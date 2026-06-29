# Phase 2 Implementation Plan

**Status:** Complete
**Tag:** v2.1.0-phase2
**Commits:** 13 (Commits 1–13 in Phase 2 sequence)

---

## Objective

Build Customer 360 — the canonical customer workspace for APForce — as a unified, production-ready experience that consolidates WhatsApp conversation, CRM pipeline, task management, notes, and timeline into one coherent page.

---

## Completed Commits

### Commit 1 — Customer 360 Page Foundation
`353b5f5` — feat(contacts): Commit 1 — Customer 360 page foundation

- Created `/admin/contacts/[id]` route with Suspense + ErrorBoundary
- Established `Customer360Provider` with single `['contact', leadId]` query
- Created `ContactHeader`, `ContactTabNav`, `ContactTabPanel` skeleton
- Defined `CONTACT_TABS`, `VALID_TAB_IDS`, and `TabId` type in `lib/contacts/types.ts`
- Created `ProfileTab` initial version

**Files added:** 13

---

### Commit 2 — Conversation Tab + Customer360Provider
`018865a` — feat(contacts): Commit 2 — Conversation tab + Customer360Provider

- Wired `ConversationTab` into Customer360Provider
- Provider now exposes `messages`, `notes`, `timeline` derived from single API response
- `useCustomer360()` hook established

**Files modified:** 5

---

### Commit 3 — Conversation Workspace Completion
`867ff8c` — feat(contacts): Commit 3 — Conversation Workspace completion

- Completed WhatsApp send/receive in `ConversationTab`
- Media attachments, reply mode, optimistic message delivery
- `MediaPreviewModal` for image/document previews

**Files modified:** 3

---

### Commit 4 — CRM Workspace Tab
`e5e72f4` — feat(contacts): Commit 4 — CRM workspace tab

- `CrmTab` with stage selector, deal value, assigned employee, tags, notes
- Optimistic stage updates (no visible flicker on change)
- `useContactMutations` extended with `updateCrm` mutation

**Files modified:** 6

---

### Commit 5 — Timeline & Activity Feed
`c94ad1d` — feat(contacts): Commit 5 — Timeline & Activity Feed

- `TimelineTab` merging messages + internal notes in chronological order
- Event type classification (message, note, task, stage-change)
- Extension data-slots reserved for AI, Workflow, Campaigns, Marketplace

**Files modified:** 2

---

### Roadmap Approval
`c1bd367` — docs(phase2): update roadmap to approved 13-commit plan

- Official 13-commit plan documented and approved
- Commits 6–13 scope locked

---

### Commit 6 — Contact Profile & Identity
`ccd52a1` — feat(contacts): Commit 6 — Contact Profile & Identity

- `ProfileTab` completed: inline name/email editing, source tracking, product interest, tags
- `CustomerJourneyBar` with 8-stage visual pipeline
- `HealthScoreBadge` with AI placeholder slot

**Files modified:** 4

---

### Commit 7 — Tasks & Follow-up Workspace
`f7f6bf0` — feat(contacts): Commit 7 — Tasks & Follow-up Workspace

- `TasksTab` with create / complete / delete follow-ups
- `FollowUpForm` reusable modal
- `Customer360Provider` extended with `followups`, `nextFollowup`, `refreshFollowups`
- `ActivityPanel` extended with next follow-up and overdue count

**Files modified:** 6

---

### Commit 8 — Contact Hub Migration
`7c215fb` — feat(contacts): Commit 8 — Contact Hub Migration

- `/admin/contacts` page migrated to use Customer 360 as canonical destination
- All Contact Hub "Open" links use `?from=hub`
- Kanban view with drag-and-drop ordering
- Delete with UndoToast confirmation

**Files modified:** 4

---

### Commit 9 — CRM Migration to Customer 360
`0abe679` — feat(crm): Commit 9 — CRM Migration to Customer 360

