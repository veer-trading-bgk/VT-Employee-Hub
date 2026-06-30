# APForce V3 — Customer 360 Vision

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## The Absolute Rule

> Customer 360 represents exactly one customer. Every feature inside Customer 360 must pass this test: "Does this help me understand, communicate with, or take action on this specific customer?" If the answer is no, it does not belong here.

Customer 360 is the heart of APForce. Everything else in the product is either feeding into it (finding a customer to work on) or consuming data from it (analytics, reports). The workspace itself must be fast, complete, and unambiguous.

---

## What Does Not Change in V3

The 7-tab structure is proven and stays:

```
Profile | Conversation | Timeline | CRM | Tasks | Notes | Documents
```

The tab boundary rule is frozen: **no new tabs without an explicit architecture review**.

The `Customer360Provider` pattern stays: all data for the workspace is fetched once, owned by a single context, and consumed by all tabs.

The URL pattern stays: `/customers/[id]?tab=[tabId]&from=[source]`

---

## What Improves in V3

### Header — Identity Layer

**Current state:** Avatar, name, phone/email, pipeline stage chip, health score, Customer Journey Bar, "Customer 360" workspace pill.

**V3 improvement:** The header becomes the *relationship identity layer* — not just who the person is, but what your relationship is with them right now.

**V3 header structure:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← CRM   Customer 360                                    [🔍 Search] │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [MP]  Meera Pillai                          ★ Investor             │
│        +91 9876 543210  ·  meera@gmail.com                          │
│        KYC · Demat · Mutual Funds                                    │
│        Assigned: Arun Kumar  ·  Source: WhatsApp                    │
│                                                                      │
│  Stage: [Qualified ●]    Health: ████░ 78        [Next Action: →]   │
│                                                                      │
│  Source ●──── Convo ●──── Lead ●──── Meeting ●──── Proposal ●──── Won ●──── Retention ○──── Referral ○ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Changes from V2:**
1. **Lifecycle badge is prominent** — moved from small pill to named badge (★ Investor, Lead, Customer etc.) with colour coding
2. **Product interest chips** — visible in header, not just in Profile tab
3. **"Next Action" button** — AI-suggested or manually set next step, visible in header. "Call back 1 Jul", "Send MF proposal", etc. One click opens the relevant tab.
4. **Health score as progress bar** — not just a number, but a visual indicator of relationship health
5. **Pipeline stage chip stays** — quick-read of current CRM position

---

### Health Score — Relationship Vitality

**Current state:** `HealthScoreBadge` shows a number (0–100). `aiEnabled={false}` — always shown as a static number.

**V3 improvement:** Health score becomes a **multi-signal indicator** with an explanation.

**Health score signals (weighted):**
| Signal | Weight | What it measures |
|---|---|---|
| Last inbound message recency | 25% | Is the customer still engaging? |
| Follow-up completion rate | 20% | Are we keeping our promises? |
| Response time | 15% | How fast do we respond? |
| Lifecycle stage progress | 15% | Is the relationship advancing? |
| Task overdue rate | 15% | Are we slipping on this customer? |
| Note recency | 10% | Are we documenting the relationship? |

**Health score display in header:**
```
Health  ████░░  62  [?]
```

Hovering the `[?]` shows a tooltip:
```
Relationship Health: 62/100

✓ Responded to last 3 messages quickly
✓ Lifecycle stage advanced to Investor
⚠ 1 overdue follow-up task
⚠ Last inbound message was 8 days ago
⚠ No notes added in 14 days
```

**Phase 3 note:** Health score calculation stays client-side in V3 (derived from available Contact record data). AI-enhanced health scoring (using NLP on conversation content) is Phase 4+.

---

### Timeline — Complete Relationship History

**Current state:** Timeline tab shows messages and notes in chronological order with type filters (all / messages / crm / notes / tasks / system).

**V3 improvement:** The Timeline becomes the **single audit trail for everything that has ever happened** with this customer.

**New event types added to Timeline:**

| Event type | Trigger | Display |
|---|---|---|
| `lifecycle_change` | Lifecycle stage promoted or demoted | "Became a Customer on 2 Jul 2026 · Promoted by Arun Kumar" |
| `pipeline_move` | Stage changed (drag-drop or CRM tab) | "Stage moved: Contacted → Qualified · Arun Kumar" |
| `assignment_change` | Contact reassigned to different agent | "Reassigned from Priya to Arun · Manager Kavitha" |
| `automation_trigger` | Automation rule fired | "Auto-sent: Welcome template · Automation: Win Trigger" |
| `document_upload` | Document added | "Document uploaded: PAN card · Arun Kumar" |
| `health_alert` | Health score dropped significantly | "⚠ Health score dropped 20 points (8-day inactivity)" |

