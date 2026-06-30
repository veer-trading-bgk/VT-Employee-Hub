# APForce V3 — Phase 3 Implementation Plan

**Status:** Approved Pre-Phase 3 Foundation Document
**Date:** 2026-06-29
**Version:** 3.0

---

## Guiding Rules

1. Every commit must be independently deployable to production.
2. Every commit must be backward-compatible with the current data model unless migration is explicitly specified.
3. No commit may change more than one module's primary responsibility.
4. Every commit ends with a Production Validation Report.
5. Stop after each commit and wait for approval before proceeding.
6. No commit may exceed ~400 lines changed (additions + deletions combined).
7. Design system changes (colours, spacing, components) are separate commits from feature changes.

---

## Phase 3 Objective

Transform APForce from a Customer 360-centric CRM into a complete Business Operating System without breaking any existing functionality.

---

## Commit Sequence

---

### Commit P3-01 — Explicit Lifecycle Stage Field

**Purpose:** Add `lifecycleStage` as an explicit field on every contact record. This is the data foundation for everything in Phase 3.

**Problem solved:** V2 infers lifecycle from pipeline stage. V3 needs lifecycle to be explicit, queryable, and independently mutable.

**Files changed:**
- `src/lib/contacts/types.ts` — Add `lifecycleStage` field to `ContactDetail` type
- `src/lib/contacts/journeyInference.ts` — Update to use explicit field when present, fall back to inference when absent (backward compatibility)
- `src/contexts/Customer360Context.tsx` — Pass `lifecycleStage` through context
- Lambda: `api/crm/leads/[id].ts` — Include `lifecycleStage` in GET response if field exists

**Validation:**
- TypeScript: zero errors
- Existing contacts without `lifecycleStage` fall back to inferred value
- Customer 360 renders correctly for both old and new records
- No visual change to the UI

**Rollback:** Revert type change. The field is optional — existing code continues to work.

**Risk:** Low. Additive change only.

**Testing:**
- Load an existing contact → lifecycle badge still renders (inferred)
- A new contact created after this commit → `lifecycleStage` is set explicitly

---

### Commit P3-02 — Lifecycle Badge in Customer 360 Header

**Purpose:** Surface the explicit lifecycle stage as a prominent badge in the Customer 360 header. Replace the inferred journey bar stage with the explicit lifecycle badge.

**Files changed:**
- `src/components/contacts/ContactHeader.tsx` — Replace workspace pill with lifecycle badge using correct colour system
- `src/lib/contacts/types.ts` — Add `LIFECYCLE_STAGES` constant and badge config map
- `src/components/contacts/LifecycleBadge.tsx` — New shared component (used in header, conversation list, search results)

**Validation:**
- Architecture Compliance checklist passes
- Lifecycle badge shows correct colour and label for each stage
- Falls back gracefully to inferred stage for contacts without explicit field

**Rollback:** Revert `ContactHeader.tsx` and remove `LifecycleBadge.tsx`.

**Risk:** Low. Visual change only. No data mutations.

**Testing:**
- Customer 360 for a known Lead → blue "Lead" badge
- Customer 360 for a known Won contact → green "Customer" badge
- Unknown contact (no CRM record) → grey "Unknown" badge

---

### Commit P3-03 — Lifecycle Promotion in Customer 360 Profile Tab

**Purpose:** Allow agents and managers to explicitly promote a contact's lifecycle stage from the Profile tab.

**Files changed:**
- `src/components/contacts/tabs/ProfileTab.tsx` — Add Lifecycle section with current stage display and "Promote" button
- `src/hooks/useLifecycleMutation.ts` — New hook for lifecycle stage mutations
- Lambda: `api/contacts/lifecycle.ts` — New endpoint: `PUT /api/contacts/[id]/lifecycle { stage, reason }`
- DynamoDB: Update contact record `lifecycleStage`, `lifecycleUpdatedAt`, `lifecycleUpdatedBy`

**Validation:**
- Promotion confirmation dialog appears before mutation fires
- Timeline event created: "Lifecycle changed: Lead → Customer · [user]"
- Health score recalculates after promotion

**Rollback:** Remove the Lifecycle section from Profile tab. The Lambda endpoint can remain (additive).

**Risk:** Medium. First write mutation for lifecycle field.

