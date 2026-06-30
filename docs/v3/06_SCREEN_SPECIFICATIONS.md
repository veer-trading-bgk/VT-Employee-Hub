# APForce V3 — Screen Specifications

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## Reading this Document

Each screen is specified with:
- Purpose (one sentence)
- URL
- Layout wireframe (ASCII)
- Primary actions (≤ 3, the most important things a user can do)
- Secondary actions (supporting actions)
- Loading state
- Empty state
- Error state
- Keyboard shortcuts (module-specific)
- Permissions (role differences)
- Responsive behaviour
- Performance considerations

---

## Screen 1: My Work

**Purpose:** Show each employee what to do in the next 30 minutes.  
**URL:** `/home`

### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  My Work                                        Monday, 30 June 2025         │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Good morning, Veer.                                                         │
│                                                                              │
│  ── 1. URGENT REPLIES ─────────────────────────────────────────────────    │
│  🔴  Priya Menon        3h ago    "When can we start KYC?"   [Reply →]    │
│  🔴  Suresh Kumar       5h ago    "Please call me back"      [Reply →]    │
│                                                [See all 12 unread →]       │
│                                                                              │
│  ── 2. TODAY'S FOLLOW-UPS ─────────────────────────────────────────────   │
│  ⏰  OVERDUE   Amit Joshi — call promised yesterday           [Open →]    │
│  📋  10:00    Rohan Singh — callback                    [✓ Done][Open →]  │
│  📋  12:30    Priya Menon — send KYC link               [✓ Done][Open →]  │
│  📋  16:00    Suresh Kumar — product demo               [✓ Done][Open →]  │
│                                             [View all 8 follow-ups →]       │
│                                                                              │
│  ── 3. UNREAD CONVERSATIONS ──────────────────────────────────────────    │
│  Manish Patel          Yesterday     "Please call me back"   [Open →]    │
│  Anita Rao             2 days ago    "Documents attached"    [Open →]    │
│  +8 more                                          [Open Inbox →]           │
│                                                                              │
│  ── 4. ASSIGNED LEADS NEEDING ATTENTION ──────────────────────────────    │
│  3 leads approaching closure deadline this week                             │
│                            [View leads →] (links to Sales filtered view)   │
│                                                                              │
│  ·········· PERFORMANCE ·········································          │
│                                                                              │
│  ── 5. TODAY'S KPIs ──────────────────────────────────────────────────    │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌──────────────┐│
│  │ Leads Added    │ │ KYC Done       │ │ Demat Done     │ │ Conv Rate    ││
│  │   8 / 20       │ │   2 / 5        │ │   1 / 3        │ │    29%       ││
│  │ ▓▓▓▓░░░░░░ 40% │ │ ▓▓▓▓░░░░░░ 40%│ │ ▓▓▓░░░░░░ 33%  │ │ ↑ 5% MoM   ││
│  └────────────────┘ └────────────────┘ └────────────────┘ └──────────────┘│
│                                                                              │
│  ── 6. RECENT ACTIVITY ────────────────────────────────────────────────   │
│  You assigned Priya Menon to Ravi Kumar         2h ago                     │
│  Suresh Kumar moved to KYC Done                 4h ago                     │
│  Rohan Singh stage updated: Contacted → Interested  Yesterday              │
│                                         [View full activity →]              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Primary Actions
1. Reply to urgent conversation (`[Reply →]` inline)
2. Mark follow-up done (inline `[✓ Done]`)
3. Open assigned lead or conversation (`[Open →]` inline)

### Secondary Actions
- See all unread conversations → Communications
- View all follow-ups → Sales > Follow-ups
- View at-risk leads → Sales (filtered)
- View full activity feed (future — not in V3 MVP)

### Loading State

Sections 1–4 show skeleton activity cards (5 per section) while data loads. KPI metric cards show number skeleton. Layout structure renders immediately with no shift.

### Empty State

