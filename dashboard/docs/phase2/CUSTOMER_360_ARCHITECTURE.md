# Customer 360 Architecture

**Status:** Complete — Phase 2 (v2.1.0)
**Frozen:** Tab list and provider tree are frozen. Changes require an explicit architecture decision.

---

## Overview

Customer 360 is the canonical customer workspace in APForce. It represents exactly one customer across every mode of interaction — WhatsApp conversation, CRM pipeline, task management, internal notes, and document sharing.

### Boundary Rule

Before placing any feature inside Customer 360, it must pass this test:

> "Does this feature help understand, communicate with, or operate a single customer?"

If yes → it belongs inside Customer 360.
If no → it belongs in a separate module.

---

## Route Structure

| Route | Description |
|---|---|
| `/admin/contacts` | Contact Hub — list, search, filter, create |
| `/admin/contacts/[id]` | Customer 360 — canonical customer workspace |
| `/admin/crm/[id]` | Server-side redirect to `/admin/contacts/[id]?from=crm` (bookmark compatibility) |

### Back Navigation Chain

Customer 360 uses a `?from=` URL parameter to surface a contextual back button label. No separate back-stack management is needed.

| `from` value | Back button label | Source page |
|---|---|---|
| `hub` | Contact Hub | `/admin/contacts` |
| `inbox` | Inbox | `/admin/whatsapp` |
| `crm` | CRM | `/admin/crm` |
| `search` | Search | Global search palette |
| *(absent)* | Contact Hub | Default fallback |

---

## Provider Tree

```
ContactDetailPage (page.tsx)
└── ErrorBoundary
    └── Suspense
        └── ContactDetailPageInner       ← resolves URL params, sets back label
            └── Navbar (showBack + backLabel)
            └── Customer360Provider      ← single provider for entire workspace
                └── Customer360PageContent
                    ├── ContactHeader
                    ├── ContactTabNav
                    └── ContactTabPanel
                        ├── ProfileTab
                        ├── ConversationTab
                        │   └── ActivityPanel
                        ├── TimelineTab
                        ├── CrmTab
                        ├── TasksTab
                        ├── NotesTab
                        └── Documents (ComingSoonPanel)
```

**Rules:**
- `Customer360Provider` is instantiated exactly once per page load.
- All tabs consume data via `useCustomer360()`. No tab fetches `['contact', leadId]` directly.
- `ConversationTab` may call `cancelQueries(['contact', leadId])` for optimistic updates — this is permitted.

---

## Frozen Tab List

The tab list is frozen at seven tabs. Do not add tabs without an explicit architecture decision recorded in this file.

| Tab ID | Label | Status | Data source |
|---|---|---|---|
| `profile` | Profile | ✅ Complete | `contact` from Customer360Provider |
| `conversation` | Conversation | ✅ Complete | `messages` from Customer360Provider |
| `timeline` | Timeline | ✅ Complete | `timeline` (merged messages + notes) from Customer360Provider |
| `crm` | CRM | ✅ Complete | `contact`, `stages`, `followups` from Customer360Provider |
| `tasks` | Tasks | ✅ Complete | `followups` from Customer360Provider |
| `notes` | Notes | ✅ Complete | `notes` from Customer360Provider |
| `documents` | Documents | 🔲 Placeholder | Phase 3 |

---

## React Query Key Ownership

| Query key | Owner | Consumers | staleTime |
|---|---|---|---|
| `['contact', leadId]` | `Customer360Provider` | All tabs via `useCustomer360()` | 60s |
| `['crm-pipeline']` | `Customer360Provider` | CrmTab, ActivityPanel via context | 10 min |
| `['crm-followups', leadId]` | `Customer360Provider` | TasksTab, ActivityPanel, CrmTab via context | 30s |
| `['tag-catalog']` | Shared (no single owner) | ProfileTab, CrmTab, ActivityPanel, `(v3)/inbox/page.tsx` via `ContactTags`/`useTagCatalog()` | 5 min |
| `['contacts']` | Contact Hub page | Contact Hub list | varies |
| `['global-search', q]` | GlobalSearch component | Self | 30s |
| `['admin-employees']` | CrmTab | Self | 10 min |

**Invariant:** No component introduces a new `['contact', leadId]` query. This key is exclusively owned by `Customer360Provider`.

---

## Extension Points

Reserved `data-slot` attributes mark locations where future capabilities will integrate. These are stable API contracts — do not remove them.

### Activity Panel

| Slot | Reserved for |
|---|---|
| `activity-panel-ai-health` | AI health score chip |
| `activity-panel-tasks` | Upcoming tasks summary |
| `activity-panel-ai` | AI next-action recommendation |
| `activity-panel-workflow` | Active workflow status |
| `activity-panel-sla` | SLA countdown |
| `activity-panel-files` | Recent file attachments |

### Timeline Tab

| Slot | Reserved for |
|---|---|
| `timeline-ext-ai` | AI-generated event type |
| `timeline-ext-workflow` | Workflow execution event |
| `timeline-ext-campaign` | Campaign event |
| `timeline-ext-broadcast` | Broadcast send event |
| `timeline-ext-marketplace` | Marketplace event |
| `event-ext-{type}` | Per-event type extension |

### CRM Tab

| Slot | Reserved for |
|---|---|
| `stage-history` | Stage transition history timeline |

### Tasks Tab

| Slot | Reserved for |
|---|---|
| `tasks-workflow` | Workflow-created task type |

### Profile Tab

| Slot | Reserved for |
|---|---|
| `profile-relationship-graph` | Phase 3 relationship mapping |
| `profile-response-rate` | AI-computed response rate metric |

---

## Integration Rules for Future Capabilities

Future capabilities must integrate into existing tabs or the Activity Panel. They must NOT become new tabs.

| Capability | Where it integrates |
|---|---|
| AI | Activity Panel (health chip, next action), CRM (win probability), Timeline (ai event type), Conversation (draft suggestion slot) |
| Automation | Timeline (workflow event type), CRM extension point, Tasks (auto-created tasks) |
| Campaigns | Future separate module; extension slots reserved in CRM and Timeline |
| Analytics | Contact-level widgets in Profile and CRM; system-wide analytics in a separate Analytics module |
| Marketplace | `data-slot="timeline-ext-marketplace"` reserved; no implementation inside Customer 360 |
| Workflow | `data-slot="timeline-ext-workflow"` reserved; no implementation inside Customer 360 |

---

## Architecture Decisions

### AD-001: Customer 360 as canonical workspace (Phase 2)

**Decision:** `/admin/contacts/[id]` is the single source of truth for all customer interactions. The legacy `/admin/crm/[id]` route is retired and replaced with a server-side redirect.

**Rationale:** Eliminates dual-maintenance of two customer detail pages. Unifies CRM, conversation, and timeline under one URL.

**Impact:** All internal links updated to `/admin/contacts/[id]`. Legacy bookmarks preserved via server redirect.

### AD-002: Frozen 7-tab architecture (Phase 2)

**Decision:** The tab list is locked at seven tabs for the lifetime of Phase 2 and 3. New capabilities must integrate into existing tabs or the Activity Panel.

**Rationale:** Prevents feature sprawl. Each tab has a clear, non-overlapping purpose. Future capabilities are bounded.

**To change:** Requires an architecture review and a new entry in this file under Architecture Decisions.

### AD-003: Single Customer360Provider per page (Phase 2)

**Decision:** All contact data is fetched by a single `Customer360Provider`. Individual tabs do not own their own contact fetches.

**Rationale:** Eliminates duplicate API calls. Enables optimistic updates that propagate to all tabs instantly. Simplifies cache invalidation.