**Testing:**
- Promote a Lead to Customer → badge updates, timeline event recorded
- Attempt to demote (Customer → Lead) → requires manager permission, shows error for sales agents

---

### Commit P3-04 — Lifecycle Filters in Customers Module

**Purpose:** Add lifecycle sub-navigation to the Customers module: All | Leads | Customers | Investors | Inactive

**Files changed:**
- `src/app/customers/page.tsx` — Replace current stage filter with lifecycle filter tabs
- `src/app/customers/page.tsx` — Add `LifecycleBadge` to contact list rows (replace stage badge)
- `src/lib/contacts/types.ts` — Update filter state type

**Validation:**
- "Leads" tab shows contacts with lifecycle = Lead or Qualified
- "Customers" tab shows lifecycle = Customer
- "Investors" tab shows lifecycle = Investor or VIP
- "Inactive" tab shows lifecycle = Dormant
- "All" tab shows all contacts
- Existing URL-persistent filter state continues to work

**Rollback:** Revert to previous Customers page.

**Risk:** Low. Filtering only — no data mutations.

---

### Commit P3-05 — Rename Modules (Routes + Navigation)

**Purpose:** Implement the V3 navigation rename:
- `/admin/whatsapp` → `/communications`
- `/admin/contacts` → `/customers`
- `/admin/crm` → `/sales`
- Add redirect routes for all old paths

**Files changed:**
- `src/app/communications/page.tsx` — New file (moves WhatsApp inbox)
- `src/app/customers/page.tsx` — New file (moves Contact Hub)
- `src/app/sales/page.tsx` — New file (moves CRM)
- `src/app/admin/whatsapp/page.tsx` — Redirect to `/communications`
- `src/app/admin/contacts/page.tsx` — Redirect to `/customers`
- `src/app/admin/crm/page.tsx` — Redirect to `/sales`
- `src/components/layout/Sidebar.tsx` — Update nav items: labels + hrefs
- `src/components/layout/BottomNav.tsx` — Update mobile nav hrefs
- All `router.push('/admin/contacts/...')` references → `/customers/...`

**Validation:**
- Old URLs redirect correctly (no 404s)
- Bookmark compatibility maintained
- All existing `?from=` parameters continue to work
- Back button behaviour unchanged

**Rollback:** Revert redirect routes. Old pages still exist until cleaned up.

**Risk:** Medium. URL changes touch many files. Requires thorough link audit.

**Testing:**
- Navigate to `/admin/whatsapp` → redirects to `/communications`
- All sidebar links work correctly
- Back button from Customer 360 → returns to correct source module

---

### Commit P3-06 — Customer 360 Route Update

**Purpose:** Move Customer 360 from `/admin/contacts/[id]` to `/customers/[id]`.

**Files changed:**
- `src/app/customers/[id]/page.tsx` — New location (copy from admin/contacts/[id])
- `src/app/admin/contacts/[id]/page.tsx` — Redirect to `/customers/[id]`
- `src/app/admin/crm/[id]/page.tsx` — Update redirect target

**Validation:**
- All existing Customer 360 links work via redirect
- `?from=` and `?tab=` parameters preserved through redirect

**Rollback:** Revert new file. Old route stays active.

**Risk:** Low if done after P3-05 (redirects in place).

---

### Commit P3-07 — Simplified Communications Sidebar

**Purpose:** Remove stage dropdown, tag editor, and quick note from the Inbox/Communications sidebar. Replace with the lean context strip defined in the V3 Communications specification.

**Files changed:**
- `src/components/whatsapp/LeadSidebar.tsx` — Remove stage select, tag input, quick note. Retain: name, phone, lifecycle badge, assignee select, chat status, "Open in Customer 360" button.

**Validation:**
- Sidebar renders correctly with simplified design
- "Open in Customer 360" button works from all conversation types
- Assignee select and chat status still functional
- Stage and tag information shows as read-only pills

**Rollback:** Revert `LeadSidebar.tsx`.

**Risk:** Low. Removes UI elements. No data changes.

**Testing:**
- Agents confirm they can still route conversations (assignee, status)
- Stage is visible (read-only) in sidebar
- Tags visible (read-only) in sidebar
- "Open in Customer 360" navigates correctly

---

### Commit P3-08 — Remove Inline Mutations from Customers List

