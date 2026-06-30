# APForce V3 — Implementation Plan

**Document version:** 3.0 — FINAL  
**Status:** FROZEN. No architecture, navigation, or module changes after this version. Only implementation and user-feedback-driven improvements.  
**Last updated:** June 2025

---

## Governing Constraints

1. **Database is locked.** Schema, GSIs, and entity relationships approved in Phase 2 are not redesigned.
2. **Every phase is independently deployable.** Each phase produces something shippable, not a half-built state.
3. **No feature flags.** APForce has one active user population (employees in test). Ship or don't ship — no flag infrastructure.
4. **No backwards-compatibility shims.** The codebase is greenfield. Remove old patterns cleanly.
5. **Self-sufficient phases.** A phase must not require the completion of a future phase to be usable.
6. **Order is strict for Phases A–C.** The shell must exist before modules. After Phase C, Phases D–J can proceed in any order that respects the dependencies listed below.

---

## Phase Map

```
Phase A — Design Foundation (tokens + typography + base components)
    ↓
Phase B — App Shell (sidebar, routing, auth guard, notification bell)
    ↓
Phase C — My Work (Dashboard)
    ↓
Phase D — Communications (can start in parallel with E once B+C are live)
Phase E — Customers + Customer 360 core (can start in parallel with D)
    ↓
Phase F — Sales (depends on E — shares the Customers entity)
    ↓
Phase G — Customer 360 full polish (all 7 tabs complete, depends on D+E+F)
    ↓
Phase H — Analytics (depends on F — needs full pipeline data)
Phase I — Automation (depends on D+E — needs conversation triggers)
Phase J — Settings (can start any time after B; split by sub-section priority)
```

---

## Phase A — Design Foundation

**Goal:** Every component defined in `05_COMPONENT_LIBRARY.md` is built, documented in Storybook, and tested. No page is built yet — only components.

**Duration:** ~5 days

### Deliverables

1. `design-tokens.css` — all tokens from `04_DESIGN_SYSTEM.md` (colors, typography, spacing, radii, shadows, z-index, animations)
2. Tailwind config consuming design tokens as custom values
3. Inter font loaded (via Next.js `next/font`)
4. Component implementations (not wired to data):

**Primitive components:**
- Button (5 variants × 3 sizes, loading state, disabled state)
- Input (7 types including phone with +91 prefix)
- Select (4 variants: single, multi, combobox, multi-combobox)
- Checkbox
- Toggle
- Badge (6 variants)
- Avatar (3 variants × 6 sizes, deterministic colour from name)
- Card (5 variants)
- Pagination

**Layout components:**
- Table (sticky header, bulk action bar, skeleton rows, column visibility)
- Search Bar (debounce built in, URL param reflection)
- Filter Bar
- Saved Views bar

**State components:**
- Loading Skeleton (5 pattern variants)
- Empty State (23 named instances)
- Error State (section-level)
- Toast (4 variants, auto-dismiss + manual)

**Overlay components:**
- Universal Drawer (all 11 instances, with form content stubs)
- FAB (5 options, `/` keyboard trigger)
- Context Menu
- Notification Card

**APForce-specific:**
- Customer Row
- Kanban Card (drag state ready)
- Timeline Event (9 event types)
- Conversation Row
- Customer Snapshot Panel (inline, no navigation)
- Activity Card

### Acceptance criteria

- All components render correctly at mobile, tablet, laptop, desktop breakpoints
- All components pass WCAG 2.1 AA colour contrast check
- All interactive components are keyboard accessible (Tab, Enter, Esc, arrows where applicable)
- Storybook story exists for every component state (idle, hover, focus, loading, error, empty)
- `prefers-reduced-motion` respected in all transition components

---

## Phase B — App Shell

**Goal:** The application frame is live. A logged-in user sees the correct sidebar for their role and can navigate between module routes. Routes that don't have content yet show a placeholder.

**Duration:** ~3 days

### Deliverables

