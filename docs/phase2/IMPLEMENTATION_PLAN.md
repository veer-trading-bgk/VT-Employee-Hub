# Implementation Plan

## Principles

1. Every commit is independently deployable. No commit creates a broken state.
2. No existing page is removed until its replacement is verified working.
3. All new components are additive. Nothing is deleted in the first 7 commits.
4. Commit 8 is the cutover — it redirects `/admin/crm/[id]` to Customer 360.
5. After Commit 8, the CRM Lead Detail page is retired.
6. Backend changes in Phase 2 are limited to two minor filter-parameter additions (Commits 11 and 13).

---

## Commit 1 — Contact Detail Page Skeleton

### Scope

Create the Customer 360 page at `/admin/contacts/[id]` with:
- Header (real data from primary fetch)
- Tab navigation bar (all 10 tabs rendered, most with empty panels)
- Empty tab panels for all tabs except Profile
- Profile tab with static contact info (from primary fetch)

Update Contact Hub row click to navigate to `/admin/contacts/[id]` instead of opening WhatsApp.

### Files Affected

**New files:**
- `dashboard/src/app/admin/contacts/[id]/page.tsx`
- `dashboard/src/components/contacts/ContactHeader.tsx`
- `dashboard/src/components/contacts/ContactAvatar.tsx`
- `dashboard/src/components/contacts/ContactIdentityBlock.tsx`
- `dashboard/src/components/contacts/ContactMetaRow.tsx`
- `dashboard/src/components/contacts/CustomerJourneyBar.tsx`
- `dashboard/src/components/contacts/HealthScoreBadge.tsx`
- `dashboard/src/components/contacts/ContactTabNav.tsx`
- `dashboard/src/components/contacts/ContactTabPanel.tsx`
- `dashboard/src/components/contacts/tabs/ProfileTab.tsx`
- `dashboard/src/lib/contacts/journeyInference.ts`
- `dashboard/src/hooks/useContactMutations.ts`

**Modified files:**
- `dashboard/src/app/admin/contacts/page.tsx` — change row click from WhatsApp navigation to `/admin/contacts/[id]`

### Validation

- [ ] Contact Hub row click opens Customer 360 page (not WhatsApp)
- [ ] Header renders: avatar, name, phone, stage, assigned agent
- [ ] Journey bar renders with correct step states
- [ ] Health score shows `–` placeholder (AI not enabled)
- [ ] Profile tab renders: personal info, tags, source
- [ ] All other tabs render with "coming soon" or skeleton state
- [ ] Mobile layout: header is compact, tab bar is scrollable
- [ ] Back button returns to Contact Hub
- [ ] TypeScript compiles without errors
- [ ] Vercel preview deployment is green

### Rollback

Delete `dashboard/src/app/admin/contacts/[id]/` and revert the one-line change to `contacts/page.tsx`. The Contact Hub returns to its previous behaviour (opens WhatsApp) with zero impact on other pages.

### Risks

Low. This commit is purely additive. The existing `/admin/crm/[id]` page is untouched. The Inbox is untouched. Only the Contact Hub row click behaviour changes.

---

## Commit 2 — CRM Tab

### Scope

Implement the CRM tab: pipeline position bar, deal details card (stage, product interest, close deadline, estimated value), lead score card.

