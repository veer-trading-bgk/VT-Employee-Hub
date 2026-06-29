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

Customer 360 manages **one customer**. Broader business capabilities (campaigns, automation, analytics) are separate modules that may surface data *inside* Customer 360 as widgets — but are not tabs.

```
Contact
├── Profile          → identity, editable fields, analytics widgets
├── Conversation     → WhatsApp chat workspace
├── Timeline         → unified chronological activity feed
├── CRM              → stage, pipeline, deal value, follow-ups
├── Tasks            → follow-up management workspace
├── Notes            → internal agent notes
└── Documents        → shared files, WhatsApp media
```

### What is NOT a tab (and why)

| Feature | Integration approach |
|---|---|
| AI | Activity Panel chip, CRM win-probability slot, Timeline AI event type, Conversation draft suggestions — AI is an assistant, not a workspace |
| Automation | Timeline automation event type, CRM extension point — automation is event-driven, not a workspace |
| Campaigns | Future Campaigns module outside Customer 360; `data-slot` extension points reserved in CRM and Timeline |
| Analytics | Contact-level stats appear as widgets in Profile and CRM; system analytics live in a separate Analytics module |

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
```

Tab state is in the URL. Browser back/forward navigates between tabs. Deep-links from other pages work. Invalid `?tab=` values default to the Profile tab.

Tabs **not** in the URL structure (removed in Commit 6): `campaigns`, `automation`, `ai`.

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

The canonical WhatsApp chat view for this contact, implemented as `ConversationTab` (`components/contacts/tabs/ConversationTab.tsx`).

**Implementation note (updated Commit 2):** `ChatPane` from the Inbox is architecturally coupled to `InboxContext`, which owns the full inbox state machine (all conversations, ping loop, unread counts). Mounting `InboxProvider` inside Customer 360 would duplicate the entire inbox API call surface — a clear violation of the "no duplicate API requests" rule. `ConversationTab` therefore reuses the same API endpoints, WebSocket subscription pattern, and UI conventions as `ChatPane`, but is fed by `Customer360Provider` instead of `InboxContext`.

**Behaviour:**
- `ConversationTab` reads messages, notes, and timeline from `Customer360Context` — no second fetch
- Message data comes from the same `/api/crm/leads/:id` call that hydrates the page (fetched once by `Customer360Provider`)
- WebSocket: subscribes to `whatsapp_message` events using `useWsEvent`; on match, calls `refresh()` which invalidates `['contact', leadId]`
- Reply-to threading, internal notes, canned responses (`/` shortcut) — all implemented
- Template picker reused directly from `components/whatsapp/TemplatePicker.tsx`
- Resolve / Reopen conversation — same API endpoints as Inbox
- Mark-read — same API endpoint as Inbox
- Optimistic send — same pattern as Inbox (cache update → mutate → settle)
- Media display (images, video, audio, documents) — implemented inline in `ConversationTab`
- Media upload (new attachments) — deferred to Commit 3; file picker shows informational toast
- Right activity panel slot reserved as `data-slot="activity-panel"` — hidden; future widgets plug in here
- `ConversationTab` is wrapped in `React.memo` to prevent rerenders when unrelated contact metadata changes

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

### AI Integration (not a tab)

AI surfaces in three locations:

- **Activity Panel** — health score chip (`— / 100` until AI enabled), next action recommendation slot (`data-slot="activity-panel-ai"`)
- **CRM tab** — win probability field (reserved, shows `—` until AI enabled)
- **Timeline** — `ai` event type defined; renders when AI events are injected via the event conversion layer
- **Conversation tab** — draft suggestion slot (`data-slot="conversation-ai-draft"`) reserved

### Automation Integration (not a tab)

Automation events surface in the Timeline as `workflow` event type. The `data-slot="timeline-ext-workflow"` extension point is already present. Automation context (which rules affect this contact) can be surfaced as a card in the CRM tab in a future commit.

### Campaign Extension Points (not a tab)

`data-slot="timeline-ext-campaign"` and `data-slot="timeline-ext-broadcast"` are reserved in the Timeline. Campaign data is not fetched inside Customer 360. A future Campaigns module will inject campaign events via these slots.

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
│    Campaigns                  │  Profile │ Conversation │ Timeline │ CRM │ Tasks │ Notes │ Documents  │
│  Automation                   │  ─────────────────────────────────────────────────────────────────  │
│    Workflow                   │                                                      │
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

The hamburger sidebar overlays the page. The tab bar shows the five most-used tabs and a "More ▾" dropdown for the remaining two (Notes, Documents).

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

## Data Architecture

### Customer360Provider

Added in Commit 2. `Customer360Provider` (`contexts/Customer360Context.tsx`) is the single source of truth for all data on the Customer 360 page.

```
ContactDetailPage
  ErrorBoundary
    div.h-screen
      Navbar(showBack)
      div.flex-1
        Suspense(PageSkeleton)
          ContactDetailPageInner              ← useParams + useSearchParams
            Customer360Provider(leadId)       ← owns ['contact', leadId] + ['crm-pipeline']
              Customer360PageContent          ← reads from useCustomer360()
                ContactHeader(contact, stages)
                ContactTabNav
                div.flex-1.overflow-auto
                  ContactTabPanel(activeTab)
                    ProfileTab                ← reads contact from props
                    ConversationTab           ← reads from useCustomer360() + own lazy queries
                    [future tabs...]
```

**Rules:**
- All tabs call `useCustomer360()` to access shared data
- No tab may directly call `useQuery(['contact', leadId])` — they consume from context
- Tabs may add their own **lazy** queries (e.g. `ConversationTab` adds `['admin-employees']` and `['wa-canned']` only when mounted)
- `refresh()` from context invalidates `['contact', leadId]` — all tabs reflect the update automatically

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
