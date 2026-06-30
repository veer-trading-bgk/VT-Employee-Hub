# APForce V3 — Communications

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## V3 Communications Philosophy

The Communications module replaces the V2 "WhatsApp Inbox." The rename is deliberate — it signals that this module is the gateway for all customer communication, not just one channel.

**Today:** WhatsApp only.
**V3 architecture:** WhatsApp with a structure that accommodates Instagram DMs, Facebook Messenger, Email, SMS, and Voice without rebuilding.

The design rule: **every capability in Communications must be channel-agnostic at the data model level, even if the UI only shows WhatsApp today.**

---

## Module Structure

```
Communications
├── All         unified conversation list, all channels
├── Mine        conversations assigned to me
├── Unassigned  conversations with no assignee (triage queue)
├── Resolved    closed conversations (searchable archive)
└── Templates   message templates library (all channels)
```

Channels appear as a filter within each list, not as separate nav items. This means adding Instagram DMs is a new filter option, not a new module.

---

## Conversation Data Model

A **Conversation** is a thread of messages between the business and a customer on a specific channel.

```
Conversation {
  id              string
  contactId       string (the contact this conversation belongs to)
  channel         'whatsapp' | 'instagram' | 'facebook' | 'email' | 'sms' | 'voice'
  channelId       string (WA phone number, IG account, email address, etc.)
  externalId      string (WA conversation ID, IG thread ID, etc.)
  status          'open' | 'resolved' | 'unassigned'
  assignedTo      string? (userId)
  createdAt       string (ISO)
  lastMessageAt   string (ISO)
  lastMessageBy   'contact' | 'agent'
  unreadCount     number
  // Channel-specific extensions
  whatsapp?: {
    windowExpiresAt   string (24h business messaging window)
    phoneNumberId     string
  }
  instagram?: {
    username          string
  }
  email?: {
    subject           string
    fromAddress       string
  }
}
```

**Key design principle:** `contactId` links every conversation to a Contact record. When a new WhatsApp message arrives from an unknown number, a Contact is created (lifecycle = Unknown) and a Conversation is created. When that unknown contact is later converted to a lead, the Conversation history is preserved and linked to the lead's Customer 360.

---

## Message Data Model

A **Message** is a single item in a Conversation.

```
Message {
  id              string
  conversationId  string
  direction       'inbound' | 'outbound'
  channel         same as Conversation.channel
  content         string | null (null for media-only messages)
  type            'text' | 'image' | 'document' | 'audio' | 'video' | 'template' | 'note'
  mediaUrl        string? (S3 URL for media messages)
  sentBy          string? (userId for outbound, null for inbound)
  sentByName      string?
  timestamp       string (ISO)
  status          'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  // WhatsApp-specific
  waMessageId     string?
  templateName    string? (for template messages)
  // Internal notes
  isNote          boolean (true for internal notes, not visible to customer)
  // Reply-to threading
  replyTo?: {
    messageId     string
    content       string
    direction     'inbound' | 'outbound'
  }
}
```

The `type: 'note'` and `isNote: true` fields distinguish internal agent notes from customer-visible messages. Notes appear in the conversation thread with a distinct visual treatment (yellow background, lock icon) so agents never accidentally treat a note as a sent message.

---

## Conversation List — Design

### Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  Communications                                                       │
│  All  ·  Mine (4)  ·  Unassigned (2)  ·  Resolved  ·  Templates    │
├──────────────────────────────────────────────────────────────────────┤
│  🔍 Search conversations...                        [Filter ▾]        │
├────────────────────────────────────────────────────────────────────  │
│  ● Meera Pillai          WhatsApp                        2h ago       │
│    KYC docs sent ✓                                                   │
│                                                                      │
│  ● Rajan Singh           WhatsApp          ⚠ OVERDUE    4d ago       │
│    "Will call you Monday" (your message)                             │
│                                                                      │
│  ○ Unknown +91 9179xxxx  WhatsApp          NEW          Just now      │
│    "Hi, interested in MF"                                            │
│                                                                      │
│  ● Priya Nair            WhatsApp          RESOLVED     Yesterday     │
│    NAV query resolved                                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Conversation list item anatomy

```
[Status dot] [Contact name]   [Channel badge]  [Urgency flag]   [Time]
             [Last message preview]
```