Extract `StageSelect` and `AssigneeSelect` from `LeadSidebar.tsx` into shared components and use them in both `ContactMetaRow` and `CrmTab`.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/CrmTab.tsx`
- `dashboard/src/components/ui/StageSelect.tsx` (extracted from LeadSidebar)
- `dashboard/src/components/ui/AssigneeSelect.tsx` (extracted from LeadSidebar)

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire CRM tab
- `dashboard/src/components/whatsapp/LeadSidebar.tsx` — import extracted components (behaviour unchanged)

### Validation

- [ ] CRM tab renders pipeline position bar with current stage highlighted
- [ ] Deal details card shows product, deadline, estimated value
- [ ] Stage change mutation fires and header stage updates
- [ ] LeadSidebar still works correctly (extraction is transparent)
- [ ] TypeScript compiles without errors

### Rollback

Remove `CrmTab.tsx`. Revert `ContactTabPanel.tsx`. Revert `LeadSidebar.tsx` import (if extraction was done). CRM tab falls back to "coming soon" state.

### Risks

Low. The extraction of `StageSelect` and `AssigneeSelect` is the only change that touches existing components, and it is a transparent refactor (same component, moved location, same behaviour).

---

## Commit 3 — Tasks Tab

### Scope

Implement the Tasks tab: follow-ups grouped by urgency (Overdue, Today, Tomorrow, This Week, Later), task cards with mark-done + reschedule, task outcome modal, create new task button.

Extract the task card component from `/admin/crm/followups/page.tsx` into a shared `TaskCard` component.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/TasksTab.tsx`
- `dashboard/src/components/ui/TaskCard.tsx` (extracted from followups page)

**Modified files:**
- `dashboard/src/app/admin/crm/followups/page.tsx` — import `TaskCard` (behaviour unchanged)
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Tasks tab

### Validation

- [ ] Tasks tab renders follow-ups grouped by urgency
- [ ] Mark Done opens outcome modal
- [ ] Outcome modal: text input + next follow-up toggle
- [ ] Creating a follow-up from Tasks tab works
- [ ] `/admin/crm/followups` page works identically (uses extracted TaskCard)
- [ ] TypeScript compiles without errors

### Rollback

Remove `TasksTab.tsx`. Revert `ContactTabPanel.tsx`. Revert followups page import. Tasks tab shows "coming soon". Followups page returns to its own inline card rendering.

### Risks

Low. Same extraction pattern as Commit 2.

---

## Commit 4 — Notes Tab

### Scope

Implement the Notes tab: internal notes feed (newest first), note creation input, note delete action.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/NotesTab.tsx`

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Notes tab

### Validation

- [ ] Notes tab renders existing internal notes
- [ ] New note input: type, submit, note appears without page reload
- [ ] Delete note removes it from the list
- [ ] Notes are not visible to customers (internal only — UI label confirms this)
- [ ] TypeScript compiles without errors

### Rollback

Remove `NotesTab.tsx`. Revert `ContactTabPanel.tsx`. Notes tab shows "coming soon".

### Risks

Low. Notes data comes from the primary fetch already loaded.

---

## Commit 5 — Timeline Tab

### Scope

Implement the Timeline tab: chronological activity feed synthesised from primary fetch data.

Implement `lib/contacts/buildTimeline.ts` pure function.
Implement `TimelineEvent` component with all event types.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/TimelineTab.tsx`
- `dashboard/src/components/contacts/TimelineEvent.tsx`
- `dashboard/src/lib/contacts/buildTimeline.ts`

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Timeline tab

### Validation

- [ ] Timeline tab renders events in chronological order
- [ ] Event types render with correct icons and actor names: messages, notes, stage changes, tasks, automations
- [ ] Filter dropdown filters events by type
- [ ] "Load earlier" works if pagination is available
- [ ] Timeline is empty-state-safe (new contact with no messages shows "No activity yet")
- [ ] Unit test for `buildTimeline.ts` (pure function — easy to test)
- [ ] TypeScript compiles without errors

### Rollback

Remove timeline files. Revert `ContactTabPanel.tsx`. Timeline tab shows "coming soon".

### Risks

Low. Client-side synthesis only. No new API calls.

---

## Commit 6 — Conversation Tab

### Scope

Implement the Conversation tab: reuse `ChatPane` in full-width mode. Connect WebSocket. Prefetch messages on page mount.

