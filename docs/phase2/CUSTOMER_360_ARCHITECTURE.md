# Customer 360 Architecture

## Product Vision

APForce is a performance platform for Angel One APs and sub-brokers. The CRM, WhatsApp inbox, and employee performance tracking used to be separate tools bolted together. Phase 2 unifies them around the single entity that matters most: the **Customer**.

A customer interacts with an AP through multiple channels (WhatsApp, forms, referrals), progresses through a sales pipeline, receives follow-ups, is targeted by campaigns, and eventually converts or churns. Every one of these events belongs to the customer — not to the channel, not to the campaign, not to the agent's task list.

The Customer 360 page is the single workspace where all of this is visible, actionable, and auditable in one place.

---

## Customer 360 Philosophy

### One entity, one page

There was previously a `/admin/crm/[id]` page (CRM Lead Detail) and a separate entry point via the WhatsApp Inbox sidebar. Both showed the same customer with different subsets of data. Agents had to switch between pages to get a complete picture. Phase 2 eliminates this split.

### Operational views remain separate

The Inbox is a queue manager — its job is to surface conversations that need attention. The CRM Pipeline is a stage manager — its job is to show where deals sit. These are workflows, not customer profiles. They remain separate navigation items. What changes is that clicking on a customer *name* from any of these views opens the same Customer 360 page.

### Everything connects from Contact

```
Contact
├── Conversations    → who said what, when
├── Timeline         → everything that happened, in order
├── CRM              → stage, pipeline position, deal value
├── Tasks            → follow-ups with outcomes
├── Notes            → internal agent notes
├── Documents        → shared files, WhatsApp media
├── Campaigns        → broadcast membership and send history
├── Automation       → which rules fire for this contact
└── AI               → health score, summary, next action
```

---

## Navigation Architecture

Three workflows reach the same destination:

```
WhatsApp Inbox  ──► [View Contact] button  ──┐
CRM Pipeline    ──► lead card click         ──┼──► /admin/contacts/[id]
Contact Hub     ──► row click               ──┘
```

See [NAVIGATION_ARCHITECTURE.md](NAVIGATION_ARCHITECTURE.md) for the complete flow map.

---

## URL Structure

```
/admin/contacts/[id]                      # default: Profile tab
/admin/contacts/[id]?tab=conversation
/admin/contacts/[id]?tab=timeline
/admin/contacts/[id]?tab=crm
/admin/contacts/[id]?tab=tasks
/admin/contacts/[id]?tab=notes
/admin/contacts/[id]?tab=documents
/admin/contacts/[id]?tab=campaigns
/admin/contacts/[id]?tab=automation
/admin/contacts/[id]?tab=ai
```

Tab state is in the URL. Browser back/forward navigates between tabs. Deep-links from other pages work.

---

## Header Layout

The header is always visible regardless of which tab is active. It is the identity anchor of the page.

### Header Sections

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [Avatar]  Name (editable inline)                     [Reassign ▼]       │
│            Phone  📱 WhatsApp   ✉ Email                                   │
│            Assigned: Priya Kapoor                                         │
│            Stage: [Proposal ▼]   Priority: 🔥 Hot                        │
│            Last activity: 2 hours ago                                     │
│                                                                           │
│  Health:  ████████░░  78 / 100                                            │
│                                                                           │
│  Journey: ●───●───●───◉───○───○───○───○───○                              │
│           Src  Con Lead Meet Prop  Won  Ret  Ref                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Header Fields

| Field | Source | Editable | Notes |
|---|---|---|---|
| Avatar | Initials from name | No | Colour derived from leadId hash |
| Name | `contact.name` | Yes — inline | Saves on blur |
| Phone | `contact.phone` | No | Click to copy |
| WhatsApp button | `contact.phone` | No | Opens WhatsApp web (or Conversation tab) |
| Email | `contact.email` | Yes — inline | |
| Assigned | `contact.assignedTo` | Yes — dropdown | |
| Stage | `contact.stage` | Yes — dropdown | Triggers stage-change automation |
| Priority | Derived from stage + follow-ups | No | 🔥 Hot / Warm / Cold |
| Last activity | Latest message timestamp | No | Relative |
| Health score | AI-calculated | No | Reserved placeholder until AI enabled |
| Journey bar | Inferred from contact state | Partially | See Journey Bar section |

---

## Customer Journey Bar

### Purpose

The journey bar provides a visual representation of where a customer is in their relationship with the AP. It is not a funnel (not all customers go through all steps). It is a timeline marker.

### Steps

```
Source → Conversation → Lead → Meeting → Proposal → Won → Retention → Referral
```

### Step Inference Rules

