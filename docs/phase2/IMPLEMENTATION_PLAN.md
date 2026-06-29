# Implementation Plan — Phase 2: Customer 360

## Principles

1. Every commit is independently deployable. No commit creates a broken state.
2. No existing page is removed until its replacement is verified working.
3. All new components are additive. Destructive changes only in Commits 8–9.
4. AI, Automation, and Campaigns are **not tabs**. They integrate into existing workspaces.
5. Customer 360 manages one customer. Broader business modules live outside it.
6. Backend changes are limited to minor additions (Commit 9). No schema changes.

---

## Approved Roadmap

| # | Commit | Status |
|---|---|---|
| 1 | Customer 360 Foundation | ✅ `353b5f5` |
| 2 | Conversation + Provider | ✅ `018865a` |
| 3 | Conversation Workspace | ✅ `867ff8c` |
| 4 | CRM Workspace | ✅ `e5e72f4` |
| 5 | Timeline & Activity Feed | ✅ `c94ad1d` |
| 6 | Contact Profile & Identity | ⏳ |
| 7 | Tasks & Follow-up Workspace | ⏳ |
| 8 | Contact Hub Migration | ⏳ |
| 9 | CRM Migration | ⏳ |
| 10 | Global Search & Navigation | ⏳ |
| 11 | Performance, Accessibility & UX Polish | ⏳ |
| 12 | Production Hardening & Regression Testing | ⏳ |
| 13 | Phase 2 Release + Documentation + Git Tag | ⏳ |

---

## Architectural Decisions (Locked)

### No dedicated AI tab
AI is an assistant, not a page. AI surfaces in:
- **Activity Panel** — next action recommendation, health score chip
- **Conversation** — message draft suggestions (reserved slot)
- **CRM** — win probability indicator (reserved slot)
- **Timeline** — AI-generated event summaries (reserved slot)

### No dedicated Automation tab
Automation is event-driven, not a workspace. Automation surfaces in:
- **Timeline** — automation trigger events (when data available)
- **CRM** — automation rules affecting this lead (reserved extension point)
- **Tasks** — tasks created by automation rules

### No Campaigns tab
Campaigns belong to a future Campaigns module, not inside Customer 360.
Extension points (`data-slot="campaign-*"`) are reserved in the CRM and Timeline.
No campaign data is fetched inside Customer 360.

### No Analytics tab
Contact analytics appear as cards and widgets in Profile and CRM.
System-wide analytics live in a separate Analytics module outside Customer 360.

---

## Commit 6 — Contact Profile & Identity

### Scope

Make the Profile tab the definitive identity record for a contact.

1. **Tab cleanup** — remove `campaigns`, `automation`, `ai` from `CONTACT_TABS` and `VALID_TAB_IDS`. Replace ComingSoonPanel entries for those tabs with `null` (or redirect to profile). This enforces the architectural decision that these are not Customer 360 tabs.

2. **Profile tab — inline editing**
   - Name: click-to-edit, saves on blur (`updateField` mutation)
   - Email: click-to-edit, saves on blur
   - Phone: read-only (click to copy)

3. **Profile tab — identity sections**
   - Personal Information (name, phone, email, last activity, created date)
   - Contact Analytics mini-cards: Total Messages, Last Activity, Response Rate (derived from `messageCount`, `lastInboundAt`)
   - Source Tracking (source label, created at, assigned to)
   - Tags (existing `TagSelector` + `TagBadge` reuse)
   - Relationship Graph — placeholder section with reserved `data-slot`
   - CRM Notes — read-only preview with "Edit in CRM →" link to CRM tab

4. **Activity Panel — health score slot**
   - Add `data-slot="activity-panel-ai-health"` reserved section
   - Shows `— / 100` chip with "AI not enabled" label

### Files Affected