This is the highest-value tab and the most technically complex. ChatPane is reused without modification.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/ConversationTab.tsx`

**Modified files:**
- `dashboard/src/app/admin/contacts/[id]/page.tsx` — add prefetch for messages query
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Conversation tab

### Validation

- [ ] Conversation tab renders ChatPane in full width (no sidebar, no conversation list)
- [ ] Historical messages load correctly
- [ ] Sending a message from Conversation tab delivers to WhatsApp
- [ ] Incoming WhatsApp message appears in real-time (via WebSocket — test by sending a message to the contact's phone)
- [ ] Template picker works
- [ ] Load more / cursor pagination works
- [ ] ChatPane in the Inbox is completely unaffected
- [ ] TypeScript compiles without errors

### Rollback

Remove `ConversationTab.tsx`. Remove prefetch from page. Revert `ContactTabPanel.tsx`. Conversation tab shows "coming soon". Inbox is unaffected.

### Risks

Medium. This is the most complex tab because it wires WebSocket and reuses `ChatPane`. The risk is that `ChatPane` has implicit dependencies on the Inbox context that need to be surfaced as props. Mitigation: review `ChatPane` props interface before writing `ConversationTab`, and ensure the full-width rendering mode is supported by props (not hardcoded layout assumptions).

---

## Commit 7 — Documents Tab

### Scope

Implement the Documents tab: media grid extracted from messages, file list for non-image documents. Upload button reserved (disabled with tooltip).

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/DocumentsTab.tsx`

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Documents tab

### Validation

- [ ] Documents tab renders images and videos from contact's messages
- [ ] PDFs and other documents appear in a list below the media grid
- [ ] Clicking a media item opens it in a new tab (or lightbox if one exists)
- [ ] Upload button renders disabled with "Coming soon" tooltip
- [ ] Empty state renders gracefully (no media)
- [ ] TypeScript compiles without errors

### Rollback

Remove `DocumentsTab.tsx`. Revert `ContactTabPanel.tsx`. Documents tab shows "coming soon".

### Risks

Low. Data is already loaded from primary fetch.

---

## Commit 8 — Cutover: Redirect CRM Lead Detail

### Scope

This is the cutover commit. After Commits 1–7 are verified, the CRM Lead Detail page is redirected to Customer 360.

Add a client-side redirect in `/admin/crm/[id]/page.tsx`:
```ts
redirect(`/admin/contacts/${params.id}?tab=crm`)
```

Add contact name links in `/admin/crm/followups/page.tsx` pointing to `/admin/contacts/[id]?tab=tasks`.

### Files Affected

**Modified files:**
- `dashboard/src/app/admin/crm/[id]/page.tsx` — add redirect
- `dashboard/src/app/admin/crm/followups/page.tsx` — add contact name links

### Validation

- [ ] Clicking a CRM pipeline card navigates to Customer 360 CRM tab
- [ ] Contact names in follow-ups list link to Customer 360 Tasks tab
- [ ] Browser back from Customer 360 returns to CRM Pipeline
- [ ] No broken states — the redirect fires immediately, no flash of old content
- [ ] TypeScript compiles without errors

### Rollback

Remove the `redirect()` call from `crm/[id]/page.tsx`. The CRM Lead Detail page returns to its previous behaviour.

### Risks

Low-medium. The redirect is a one-liner. The risk is if any internal link in the codebase constructs `/admin/crm/[id]` URLs with assumptions about what the page renders. Review all `href` and `router.push` calls that reference `/admin/crm/` before this commit.

---

## Commit 9 — Inbox Bridge

### Scope

Add "View Contact" button in `LeadSidebar.tsx` header. Remove the existing "View CRM Lead" link (which now redirects anyway).

### Files Affected

**Modified files:**
- `dashboard/src/components/whatsapp/LeadSidebar.tsx`

### Validation

- [ ] "View Contact" button appears in the LeadSidebar header
- [ ] Clicking it navigates to `/admin/contacts/[id]?tab=conversation`
- [ ] The Conversation tab opens directly (Conversation tab is prefetched)
- [ ] Old "View CRM Lead" link is gone
- [ ] Inbox workflow is otherwise unchanged
- [ ] TypeScript compiles without errors

### Rollback

Revert `LeadSidebar.tsx`. The Inbox returns to the previous sidebar header.

### Risks

Low. Single file change.

---

## Commit 10 — Customer Journey Bar (Full Implementation)

### Scope

Complete the `CustomerJourneyBar` with hover tooltips (date + actor), correct step inference for all steps available in v1, and the correct placeholder state for reserved steps (Meeting, Retention, Referral).