**Status dot:**
- ● Filled = unread (customer's message waiting)
- ○ Empty = read / agent responded last
- ✓ Check = resolved

**Urgency flags:**
- `NEW` — message arrived in the last 30 minutes
- `OVERDUE` — last message from agent was > 48h ago (configurable)
- `⚠ 24H` — WhatsApp 24h window expiring in < 2h
- `ASSIGNED` — recently assigned to this agent
- `VIP` — contact lifecycle is VIP

**Channel badge:** Small icon indicating channel (WA icon, IG icon, email icon). In V3, most conversations will show the WA icon. The badge scales gracefully when more channels are added.

---

## Chat Pane — Design

```
┌──────────────────────────────────────────────────────────────────────┐
│  [←]  Meera Pillai  ·  WhatsApp  ·  ● Open  ·  Arun       [☰ ···]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [Today, 29 Jun]                                                     │
│                                                                      │
│  ◀ Meera (2:15 PM)                                                   │
│  Hi, can I send the Aadhar now?                                      │
│                                                                      │
│                              Arun (2:18 PM) ▶                        │
│                              Yes please, that's all we need.         │
│                              ✓✓ Read                                 │
│                                                                      │
│  ◀ Meera (2:20 PM)                                                   │
│  [📄 Aadhar_Meera.pdf]  340KB                                        │
│                                                                      │
│  🔒 Internal note · Arun (2:22 PM)                                   │
│  Aadhar received. Uploading to KYC system.                           │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  [📎] [💬] [⚡]  Type a message...                    [📤 Send]    │
│  24h window: ████████░░  19h remaining                               │
└──────────────────────────────────────────────────────────────────────┘
```

**Toolbar icons:**
- 📎 Attachment — upload image, document, audio
- 💬 Template — browse and send approved WA templates
- ⚡ Canned — browse and insert canned responses
- 📤 Send — send the message

**24h window indicator:** A progress bar showing remaining time in the WhatsApp 24h messaging window. Disappears for channels that don't have session limits (email, Instagram DMs). Turns red when < 2h remain, prompts agent to send a template before the window closes.

---

## Right Sidebar — Contact Context Strip

The right sidebar in Communications is simplified from V2. It is a **context strip**, not a mini contact manager.

```
┌──────────────────────────────────┐
│  Meera Pillai                    │
│  +91 9876 543210                 │
│  ★ Investor                     │
│                                  │
│  Stage  [Qualified ●]            │
│  Health  ████░ 62               │
│                                  │
│  Assigned to: Arun Kumar  [▾]   │
│  Status:  ● Open  [▾]           │
│                                  │
│  [Open in Customer 360 ↗]        │
└──────────────────────────────────┘
```

**What the sidebar shows:**
- Contact name and phone (read-only)
- Lifecycle stage badge (read-only — not a dropdown)
- Pipeline stage chip (read-only — not a dropdown)
- Health score
- Assigned agent (editable — conversation routing)
- Chat status (open/resolved/unassigned — editable — conversation lifecycle)
- "Open in Customer 360 ↗" — the primary CTA

**What the sidebar does NOT show (removed from V2):**
- Stage mutation dropdown (→ Customer 360 CRM tab)
- Tag editor (→ Customer 360 Profile tab)
- Quick note input (→ Customer 360 Notes tab)
- Product interest editor (→ Customer 360 Profile tab)

**The one mutation kept:** Assigned agent and chat status. These are *conversation routing* decisions that belong to the conversation context, not the contact record. Changing who handles this conversation should not require navigating away from the conversation.

---

## Templates Library

Templates in V3 are managed per-channel. WhatsApp templates are Meta-approved messages used when the 24h window has closed or for structured outreach.

**Template structure:**
```
Template {
  id          string
  name        string
  channel     'whatsapp' | 'instagram' | 'email' | 'sms'
  category    'utility' | 'marketing' | 'authentication'
  language    'en' | 'hi' | 'te' | 'kn' | 'ta' (etc.)
  body        string (with {{variable}} placeholders)
  header      string? (for WA templates with headers)
  footer      string? (for WA templates with footers)
  buttons     Array<{type, text, url?}>?
  status      'approved' | 'pending' | 'rejected'
  usageCount  number
  lastUsedAt  string?
}
```

**Template library UI:**
```
Templates
─────────────────────────────────────────────────────────
Filter: [All] [WhatsApp] [Email]  [📋 Category ▾]

  Welcome Message                    WhatsApp · Utility · EN
  "Hi {{name}}, welcome to [Firm]..."
  Used 127 times · Last used 2d ago
  [Use]  [Edit]  [Preview]

  KYC Reminder                       WhatsApp · Utility · EN
  "Hi {{name}}, your KYC is pending..."
  Used 43 times · Last used 5d ago
  [Use]  [Edit]  [Preview]
─────────────────────────────────────────────────────────
[+ New Template]
```

---

## Canned Responses

Canned responses are quick-reply shortcuts for common messages. Unlike templates, they do not require Meta approval — they are internal shortcuts that paste text into the compose field for the agent to edit before sending.

**Canned response triggers:**
- `/welcome` → "Hi [name], thank you for reaching out to [firm]!"
- `/kyc` → "To proceed with your Demat account opening, we need your PAN card and Aadhar. Could you please share them?"
- `/pending` → "Your documents are with us. We'll revert within 24 working hours."
- `/refer` → "Thank you for your trust! If you know someone looking to invest, we'd love to help them too. Do refer us!"

Agents type `/` in the compose field to trigger the canned response picker.

---

## Channel Architecture — Future Proofing

### V3 — WhatsApp (live)

Status: Fully implemented in V2. V3 moves it into the Communications module structure.

Implementation: Meta WhatsApp Business API via the existing Lambda backend.

### Future: Instagram DMs

When ready, Instagram DMs are added as a new `channel` type:
- Conversation list gains a "Instagram" filter tab
- Messages show the Instagram icon
- 24h window logic applies (Instagram has a similar session limit)
- Customer 360 Conversation tab gains an Instagram filter

**No new module needed.** It is a new row in the channel selector.

### Future: Facebook Messenger

Same pattern as Instagram. Added as `channel: 'facebook'`.

### Future: Email

Email has structural differences (subject line, thread structure, attachments, HTML vs plain text). The channel model accommodates this through the `channel`-specific extension fields on the Conversation object.

Email templates are distinct from WA templates (no Meta approval process; but still stored in the Templates library with `channel: 'email'`).

**Thread model:** Email threads (multiple replies under one subject) map to a single Conversation record. Each reply is a Message. This is consistent with how WA conversations work.

### Future: SMS

SMS is the simplest addition — no session limits, no template approval, text-only. Added as `channel: 'sms'`.

### Future: Voice Calls

Voice calls are the most structurally different channel. A call is a Conversation where the messages are:
- `type: 'call_started'` — call initiated
- `type: 'call_ended'` — call ended with duration
- `type: 'voicemail'` — voicemail recording (media URL)
- Agent's typed `note` messages (post-call notes)

The Timeline in Customer 360 would show: "Arun called Meera Pillai · 12 min · Connected · 15 Jun 2026"

The call itself may be handled by an external VoIP system (Exotel, Tata Tele, etc.) with a webhook delivering call metadata to APForce. APForce stores the record; it does not handle the call audio.

---

## Channel Unification in Customer 360

Customer 360 > Conversation tab in V3 shows messages from ALL channels for that customer, unified in chronological order.

```
Timeline order (Conversation tab):
  ◀ WhatsApp  Meera (15 Jun): "Hi, interested in Demat"
  ▶ WhatsApp  Arun (15 Jun): "Thank you, let me help you!"
  ► Email     Arun (16 Jun): [sent KYC instructions document]
  ◀ WhatsApp  Meera (18 Jun): "Documents sent!"
  📞 Voice    Arun (20 Jun): "12-min call · Connected"
  ◀ Instagram Meera (22 Jun): "Quick question about MF?"
```

The channel icon before each message entry identifies which channel it came from.

**Filter within Conversation tab:**
```
All Channels | WhatsApp | Email | Instagram | Voice
```

---

## Notification Architecture

Communications generates notifications to agents. The notification system is independent of the chat pane — it works even when the agent is in a different module.

**Notification triggers:**
| Event | Who is notified | Delivery |
|---|---|---|
| New inbound message (assigned) | Assigned agent | In-app banner + browser notification |
| New inbound message (unassigned) | All agents in unassigned queue | In-app badge on Communications |
| 24h window expiring in 2h | Assigned agent | In-app banner |
| Conversation assigned to me | Me | In-app notification |
| Automation sent a message on my behalf | Me | Silent (recorded in Timeline only) |
| VIP contact sends first message of day | Assigned agent | Prominent in-app notification |

**Notification display (V3):**
- Bell icon in navbar with unread count badge
- Banner notification at top of screen (dismissible)
- Home > My Work shows conversation alerts in real-time

**No email notifications** by default (agents work in-app). Email digest is a future opt-in feature.

---

## Communications and Customer 360 — Relationship Defined

| Scenario | Correct module |
|---|---|
| Agent handling inbound queue (multiple contacts) | Communications |
| Agent doing deep work on one specific contact | Customer 360 > Conversation tab |
| Sending a message while reviewing the full relationship | Customer 360 > Conversation tab |
| Manager reviewing which conversations need attention | Communications |
| Agent sending a bulk template (future Campaigns) | Campaigns (future) |
| Agent searching for a past message from a specific customer | Customer 360 > Conversation tab OR Timeline tab |

Both Communications and Customer 360 > Conversation tab show the same message thread. They serve different workflow contexts. The data is identical. The experience is complementary.