1. Layout component: Sidebar (desktop 240px/64px collapsed, tablet 64px icon-only, mobile bottom tab)
2. Sidebar items rendered from role-based config (not hardcoded per role — derive from permission matrix)
3. Client-side routing (Next.js App Router):
   - `/home`
   - `/communications`
   - `/customers`, `/customers/[contactId]`
   - `/sales`, `/sales/followups`
   - `/analytics`, `/analytics/[section]`
   - `/automation`
   - `/settings`, `/settings/[section]`
4. Auth guard: unauthenticated users are redirected to `/login`
5. Command Palette: structure and keyboard shortcut. Search result wiring is a stub (returns empty).
6. Notification center panel: structure and panel open/close. Content is a stub.
7. `?` keyboard shortcut: cheatsheet overlay with all shortcuts listed.
8. FAB: structure. FAB options each open a stub drawer.
11. `Ctrl+L` global shortcut: registered at the app-shell level. Opens the "Log a Call" Universal Drawer. Drawer form: call notes (textarea, required) + new stage (dropdown, optional) + follow-up date + follow-up description + assignee. Single submit creates a NOTES# record, optionally updates contact stage, and optionally creates a FOLLOWUP# record in one API call.
9. `skip to main content` link for accessibility.
10. FOUC prevention: inline `<script>` in `<head>` to apply theme before first paint.

### Acceptance criteria

- Navigation between all module routes works (modules show a placeholder)
- Sidebar shows correct items for each of the 5 roles (test with mock session)
- Command palette opens on `Cmd+K` / `Ctrl+K` from any route
- Notification panel opens/closes from bell icon
- FAB visible on all routes
- Auth redirect works for unauthenticated access to protected routes
- Shell renders without content flash on initial load

---

## Phase C — My Work (Dashboard)

**Goal:** The first real module is live. Employees can see what to do immediately on login.

**Duration:** ~4 days

### Deliverables

