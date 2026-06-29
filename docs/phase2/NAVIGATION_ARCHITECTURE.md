# Navigation Architecture

## Core Principle

Three operational workflows exist in APForce. Each serves a different purpose. All three can open the same Customer 360 page.

```
Inbox (queue management)
    ↓  "View Contact" button
    └──────────────────────────┐
                               │
CRM Pipeline (stage view)      ├──► /admin/contacts/[id]  — Customer 360
    ↓  lead card click         │
    └──────────────────────────┤
                               │
Contact Hub (directory)        │
    ↓  row click               │
    └──────────────────────────┘
```

---

## Navigation Items (Sidebar)

The sidebar structure changes from Phase 1 to Phase 2. Inbox, Contact Hub, and CRM Pipeline remain **separate top-level navigation items** because they represent fundamentally different workflows.

### Phase 2 Sidebar Structure

```
Overview
└── Dashboard

Customers
├── Inbox              /admin/whatsapp          (operational queue)
├── Contact Hub        /admin/contacts          (directory + search)
└── CRM Pipeline       /admin/crm               (stage management)

Marketing
├── Broadcast          /admin/whatsapp/broadcast
├── Templates          /admin/whatsapp/templates
└── Campaigns          /admin/marketing/campaigns    (future)

Automation
├── Workflow           /admin/crm/automations
└── AI                 /admin/ai                     (future)

Team
├── Employees          /admin/employees
└── Analytics          /admin/analytics

System
├── Metric Settings    /admin/settings/metrics
├── Audit Logs         /admin/audit
└── Billing            /admin/billing
```

### Why Inbox, Contact Hub, and CRM Pipeline are not merged

| Screen | Primary job | Primary user action |
|---|---|---|
| Inbox | Manage message queue | Reply to conversations, assign chats, resolve |
| Contact Hub | Find and browse contacts | Search, filter, bulk actions, CSV export |
| CRM Pipeline | Manage sales stages | Move leads through stages, review pipeline health |

Merging these into one screen would make each worse. The Inbox needs to show real-time unread counts and conversation state. The Pipeline needs kanban drag-drop. The Contact Hub needs bulk filtering. These are distinct tools that happen to reference the same underlying contacts.

The Customer 360 page is the *customer workspace*, not a replacement for these operational tools.

---

## Navigation Flow Map

### From Contact Hub → Customer 360

**Current behaviour:** Row click opens WhatsApp inbox at that phone number.

**Phase 2 behaviour:** Row click navigates to `/admin/contacts/[id]`.

**Change required:** `ContactHubPage` — row `onClick` handler.

**Affected file:** `dashboard/src/app/admin/contacts/page.tsx`

```
/admin/contacts
  └── [row click]  →  /admin/contacts/[id]            (Commit 1)
```

---

### From WhatsApp Inbox → Customer 360

**Current behaviour:** Clicking a conversation opens ChatPane + LeadSidebar. The sidebar has a "View CRM Lead" link that goes to `/admin/crm/[id]`.

**Phase 2 behaviour:**
- Clicking a conversation still opens the Inbox ChatPane (unchanged — Inbox stays as the queue manager)
- A "View Contact" button is added to the LeadSidebar header
- Clicking "View Contact" navigates to `/admin/contacts/[id]?tab=conversation`
- The existing "View CRM Lead" link is removed (replaced by "View Contact")

**Change required:** `LeadSidebar.tsx` — add button, remove old link.

**Affected file:** `dashboard/src/components/whatsapp/LeadSidebar.tsx`

```
/admin/whatsapp
  └── [conversation selected]  →  ChatPane + LeadSidebar (unchanged)
      └── [View Contact button]  →  /admin/contacts/[id]?tab=conversation  (Commit 9)
```

---

### From CRM Pipeline → Customer 360

**Current behaviour:** Lead card click navigates to `/admin/crm/[id]`.

**Phase 2 behaviour:** Lead card click navigates to `/admin/contacts/[id]?tab=crm`.