**Filter system (V3):**

```
All | Messages | CRM | Notes | Tasks | System | AI (Phase 4)
```

- **Messages:** Inbound + outbound WhatsApp only
- **CRM:** Stage changes, lifecycle changes, assignment changes
- **Notes:** Internal notes
- **Tasks:** Task created, completed, deleted
- **System:** Automation events, health alerts, integration events

**Timeline search (Phase 3+):** A search bar within the Timeline that filters events by keyword. Useful for "find the message where Meera mentioned PMS" without scrolling through months.

---

### Relationship Score — Trust Layer (New in V3)

**Concept:** Distinct from health score. Health score measures the *current health of the relationship* (is it warm or cold?). Relationship score measures the *depth and quality of the relationship over time* (how much do they trust us?).

**Relationship score signals:**
| Signal | What it measures |
|---|---|
| Number of messages exchanged | Volume of relationship |
| Number of follow-ups kept | Promise reliability |
| Customer-initiated messages | Is the customer proactively reaching out? |
| Products purchased | Investment in the relationship |
| Referrals given | Ultimate trust signal |
| Tenure (days since first contact) | Relationship duration |

**Display:** Relationship score is shown as a badge under the customer name in the header (not as a number — as a tier):

```
● New       (< 30 days, < 20 messages)
● Growing   (30–90 days, 20–50 messages, 1+ product)
● Established (90+ days, 50+ messages, 2+ products)
● Trusted   (Referral given, 2+ products, 180+ days)
● Champion  (Multiple referrals, VIP tier, 1+ year)
```

This gives the agent an instant qualitative understanding of the relationship depth without reading the entire timeline.

**V3 scope:** Relationship score is calculated client-side from available data. Display as a badge in the header. The algorithm is defined in the codebase and can evolve in Phase 4.

---

### Next Best Action — Intelligent Prompt (V3 Header)

**Concept:** Based on the current state of the customer record, the system suggests the single most important action the agent should take right now.

**Rules engine (client-side, V3):**

| Condition | Suggested action |
|---|---|
| Last inbound message received, no reply | "Reply to Meera's message" |
| Follow-up task overdue | "Complete overdue follow-up" |
| Pipeline stage = Proposal, no activity 7d | "Follow up on your proposal" |
| Lifecycle = Lead, no meeting milestone | "Schedule a meeting" |
| Lifecycle = Customer, no investment recorded | "Discuss first investment" |
| Health score < 40 | "Reach out — relationship at risk" |
| 24h WhatsApp window expiring in < 2h | "Send a message before window closes" |
| No note added in 30 days | "Log a note on this relationship" |

**Display in header:**
```
Next Action: [Reply to Meera's message →]
```

Clicking the Next Action button navigates to the relevant tab (Conversation, Tasks, CRM etc.) directly. The button is not a command — it is a navigation shortcut that respects the agent's judgment.

**Why not make it an AI feature from the start:** The rules engine is deterministic and explainable. Every suggestion comes from a named rule. This is important in financial services where agents should be able to justify every action. AI-enhanced next actions (using conversation content analysis) are Phase 4+ and optional.

---

### CRM Tab — Deal Management (Enhanced)

**V3 additions:**

| Field | Status | Notes |
|---|---|---|
| Pipeline stage | Current (V2) | Stays. Single mutation surface. |
| Closure deadline | Current (V2) | Stays. |
| Expected deal value | Reserved (V2) | Activate in V3. Input in ₹. |
| Win probability | New (V3) | Manual 0–100% slider. AI-enhanced in Phase 4. |
| Deal notes | New (V3) | Notes specific to this deal (distinct from contact notes) |
| Products in progress | New (V3) | Which products are currently being worked? KYC in progress, Demat pending. |
| Follow-ups | Current (V2) | Stays. |

**Expected deal value and win probability:** Enable revenue forecasting. `Expected value × Win probability = Weighted pipeline value`. This feeds Analytics > Pipeline with a revenue forecast. The calculation is `SUM(expectedValue * probability/100)` across all leads. Displayed in Sales > Pipeline board header.

---

### Documents Tab — File Management (Phase 3 Implementation)

**V3 scope:** The Documents tab currently shows a "coming soon" stub. V3 builds it.

**What Documents contains:**
- KYC documents (PAN, Aadhar, photo) uploaded by agent or customer
- WhatsApp media received from this customer (auto-synced from conversation)
- Files manually uploaded by agents
- System-generated documents (future: offer letters, portfolio reports)