**First login / new employee (zero data assigned):** Sections 1–4 are replaced entirely by a Getting Started checklist. KPI and Activity sections (5 and 6) remain visible.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Welcome to APForce, Veer.                                                   │
│  Complete these three steps to get started.                                  │
│                                                                              │
│  ○  Add your first contact                        [Add contact →]            │
│  ○  Start a conversation                          [Go to Communications →]   │
│  ○  Set your first follow-up                      [Add follow-up →]          │
│                                                                              │
│  Your urgent replies and follow-ups appear here once data is assigned.       │
└──────────────────────────────────────────────────────────────────────────────┘
```

The Getting Started block disappears when all three steps are complete, or after 7 days — whichever comes first. It does not reappear.

**New workspace setup (Admin/Owner with no WhatsApp connected):** A workspace setup checklist replaces Getting Started:
- ○ Connect WhatsApp `[Settings → WhatsApp →]`
- ○ Invite your team `[Settings → Employees →]`
- ○ Configure pipeline stages `[Settings → Pipelines →]`

This checklist disappears once WhatsApp is connected and at least one employee is invited.

**Catch-up state (returning employee, all caught up):** Sections 1–4 are hidden (not shown with empty messages). A single "✓ All caught up." banner shows above the KPI section. Sections 5 and 6 are always visible.

Section 1 (no urgent, mid-day): not shown — section is hidden entirely.  
Section 2 (no follow-ups today): "No follow-ups scheduled for today. [Add one?]"  
Section 3 (no unread): replaced by: "✓ All conversations read."

### Error State

Each section loads independently. Failed sections show inline error + Retry. The page always shows something — it never fails completely.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `J / K` | Navigate between items in Urgent / Follow-ups |
| `↵` | Open focused item |
| `X` | Mark focused follow-up done |
| `S` | Snooze focused follow-up (future) |
| `G then H` | Go to My Work (from anywhere) |

### Permissions

| Section | Sales | Manager | Admin/Owner |
|---|---|---|---|
| Urgent replies | Own assigned only | All unassigned + team | All |
| Follow-ups | Own | Team | All |
| KPIs | Own targets | Team aggregate | Company aggregate |
| Recent activity | Own actions | Team actions | All actions |
| Goal targets | View own | Edit team | Edit all |

### Responsive Behaviour

- **Tablet:** Two-column layout collapses to single column. KPI cards become 2×2 grid.
- **Mobile:** Single column. KPI cards are 2×2. Charts are hidden (accessible from Analytics). FAB always visible.

### Performance Considerations

- My Work data is prefetched in the background immediately after login
- KPI data is cached for 60 seconds (stale-while-revalidate)
- Recent activity is paginated server-side (shows latest 5)
- Follow-ups and urgent items are fetched in parallel, not sequentially

---

## Screen 2: Communications

**Purpose:** Manage all customer conversations in one screen without switching to another page.  
**URL:** `/communications`

### Desktop Layout (Three-Pane)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Communications                                                        [🔔] [AV]          │
├──────────────────────┬──────────────────────────────────────┬─────────────────────────────┤
│ CONVERSATION LIST    │ CONVERSATION THREAD                  │ CUSTOMER SNAPSHOT           │
│ (280px fixed)        │ (fluid)                              │ (320px fixed)               │
│                      │                                      │                             │
│ [🔍 Search...]       │ ┌──────────────────────────────────┐ │ [AV] Priya Menon  [→ C360]│
│                      │ │ Priya Menon                      │ │ +91 98765 43210   [📋]     │
│ [Open ●][Resolved]   │ │ Assigned: You    [Assign ▼][✓]  │ ├─────────────────────────── │
│ [Pending][Unassigned]│ │ +91 98765 43210        [⋮ More] │ │ Stage: [Interested ▼]      │
│                      │ └──────────────────────────────────┘ │ Owner: [You ▼]             │
│ [Mine ▼] [All ▼]    │                                      │ Tags: [#HNI ×][+]          │
│                      │ ── Today ─────────────────────────  │ ─────────────────────────── │
│ ● Priya Menon   3h   │                                      │ NOTES           [+ Note]   │
│   "When can we       │ ┌─────────────────────┐             │ "Very interested in SIP..." │
│    start KYC?"       │ │ Priya (09:15)       │             │ ─────────────────────────── │
│                      │ │ "When can we start  │             │ FOLLOW-UPS [+ Follow-up]│
│   Suresh Kumar  5h   │ │  KYC?"              │             │ ☐ Today: Call at 4pm        │
│   "Sent docs as      │ └─────────────────────┘             │ ☐ 2 Jul: Send KYC link      │
│    requested"        │                 ┌───────────────────┐│ ─────────────────────────── │
│                      │                 │ You (10:42)       ││ ASSIGN CONV   [→]          │
│   Manish Patel Yest. │                 │ "Hi Priya, your   ││ [Select employee ▼]        │
│   "Please call back" │                 │  KYC can start    ││ ─────────────────────────── │
│                      │                 │  as soon as you   ││ [  Resolve Conversation  ] │
│   Anita Rao    2d    │                 │  share Aadhaar    ││                             │
│   "Documents here"   │                 │  + PAN."          ││                             │
│                      │                 └───────────────────┘│                             │
│ [+ New Conversation] │                                      │                             │
│                      │ ── Yesterday ─────────────────────  │                             │
│                      │                                      │                             │
│                      │ [More messages...]                   │                             │
│                      │                                      │                             │
│                      ├──────────────────────────────────────┤                             │
│                      │ [📎][😊][📋 Template][🖼 Media]      │                             │
│                      │ ┌──────────────────────────────────┐ │                             │
│                      │ │ Type a message...                │ │                             │
│                      │ └──────────────────────────────────┘ │                             │
│                      │                    [Send  Ctrl+↵]    │                             │
└──────────────────────┴──────────────────────────────────────┴─────────────────────────────┘
```

### Primary Actions
1. Send message (`Ctrl+Enter`)
2. Resolve conversation (`Ctrl+Shift+R`)
3. Assign conversation (`Ctrl+Shift+A` or `[Assign ▼]`)

### Secondary Actions
- Send template (`Ctrl+M` or `[📋 Template]`)
- Attach media (`[🖼 Media]`)
- Add note (in snapshot panel)
- Add follow-up (in snapshot panel)
- Change stage inline (snapshot panel dropdown)
- Change owner inline (snapshot panel dropdown)
- Add/remove tags (snapshot panel)
- Open Customer 360 (snapshot panel header link)
- Snooze conversation (`[⋮ More]` menu)
- Reopen resolved conversation
- Start new outbound conversation (`[+ New Conversation]` in list pane, or `Ctrl+Shift+N`)

### Outbound Conversation Flow

`[+ New Conversation]` opens the Universal Drawer titled **"New Conversation"** with a three-step form:

1. **Contact** — Type-ahead search by name or phone number. Selecting an existing contact pre-fills their name. Entering a new number creates a contact stub (name optional — phone is sufficient).
2. **Template** — Select from Meta-approved templates (required for all first-contact outbound messages per WhatsApp Business API). Template list is searchable. Each template shows a preview of the rendered message.
3. **Preview + Send** — Shows the final rendered message with any variable substitutions applied. `[Send]` creates the conversation and sends the template. Drawer closes; the new conversation opens in the thread pane immediately (optimistic).

**No templates state:** If the workspace has zero approved templates, step 2 shows:
> "No templates approved yet. Templates take 1–7 days to approve after submission.  
> [Request a template in Settings →]"  
> The Send button is disabled. The employee can still create the contact and draft the conversation.

**Keyboard shortcut:** `Ctrl+Shift+N` opens New Conversation drawer from anywhere in Communications.

### Loading State

- List pane: 5 skeleton conversation rows
- Thread pane: 6 skeleton message bubbles (alternating sides)
- Snapshot pane: skeleton header + 3 skeleton info sections

### Empty State (inbox empty)

List pane:
```
💬
All caught up!
No open conversations.
[Start a new conversation]
```

Thread pane (no conversation selected):
```
← Select a conversation to start
```

### Error State

If thread fails to load: thread pane shows inline error + Retry. List and snapshot remain usable.

If send fails: message appears in thread with error indicator + Retry button inline in the message bubble.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `J / K` | Next/previous conversation in list |
| `↵` | Open focused conversation |
| `Ctrl+↵` | Send message |
| `Ctrl+Shift+R` | Resolve current conversation |
| `Ctrl+Shift+A` | Open assign dropdown |
| `Ctrl+Shift+N` | Focus note field in snapshot |
| `Ctrl+T` | Add follow-up (opens drawer) |
| `Ctrl+M` | Open template picker |
| `R` (in list) | Mark conversation as read |
| `1/2/3/4` | Switch tabs: Open/Resolved/Pending/Unassigned |
| `Esc` | Close template picker / collapse snapshot (tablet) |

### Permissions

| Action | Sales | Support | Manager | Admin |
|---|---|---|---|---|
| View conversations | Own assigned | Own assigned | Team | All |
| Send messages | Yes | Yes | Yes | Yes |
| Assign to others | No (self-assign only) | No | Yes | Yes |
| Resolve | Own | Own | Team | All |
| View unassigned | No | No | Yes | Yes |
| Bulk actions | No | No | Yes | Yes |

### Responsive Behaviour

- **Tablet:** Three-pane becomes sequential. List pane is default. Opening a conversation replaces list pane with thread + back arrow. Snapshot is a slide-in drawer triggered by tapping customer name.
- **Mobile:** Single-screen. Default shows list. Opening a conversation is a full-screen transition. Customer snapshot is a bottom sheet. Reply bar is sticky above mobile keyboard.

### Performance Considerations

- Conversation list: paginated, 30 per page, infinite scroll triggers at 80% scroll
- Message thread: virtualised. Only 50 messages rendered at once; scroll up loads older.
- Prefetch next conversation's messages when hovering list item > 200ms
- Snapshot data: uses same React Query cache as Customer 360 (shared, no duplicate fetch)
- Template picker: loaded once on first open, cached for session

---

## Screen 3: Customers

**Purpose:** Find any customer and access their workspace.  
**URL:** `/customers`

### Desktop Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Customers                                                        [+ Add Customer]   │
│ Your complete contact directory                          [⬇ Import]  [⬆ Export]    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ [🔍 Search by name, phone, email...                    ]                            │
│                                                                                     │
│ Views: [All Contacts ●] [My Contacts] [Unassigned] [Hot Leads] [+ New view]        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Filters: [Stage ▼] [Owner ▼] [Tags ▼] [Source ▼] [Date Added ▼]    [✕ Clear all] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ☐  │ Name ↕       │ Phone           │ Stage ↕      │ Owner ↕   │ Last Msg ↕  │ ⋮  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ☐  │ [AV]Priya M  │ +91 98765 43210 │ [Interested] │ You       │ 3h          │ ⋮  │
│ ☐  │ [AV]Suresh K │ +91 87654 32109 │ [KYC Done]   │ Ravi      │ 5h          │ ⋮  │
│ ☐  │ [AV]Manish P │ +91 76543 21098 │ [New Lead]   │ —         │ 2d          │ ⋮  │
│ ☐  │ [AV]Anita R  │ +91 65432 10987 │ [Contacted]  │ You       │ 2d          │ ⋮  │
│ ☐  │ [AV]Rohan S  │ +91 54321 09876 │ [Interested] │ Priya S   │ 4d          │ ⋮  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Showing 1–50 of 1,243              [← Previous]  Page 1 of 25  [Next →]           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ☐ 3 selected: [Assign ▼] [Add Tag ▼] [Stage ▼] [Send Campaign ▼] [🗑 Delete]      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Primary Actions
1. Open Customer 360 (tap/click any row)
2. Add new customer (`[+ Add Customer]` → opens Universal Drawer)
3. Search and filter the list

### Secondary Actions
- Import contacts (CSV) → opens Import Drawer (multi-step wizard)
- Export current view → immediate CSV download
- Save current filters as a named view
- Bulk: assign, add tag, change stage, send campaign, delete
- Row ⋮ context menu: Open C360, Assign, Change stage, Copy phone, Send WhatsApp, Delete

### Column Visibility (⋮ in table header)

Default columns: Name, Phone, Stage, Owner, Last Message  
Optional: Email, Source, Tags, Date Added, Product Interest, Last Activity

### Loading State

