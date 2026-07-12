# Pending Work

**This is the standing, single source of truth for "what is NOT yet done."** Unlike
`docs/bible/19_DECISION_LOG.md` and `docs/v3/12_DECISION_LOG.md` (chronological history — what was
decided and when) or `docs/phase3/TECHNICAL_DEBT.md` (per-issue technical writeups), this file is a
maintained checklist, not a history log. Old entries are removed when closed, not marked
struck-through and left in place.

**Maintenance rule — read before editing this file:**
- When a session closes an item on this list, **remove it from this list** (the fix's own detail
  belongs in a commit message, `TECHNICAL_DEBT.md`, or a decision log — not preserved here).
- When a session discovers a new open item — a deferred decision, a "not done, flagged for later"
  finding, a queued-but-unscoped feature — **add it here**, not only in chat or a commit message.
  If it's a technical finding with real investigative detail, also add the detailed writeup to
  `docs/phase3/TECHNICAL_DEBT.md` and link back to it from here.
- Keep entries short — one or two sentences plus a pointer to where the full detail lives. This
  file is a checklist to scan, not a place to re-litigate the full context every time.

**Last updated:** 2026-07-12.

---

## Product decisions awaiting Viir's call

- **Contacts module `team_lead` RBAC scope — own-only vs. team-wide.** `contacts.js`'s actual
  check is binary (`isAdmin ? everything : own-assigned-only`) — `team_lead` currently gets the
  same own-only scope as `agent`/`telecaller`/`intern`. But `docs/v3/09_PERMISSION_MATRIX.md`
  documents `team_lead` as seeing "Team" contacts and being able to export team contacts. This is
  a different file/finding from the already-resolved `team_lead` vs `manager` split in
  `attendance.js`/`compensation.js`/`crm.js`/`metrics.js` (see DL-021,
  `docs/v3/12_DECISION_LOG.md`) — that resolution does not cover Contacts. Needs a real product
  call: implement team-scoping to match the documented intent, or correct the permission matrix to
  state actual own-only behavior. Found 2026-07-09, still open.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Contacts RBAC: team_lead sees team Is Documented But
  Not Implemented"; `docs/v3/12_DECISION_LOG.md` OQ-006; `docs/bible/19_DECISION_LOG.md` Era 44,
  open-questions item 20.

## Queued technical work