**Transition strategy:** `/admin/crm/[id]` redirects to `/admin/contacts/[id]?tab=crm` (Commit 8). This means the CRM pipeline card does not need to change its link immediately — the redirect handles it. After redirect is in place, the pipeline card link can be updated directly in a follow-on cleanup commit.

**Change required:** `app/admin/crm/[id]/page.tsx` — add redirect.

```
/admin/crm
  └── [lead card click]  →  /admin/crm/[id]  →  redirect  →  /admin/contacts/[id]?tab=crm  (Commit 8)
```

---

### From CRM Follow-ups → Customer 360

**Current behaviour:** Contact name in follow-up list has no link (navigates nowhere).

**Phase 2 behaviour:** Contact name becomes a link to `/admin/contacts/[id]?tab=tasks`.

**Change required:** `app/admin/crm/followups/page.tsx` — add link to contact name.

```
/admin/crm/followups
  └── [contact name click]  →  /admin/contacts/[id]?tab=tasks    (Commit 8 or cleanup)
```

---

### From Automation Run History → Customer 360

**Current behaviour:** No contact link in automation history.

**Phase 2 behaviour:** Contact name in automation run history links to `/admin/contacts/[id]?tab=automation`.

```
/admin/crm/automations
  └── [contact name in run log]  →  /admin/contacts/[id]?tab=automation  (post-Commit 13)
```

---

### From Dashboard → Customer 360

**Current behaviour:** KPI tiles link to list pages (CRM, Inbox).

**Phase 2 behaviour:**
- "Total Leads" → `/admin/contacts` (unchanged, Contact Hub is the directory)
- "Open Chats" → `/admin/whatsapp` (unchanged, Inbox is the queue)
- "Pending Follow-ups" → `/admin/crm/followups` (unchanged)
- Leaderboard agent links → `/admin/analytics?agent=X` (unchanged)

Dashboard does not link directly to Customer 360 — it links to list views which then link to Customer 360.

---

### From Global Search → Customer 360 (Future)

When global search is implemented (planned post-Phase 2 core):

```
Navbar search  →  contact result  →  /admin/contacts/[id]
               →  employee result →  /admin/employees/[id]
```

---

## Deep-Link Tab Routing

Any page in the app can deep-link to a specific tab of Customer 360 by appending `?tab=X`.

| Source | Destination |
|---|---|
| Inbox "View Contact" | `?tab=conversation` |
| CRM Pipeline card | `?tab=crm` |
| Follow-ups list | `?tab=tasks` |
| Automation run log | `?tab=automation` |
| Campaign send history | `?tab=campaigns` |

Default tab when no `?tab` parameter is present: `profile`.

---

## Back Navigation

From Customer 360, the back button returns the user to their originating context:

| Came from | Back button destination |
|---|---|
| Contact Hub | `/admin/contacts` |
| CRM Pipeline | `/admin/crm` |
| Inbox (via View Contact) | `/admin/whatsapp` |
| Follow-ups | `/admin/crm/followups` |
| Direct URL / unknown | `/admin/contacts` (fallback) |

Implementation: the originating route is passed as a `?from=` query parameter or tracked in the router's `referrer`. The back button uses `router.back()` if a history entry exists, otherwise falls back to Contact Hub.

---

## Employee Route Isolation

Employee screens (`/employee/*`) are out of scope for Phase 2. Employee lead detail (`/employee/crm/[id]`) remains unchanged. The Customer 360 page is admin/manager-scoped.

Employee screens are addressed in Phase 3.

---

## Route Summary

| Route | Status | Change |
|---|---|---|
| `/admin/contacts` | Existing | Row click → Customer 360 (Commit 1) |
| `/admin/contacts/[id]` | **New** | Customer 360 (Commits 1–12) |
| `/admin/crm` | Existing | No change to the list; card click redirect (Commit 8) |
| `/admin/crm/[id]` | Existing | Redirects to `/admin/contacts/[id]?tab=crm` (Commit 8) |
| `/admin/whatsapp` | Existing | Add "View Contact" button in sidebar (Commit 9) |
| `/admin/crm/followups` | Existing | Contact name links added (Commit 8 cleanup) |