Table header renders immediately (static). 10 skeleton rows (shimmer). Search and filter bar interactive during load.

### Empty State

No contacts:
```
👥
No contacts yet.
Add your first contact or import a list.
[Add Contact]   [Import CSV]
```

Filtered, no results:
```
No contacts match your filters.
[Clear filters]
```

### Error State

Table body shows inline error card with Retry. Search, filters, and column controls remain usable.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `J / K` | Navigate rows |
| `↵` | Open Customer 360 for focused row |
| `Space` | Toggle selection of focused row |
| `Shift+↓/↑` | Extend selection |
| `Ctrl+A` | Select all on current page |
| `Esc` | Deselect all |
| `N` | New contact (opens drawer) |
| `I` | Import contacts |
| `E` | Export current view |
| `/` | Focus search |
| `F` | Open filter panel |
| `1–5` | Switch saved views |

### Permissions

| Action | Sales | Support | Manager | Admin |
|---|---|---|---|---|
| View contacts | Own assigned | Own assigned (read) | Team | All |
| Add contact | Yes | No | Yes | Yes |
| Import | No | No | Yes | Yes |
| Export | Own data | No | Team data | All data |
| Bulk assign | No | No | Yes | Yes |
| Delete | No | No | Soft-delete | Hard + soft |

### Responsive Behaviour

- **Tablet:** Columns reduce to Name + Phone + Stage + ⋮. Filters collapse to single `[Filter ▼]` button (bottom sheet).
- **Mobile:** Table becomes a card list. Each contact is a 72px card (avatar + name + phone + stage). Long-press = select mode. Swipe left = quick actions (Assign, Message, Open).

### Performance Considerations

- Default view: 50 contacts per page (not "load all")
- Search: 250ms debounce, server-side search against DynamoDB
- Saved views: stored client-side (localStorage) and server-side (for cross-device)
- Export: generated server-side, streamed as download (not blocking UI)
- Prefetch Customer 360 data on row hover > 200ms

---

## Screen 4: Sales

**Purpose:** Manage the sales pipeline and track deal progress.  
**URL:** `/sales` (Kanban default), `/sales?view=list` (List), `/sales/followups` (Follow-ups)

### Desktop — Kanban View

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sales                           [Table ▼] [● Kanban]     [Owner ▼] [Tags ▼] [+ Add Lead]   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│ │ NEW LEAD 8  │ │CONTACTED 12 │ │INTERESTED 6 │ │ KYC DONE 4  │ │DEMAT DONE 3 │  [+stage] │
│ ├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤           │
│ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │           │
│ │ │[AV]     │ │ │ │[AV]     │ │ │ │[AV]     │ │ │ │[AV]     │ │ │ │[AV]     │ │           │
│ │ │Manish P │ │ │ │Anita R  │ │ │ │Priya M  │ │ │ │Suresh K │ │ │ │Rohan S  │ │           │
│ │ │─────────│ │ │ │─────────│ │ │ │─────────│ │ │ │─────────│ │ │ │─────────│ │           │
│ │ │#Mumbai  │ │ │ │#HNI     │ │ │ │#HNI     │ │ │ │#Pune    │ │ │ │#Mumbai  │ │           │
│ │ │You · 2d │ │ │ │You · 2d │ │ │ │You · 3h │ │ │ │Ravi · 5h│ │ │ │PriyaS · │ │           │
│ │ │[💬] [→] │ │ │ │[💬] [→] │ │ │ │[💬] [→] │ │ │ │[💬] [→] │ │ │ │[💬] [→] │ │           │
│ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │           │
│ │             │ │             │ │             │ │             │ │             │           │
│ │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │ │             │ │             │           │
│ │ │[AV] ... │ │ │ │[AV] ... │ │ │ │[AV] ... │ │ │  [+ Add]    │ │  [+ Add]    │           │
│ │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │ │             │ │             │           │
│ │             │ │             │ │             │ │             │ │             │           │
│ │   [+ Add]   │ │   [+ Add]   │ │   [+ Add]   │ │             │ │             │           │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Desktop — List / Table View

Same as Customers table view, with additional columns: Stage, Follow-up date. Default sort: last activity (newest first). Same keyboard shortcuts and bulk actions.

### Desktop — Follow-ups View

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Follow-ups                                   [Date: Today ▼] [Owner: Mine ▼]            │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ OVERDUE                                                                                  │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ [AV] Amit Joshi   Callback promised yesterday   You   [Mark done] [Reschedule] [→]  │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│ TODAY                                                                                    │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ☐ 10:00  Rohan Singh   Callback                  You   [Mark done] [Reschedule] [→]│ │
│ │ ☐ 12:30  Priya Menon   Send KYC link             You   [Mark done] [Reschedule] [→]│ │
│ │ ✓ 09:00  Anita Rao     Morning check-in          You   Completed 09:15              │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│ TOMORROW                                                                                 │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ☐ 14:00  Suresh Kumar  Follow-up call            Ravi  [Mark done] [Reschedule] [→]│ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Primary Actions
1. Move lead to next stage (drag in Kanban, or `→` keyboard shortcut in List)
2. Open Customer 360 (card tap or row click)
3. Send message from card (`[💬]` on Kanban card)

### Secondary Actions
- Switch between Kanban / Table views
- Filter by owner, tags, source, date
- Add lead → Universal Drawer
- Bulk: move stage, assign, add tag, add follow-up, delete
- Follow-ups: Mark done, Reschedule (opens drawer)

### Kanban Drag-and-Drop Rules