- **B2 item 9 — execution-volume/trigger-breakdown charts for the Automation dashboard.** Deferred
  out of Track B2 Batches 1/2a explicitly ("stays queued for its own aggregation-strategy pass" —
  `f82f6d0`'s own commit message). Needs its own scoping pass before implementation — how to
  aggregate execution volume/trigger breakdown over time without a new hot path. `AutomationEngine`'s
  existing `runCount`/`successCount`/`failureCount` atomic-increment, day-bucketed pattern is
  flagged as a plausible lead for the aggregation strategy, not yet confirmed as the chosen
  approach.
- **B3 — Settings module deep audit.** Not started.
- **B4 — AI Admin module UI/UX audit.** Not started.
- **Phase 2 (Viir's chosen scope) — n8n-style automation builder features:** Condition/IF node,
  drag-to-connect canvas UX, dry-run/test mode. Scope chosen by Viir; not started.
- **AI pricing placeholder fix** (`src/config/aiConfig.js`) — `PRICING` is a placeholder, not real
  per-model/per-token cost data. Small fix, not done.
  *Detail:* `docs/bible/19_DECISION_LOG.md` Era 11 (ADR-015) region; confirmed still a placeholder
  as of the Phase 2A audit.
- **`ctwa_clid` / Meta ads click-to-WhatsApp attribution capture.** No Meta Ads API integration
  exists in this codebase today (CTWA campaigns are record-only — configured in Meta Ads Manager
  directly, not launched from APForce; see `docs/bible/20_CURRENT_STATE.md` §4). Needed before
  scaling ad spend, so ad-driven leads can be attributed back to the campaign that produced them.
  Not started.
- **Inbox → `Customer360Provider` cache consolidation.** `inbox/page.tsx`'s conversation panel owns
  its own React Query cache (`['wa-conv', convKey]`), duplicating `Customer360Provider`'s
  `['contact', leadId]` cache for known leads — the exact duplicate-ownership pattern
  `dashboard/CLAUDE.md`'s Commit-Level Enforcement forbids. Blocked on a real architectural gap:
  `Customer360Provider` explicitly does not represent unknown/non-lead contacts, but Inbox handles
  them routinely via a completely different endpoint. Needs a dedicated plan, not a squeezed-in fix.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Inbox → useCustomer360() Cache Consolidation".
- **84-item medium/low audit-finding triage.** The 2026-07-08 full codebase audit's Medium/Low/
  Informational findings (37 medium + 47 low, transcribed in full) need a planning session to
  triage which are worth fixing vs. accepting as known debt. Not started.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Wave 5 — Full Audit Log: 84 Medium/Low Findings".
- **`_handoff()`'s send failure is swallowed** (`ConversationalAgentService.js`) — if the
  escalation handoff message itself fails to send, `_runTurn()` still returns `true`, so the caller
  believes a handoff message went out when it didn't. Flagged, not fixed.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "_handoff()'s Send Failure Is Swallowed".
- **Bulk delete's `restore` route is a dead end.** `ContactBulkOpsService.deleteLead()`/
  `deleteUnknownContact()` are hard purges that never set `deletedAt`, but
  `POST /leads/:id/restore` still exists and 404s for anything deleted via the current delete path.
  Needs a product decision: remove the now-dead restore route (hard-delete-with-confirmation is a
  coherent, intentional design), or build real soft-delete and wire restore up for real. Not done.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Bulk-Deleted Contacts Are Unrecoverable".
- **Unknown-contact delete's CONV#/TL# purge coverage is unverified.** Unlike the lead-delete path
  (which purges linked `CONV#`/`TL#CONV` records), `deleteUnknownContact()` only ever purges the
  `INBOX#` partition. Whether an unknown/pre-promotion contact can actually accumulate a `CONV#`
  entity hasn't been checked — if it can, this is the same orphan-record bug class already fixed
  for leads (Era 37/41), just on an unaudited path. Not done.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Unknown-Contact Delete Never Purges CONV#/TL#".
- **V3_NAV_PERMISSIONS centralization.** Route gating is currently per-page (`ProtectedRoute
  allowedRoles`, e.g. Campaigns and, as of 2026-07-12, Templates) rather than driven by the
  existing-but-unused `V3_NAV_PERMISSIONS` map (`dashboard/src/types/v3.ts:21-33`). A central guard
  (e.g. in `(v3)/layout.tsx`, consuming that map) would prevent the class of bug the Templates
  audit's finding #1 was — a page silently shipping with no gate at all. Not urgent: no page is
  currently missing a gate after that fix. Deliberately not done as part of the Templates fix batch
  (would have widened that fix's scope well beyond RBAC on one module).
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Templates Module Audit", finding #8.
- **Docs' "Owner" role tier doesn't map to any real per-company role.** `toV3Role()` only produces
  `'owner'` from the raw `superadmin` role (APForce's own platform staff), never from any
  company-level role — every real company employee's ceiling is `admin`. The V3 permission docs
  model "Owner" as sitting above "Admin" for every company, which doesn't correspond to anything
  reachable by an actual customer. No functional bug (`checkRole()`'s `superadmin` bypass already
  covers the intended behavior) — doc-clarity only.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Templates Module Audit", finding #9.
- **DL-021 raw-role audit** — 6 candidate violations found while fixing Templates finding #2, not
  yet fixed. Files: `sales/page.tsx:1120` (`isAdmin` gating Team View tab), `CampaignList.tsx:26-27`
  (`canDelete`), `WorkflowList.tsx:25` (`isAdmin`-style workflow actions), `entry/page.tsx:237-238`
  (`canBulk`), `employees/page.tsx:14-15` (`canCreate`/invite), `settings/page.tsx:1434-1435`
  (`visibleSections` — which Settings sections render at all; same bug class as the Templates
  finding #1 RBAC gap just fixed, and directly overlaps B3's future scope). Each needs a backend
  cross-check against its corresponding endpoint's actual `checkRole()` before fixing — same depth
  of work as the Templates batch. Not scoped or prioritized yet.

## External / waiting-on-Meta

- **Meta App Review — submitted, status "in review."** Submitted 2026-07-12; Meta's stated review
  window is up to 20 days. The `apforce.in` marketing page and the public legal pages (Privacy
  Policy, Terms, Data Deletion) were shipped as prerequisites. No action pending on our side —
  waiting on Meta's response.
  *Detail:* `docs/bible/19_DECISION_LOG.md` Era 44.
- **DNS/email (`apforce.in`, `support@apforce.in`) — fully live, no action needed.** Confirmed
  correct: all 3 DNS records DNS-only/unproxied in Cloudflare, correct values. Listed here only so
  a future session doesn't waste time re-checking something already closed.