**Modified files:**
- `dashboard/src/lib/contacts/types.ts` — remove `campaigns`, `automation`, `ai` from `TabId` union + `CONTACT_TABS` + `VALID_TAB_IDS`
- `dashboard/src/components/contacts/tabs/ProfileTab.tsx` — inline editing, analytics cards, source section, relationship placeholder
- `dashboard/src/components/contacts/ActivityPanel.tsx` — health score reserved slot
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — remove ComingSoonPanel for retired tabs

### Validation

- [ ] TypeScript: PASS
- [ ] ESLint: PASS (0 warnings)
- [ ] Name inline edit: click → input appears; blur → save; ESC → cancel
- [ ] Email inline edit: same pattern
- [ ] Phone: click copies to clipboard; no edit input appears
- [ ] Analytics mini-cards render with live data
- [ ] Tags work: add, create, remove
- [ ] Campaigns / Automation / AI tabs no longer appear in tab bar
- [ ] No broken URL states from removed tabs

### Rollback

Revert `types.ts`, `ProfileTab.tsx`, `ActivityPanel.tsx`, `ContactTabPanel.tsx`. Retired tabs show "coming soon" again. Profile tab reverts to basic display.

### Risks

Low. The tab removal is the highest-impact change — verify no other page links to `?tab=campaigns`, `?tab=automation`, or `?tab=ai`.

---

## Commit 7 — Tasks & Follow-up Workspace

### Scope

Dedicated workspace for follow-up management and internal notes.

1. **Tasks tab** — production-quality follow-up workspace
   - Follow-up list grouped: Overdue → Today → Tomorrow → This Week → Later
   - Each task card: date, note, status badge, Mark Done button, Reschedule button
   - Mark Done inline: collapses task, shows outcome input (free text), optional next follow-up date
   - Create task form: date picker + note + add button (identical to CRM tab form, extract shared component)
   - Sync: after any mutation, calls `refreshFollowups()` from context

2. **Notes tab** — internal agent notes workspace
   - Note input at top (textarea + Post button)
   - Notes feed below, newest first
   - Each note: agent name, timestamp, content, delete button
   - Notes are not editable after posting (audit integrity)
   - Implemented with `addNote` mutation from `useContactMutations`