**Document card structure:**
```
┌────────────────────────────────────────────────────────┐
│  📄 PAN_Card_Meera.jpg                                  │
│  Uploaded by Arun · 15 Jun 2026 · 240 KB               │
│  KYC Document                                          │
│  [Download]  [Share Link]  [Delete]                    │
└────────────────────────────────────────────────────────┘
```

**Categories:** KYC Documents | WhatsApp Media | Agent Uploads | System Documents

**Delete policy:** Only the uploader or a manager/admin can delete documents. Deleted documents leave an audit trail in the Timeline: "Document deleted: [name] · [user] · [reason]"

---

### Activity Panel (Conversation Tab) — Enhanced

The ActivityPanel inside the Conversation tab (right sidebar within the tab) is enhanced with V3 signals:

**Current (V2):** Health chip, tags, quick actions.

**V3 ActivityPanel:**
```
┌──────────────────────────────────────────┐
│  Relationship Context                    │
│  ─────────────────                       │
│  Health     ████░ 62                     │
│  Stage      Qualified                    │
│  Lifecycle  Investor ★                   │
│  Last note  "Interested in PMS" · 3d ago │
│                                          │
│  Next Action                             │
│  [Send PMS performance report →]         │
│                                          │
│  Open Tasks (2)                          │
│  🟡 PMS proposal · Due tomorrow          │
│  🟢 SIP confirmation · Due 5 Jul         │
│                                          │
│  Products                                │
│  KYC ✓  Demat ✓  MF ✓  Insurance ○      │
└──────────────────────────────────────────┘
```

The ActivityPanel gives the agent full relationship context while they are in the middle of a live conversation — they do not need to switch tabs.

---

### AI Summary (Phase 3 Foundation, Phase 4 Full)

**Concept:** A one-paragraph AI-generated summary of the customer relationship, visible in the header or as a collapsible panel.

**V3 scope:** Reserve the slot in the UI. Show a `data-slot="ai-summary"` container. Implementation is Phase 4 (requires LLM API integration).

**What AI summary would contain (Phase 4):**
- Key topics discussed in the last 30 days
- Customer sentiment (positive / neutral / cautious)
- Products discussed and their status
- Relationship risk factors

**Why reserve in V3:** The data-slot pattern (already used in Timeline for extension points) ensures that when Phase 4 AI summary is ready, it can be injected without restructuring the Customer 360 layout.

---

### Extension Slots

Customer 360 has reserved `data-slot` attributes for future capabilities that are NOT tabs:

| Slot | Location | Future capability |
|---|---|---|
| `data-slot="header-ext"` | Header, below journey bar | Campaign membership badge, referral chain link |
| `data-slot="ai-summary"` | Profile tab, top | AI-generated relationship summary |
| `data-slot="timeline-ext-workflow"` | Timeline, between events | Workflow automation event injection |
| `data-slot="timeline-ext-marketplace"` | Timeline, between events | Future marketplace integration events |
| `data-slot="crm-ext-scoring"` | CRM tab, above stage | AI win probability (when ready) |
| `data-slot="conversation-ext-draft"` | Conversation tab, above input | AI draft suggestion slot |

These slots exist in the HTML as empty `div` elements with the `data-slot` attribute. They are invisible when empty. They receive content via injection when the corresponding feature is enabled. This prevents structural rewrites when new capabilities land.

---

## Customer 360 Rules — Permanent

1. **The tab list is frozen.** Profile, Conversation, Timeline, CRM, Tasks, Notes, Documents. No new tabs without a documented architecture review.

2. **Customer360Provider owns all data fetching.** No tab fetches data independently. All tabs consume via `useCustomer360()`.

3. **No duplicate query keys.** Every query key is owned by exactly one consumer. If a tab needs data that another tab already fetches, it reads from the shared context.

4. **Backward-compatible navigation.** The `?from=` parameter always works. Back button always returns to the correct source module.

5. **Header is always visible.** Regardless of which tab is active, the header (identity, lifecycle, stage, health) is always visible. The customer's identity is the context for all tab content.

6. **Timeline is the audit trail.** Every significant event is recorded in the Timeline. Nothing important is deleted from the Timeline. Timeline is append-only.

7. **Single source of truth for mutations:**
   - Stage: CRM tab (plus kanban drag-drop as the sole exception)
   - Tags: Profile tab
   - Assignee: Profile tab
   - Lifecycle: Profile tab (with confirmation dialogs)
   - All other fields: the tab that owns them
