# Rollout Plan

## Deployment Model

Every commit is deployed to Vercel (frontend) and/or AWS Lambda (backend) independently. Each commit must pass:

1. TypeScript compilation (`tsc --noEmit`)
2. Vercel preview deployment successfully builds
3. Manual validation checklist (listed per commit below)
4. No regressions in existing flows (Inbox, CRM, Contact Hub must remain functional)

Production deployment is approved per commit. No batch deployments.

---

## Commit Sequence

```
Commit 1  ──► Commit 2  ──► Commit 3  ──► Commit 4  ──► Commit 5
   │
   ↓ (verify each before proceeding)
Commit 6  ──► Commit 7  ──► Commit 8 (CUTOVER)  ──► Commit 9
   │
   ↓
Commit 10 ──► Commit 11 ──► Commit 12 ──► Commit 13
```

Commits 1–7 are build-up. Commit 8 is the cutover. Commits 9–13 are enhancements.

---

## Commit 1 — Contact Detail Page Skeleton + Profile Tab

**What ships:**
- New route `/admin/contacts/[id]` with full header (real data)
- Profile tab with contact info, tags, source tracking
- All other tabs render an empty state (not "coming soon" — just an empty panel)
- Contact Hub row click navigates to Customer 360 instead of WhatsApp
- Journey bar with step inference (no tooltips yet)
- Health score badge (placeholder `–` state)

**Validation:**
- [ ] Contact Hub row click → Customer 360 opens
- [ ] Header: avatar, name, phone, stage, assigned, last activity
- [ ] Journey bar renders correct step states
- [ ] Profile tab: personal info, tags, source tracking
- [ ] Mobile: compact header, scrollable tab bar
- [ ] Back button → Contact Hub
- [ ] WhatsApp Inbox: completely unaffected
- [ ] CRM Pipeline: completely unaffected
- [ ] TypeScript: no errors
- [ ] Vercel: build green

**Rollback:** Revert Contact Hub row click. Delete `app/admin/contacts/[id]/`.

---

## Commit 2 — CRM Tab

**What ships:**
- CRM tab: pipeline position, deal details, lead score
- Shared `StageSelect` and `AssigneeSelect` components (extracted from LeadSidebar)

**Validation:**
- [ ] CRM tab renders pipeline bar with current stage highlighted
- [ ] Stage change from CRM tab works; header stage updates
- [ ] LeadSidebar: identical behaviour (uses extracted components)
- [ ] TypeScript: no errors

**Rollback:** Remove `CrmTab.tsx`. CRM tab → empty state. Revert `LeadSidebar.tsx` import.

---

## Commit 3 — Tasks Tab

**What ships:**
- Tasks tab: follow-ups grouped by urgency
- Mark Done with outcome modal
- Create new follow-up from Tasks tab
- Shared `TaskCard` component (extracted from followups page)

**Validation:**
- [ ] Tasks tab: follow-ups in correct urgency groups
- [ ] Mark Done: outcome modal opens, outcome saved
- [ ] Create follow-up from Tasks tab: appears in list
- [ ] `/admin/crm/followups`: identical behaviour
- [ ] TypeScript: no errors

**Rollback:** Remove `TasksTab.tsx`. Tasks tab → empty state. Revert followups page.

---

## Commit 4 — Notes Tab

**What ships:**
- Notes tab: internal notes feed
- Create note, delete note

**Validation:**
- [ ] Notes tab: existing notes render
- [ ] New note: submit → appears immediately
- [ ] Delete note: removed
- [ ] TypeScript: no errors

**Rollback:** Remove `NotesTab.tsx`. Notes tab → empty state.

---

## Commit 5 — Timeline Tab

**What ships:**
- Timeline tab: merged activity feed (messages + notes + tasks + stage changes)
- Filter by event type
- `buildTimeline` pure function with unit tests

**Validation:**
- [ ] Timeline: events in chronological order
- [ ] Event types render with correct icons
- [ ] Filter: works for each type
- [ ] Empty state: "No activity yet" for new contacts
- [ ] Unit tests for `buildTimeline` pass
- [ ] TypeScript: no errors

**Rollback:** Remove timeline files. Timeline tab → empty state.

---

## Commit 6 — Conversation Tab (WebSocket)

**What ships:**
- Conversation tab: ChatPane in full-width mode with WebSocket
- Messages prefetched on page mount
- Real-time incoming messages

**Validation:**
- [ ] Conversation tab: historical messages load
- [ ] Send message from Customer 360 → delivers to WhatsApp
- [ ] Receive WhatsApp message → appears in real-time (< 2s)
- [ ] Template picker works
- [ ] Inbox ChatPane: completely unaffected (test by using Inbox in a separate tab simultaneously)
- [ ] TypeScript: no errors

**Rollback:** Remove `ConversationTab.tsx`. Conversation tab → empty state. Remove prefetch from page.

---

## Commit 7 — Documents Tab

**What ships:**
- Documents tab: media grid from messages, file list for documents
- Upload button (reserved, disabled)

**Validation:**
- [ ] Media grid: images and videos from contact's messages
- [ ] File list: PDFs and other documents
- [ ] Clicking media item opens in new tab
- [ ] Upload button: disabled with tooltip
- [ ] Empty state: no errors
- [ ] TypeScript: no errors