3. **Extract shared component** — `FollowUpForm` (used in both Tasks tab and CRM tab; removes duplication)

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/TasksTab.tsx`
- `dashboard/src/components/contacts/tabs/NotesTab.tsx`
- `dashboard/src/components/ui/FollowUpForm.tsx` (extracted, shared by CrmTab + TasksTab)

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Tasks + Notes tabs
- `dashboard/src/components/contacts/tabs/CrmTab.tsx` — use shared `FollowUpForm`

### Validation

- [ ] TypeScript: PASS
- [ ] ESLint: PASS
- [ ] Tasks: follow-ups grouped correctly; overdue badge appears for past dates
- [ ] Mark Done: task collapses; outcome saved; optional next follow-up created
- [ ] Create task: form validates date required; success creates task in list
- [ ] Notes: post note; note appears without reload; agent name shown
- [ ] Notes: delete removes note with confirmation
- [ ] CRM tab follow-up section still works (shared FollowUpForm)

### Rollback

Remove `TasksTab.tsx`, `NotesTab.tsx`, `FollowUpForm.tsx`. Revert `ContactTabPanel.tsx` and `CrmTab.tsx`. Tasks and Notes tabs show "coming soon".

### Risks

Low. Data is already loaded in context. The shared `FollowUpForm` extraction is a transparent refactor.

---

## Commit 8 — Contact Hub Migration

### Scope

Make the Contact Hub (`/admin/contacts`) the primary entry point to Customer 360. Production-quality list view with search, filters, and sorting.

1. **Contact Hub enhancements**
   - Real-time search (debounced, calls existing API)
   - Filter by stage, assigned employee, source, tags
   - Sortable columns: Name, Stage, Last Activity, Created
   - Row click navigates to `/admin/contacts/[id]` (already in place from Commit 1; verify it works)
   - Keyboard accessibility: arrow keys navigate rows, Enter opens contact

2. **Inbox bridge**
   - Add "View Contact" button in `LeadSidebar.tsx` header, navigating to `/admin/contacts/[id]?tab=conversation`
   - Remove old "View CRM Lead" link from sidebar (now redundant)

3. **Breadcrumb / back navigation**
   - Ensure browser back from Customer 360 returns to Contact Hub (or to the page that launched it)
   - `?from=inbox` query param to control back button label: "Back to Inbox" vs "Back to Contact Hub"

### Files Affected

**Modified files:**
- `dashboard/src/app/admin/contacts/page.tsx` — search, filters, sort
- `dashboard/src/components/whatsapp/LeadSidebar.tsx` — "View Contact" button
- `dashboard/src/app/admin/contacts/[id]/page.tsx` — `?from` param for back button label

### Validation

- [ ] TypeScript: PASS
- [ ] ESLint: PASS
- [ ] Contact Hub search filters contacts in real time
- [ ] Stage filter shows only matching contacts
- [ ] Row click opens Customer 360
- [ ] Inbox: "View Contact" button appears in sidebar header
- [ ] Inbox: clicking "View Contact" opens Customer 360 at Conversation tab
- [ ] Back button label is correct based on origin

### Rollback

Revert `contacts/page.tsx` (search/filter removed). Revert `LeadSidebar.tsx`. Back button reverts to static label. Customer 360 still accessible; hub search reverts to basic display.

### Risks

Low-medium. The Contact Hub filter changes touch the list API query. Verify the existing API supports filter parameters before implementing client-side filter calls.

---

## Commit 9 — CRM Migration

### Scope

Retire the old CRM Lead Detail page by redirecting it to Customer 360. Update all internal links that reference the old page.

1. **Redirect** — `/admin/crm/[id]/page.tsx` → `redirect('/admin/contacts/${id}?tab=crm')`

2. **CRM Pipeline links** — verify pipeline card clicks navigate to Customer 360 (if they currently link to `/admin/crm/[id]`, they now redirect automatically)

3. **Follow-ups page links** — update contact name links in `/admin/crm/followups/page.tsx` to navigate to `/admin/contacts/[id]?tab=tasks`

4. **CRM page cleanup** — add deprecation banner to `/admin/crm/[id]/page.tsx` before redirect, confirming the redirect is intentional

### Files Affected

**Modified files:**
- `dashboard/src/app/admin/crm/[id]/page.tsx` — add redirect
- `dashboard/src/app/admin/crm/followups/page.tsx` — update contact name links

### Validation

- [ ] TypeScript: PASS
- [ ] Visiting `/admin/crm/[id]` redirects immediately to Customer 360 CRM tab
- [ ] CRM Pipeline card click → Customer 360 CRM tab
- [ ] Follow-ups contact names → Customer 360 Tasks tab
- [ ] Browser back from Customer 360 returns to CRM Pipeline (not the redirect)
- [ ] No 404s or broken internal links

### Rollback

Remove `redirect()` call. CRM Lead Detail page returns to normal rendering.

### Risks

Medium. The redirect affects all users who have bookmarked `/admin/crm/[id]` URLs. Communicate the change before deployment. Verify all internal navigation that references `/admin/crm/[id]`.

---

## Commit 10 — Global Search & Navigation

### Scope

Global search across contacts and navigation improvements.

1. **Global search** — command palette or header search bar
   - Searches contacts by name, phone, email
   - Keyboard shortcut: `Cmd/Ctrl + K`
   - Results navigate to `/admin/contacts/[id]`

2. **URL deep-linking** — verify all tab URLs work as direct navigation targets
   - Opening `/admin/contacts/[id]?tab=crm` directly should mount the correct tab
   - Invalid `?tab=` values default to Profile tab

3. **Tab URL sync** — ensure tab changes update the URL without full page reload (already in place; verify and fix edge cases)

### Files Affected

TBD based on search implementation. Likely:
- New global search component
- Modifications to the admin layout or navbar

### Validation

- [ ] TypeScript: PASS
- [ ] ESLint: PASS
- [ ] `Cmd+K` opens search palette
- [ ] Typing a name or phone number returns matching contacts
- [ ] Clicking a result navigates to Customer 360
- [ ] Deep-linking to `?tab=crm` opens CRM tab directly
- [ ] Invalid tab values default to Profile tab

### Risks

Medium. Global search introduces a new API call pattern. Design carefully to avoid triggering on every keystroke without debouncing.

---

## Commit 11 — Performance, Accessibility & UX Polish

### Scope

Cross-cutting improvements across all Customer 360 tabs.

1. **Performance**
   - Audit React Query `staleTime` values — standardise
   - Review memo() coverage — identify unnecessary re-renders
   - Lazy-load Documents tab (heavy media grid)
   - Add `loading` skeleton for initial page load

2. **Accessibility**
   - Keyboard navigation through tabs (`Arrow` keys, `Home`, `End`)
   - Focus management on tab switch
   - Screen reader announcement on tab change (`aria-live`)
   - Contrast audit for dark mode badges and chips

3. **UX Polish**
   - Loading skeletons for all tabs (consistent shimmer pattern)
   - Error states for failed queries (inline retry button)
   - Empty states for all tabs (consistent illustration + CTA)
   - Responsive: verify all tabs on mobile 375px

### Files Affected

Multiple files across all tabs. No new components — modifications and improvements only.

### Validation

- [ ] TypeScript: PASS
- [ ] ESLint: PASS
- [ ] Lighthouse accessibility score ≥ 90 on Customer 360 page
- [ ] All tabs keyboard-navigable without a mouse
- [ ] No layout overflow at 375px viewport
- [ ] All error states trigger and show retry option

### Rollback

Individual files can be reverted independently. No structural changes.

### Risks

Low. Improvements only. The accessibility changes are the highest-risk (focus management can cause unexpected scroll behaviour on some browsers).

---

## Commit 12 — Production Hardening & Regression Testing

### Scope

Final hardening before the Phase 2 release tag.

1. **Error boundaries** — wrap each tab in an `ErrorBoundary` so a crash in one tab does not crash the whole page

2. **Feature flags** — verify all reserved / placeholder sections are gated correctly and show appropriate messages when the feature is not enabled

3. **Regression testing checklist**
   - Inbox: sending / receiving messages unaffected
   - CRM Pipeline: stage changes still work
   - Follow-ups page: task completion still works
   - Contact Hub: search and row click still work
   - All Customer 360 tabs: render without errors on 5 different contact types (new, active, resolved, converted, no-messages)

4. **Monitoring**
   - Verify EMF metrics log on page load (from Commit 2b890cf production hardening)
   - Verify error events surface in CloudWatch

### Files Affected

- Error boundary components
- Feature flag checks in relevant tabs

### Validation

- [ ] TypeScript: PASS
- [ ] ESLint: PASS
- [ ] Crashing one tab does not crash the header or other tabs
- [ ] All placeholder sections show correct "feature not enabled" state
- [ ] Full regression checklist executed and passing

### Risks

Low. Hardening only. No functional changes.

---

## Commit 13 — Phase 2 Release + Documentation + Git Tag

### Scope

Formal Phase 2 release.

1. **Documentation update** — update all Phase 2 docs to reflect final implementation (this file, `CUSTOMER_360_ARCHITECTURE.md`, `FUTURE_EXTENSIONS.md`)

2. **Git tag** — `git tag v2.0.0 -m "Phase 2: Customer 360"`

3. **Deployment verification** — production smoke test across all tabs

4. **Post-Phase 2 cleanup notes** (not in this commit)
   - Evaluate removing `dashboard/src/app/admin/crm/[id]/page.tsx` entirely (after 30 days stable redirect)
   - Merge duplicate `Lead` and `ContactDetail` type definitions
   - Consolidate `context/` and `contexts/` folders

### Files Affected

Documentation files only. No code changes.

### Validation

- [ ] All docs reflect actual implementation
- [ ] Git tag `v2.0.0` exists and points to this commit
- [ ] Production smoke test passes

### Risks

None.