Also: complete `HealthScoreBadge` with colour states (green/amber/red) and the muted placeholder state.

This was partially implemented in Commit 1. This commit completes it.

### Files Affected

**Modified files:**
- `dashboard/src/components/contacts/CustomerJourneyBar.tsx`
- `dashboard/src/components/contacts/HealthScoreBadge.tsx`
- `dashboard/src/lib/contacts/journeyInference.ts`

### Validation

- [ ] Journey bar shows correct step for a contact in each stage
- [ ] Hovering a step shows tooltip with date
- [ ] Reserved steps (Meeting, Retention, Referral) show hollow circles
- [ ] Health score shows colour-coded badge when score is present
- [ ] Health score shows `–` when AI is disabled
- [ ] TypeScript compiles without errors

### Rollback

Revert modified files. The journey bar returns to its basic v1 state (still functional, just missing tooltips and full colour states).

### Risks

Low. UI polish only.

---

## Commit 11 — Campaigns Tab + Backend Filter

### Scope

Implement the Campaigns tab. Add `contactId` filter parameter to the broadcast list backend endpoint.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/CampaignsTab.tsx`

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Campaigns tab
- `src/routes/broadcast.js` — add `contactId` filter (backend)

### Validation

- [ ] Campaigns tab renders active membership and send history
- [ ] "Add to campaign" button renders (action TBD)
- [ ] `GET /api/whatsapp/broadcast?contactId=X` returns filtered results
- [ ] Existing broadcast list (without `contactId`) is unaffected
- [ ] TypeScript compiles without errors

### Rollback

Remove `CampaignsTab.tsx`. Revert backend change. Campaigns tab shows "coming soon".

### Risks

Low. The backend change is additive (optional filter parameter).

---

## Commit 12 — AI Tab

### Scope

Implement the AI tab: health score gauge, factor breakdown, AI summary paragraph, next action card, sentiment history chart. Full placeholder state when AI feature flag is disabled.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/AiTab.tsx`

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire AI tab

### Validation

- [ ] AI tab renders placeholder state when AI flag is off (no API call made)
- [ ] AI tab renders health score, summary, next action when AI flag is on
- [ ] "Recalculate" button invalidates the cache and re-fetches
- [ ] Sentiment history chart renders a line chart
- [ ] TypeScript compiles without errors

### Rollback

Remove `AiTab.tsx`. Revert `ContactTabPanel.tsx`. AI tab shows "coming soon".

### Risks

Low-medium. AI endpoint behaviour needs to be verified against the expected response shape.

---

## Commit 13 — Automation Tab + Backend Filter

### Scope

Implement the Automation tab. Add `contactId` filter to the automations run history backend endpoint.

### Files Affected

**New files:**
- `dashboard/src/components/contacts/tabs/AutomationTab.tsx`

**Modified files:**
- `dashboard/src/components/contacts/ContactTabPanel.tsx` — wire Automation tab
- `src/routes/automations.js` — add `contactId` filter to run history (backend)

### Validation

- [ ] Automation tab renders active rules for this contact
- [ ] Automation tab renders run history filtered to this contact
- [ ] "View all automations" link navigates to `/admin/crm/automations`
- [ ] `GET /api/automations?contactId=X` returns filtered results
- [ ] Existing automations list (without `contactId`) is unaffected
- [ ] TypeScript compiles without errors

### Rollback

Remove `AutomationTab.tsx`. Revert backend change. Automation tab shows "coming soon".

### Risks

Low. Same pattern as Commit 11.

---

## Post-Phase 2 Cleanup (Not in Rollout Plan)

After all 13 commits are deployed and stable, a cleanup pass removes dead code:

- Remove `app/admin/crm/[id]/page.tsx` (replaced by redirect and then Customer 360)
- Evaluate removal of LeadSidebar's inline note input (now duplicated by Notes tab)
- Merge duplicate `Lead` type definitions into a single shared type
- Consolidate `context/` and `contexts/` folders

These are low-risk cleanup tasks that do not affect functionality.