**Purpose:** Make the Customers list read-only. Remove inline stage dropdown and floating tag selector. Replace with read-only badges.

**Files changed:**
- `src/app/customers/page.tsx` — Replace stage dropdown with badge; replace tag selector with static chips; remove tag mutation hooks from this page

**Validation:**
- Contact rows are now clickable navigation links (no accidental mutations)
- Stage badge displays correct value
- Tags display as non-interactive chips
- Performance improves (fewer mutation hooks, simpler event handlers)

**Rollback:** Revert `customers/page.tsx`.

**Risk:** Low. Removes UI elements. No data changes.

---

### Commit P3-09 — Home Page (Sales Agent)

**Purpose:** Build the Sales Agent home page — the My Work queue with follow-ups, conversations, pipeline summary, targets, and quick actions.

**Files changed:**
- `src/app/home/page.tsx` — New file. Sales agent role-filtered home.
- `src/components/home/FollowUpsWidget.tsx` — New component
- `src/components/home/OpenConversationsWidget.tsx` — New component
- `src/components/home/PipelineSummaryWidget.tsx` — New component
- `src/components/home/TargetProgressWidget.tsx` — New component
- `src/components/home/QuickActionsWidget.tsx` — New component
- `src/utils/permissions.ts` — Update `getHomePath` for `sales` role

**New API calls (parallel, independent):**
- `GET /api/tasks?due=today&assignedTo=me`
- `GET /api/conversations?status=open&assignedTo=me&limit=4`
- `GET /api/crm/leads?assignedTo=me&summary=true`
- `GET /api/metrics/today?userId=me`

**Validation:**
- Each widget loads independently (failure of one does not break others)
- Empty states render correctly when no data
- Follow-up tasks link to correct Customer 360
- Target progress reflects real metric data

**Rollback:** Remove `/home/` route. Agent continues using old dashboard.

**Risk:** Medium. Multiple new API calls. Data freshness critical.

---

### Commit P3-10 — Home Page (Manager)

**Purpose:** Build the Manager home page — team overview with overdue follow-ups, unassigned queue, pipeline snapshot, verification queue.

**Files changed:**
- `src/app/home/page.tsx` — Role-fork: if role = manager, render Manager home
- `src/components/home/TeamStatusWidget.tsx` — New component
- `src/components/home/OverdueFollowupsWidget.tsx` — New component
- `src/components/home/VerificationQueueWidget.tsx` — New component

**Validation:**
- Manager home shows team data (scoped to their team)
- Click on overdue follow-up → Customer 360 for that contact

**Rollback:** Revert home role fork.

**Risk:** Low given P3-09 foundation.

---

### Commit P3-11 — Home Page (Owner)

**Purpose:** Build the Owner home page — business pulse, team activity, pipeline value, key alerts.

**Files changed:**
- `src/app/home/page.tsx` — Role-fork: owner home
- `src/components/home/BusinessPulseWidget.tsx` — New component
- `src/components/home/KeyAlertsWidget.tsx` — New component

**New API calls:**
- `GET /api/analytics/pulse?period=week`

**Validation:**
- Owner home shows full team data (unfiltered)
- Business pulse metrics match Analytics > Overview numbers

---

### Commit P3-12 — Documents Tab Implementation

**Purpose:** Implement the Documents tab in Customer 360 (currently a "coming soon" stub).

**Files changed:**
- `src/components/contacts/tabs/DocumentsTab.tsx` — Full implementation
- `src/components/contacts/ContactTabPanel.tsx` — Remove `ComingSoonPanel` for documents
- Lambda: `api/contacts/[id]/documents.ts` — New endpoint: GET/POST/DELETE documents
- S3: Document upload flow (presigned URL pattern, already used for media)

**Document categories:** KYC Documents | WhatsApp Media | Agent Uploads

**Validation:**
- Upload a KYC document → appears in Documents tab
- Download document → presigned S3 URL works
- Delete document → Timeline event recorded: "Document deleted: [name]"
- WhatsApp media auto-syncs (from conversation messages)

**Rollback:** Revert to `ComingSoonPanel`. Documents Lambda endpoint stays (additive).

**Risk:** Medium. New S3 upload flow. Test file size limits and MIME type validation.

---

### Commit P3-13 — Expected Deal Value + Win Probability in CRM Tab