- Card lift: `shadow-xl`, 3° rotation, `opacity-0.8`
- Drop target highlight: `primary-100` column background, `primary-500` left border (4px)
- Drop: optimistic update (card moves immediately), sync in background
- Failed sync: card snaps back, error toast with Retry option
- Drag is disabled during initial data load

### Loading State

**Kanban:** Column headers + counts render immediately (from cache). Skeleton cards fill columns.  
**List:** Standard table skeleton (10 rows).  
**Follow-ups:** Skeleton follow-up rows per time group.

### Empty State

**Kanban (stage empty):** Stage column shows empty state card at bottom (column is not removed).  
**Kanban (no leads):** Each column shows empty state.  
**List (filtered):** Standard filter empty state.  
**Follow-ups (none today):** "No follow-ups today. You're all caught up!"

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `J / K` | Navigate cards (Kanban) or rows (List) |
| `↵` | Open Customer 360 |
| `→ / ←` | Move focused card to next/previous stage (Kanban) |
| `A` | Assign focused card |
| `T` | Add follow-up to focused card |
| `M` | Message focused contact |
| `L` | Switch to List view |
| `B` | Switch to Kanban view |
| `F` | View Follow-ups |
| `N` | New lead |

### Permissions

| Action | Sales | Manager | Admin |
|---|---|---|---|
| View pipeline | Own leads | Team | All |
| Add lead | Yes | Yes | Yes |
| Move stage | Own leads | Team | All |
| Assign (to others) | No | Yes | Yes |
| Delete | No | Soft-delete | All |
| View Forecast | Own stats | Team | All |

### Responsive Behaviour

- **Tablet:** Kanban shows 3 columns with left/right swipe to reveal more.
- **Mobile:** Kanban becomes single-column. Swipe left/right to change the visible stage column. Column header shows stage name + count + arrows.

### Performance Considerations

- Kanban: load all stages' lead counts immediately, lazy-load card content per stage as user scrolls
- List view: same pagination as Customers (50 per page)
- Drag-and-drop: optimistic (immediate UI), eventual consistency (server confirm)
- Follow-ups: time-grouped, loaded for the selected date range (default: today + tomorrow + overdue)

---

## Screen 5: Customer 360

**Purpose:** Deep workspace for all information and actions related to one specific customer.  
**URL:** `/customers/[contactId]?tab=[tabName]`