| Step | Complete when |
|---|---|
| Source | Always — contact exists |
| Conversation | `messageCount > 0` |
| Lead | Contact has a CRM stage entry |
| Meeting | `contact.milestones.meeting` is set (manual, future) |
| Proposal | `contact.stage === 'Proposal'` or past it |
| Won | `contact.stage === 'Won'` |
| Retention | `contact.milestones.retention` is set (future) |
| Referral | Relationship graph has referral link (future) |

### Visual States

- **Filled circle** — step is complete
- **Active ring** — current step
- **Hollow circle** — future step
- Hovering a step shows tooltip: date + actor (when available)

### v1 Behaviour

Steps 1–5 (Source through Proposal/Won) are inferred automatically. Steps 6–8 (Retention, Referral) display as hollow placeholders. Clicking any step in v1 does nothing (future: filters Timeline to that stage's events).

---

## AI Health Score

### Purpose

A single number (0–100) summarising how healthy the customer relationship is. Designed to surface at-risk contacts before they go cold.

### Six Factors (All Reserved in v1)

| Factor | Description | Future Source |
|---|---|---|
| Replies | How often the customer replies | `messageCount`, response rate |
| Engagement | Opens, reactions, clicks | Meta webhook read receipts |
| Follow-ups | Task completion rate | Follow-up done/total ratio |
| Inactivity | Days since last message | Last message timestamp |
| Sentiment | Tone of customer messages | AI sentiment analysis |
| Purchases | Conversion events | Won stage + external data |

### v1 Behaviour

The health score widget renders in the header and AI tab with a placeholder state. Until AI scoring is enabled for an account (feature flag), it shows `– / 100` in a muted style with no bar fill. The AI tab shows a banner: *"Health Score becomes active once AI is enabled for your account."* No fake data. No zeros that imply an unhealthy customer.

---

## Tab Specifications

### Tab 1 — Profile

Displays all static contact information. Read-mostly; fields are editable inline.

**Sections:**
- Personal Information (name, phone, email, city)
- Custom Fields (company, designation, annual income — configurable)
- Tags (add/remove, same component as Contact Hub)
- Source Tracking (created via, form, campaign, referral)
- Relationship Graph (placeholder — see Future Extensions)

### Tab 2 — Conversation

The canonical WhatsApp chat view for this contact. Reuses the existing `ChatPane` component from the Inbox.

**Behaviour:**
- ChatPane renders in full-width mode (no ConversationList column, no LeadSidebar column)
- The contact context comes from the parent page — ChatPane does not re-fetch identity
- WebSocket subscription is the same as used by the Inbox — real-time messages
- Template picker, emoji, attachments — all unchanged from Inbox
- If the contact has multiple conversations (rare), a `ConversationSelector` appears above the ChatPane
- Conversation tab is prefetched in the background as soon as the page mounts, so it feels instant on first click

### Tab 3 — Timeline

A chronological activity feed covering everything that happened with this contact.

**Event types:**
- Inbound message
- Outbound message (with agent name)
- Internal note (agent name)
- Stage change (from → to, agent name)
- Agent assignment change
- Tag added / removed
- Follow-up created / completed (with outcome)
- Automation triggered (rule name)
- Campaign message sent

**Filters:** All, Messages, Notes, Stage Changes, Tasks, Campaigns, Automation

**Implementation note:** Timeline is synthesised client-side from data already fetched by other tabs. No dedicated timeline API endpoint is required in v1. A dedicated `/api/contacts/:id/timeline` endpoint is planned for v2 when event volume makes client-side synthesis impractical.

### Tab 4 — CRM

Pipeline position, deal details, and lead scoring for this contact.

**Sections:**
- Pipeline position bar (horizontal stepper showing all stages, current highlighted)
- Deal details (product interest, estimated value, close deadline, priority, source)
- Lead score (field-completeness score, 0–100, shows which fields are missing)
- CRM notes (free-text, separate from internal notes in Notes tab)

**Mutations:** Stage change, assign, tag management — same APIs as current CRM pages.

### Tab 5 — Tasks

All follow-ups for this contact, grouped by urgency.

**Groups:** Overdue → Today → Tomorrow → This Week → Later

**Mark Done flow:** Clicking "Mark Done" opens an inline outcome modal:
- What happened? (free text)
- Create next follow-up? (yes/no toggle, date picker if yes)

This captures outcome data currently lost when agents mark tasks done.

### Tab 6 — Notes

Internal agent notes — not visible to the customer, separate from chat messages.

**Behaviour:**
- Text input at the top, "Post" button
- Notes feed below, newest first
- Each note shows: agent name, timestamp, text, delete button
- Notes are not editable after posting (audit integrity)

### Tab 7 — Documents

WhatsApp media shared in the conversation, plus manually uploaded files.

**Sections:**
- Media grid: images and videos from messages with `mediaUrl`
- File list: PDFs, audio, uploaded documents (future S3 upload)

### Tab 8 — Campaigns

Broadcast membership and message send history for this contact.

**Sections:**
- Active campaign membership (which broadcasts include this contact)
- Send history: date, template name, delivery status (sent/delivered/read/failed)
- Action: "Add to campaign" button

### Tab 9 — Automation

Which automation rules are active for this contact and their execution history.

**Sections:**
- Active rules: rule name, trigger, last fired, status
- Run history: date, rule name, action taken, outcome

### Tab 10 — AI

AI-generated intelligence about this contact.

**Sections:**
- Health score gauge (0–100) with factor breakdown
- AI summary (natural language paragraph from `/api/ai/insights`)
- Recommended next action (call / send message / schedule follow-up)
- Sentiment history chart (positive/neutral/negative over time)

All sections show reserved placeholders until AI is enabled.

---

## Desktop Layout (1280px+)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ APForce Sidebar (240px fixed) │  Customer 360 (fluid)                               │
│                               │                                                      │
│  Overview                     │  ← Back to Contact Hub                              │
│  Customers ▼                  │                                                      │
│    Inbox                      │  ┌──────────────────────────────────────────────┐   │
│    Contact Hub   ← active     │  │  HEADER (fixed within content area)          │   │
│    CRM Pipeline               │  │  Avatar │ Name │ Phone │ Stage │ Assigned     │   │
│  Marketing                    │  │  Health Score │ Journey Bar                   │   │
│    Broadcast                  │  └──────────────────────────────────────────────┘   │
│    Templates                  │                                                      │
│    Campaigns                  │  Profile │ Conversation │ Timeline │ CRM │ Tasks   │
│  Automation                   │  Notes │ Documents │ Campaigns │ Automation │ AI    │
│    Workflow                   │  ─────────────────────────────────────────────────  │
│    AI                         │                                                      │
│  Team                         │  [TAB CONTENT — full width, scrollable]             │
│    Employees                  │                                                      │
│    Analytics                  │                                                      │
│  System                       │                                                      │
└───────────────────────────────┴──────────────────────────────────────────────────────┘
```

The content area uses the full remaining width. No secondary sidebar panels. All customer data is in tabs.

---

## Tablet Layout (768–1279px)

```
┌──────────────────────────────────────────────────────────────────┐
│ [≡] APForce                                     [search] [bell]  │
├──────────────────────────────────────────────────────────────────┤
│ ← Contact Hub                                                     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ HEADER (compact two-row layout)                            │  │
│  │ [Avatar] Name  Phone  📱   Stage ▼  Assigned ▼             │  │
│  │ Journey: ●──●──●──◉──○──○──○──○   Health: 78              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Profile │ Conversation │ Timeline │ CRM │ Tasks │ More ▾        │
│  ────────────────────────────────────────────────────────────    │
│                                                                   │
│  [TAB CONTENT — scrollable]                                      │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

The hamburger sidebar overlays the page. The tab bar shows the five most-used tabs and a "More ▾" dropdown for the remaining five (Notes, Documents, Campaigns, Automation, AI).

---

## Mobile Layout (< 768px)

```
┌───────────────────────────────────────────┐
│ ← Rahul Sharma                    [•••]   │
├───────────────────────────────────────────┤
│  HEADER (collapsed)                       │
│  ┌───┐ Rahul Sharma                       │
│  │RS │ +91 98765 43210  📱  ✉             │
│  └───┘ Stage: Proposal 🔥  Health: 78     │
│        Assigned: Priya Kapoor             │
│        Last activity: 2 hours ago         │
│                                           │
│  ●──●──●──◉──○──○──○──○                  │
│  Src Convo Lead Prop Won Ret Ref          │
├───────────────────────────────────────────┤
│ < Profile │ Convo │ Timeline │ CRM │ > │  │
├───────────────────────────────────────────┤
│  [TAB CONTENT — full screen, scrollable]  │
└───────────────────────────────────────────┘
```

The header collapses to two rows. The journey bar is horizontal-scrollable. The tab bar is swipe-scrollable. The back button returns to Contact Hub.

---

## Component Hierarchy

See [UI_COMPONENT_ARCHITECTURE.md](UI_COMPONENT_ARCHITECTURE.md) for the full component tree with props and state ownership.

---

## Relationship Graph (Reserved)

The Profile tab contains a reserved section for the Relationship Graph. In v1, all fields display as `–` with a note that this feature is planned. The section headings and field slots are present in the DOM so they do not require a layout change when the feature ships.

Reserved relationship types:
- Company
- Decision Maker
- Influencer
- Referral From / Referred
- Family
- Accountant / Advisor

---

## Future Extensibility

The Customer 360 page is designed to absorb new tabs without structural changes. The tab nav is data-driven. Adding a new tab requires:
1. A new tab constant in the tab config array
2. A new `*Tab.tsx` component under `components/contacts/tabs/`
3. A case in the tab panel switch

See [FUTURE_EXTENSIONS.md](FUTURE_EXTENSIONS.md) for planned extensions.