- `/admin/crm/[id]` retired; replaced with server-side redirect to `/admin/contacts/[id]?from=crm`
- All CRM pipeline links updated to `/admin/contacts/[id]?from=crm`
- CRM follow-ups links updated to `/admin/contacts/[id]?tab=tasks&from=crm`
- `ChatPane` "CRM ↗" link updated to `?tab=crm&from=inbox`
- `backLabel` in Customer 360 now reads "CRM" when `from=crm`

**Files modified:** 5

---

### Commit 10 — Navigation & Discovery
`09cafad` — feat(nav): Commit 10 — Navigation & Discovery

- `GlobalSearch` command palette (Cmd+K / Ctrl+K)
- Search by name or phone, keyboard navigation (↑↓ Enter Esc)
- React Query cache `['global-search', q]` with 30s staleTime
- `Navbar` search button + Cmd+K listener with proper cleanup
- Contact Hub `<Navbar title="Contact Hub" />` title

**Files modified:** 4

---

### Commit 11 — Performance, Accessibility & UX Polish
`791c90f` — perf(ux): Commit 11 — Performance, Accessibility & UX Polish

- `ActivityPanel`: tag IDs resolved to labels+colors via `['tag-catalog']` query
- `ActivityPanel`: `timeline.slice(-3).reverse()` replaces full-array copy
- `ProfileTab`: `useMemo` for `tagCatalog`, `resolvedTags`, `lastActivity`
- `ErrorBoundary`: `aria-label` + `focus-visible:ring-2` on Try Again button
- `UndoToast`: `aria-label` + `focus-visible:ring-2` on Undo button
- Removed stale `eslint-disable-next-line no-console` directive

**Files modified:** 4 (+ 1 stale directive removed)

---

### Commit 12 — Production Hardening & Regression Validation
`c3a33bc` — fix(prod): Commit 12 — Production Hardening & Regression Validation

- CRM legacy redirect now includes `?from=crm` (back label was showing "Contact Hub")
- `['tag-catalog']` staleTime unified to 5 min across all consumers
- Full TypeScript + ESLint audit; Phase 2 files confirmed clean
- Pre-existing legacy debt documented and deferred

**Files modified:** 3

---

### Commit 13 — Phase 2 Release
*This commit* — docs(release): Commit 13 — Phase 2 Release

- Created `docs/phase2/CUSTOMER_360_ARCHITECTURE.md`
- Created `docs/phase2/IMPLEMENTATION_PLAN.md`
- Created `docs/releases/PHASE2_RELEASE.md`
- Updated `README.md` to reflect Phase 2 architecture
- Created git tag `v2.1.0-phase2`

---

## Architecture Decisions Made During Phase 2

| ID | Decision | Commit |
|---|---|---|
| AD-001 | Customer 360 is the canonical customer workspace | Commit 1 |
| AD-002 | 7-tab frozen architecture | Commit 1 |
| AD-003 | Single `Customer360Provider` per page | Commit 2 |
| AD-004 | `?from=` param for back-navigation context | Commit 8 |
| AD-005 | Legacy `/admin/crm/[id]` retired via server redirect | Commit 9 |
| AD-006 | Global search uses existing `/api/contacts` endpoint | Commit 10 |

---

## APIs Reused (No New APIs Introduced)

| API endpoint | Usage |
|---|---|
| `GET /api/crm/leads/:id` | Customer 360 contact detail |
| `PATCH /api/crm/leads/:id` | CRM field updates, name/email edits |
| `GET /api/crm/pipeline` | Stage list for CRM tab |
| `GET /api/crm/followups` | Follow-up list for Tasks tab |
| `POST /api/crm/followups` | Create follow-up |
| `PATCH /api/crm/followups/:id` | Complete / update follow-up |
| `DELETE /api/crm/followups/:id` | Delete follow-up |
| `GET /api/tags` | Tag catalog |
| `GET /api/contacts` | Contact Hub list + GlobalSearch |
| `GET /api/admin/employees` | Employee list for CRM assignment |

**New APIs introduced: 0**