### Desktop Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Customers                                              [⋮ More Actions]       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ [AV 48px]  Priya Menon                               [💬 Message] [📋 Follow-up]       │
│            +91 98765 43210  ·  priya@example.com                                        │
│            Stage: [Interested ▼]    Owner: [You ▼]    Tags: [#HNI ×] [#Mumbai ×] [+]  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ [Overview][Conversations][Notes][Follow-ups][Timeline][KYC][Documents]    ACTIVITY PANEL    │
├────────────────────────────────────────────────────────────────────┬────────────────────┤
│                                                                    │ TODAY              │
│  TAB CONTENT                                                       │ ──────────────── │
│                                                                    │ You sent a message │
│  (see per-tab specifications below)                                │ 3h ago             │
│                                                                    │                    │
│                                                                    │ Stage moved to     │
│                                                                    │ Interested         │
│                                                                    │ Jun 28             │
│                                                                    │                    │
│                                                                    │ Contact created    │
│                                                                    │ Jun 12             │
│                                                                    │                    │
│                                                                    │ [Load more]        │
└────────────────────────────────────────────────────────────────────┴────────────────────┘
```

Activity Panel: 280px wide, always visible on desktop, slide-in panel on tablet/mobile.

### Header Zone Rules

- **Name:** Inline-editable on click. No save button — auto-saves on blur. `text-xl font-semibold`.
- **Phone / Email:** Inline-editable. Copy icon on hover. Phone: shows WhatsApp icon → opens Communications.
- **Stage:** Inline dropdown. Saves immediately. Records stage change in Timeline automatically.
- **Owner:** Inline dropdown. Saves immediately. Records owner change in Timeline automatically.
- **Tags:** Chip list. `×` removes. `+` opens tag multi-select dropdown. Changes instant.

### Tab: Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ CONTACT DETAILS                              QUICK STATS                         │
│ ─────────────────────────────────────────   ─────────────────────────────────── │
│ Email         priya@example.com  [✎]         Conversations    3 (1 open)         │
│ Source        Referral                        Notes            2                  │
│ Added         12 Jun 2025                     Follow-ups       2 (1 overdue)      │
│ Product       [SIP] [Lumpsum]     [✎]        Last message     3h ago             │
│ Interest                                                                          │
│ Language      English             [✎]        NEXT ACTION                         │
│ Timezone      Asia/Kolkata                    📋 Call at 4pm today               │
│                                               Assigned: You                      │
│ PIPELINE DETAILS                              [Mark done] [Reschedule]           │
│ ─────────────────────────────────────────                                         │
│ Stage         Interested                                                          │
│ Closure       30 Jul 2025         [✎]                                            │
│ Auto-assigned Yes                                                                 │
│ Created by    You on Jun 12                                                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

`[✎]` triggers inline edit (cursor changes, field becomes editable input). No modal required.

### Tab: Conversations

Lists all conversations for this contact sorted newest-first. Each row: status badge, channel icon, last message preview, assigned employee, timestamp. `[Open →]` navigates to Communications with that conversation active.

### Tab: Notes

Inline note composer at top (rich text: bold, bullets, @mention). Notes list below, newest first. Each note: author avatar, relative timestamp, content, `[Edit]` and `[Delete]` on hover.

### Tab: Follow-ups

Follow-up composer: quick-add row at top (description + due date + assign). Follow-up list grouped by status (Overdue, Today, Upcoming, Completed). Each follow-up: checkbox, description, due time, assigned, `[Reschedule]`. A `[+1 Day]` button quick-snoozes to tomorrow without opening the drawer.

### Tab: Timeline

Complete chronological audit trail. All events listed newest-first. Filter by event type (dropdown). Events: messages, stage changes, notes, tasks, assignments, creation. Each event is immutable — no editing here.

### Tab: KYC

KYC status checklist (PAN, Aadhaar, Bank, Signature). Progress indicator. Mark KYC Complete button. Remarks field. Shows KYC date and completed-by when complete.

### Tab: Documents

Upload area (drag-and-drop). File list with type icon, name, upload date, size, download/delete actions. Supports: PDF, JPG, PNG, HEIC.

### Primary Actions
1. Send message (`[💬 Message]` in header → opens Communications)
2. Add follow-up (`[📋 Follow-up]` in header → opens Universal Drawer)
3. Change stage (inline header dropdown)

### Secondary Actions
- Change owner (inline dropdown)
- Add/remove tags (inline chips)
- Add note (in Notes tab)
- Upload document (in Documents tab)
- Edit any field (inline `[✎]` or click)
- `[⋮ More Actions]`: Assign to, Export PDF, Delete contact, Merge (future)

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `1–7` | Switch between 7 tabs |
| `M` | Open message composer |
| `T` | Add follow-up |
| `N` | Add note (focuses tab) |
| `E` | Edit name (focuses inline) |
| `Ctrl+C` | Copy phone number |
| `Backspace` | Go back to previous module |
| `Esc` | Cancel inline edit |

### Permissions

| Action | Sales | Support | Manager | Admin |
|---|---|---|---|---|
| View C360 | Own assigned | Own assigned | Team | All |
| Edit fields | Own | Read-only | Team | All |
| Add notes | Own | Own | Team | All |
| Delete notes | Own | No | Team | All |
| Change owner | No | No | Yes | Yes |
| Delete contact | No | No | Soft-delete | Hard+soft |
| KYC tab | Yes | Yes | Yes | Yes |
| Documents | Own | View-only | Team | All |

### Loading State

Header: name/phone skeleton bars, stage/owner skeleton dropdowns. Tab bar: immediate (static). Activity panel: skeleton event list. Tab content: per-tab skeleton (card for Overview, rows for Notes/Follow-ups/Timeline).

### Empty States

Per-tab (see Component Library Section 12 standard instances).

### Performance Considerations

- All 7 tabs are loaded on first open (but only the active tab's content renders)
- Inactive tab data is prefetched and cached
- Activity panel: latest 20 events, paginate on demand
- Inline edits: optimistic (change appears immediately, error reverts)
- Stage change: triggers background notification if automation is configured

---

## Screen 6: Analytics

**Purpose:** Report on performance across team, pipeline, and conversations.  
**URL:** `/analytics`, `/analytics/pipeline`, `/analytics/conversations`, `/analytics/team`, `/analytics/sources`

### Desktop Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Analytics                                        [Jun 2025 ▼] [Team: All ▼] [Export]│
├──────────────────────────────────────────────────────────────────────────────────────┤
│ [Overview ●] [Pipeline] [Conversations] [Team] [Sources]                             │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                        │
│ │ Leads Added│ │ KYC Done   │ │ Demat Done │ │ Conv Rate  │                        │
│ │   143      │ │    42      │ │    31      │ │   29%      │                        │
│ │ ↑ 12% MoM │ │ ↑ 8% MoM  │ │ ↓ 3% MoM  │ │ ↑ 5% MoM  │                        │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘                        │
│                                                                                      │
│ ┌────────────────────────────────────┐  ┌──────────────────────────────────────┐   │
│ │ PIPELINE FUNNEL                    │  │ LEADS ADDED OVER TIME                │   │
│ │                                    │  │   [Daily ●] [Weekly] [Monthly]       │   │
│ │ New Lead    ████████████  143 → 98%│  │    ╭──╮                              │   │
│ │ Contacted   ████████       98 → 53%│  │  ╭─╯  ╰────╮                        │   │
│ │ Interested  █████          52 → 43%│  │ ─╯         ╰──                       │   │
│ │ KYC Done    ████           42 → 74%│  │ Jun 1               Jun 30           │   │
│ │ Demat Done  ███            31      │  │                                      │   │
│ └────────────────────────────────────┘  └──────────────────────────────────────┘   │
│                                                                                      │
│ ┌──────────────────────────────────────────────────────────────────────────────┐   │
│ │ TEAM LEADERBOARD                                          [Full report →]    │   │
│ │ Name          Leads Added  KYC  Demat  Conv Rate  Avg Response               │   │
│ │ 1. Ravi Kumar     43       18    14      33%        1h 24m                   │   │
│ │ 2. Veer Chettar   38       14    11      29%        2h 10m                   │   │
│ │ 3. Priya Sharma   31       10     6      19%        3h 45m                   │   │
│ └──────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Every chart element (bar, segment, row) is clickable and navigates to the filtered list in Customers or Sales that produced that number.

### Primary Actions
1. Change date range (dropdown)
2. Change team scope (All / My team / specific employee)
3. Export current view (CSV or PDF)

### Secondary Actions
- Switch tab (Pipeline / Conversations / Team / Sources)
- Change chart granularity (Daily / Weekly / Monthly on line charts)
- Drill into a metric → navigates to filtered Customers or Sales view

### Loading State

Metric cards: number skeleton. Charts: placeholder boxes same dimensions as charts. Leaderboard: 3 skeleton rows.

### Empty State

"No data for this period. Try a different date range or team filter."

### Permissions

| View | Sales | Support | Manager | Admin |
|---|---|---|---|---|
| Overview | Own data only | Own convs only | Team | All |
| Pipeline | Own leads | Hidden | Team | All |
| Conversations | Own | Own | Team | All |
| Team | Hidden | Hidden | Team | All |
| Sources | Hidden | Hidden | Team | All |
| Export | Own data | No | Team | All |

### Responsive Behaviour

Metric cards: 2×2 grid (tablet), 2×2 grid (mobile). Charts stack vertically full-width. Leaderboard truncates to 5 rows on tablet/mobile with "View all →" link.

### Performance Considerations

- Aggregation is done server-side. Never aggregate on the client.
- Chart data is cached for 5 minutes
- Drill-down links pass filter state to target module via URL params
- Date range changes trigger a single batch request (all chart data in one API call)

---

## Screen 7: Automation

**Purpose:** Define and manage automated business rules that execute on triggers.  
**URL:** `/automation`

### Desktop — Workflow List

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Automation                                                  [+ New Workflow]     │
│ Automate repetitive actions                                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ [Active ●] [Inactive] [All]            [🔍 Search workflows...]                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ ● Welcome Message on First Contact                   [● Active]  [Logs] [⋮] │ │
│ │   Trigger: New inbound message from unknown contact                         │ │
│ │   Action:  Send template "Welcome to APForce"                               │ │
│ │   Ran 43 times · Last run 2h ago · 0 failures                               │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ ● Auto-assign: Round Robin                           [● Active]  [Logs] [⋮] │ │
│ │   Trigger: New contact created (source: WhatsApp)                           │ │
│ │   Action:  Assign to next employee in rotation                              │ │
│ │   Ran 143 times · Last run 30m ago · 0 failures                             │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ ─── TEMPLATES ────────────────────────────────────────────────────────────────  │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│ │ 👋 Welcome   │ │ ⏰ Follow-up │ │ 📋 KYC docs  │ │ 🎉 Onboard   │           │
│ │ [Use this]   │ │ [Use this]   │ │ [Use this]   │ │ [Use this]   │           │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Desktop — Workflow Builder

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Automation   [Untitled Workflow — click to rename]   [Test] [Draft] [Publish] │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                       ┌──────────────────────────────┐                          │
│                       │ ⚡ TRIGGER                    │                          │
│                       │ When this happens...          │                          │
│                       │ [Select trigger ▼]            │                          │
│                       │  ○ New contact created        │                          │
│                       │  ○ Message received           │                          │
│                       │  ○ Stage changed to...        │                          │
│                       │  ○ Follow-up overdue          │                          │
│                       │  ○ Tag added                  │                          │
│                       │  ○ Time-based schedule        │                          │
│                       └──────────────┬───────────────┘                          │
│                                      │                                          │
│                       ┌──────────────▼───────────────┐                          │
│                       │ 🔍 CONDITION (optional)       │                          │
│                       │ Only if...                    │                          │
│                       │ Stage is [New Lead ▼]         │                          │
│                       │ AND Source is [WhatsApp ▼]    │                          │
│                       │ [+ Add condition]             │                          │
│                       └──────────────┬───────────────┘                          │
│                                      │                                          │
│                       ┌──────────────▼───────────────┐                          │
│                       │ ▶ ACTION                      │                          │
│                       │ Then do this...               │                          │
│                       │ [Select action ▼]             │                          │
│                       │  ○ Send WhatsApp template     │                          │
│                       │  ○ Assign to employee         │                          │
│                       │  ○ Change stage               │                          │
│                       │  ○ Add tag                    │                          │
│                       │  ○ Create follow-up task      │                          │
│                       │  ○ Wait (delay)               │                          │
│                       │ [+ Add action]                │                          │
│                       └──────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Builder is a linear vertical flow (trigger → condition → one or more actions). Not a node-graph canvas — intentional simplicity for non-technical users.

### Primary Actions
1. Create workflow (from list or template)
2. Activate / deactivate workflow (toggle on list card)
3. Test workflow (simulation mode — no real sends)

### Secondary Actions
- Duplicate workflow
- View execution logs
- Use a template
- Delete workflow

### Permissions

This module is visible only to Admin and Owner roles. Manager, Sales, and Support do not see it in the sidebar.

### Responsive Behaviour

- Workflow list: same on all sizes.
- Workflow builder: not recommended on mobile (complex interactions). Mobile shows a warning: "Building workflows is better on desktop." Viewing and toggling workflows works on mobile.

---

## Screen 8: Settings

**Purpose:** Configure the workspace, team, channels, and integrations.  
**URL:** `/settings/[section]`

### Desktop Layout (Two-Column)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Settings                                                                         │
├──────────────────┬───────────────────────────────────────────────────────────────┤
│ ORGANISATION     │  [Section-specific content]                                   │
│ ─────────────── │                                                                │
│  Company Profile │                                                                │
│  Employees       │                                                                │
│  Teams           │                                                                │
│  Roles & Perms   │                                                                │
│  Audit Log       │                                                                │
│                  │                                                                │
│ SALES CONFIG     │                                                                │
│ ─────────────── │                                                                │
│  Pipelines       │                                                                │
│  Tags            │                                                                │
│                  │                                                                │
│ CHANNELS         │                                                                │
│ ─────────────── │                                                                │
│  WhatsApp        │                                                                │
│  Templates       │                                                                │
│  Broadcast       │                                                                │
│                  │                                                                │
│ SYSTEM           │                                                                │
│ ─────────────── │                                                                │
│  Integrations    │                                                                │
│  Billing ★       │                                                                │
│  Danger Zone ★   │                                                                │
│                  │                                                                │
│ ★ Owner only     │                                                                │
└──────────────────┴───────────────────────────────────────────────────────────────┘
```

### Settings Sections

**Company Profile:** Name, logo upload, timezone, language, SEBI registration number, business type.

**Employees:** Table of employees (same component as Customers table). Columns: name, email, role, status, last active. `[+ Invite]` button opens Universal Drawer. Row ⋮: change role, deactivate, resend invite, remove.

**Teams:** Group employees into named teams (Mumbai Team, Senior APs). Used for analytics scoping and automation targeting. Simple list with add/edit/delete.

**Roles & Permissions:** Role cards (Owner, Admin, Manager, Sales, Support, Readonly). Manager and Sales/Support roles have toggle-able permissions. Owner and Admin are fixed.

**Audit Log:** Read-only table. Time / User / Action / Details. Filterable by user, action type, date. Exportable.

**Pipelines & Stages:** Drag-to-reorder stage list. Rename stages. Add stages. Delete stage (with migration modal if contacts exist in that stage).

**Tags:** List of tags with name, colour, contact count. Add/edit/delete.

**WhatsApp:** Connection status, phone number, WABA details, quality rating, template count. Welcome message toggle. `[Disconnect]` (destructive, confirmation required).

**Templates:** Read-only list of Meta-approved templates with status (Approved/Pending/Rejected). `[+ Request New Template]` opens submission drawer. Preview on row click.

**Broadcast:** List of past broadcasts with stats (sent, delivered, read). `[+ New Broadcast]` opens the broadcast wizard drawer.

**Integrations:** API key display (masked), webhook URL, regenerate key button. Placeholder for future integrations.

**Billing:** Current plan, usage, next billing date, invoices. Upgrade/downgrade. Owner only.

**Danger Zone:** Delete company account. Owner only. Requires typed confirmation.

### Primary Actions (per section)
Each section has one primary action: save form, invite employee, add stage, request template, etc.

### Loading State

Left nav renders immediately (static). Content area skeleton matches the section layout.

### Permissions

| Section | Sales | Support | Manager | Admin | Owner |
|---|---|---|---|---|---|
| Company Profile | Hidden | Hidden | Read | Edit | Edit |
| Employees | Hidden | Hidden | View | Full | Full |
| Teams | Hidden | Hidden | View | Full | Full |
| Roles & Permissions | Hidden | Hidden | Hidden | View | Edit |
| Audit Log | Hidden | Hidden | Hidden | View | Full |
| Pipelines | Hidden | Hidden | Hidden | Edit | Edit |
| Tags | Hidden | Hidden | Edit | Edit | Edit |
| WhatsApp | Hidden | Hidden | Hidden | Edit | Edit |
| Templates | Hidden | Hidden | View | Edit | Edit |
| Broadcast | Hidden | Hidden | View | Edit | Edit |
| Integrations | Hidden | Hidden | Hidden | View | Edit |
| Billing | Hidden | Hidden | Hidden | Hidden | Full |
| Danger Zone | Hidden | Hidden | Hidden | Hidden | Full |

### Responsive Behaviour

- **Tablet:** Left nav collapses to icon-only (same as sidebar pattern). Tap icon to expand as overlay.
- **Mobile:** Settings is a two-screen experience: section list → section content. Back arrow returns to list.

---

## Screen 9: Notification Center

Covered in Navigation System (Section 10). Not a standalone screen — it is a panel overlay triggered from the bell icon. All notification types, routing, and behaviour are specified there.

---

## Screen 10: Search / Command Palette

Covered in Navigation System (Sections 5 and 6). The command palette serves as the global search surface. There is no separate search results page in V3.

---

## Cross-Screen Rules

1. **Page titles:** Every screen has an `<h1>` visible on the page (may differ from nav item label).
2. **Breadcrumbs:** Only on Customer 360. All other screens are at Level 1 or Level 2 — no breadcrumb needed.
3. **Loading states:** All screens show skeletons within 50ms of navigation. No blank screens, no full-page spinners.
4. **Error states:** All screens handle per-section errors inline. No full-page error screens (except auth failure and 404).
5. **Empty states:** All lists have a specific, actionable empty state for both "no data" and "no results for filter."
6. **Scroll preservation:** Returning to a list (e.g., from Customer 360 back to Customers) restores scroll position and filter state from the current session.
7. **Keyboard shortcuts:** Every screen's module-specific shortcuts are available via `?` key (shows a cheatsheet overlay).
8. **Log a Call (`Ctrl+L`):** Available from every screen (except inside a text input). Opens the "Log a Call" Universal Drawer: call notes + new stage (optional) + follow-up (date + description + assignee). Captures all three outcomes of a sales call in one action.
9. **Context preserved on all actions:** Assigning, resolving, stage-changing, and note-adding never navigate away from the current screen. Only explicit navigation (clicking a module in the sidebar, clicking `[Open →]`) changes the current module.