1. My Work page (`/home`) with all 6 sections:
   - Urgent Replies (from open conversations assigned to me, unread, sorted by wait time)
   - Today's Follow-ups (from FOLLOWUP# records due today, grouped by overdue/today)
   - Unread Conversations (inbox summary)
   - Leads Needing Attention (from CONTACT# where stage approaching threshold, own only)
   - Today's KPIs (aggregated metrics for the logged-in employee)
   - Recent Activity (last 5 actions from the employee)
2. Data fetching: React Query hooks for each section, fetching in parallel
3. Follow-up "Mark done" and "Reschedule" inline actions (reschedule opens Universal Drawer)
4. All loading skeletons
5. Empty states for each section
6. Error states (per-section, independent)
7. All keyboard shortcuts from the screen spec
8. Permission scoping (Sales/Support see own data; Manager sees team; Admin/Owner sees all)
9. Getting Started checklist: shown to new employees (zero data) instead of sections 1-4. Three steps: add contact, start conversation, add follow-up. Auto-dismisses on completion or after 7 days. Admin/Owner variant shows workspace setup checklist: connect WhatsApp, invite team, configure stages.

### API endpoints used

- `GET /api/conversations?status=open&assigned=me&unread=true` — urgent replies
- `GET /api/followups?due=today&assignee=me` — today's follow-ups
- `GET /api/conversations?status=open&assigned=me` — unread conversations
- `GET /api/analytics/kpis?scope=me&period=today` — KPI cards
- `GET /api/activity?actor=me&limit=5` — recent activity

### Acceptance criteria

- Page shows data within 1 second on fast connection
- All 6 sections are independently loadable (one failed section does not break others)
- Follow-up mark done uses optimistic UI (checkbox ticks immediately, row fades)
- KPI card numbers match server aggregate
- My Work data is prefetched on login (data ready before the route is visible)

---

## Phase D — Communications

**Goal:** Employees can manage all WhatsApp conversations from one screen.

**Duration:** ~8 days

### Deliverables

1. Three-pane layout (responsive: two-pane on tablet, single-screen on mobile)
2. Conversation list pane:
   - Tab bar (Open / Resolved / Pending / Unassigned)
   - Mine / All filter (role-gated: All only visible to Manager+)
   - Search bar (searches contact name, phone, last message)
   - Infinite scroll (30 per page)
   - Real-time updates: new message on open conversation rises to top without page refresh
3. Conversation thread pane:
   - Virtualised message list (50 messages, scroll up loads more)
   - Message bubbles (outbound right, inbound left, timestamp, delivery status ticks)
   - Date separators
   - Assign + Resolve controls in thread header
   - Message input (plain text, send on Ctrl+Enter or button click)
   - Attachment button (media picker, future: file upload)
   - Template picker (Ctrl+M): searchable list of Meta-approved templates
4. Customer Snapshot Panel:
   - Stage, owner, tags — all inline editable
   - Notes section (add inline, view last 3, "view all" opens C360 Notes tab)
   - Follow-ups section (add inline, view today's + overdue, "view all" opens C360 Follow-ups tab)
   - Assign conversation control
   - Resolve conversation button
   - Link to Customer 360
5. All optimistic UI (assign, resolve, stage change, tag change all apply immediately)
6. All keyboard shortcuts from screen spec
7. Permission enforcement (Sales sees own conversations only; no Assign to others)
8. Real-time delivery status (WAMID# status polling or webhook-pushed updates)

### API endpoints used

- `GET /api/conversations` — list with filters
- `GET /api/conversations/[id]/messages` — thread
- `POST /api/conversations/[id]/messages` — send message
- `PATCH /api/conversations/[id]` — assign, resolve, stage, tags
- `GET /api/templates` — WhatsApp templates list

### Acceptance criteria

- Sending a message: bubble appears immediately, server confirm in background
- Resolving a conversation: disappears from Open tab immediately, appears in Resolved
- Assign action: assigned-to badge updates immediately
- Stage/owner/tag changes in snapshot: instant
- Template picker: searchable, keyboard navigable, send on Enter
- Three-pane layout responsive across all breakpoints per spec

---

## Phase E — Customers + Customer 360 Core

**Goal:** Full contact directory and the Customer 360 workspace.

**Duration:** ~8 days

### Deliverables

**Customers module:**
1. Table with all columns, sort, filter, pagination
2. Search (250ms debounce, server-side)
3. Saved views (localStorage + server-sync)
4. Bulk actions (assign, tag, stage, delete)
5. Import CSV (multi-step drawer wizard)
6. Export (server-generated, streamed download)
7. Context menu (right-click)
8. All keyboard shortcuts

**Customer 360:**
1. Header zone (name, phone, email, stage, owner, tags — all inline editable)
2. Back navigation (contextual: "← Back to [source]")
3. Activity panel (280px right side, last 20 events)
4. All 7 tabs:
   - **Overview:** contact details + pipeline details + next action + quick stats
   - **Conversations:** list of all conversations for this contact (links to Communications)
   - **Notes:** inline composer + notes list (add, edit, delete own)
   - **Follow-ups:** quick-add row + grouped follow-up list (Overdue, Today, Upcoming, Completed). Includes [+1 Day] quick-snooze button.
   - **Timeline:** chronological audit trail, filter by event type
   - **KYC:** status checklist + complete/remarks
   - **Documents:** upload area + file list
5. Send message from header (deep-link to Communications with conversation active)
6. Add follow-up from header (Universal Drawer)
7. All inline edits save immediately (no save button)
8. Permission enforcement (Support: read-only; Sales: own only; Manager: team)

### API endpoints used

- `GET /api/contacts` — list
- `GET /api/contacts/[id]` — single contact + all related entity IDs
- `PATCH /api/contacts/[id]` — edit any field
- `GET /api/contacts/[id]/notes` — notes
- `POST /api/contacts/[id]/notes` — add note
- `GET /api/contacts/[id]/tasks` — tasks
- `POST /api/contacts/[id]/tasks` — add task
- `GET /api/contacts/[id]/timeline` — timeline events
- `GET /api/contacts/[id]/documents` — documents
- `POST /api/contacts/[id]/documents` — upload
- `DELETE /api/contacts/[id]` — soft delete

---

## Phase F — Sales

**Goal:** Kanban pipeline and follow-up management.

**Duration:** ~5 days

### Deliverables

1. Kanban board (drag-and-drop across stages, optimistic updates)
2. List view (reuses Customer Row + Table from Phase E, adds Stage column)
3. Follow-ups view (grouped by Overdue / Today / Tomorrow / Future, filterable)
4. Kanban keyboard shortcuts (→/← to move stage)
5. Kanban drag-and-drop accessibility (keyboard alternative)
6. Kanban column "Add Lead" (opens Universal Drawer)
7. Bulk actions on list view (reuses Phase E infrastructure)
8. Permission enforcement

### Dependencies

- Phase E must be complete (Customers). Kanban cards open Customer 360.

---

## Phase G — Customer 360 Polish

**Goal:** All 7 tabs are fully polished with real data, real-time updates, and all edge cases handled.

**Duration:** ~3 days

This phase addresses items deferred from Phase E for complexity:
- Notes: @mention support (autocomplete employee names when typing `@`)
- Tasks: assign tasks to another employee (Drawer field)
- Documents: drag-and-drop upload into the Documents tab area
- Timeline: pagination ("Load more events")
- KYC: remarks history (not just current remarks)
- Activity panel: real-time (new events appear without refresh)
- C360 prefetch: on hover > 200ms from any list

### Dependencies

- Phase D (Communications) — Conversations tab shows real conversation data
- Phase E (Customers) — Core C360 must be complete
- Phase F (Sales) — Follow-up tasks may reference pipeline stages

---

## Phase H — Analytics

**Goal:** Reporting dashboards for managers and owners.

**Duration:** ~5 days

### Deliverables

1. Overview dashboard (metric cards + pipeline funnel + leads-over-time line chart + team leaderboard)
2. Pipeline tab (funnel per stage, conversion rates, avg time in stage)
3. Conversations tab (volume, response time, resolution rate, per-employee)
4. Team tab (leaderboard, per-employee breakdown, goal tracking)
5. Sources tab (which source produces most leads, conversion by source)
6. Date range filter + team filter
7. Drill-down: every chart element navigates to filtered Customers/Sales/Communications view
8. Export (CSV for all views, PDF for Overview)
9. Permission scoping (Sales: own data; Manager: team; Admin/Owner: all)

### Dependencies

- Phase F (Sales) must be complete — pipeline data needed for Pipeline tab

---

## Phase I — Automation

**Goal:** Non-technical employees can configure workflow automations.

**Duration:** ~6 days

### Deliverables

1. Workflow list (active/inactive tabs, run stats)
2. Workflow builder (linear: trigger → conditions → actions)
3. Triggers: new contact, message received, stage changed, follow-up overdue, tag added, time schedule
4. Conditions: stage is, source is, tag is, assigned to is, contact field equals
5. Actions: send WhatsApp template, assign to employee, change stage, add tag, create follow-up, wait (delay)
6. Multiple actions in sequence (with delay steps between)
7. Test mode (simulation — no real sends, shows what would happen)
8. Activation/deactivation toggle
9. Execution logs (timestamp, contact name, action taken, success/failure)
10. 4 pre-built templates (Welcome, Follow-up reminder, KYC docs, Onboarding)

### Dependencies

- Phase D (Communications) — WhatsApp template send action requires template infrastructure
- Phase E (Customers) — Contact-based triggers require CONTACT# entity to exist

---

## Phase J — Settings

**Goal:** All settings sections are functional.

**Duration:** ~6 days

Settings can be built in parallel with any other phase after Phase B is complete. Prioritise sub-sections by business need:

### J1 — High priority (needed from day 1)

- **Employees** (invite, role, deactivate) — needed for team setup
- **WhatsApp** (connection status, disconnect)
- **Message Templates** (view Meta-approved templates)
- **Company Profile**

**Duration:** ~2 days

### J2 — Medium priority

- **Pipelines & Stages** (rename, reorder, add stage)
- **Tags** (create, color, delete)
- **Teams** (group employees)
- **Broadcast** (list + new broadcast wizard)

**Duration:** ~2 days

### J3 — Lower priority

- **Roles & Permissions** (role card view, toggle individual permissions)
- **Audit Log** (read-only table, filter, export)
- **Integrations** (API key, webhook URL)
- **Billing** (Owner-only: plan, invoices, upgrade)
- **Danger Zone** (Owner-only: delete account)

**Duration:** ~2 days

---

## Parallel Execution Strategy

After Phase C is complete, the following can proceed in parallel with the right team allocation:

```
Team A: Phase D (Communications) — requires WhatsApp API integration
Team B: Phase E (Customers) — core CRUD and C360
Team C: Phase J1 (Settings: Employees + WhatsApp) — unblocks team setup

After D + E are done:
Team A: Phase F (Sales) + Phase G (C360 Polish)
Team B: Phase H (Analytics)
Team C: Phase I (Automation) + Phase J2/J3
```

---

## React Query Cache Strategy

All modules share a single React Query client. Cache keys follow this pattern:

| Data | Cache key | Stale time | Cache time |
|---|---|---|---|
| Contact list | `['contacts', filters]` | 30s | 5min |
| Single contact | `['contact', contactId]` | 60s | 10min |
| Conversation list | `['conversations', filters]` | 15s | 5min |
| Conversation thread | `['messages', conversationId]` | 10s | 5min |
| Follow-ups | `['followups', date, assignee]` | 30s | 5min |
| KPI metrics | `['kpis', scope, period]` | 60s | 10min |
| Analytics | `['analytics', type, filters]` | 300s | 30min |
| Templates | `['templates']` | 600s | 60min (rarely changes) |
| Employees | `['employees']` | 300s | 30min |

When a mutation succeeds, the relevant cache keys are invalidated immediately (not on next poll). This ensures the list reflects the change without waiting for the stale time.

---

## Performance Budget

| Metric | Target | Measured at |
|---|---|---|
| First Contentful Paint | < 1.2s | Fast 4G, cold load |
| Largest Contentful Paint | < 2.5s | Fast 4G, cold load |
| Time to Interactive | < 3.5s | Fast 4G, cold load |
| Module navigation (warm) | < 100ms | Cached data, client-side routing |
| Module navigation (cold) | < 800ms | No cache, includes API call |
| Skeleton-to-data swap | < 500ms | p95 on fast 4G |
| Command palette open | < 50ms | From Cmd+K keystroke |
| Drawer open animation | 200ms | As designed |
| API response | < 200ms | p95 on AWS, India region |

---

## Engineering Quality Gates (per phase)

Before marking any phase complete:

1. **TypeScript:** Zero type errors with `strict: true`. No `any` casts without a comment explaining why.
2. **Keyboard:** All interactive elements reachable via Tab. All shortcuts documented in Phase B's cheatsheet overlay work.
3. **WCAG AA:** All text passes contrast check. All interactive elements have focus rings. All form fields have labels.
4. **Mobile:** Tested on iPhone SE (375px) and Galaxy S22 (390px) in browser DevTools. No horizontal scroll.
5. **Empty + Error states:** Every data fetch has both states implemented before the phase is considered done.
6. **Optimistic UI:** All writes (create, update, delete, status changes) are optimistic with rollback on failure.
7. **No console errors:** Zero errors or warnings in browser console in normal operation.

---

## Decisions Deferred to Future Phases (Not V3)

The following are explicitly out of scope for V3 and must not be designed into the current codebase:

- Email channel integration
- Instagram DM integration
- Dark mode (tokens are designed but mode switching is not implemented)
- Advanced analytics (funnel attribution, cohort analysis)
- Contact merge
- Duplicate detection
- Revenue tracking / commission module
- Mobile native app (PWA only in V3)
- OpenSearch migration (applicable when contacts > 500K per company)
- Role-specific onboarding flows
- AI-assisted message suggestions
- Referral tracking