**Purpose:** Activate the reserved `expectedValue` and `probability` fields in Customer 360 CRM tab.

**Files changed:**
- `src/components/contacts/tabs/CrmTab.tsx` — Add expected value input (₹ formatted) and win probability slider (0–100%)
- Lambda: `api/crm/leads/[id]/value.ts` — New endpoint: `PUT /api/crm/leads/[id]/value`
- `src/lib/contacts/types.ts` — `expectedValue` and `probability` already reserved; no type changes needed

**Validation:**
- Enter ₹5,00,000 expected value → saves correctly, formatted as ₹5L
- Win probability slider → 0–100%, updates in real time
- Timeline event: "Deal value updated: ₹5L · 60% probability"
- No impact on existing contacts that have no value set

---

### Commit P3-14 — Timeline Lifecycle and CRM Events

**Purpose:** Add lifecycle change events and pipeline stage events to the Customer 360 Timeline.

**Files changed:**
- `src/components/contacts/tabs/TimelineTab.tsx` — Add `lifecycle_change`, `pipeline_move`, `assignment_change` event types with display logic
- Lambda: `api/contacts/[id]/events.ts` — When lifecycle changes, write a Timeline event
- Lambda: `api/crm/leads/[id]/stage.ts` — When stage changes, write a Timeline event

**Validation:**
- Promote lifecycle → Timeline shows "Lifecycle changed: Lead → Customer · Arun"
- Move pipeline stage → Timeline shows "Stage moved: Contacted → Qualified"
- Filter "CRM" in Timeline → only lifecycle and stage events shown

---

### Commit P3-15 — Health Score Enhancement

**Purpose:** Upgrade health score from a static number to a multi-signal client-side calculation with an explanation tooltip.

**Files changed:**
- `src/lib/contacts/healthScore.ts` — New file: deterministic health score algorithm (6 weighted signals)
- `src/components/contacts/HealthScoreBadge.tsx` — Upgrade from static number to visual bar with tooltip breakdown
- `src/components/contacts/ContactHeader.tsx` — Use new badge

**Validation:**
- Health score changes when contact data changes (e.g., overdue task lowers score)
- Tooltip shows the contributing signals with check/warning icons
- Score is deterministic: same data → same score, always

---

### Commit P3-16 — Next Best Action in Customer 360 Header

**Purpose:** Add the "Next Best Action" prompt to the Customer 360 header. Rule-based, client-side.

**Files changed:**
- `src/lib/contacts/nextBestAction.ts` — New file: rule engine (10 named rules, returns action label + tab link)
- `src/components/contacts/ContactHeader.tsx` — Add Next Action button below stage chip
- `src/components/contacts/NextActionButton.tsx` — New small component

**Validation:**
- Contact with overdue follow-up → "Complete overdue follow-up" button
- Contact with no reply to last message → "Reply to [name]'s message"
- Contact with 24h window < 2h → "Send a message before window closes"
- All suggestions navigate to the correct tab
- No action shown if no rules match (button hidden, not empty)

---

### Commit P3-17 — Analytics Module (Phase 3 Foundation)

**Purpose:** Build the Analytics module with the Overview and Pipeline tabs. Empty states for Team, Conversations, Sources.

**Files changed:**
- `src/app/analytics/page.tsx` — New module with sub-navigation
- `src/components/analytics/OverviewTab.tsx` — Key metrics snapshot
- `src/components/analytics/PipelineTab.tsx` — Funnel chart, stage conversion rates
- `src/components/analytics/` — Empty state stubs for Team, Conversations, Sources

**New API calls:**
- `GET /api/analytics/overview?period=week`
- `GET /api/analytics/pipeline?period=week`

**Validation:**
- Analytics shows in sidebar for Manager, Admin, Owner roles
- Not visible for Sales, Support roles
- Funnel chart renders correctly with real pipeline data

---

### Commit P3-18 — Analytics Team and Sources Tabs

**Purpose:** Implement the Team and Sources analytics tabs.

**Files changed:**
- `src/components/analytics/TeamTab.tsx` — Per-agent performance table
- `src/components/analytics/SourcesTab.tsx` — Source attribution chart + table

**New API calls:**
- `GET /api/analytics/team?period=week`
- `GET /api/analytics/sources?period=week`

---

