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

**Last updated:** 2026-07-13.

---

## Product decisions awaiting Viir's call

*(none currently — see `docs/v3/12_DECISION_LOG.md` OQ-006 for the most recently resolved item:
Contacts `team_lead` team-scoping, decided and implemented 2026-07-13.)*

## Queued technical work

- **M2 remaining batches (M1 mobile audit follow-up).** M2-B (Fixes 1-4) and M2-D are done
  (`docs/phase3/TECHNICAL_DEBT.md` — "M1 Mobile Audit"). Still queued: **A** (Button.tsx design-
  token pass), **E** (broader CSS sweep), **C** (Kanban stage-picker — proposal already approved
  and banked, ready to implement), **F** (Settings content responsiveness — unblocked now that
  M2-B/D are closed; overlaps with B3 finding #4 below, coordinate scope before starting either),
  **G** (sweep-up / remaining loose ends). Full batch detail lives in the M1 audit session's own
  record, not this repo's docs — not started here.
- **`team_lead` bulk-update access — deferred, not rejected (Option B from the OQ-006 proposal).**
  OQ-006's resolution (`docs/v3/12_DECISION_LOG.md`, [DL-022]) extended `team_lead` to team-wide
  Contacts read/export/tag scoping but deliberately left `bulk-update` out of that batch —
  materially more implementation work than the read-scoping fix, not because it's undesirable.
  `manager`'s existing (already granted, company-wide) `bulk-update` access is unchanged. Revisit
  as its own decision if a real need arises.
- **`metrics.js`'s `/my-team` route is an unindexed, cross-company full-table scan.** Resolves
  `team_lead` membership via a bare `dynamodb.scan()` with no `companyId` key condition — safe
  today only because employee ids are globally-unique UUIDs, not because the query itself is
  tenant-scoped. Found while building `TeamScopeService` for OQ-006; suggested fix is migrating
  `/my-team` to call `TeamScopeService.getTeamMemberIds()` instead. Log-only, not fixed.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "metrics.js's /my-team route is an unindexed,
  cross-company full-table scan".
- **Drip / recurring campaign sequences** (`docs/bible/ROADMAP.md`'s Campaign Intelligence list).
  Roadmap-level idea, not yet scoped as concrete work — no investigation or decision exists yet,
  unlike the other items in this section. Flagged here only so it isn't lost; needs its own
  scoping pass before it's real queued work.
- **B2 item 9 — execution-volume/trigger-breakdown charts for the Automation dashboard.** Deferred
  out of Track B2 Batches 1/2a explicitly ("stays queued for its own aggregation-strategy pass" —
  `f82f6d0`'s own commit message). Needs its own scoping pass before implementation — how to
  aggregate execution volume/trigger breakdown over time without a new hot path. `AutomationEngine`'s
  existing `runCount`/`successCount`/`failureCount` atomic-increment, day-bucketed pattern is
  flagged as a plausible lead for the aggregation strategy, not yet confirmed as the chosen
  approach.
- **B4 remaining (AI Admin audit follow-up — 7 of 11 findings resolved 2026-07-13).** isError sweep
  (~11 queries across 9 AI Administration/Knowledge Center files — `TagsSection` reference pattern
  not yet applied). Sweep-up batch (3 small gaps: unwired `updateDocumentMeta()`, `CompanyCostTable`
  row-click drill-down, unused `embedUsage` detail in `AiCostsTab.tsx`). Compliance-monitoring
  dashboard for the autonomous conversational agent — scoped and Viir-approved (guardrail-trip list +
  conversation drill-down + per-day counts, extends AI Administration's Compliance tab, reuses
  `queryAuditLogs()`), pre-onboarding priority, not yet implemented.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "B4 — AI Admin Module Audit", findings #4/#5/#11.
- **Settings mobile navigation build (B3 finding #4).** The documented mobile "two-screen"
  Settings experience (section list → section content, back arrow returns) does not exist —
  `settings/page.tsx`'s sidebar is simply `hidden ... md:flex` with no mobile equivalent, so below
  768px there is no way to switch Settings sections through the UI at all (confirmed live). Needs a
  real mobile nav (bottom sheet, hamburger, or a genuine two-screen router state) — a build item,
  not a one-line fix. Overlaps with M2-F (Settings content responsiveness, above) — coordinate
  scope before starting either. Not started.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Settings Module Audit", finding #4.
- **Bare (ungated) GET routes in `companies.js` and `whatsapp.js` (B3 finding #9).**
  `companies.js`'s `GET /profile`/`GET /trial` and `whatsapp.js`'s `GET /flows`/`GET /branches`
  have only `authMiddleware` — any role. Docs say Company Profile should exclude Sales/Support and
  WhatsApp should be Manager-Hidden entirely. The `companies.js` pair is currently unreachable
  (Organisation is a stub, zero frontend caller); the `whatsapp.js` pair is reachable. Not yet
  scoped.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Settings Module Audit", finding #9.
- **`whatsapp.js`'s `POST /_tick` has no explicit `authMiddleware` token on its own line (B3
  finding #16) — informational, no action needed.** Relies on the router-level middleware chain
  instead, which is intentional and already documented (`docs/bible/08_MODULES.md:211`) as a
  secondary manual-trigger path alongside the real EventBridge entry. Listed here only so a future
  session doesn't re-investigate it from scratch.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Settings Module Audit", finding #16.
- **Settings spec sync.** 3 documented Settings sections (Teams, Roles & Permissions, Danger Zone)
  have zero code anywhere, not even a stub; conversely 5 built sections (Notifications, Security,
  Appearance, AI, Metric Targets) have no documentation at all. Needs a decision per section: build
  the missing ones, or correct the docs to describe only what actually exists (same "spec vs. built"
  gap class as the Templates/Broadcast finding already closed). Not started.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Settings Module Audit" section intro (spec vs. built
  matrix).
- **Phase 2 (Viir's chosen scope) — n8n-style automation builder features:** Condition/IF node,
  drag-to-connect canvas UX, dry-run/test mode. Scope chosen by Viir; not started.
- **AI pricing placeholder fix** (`src/config/aiConfig.js`) — `PRICING.marginMultiplier`/`pointsPerUsd`
  and the per-model token rates are placeholders, not real cost data. Confirmed (B4 audit, 2026-07-13)
  to taint every dollar/rupee figure on Platform → AI Costs, not just a narrow "wallet points" display
  — needs real business input to set actual values, plus the hardcoded `USD_TO_INR_RATE` FX snapshot
  (dated 2026-07-08, not auto-refreshed) needs a refresh mechanism. Viir's plate — not a code-only fix.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "B4 — AI Admin Module Audit", finding #2.
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

## External / waiting-on-Meta

- **Meta App Review — submitted, status "in review."** Submitted 2026-07-12; Meta's stated review
  window is up to 20 days. The `apforce.in` marketing page and the public legal pages (Privacy
  Policy, Terms, Data Deletion) were shipped as prerequisites. No action pending on our side —
  waiting on Meta's response.
  *Detail:* `docs/bible/19_DECISION_LOG.md` Era 44.
- **DNS/email (`apforce.in`, `support@apforce.in`) — fully live, no action needed.** Confirmed
  correct: all 3 DNS records DNS-only/unproxied in Cloudflare, correct values. Listed here only so
  a future session doesn't waste time re-checking something already closed.