**Rollback:** Remove `DocumentsTab.tsx`. Documents tab → empty state.

---

## Commit 8 — Cutover: CRM Lead Detail → Customer 360

**What ships:**
- `/admin/crm/[id]` redirects to `/admin/contacts/[id]?tab=crm`
- Contact name links in `/admin/crm/followups` → Customer 360 Tasks tab

**Pre-commit checklist (before writing code):**
- Audit all `href` and `router.push` referencing `/admin/crm/` in frontend codebase
- Confirm Customer 360 CRM tab is fully functional (Commit 2 verified)
- Confirm no bookmarked direct-link users would be stranded (redirect handles them)

**Validation:**
- [ ] CRM pipeline card click → Customer 360 CRM tab
- [ ] Follow-ups contact name → Customer 360 Tasks tab
- [ ] Browser back from Customer 360 → CRM Pipeline
- [ ] Direct URL `/admin/crm/[id]` → redirects immediately, no flash
- [ ] TypeScript: no errors

**Rollback:** Remove `redirect()` from `crm/[id]/page.tsx`. CRM Lead Detail returns immediately.

---

## Commit 9 — Inbox Bridge ("View Contact" Button)

**What ships:**
- "View Contact" button in LeadSidebar header
- Navigates to `/admin/contacts/[id]?tab=conversation`
- Old "View CRM Lead" link removed

**Validation:**
- [ ] "View Contact" button visible in LeadSidebar
- [ ] Click → Customer 360 Conversation tab opens
- [ ] Conversation tab: messages ready immediately (prefetched)
- [ ] "View CRM Lead" link: gone
- [ ] Inbox workflow: otherwise unchanged
- [ ] TypeScript: no errors

**Rollback:** Revert `LeadSidebar.tsx`.

---

## Commit 10 — Journey Bar & Health Score Polish

**What ships:**
- Journey bar hover tooltips (step name + date)
- Health score colour states (green/amber/red)
- Full step inference for all v1-available steps

**Validation:**
- [ ] Hovering a journey step shows tooltip
- [ ] Health score shows green badge when score ≥ 70
- [ ] Health score shows amber when 40–69
- [ ] Health score shows red when < 40
- [ ] Health score shows `–` when AI disabled
- [ ] TypeScript: no errors

**Rollback:** Revert modified components.

---

## Commit 11 — Campaigns Tab + Backend Filter

**What ships:**
- Campaigns tab: membership list, send history
- Backend: `GET /api/whatsapp/broadcast?contactId=X` filter

**Deploy order:** Backend (Lambda) first, then frontend (Vercel).

**Validation:**
- [ ] Campaigns tab: active membership and send history render
- [ ] API filter: `?contactId=X` returns scoped results
- [ ] API without `contactId`: unaffected
- [ ] TypeScript: no errors

**Rollback:** Remove `CampaignsTab.tsx`. Revert backend. Campaigns tab → empty state.

---

## Commit 12 — AI Tab

**What ships:**
- AI tab: health score gauge, factor breakdown, AI summary, next action, sentiment chart
- Full placeholder state when AI flag disabled

**Validation:**
- [ ] AI flag off: tab renders placeholder, no API call
- [ ] AI flag on: summary and next action render from `/api/ai/insights`
- [ ] "Recalculate" button: re-fetches
- [ ] Sentiment chart: renders
- [ ] TypeScript: no errors

**Rollback:** Remove `AiTab.tsx`. AI tab → empty state.

---

## Commit 13 — Automation Tab + Backend Filter

**What ships:**
- Automation tab: active rules and run history
- Backend: `GET /api/automations?contactId=X` filter

**Deploy order:** Backend (Lambda) first, then frontend (Vercel).

**Validation:**
- [ ] Automation tab: active rules for this contact
- [ ] Run history: filtered to this contact's events
- [ ] "View all automations" link: works
- [ ] API without `contactId`: unaffected
- [ ] TypeScript: no errors

**Rollback:** Remove `AutomationTab.tsx`. Revert backend. Automation tab → empty state.

---

## Regression Checklist (After Every Commit)

Run this after every commit before marking it production-verified:

| Flow | Expected result |
|---|---|
| WhatsApp Inbox: open conversation | ChatPane + LeadSidebar open correctly |
| WhatsApp Inbox: send message | Message delivers |
| WhatsApp Inbox: receive message | Appears in real-time |
| CRM Pipeline: view pipeline | Kanban/list renders |
| Contact Hub: search and filter | Results load correctly |
| Contact Hub: bulk delete | Works |
| Contact Hub: CSV export | Works |
| Dashboard: loads | KPI cards render |
| Follow-ups: mark done | Works |
| Automations: list | Renders |

---

## Go / No-Go Decision Per Commit

Before each commit is merged to main and deployed to production, the following conditions must be met:

1. TypeScript compiles clean
2. Vercel preview URL is green (no build errors)
3. Validation checklist for the commit is fully checked
4. Regression checklist shows no issues
5. Architect approval (you)

If any condition is not met, the commit is held in a feature branch and the issue is fixed before proceeding.