### Commit P3-19 — Employees Module Consolidation

**Purpose:** Merge the scattered employee management pages (employees, attendance, targets, verification, bulk-entry) into a single consolidated Employees module.

**Files changed:**
- `src/app/employees/page.tsx` — New consolidated module with sub-nav
- `src/app/employees/attendance/page.tsx`
- `src/app/employees/targets/page.tsx`
- `src/app/employees/verification/page.tsx`
- Old `/admin/employees`, `/admin/attendance`, `/admin/targets` → redirect
- `src/components/layout/Sidebar.tsx` — Replace 5 sidebar items with 1

**Validation:**
- All old URLs redirect correctly
- Verification workflow still functions
- Attendance and targets work in new location

---

### Commit P3-20 — Role System Update (sales + support + owner roles)

**Purpose:** Introduce the V3 role model: rename `agent/telecaller/intern` to `sales`, `team_lead` to `manager`, add `support` and `owner` roles.

**Files changed:**
- `src/types/index.ts` — Update `Role` type
- `src/utils/permissions.ts` — Update role hierarchy, labels, colours, home paths
- `src/components/layout/Sidebar.tsx` — Update role-based visibility
- Lambda: auth token generation — include new role names
- DynamoDB: migration script — remap existing role values

**Migration plan:**
- `agent` → `sales`
- `telecaller` → `sales`
- `intern` → `sales` (with `restrictions: ['no-delete']` flag)
- `team_lead` → `manager`
- `admin` → `admin` (unchanged)
- First user in each company → `owner`

**Validation:**
- All existing users can log in after role migration
- Home page renders correct content for each role
- Sidebar shows correct modules per role
- Permissions are correctly enforced (test matrix from document 06)

**Rollback:** Role migration can be reversed by re-applying the mapping in reverse.

**Risk:** High. Role system change touches every permission check. Requires full permission matrix testing.

---

## Phase 3 Commit Summary

| Commit | Description | Risk |
|---|---|---|
| P3-01 | Explicit lifecycle field | Low |
| P3-02 | Lifecycle badge in C360 header | Low |
| P3-03 | Lifecycle promotion in Profile tab | Medium |
| P3-04 | Lifecycle filters in Customers | Low |
| P3-05 | Module renames (routes + nav) | Medium |
| P3-06 | C360 route update | Low |
| P3-07 | Simplified Communications sidebar | Low |
| P3-08 | Read-only Customers list | Low |
| P3-09 | Home page (Sales Agent) | Medium |
| P3-10 | Home page (Manager) | Low |
| P3-11 | Home page (Owner) | Low |
| P3-12 | Documents tab | Medium |
| P3-13 | Deal value + win probability | Low |
| P3-14 | Timeline lifecycle events | Low |
| P3-15 | Health score enhancement | Low |
| P3-16 | Next best action | Low |
| P3-17 | Analytics overview + pipeline | Medium |
| P3-18 | Analytics team + sources | Low |
| P3-19 | Employees module consolidation | Medium |
| P3-20 | Role system update | High |

**Recommended order:** P3-01 through P3-04 (data foundation), then P3-05/P3-06 (navigation), then P3-07/P3-08 (cleanup), then P3-09 through P3-11 (home), then P3-12 through P3-16 (Customer 360 enhancements), then P3-17/P3-18 (analytics), then P3-19/P3-20 (structure).

P3-20 (role system) should be last because it affects the entire permission surface. All previous commits should be tested with the existing role system, then the role system migrated as the final step.

---

## Production Validation Report Template (Phase 3)

Each commit produces a report with this structure:

```
## Production Validation Report — [Commit ID]

### Architecture Compliance
✅ Contact First Architecture
✅ Repository Pattern
✅ Service Layer
✅ No Duplicate Components
✅ Backward Compatible
✅ Documentation Updated
✅ CLAUDE.md Reviewed

### Changes Made
[List of files and what changed]

### Before / After
[If UI change: describe the before and after experience]

### Validation
- TypeScript: PASS / FAIL
- ESLint: PASS / N warnings (list pre-existing vs new)
- Manual test: [what was tested]
- API: [endpoints touched]
- Data: [migrations, if any]

### Rollback Plan
[Specific steps to revert this commit]

### Risk Assessment
Low / Medium / High — [reason]
```
