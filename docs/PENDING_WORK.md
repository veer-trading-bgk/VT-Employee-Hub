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

**Last updated:** 2026-08-02.

---

## Product decisions awaiting Viir's call

*(none currently — see `docs/v3/12_DECISION_LOG.md` OQ-006 for the most recently resolved item:
Contacts `team_lead` team-scoping, decided and implemented 2026-07-13.)*

## Near-term loose ends (after Journey Instances UI → media incident)

Do **not** pull these ahead of Instances UI or the remaining inbound-media execution-model fix.
Small, confirmed, and easy to lose once the priority queue moves on:

- **`storeInboundMedia` freeze/thaw (deferred execution-model fix)** — Phase 1 shipped
  2026-08-02 (`InboundMediaArchiveService`: hop logging, same-invocation timeouts/retry,
  shared archive used by webhook + `scripts/backfill-media-s3.js`; live backfill recovered 7/15
  missing archives). Still open: fire-and-forget before `res.sendStatus(200)` can freeze mid-
  download; await-before-ACK / queue not in Phase 1. **New evidence from that backfill:** Meta
  returned Graph `100`/`33` ("object does not exist") on media only ~5 days old (token/company
  ruled out via cross-check + control that still resolved) — effective retention is sometimes
  far shorter than the documented ~30-day window, so a missed archive is often unrecoverable
  well before day 30. That strengthens the case for closing the freeze/thaw gap; do not treat
  "retry within 30 days" as a safety net.

*(2026-08-02 note — not an open item: the `documentExtraction` PDF / Jest alarm was a
test-runner invocation gap — agents calling `jest` without `--experimental-vm-modules` — not a
product or fixture bug. CI/`npm test` already correct; no production impact. Closed via
`tests/jest.setup.js` fail-fast + `CLAUDE.md` §12 / `AGENTS.md` §5b. Historical writeup:
`docs/phase3/TECHNICAL_DEBT.md` — "PDF Extraction Test Fails Inside Jest Only".)*

## Queued technical work

- **Journey Payment UI wire — code complete, awaiting sandbox E2E validation (not production-proven).**
  Merged/ready code: Review → Pay & Register (priced) / Book Now (free), Razorpay Checkout.js
  (server amounts only), GET payment-status poll with ownership checks + AbortController cleanup,
  webhook confirm path from PR 2. **Blocked on environment:** `RAZORPAY_KEY_ID` /
  `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` not available in this agent shell; Secrets
  Manager secret `vt-employee-bot/production` not found from local AWS. Live proof still required
  before declaring production readiness — one test-mode payment with evidence for each step:
  Review → Pay & Register → Checkout opens → test pay succeeds → webhook HTTP 200 →
  `PAYMENT#`=`paid` → journey resumed → `JOURNEY_RECORD#` written → WhatsApp confirmation →
  thank-you after poll sees `paid`. Do not treat mocked Playwright as that proof.

- **Journey Payment — orphan sweeper + paid-but-not-resumed retry (Phase 2).**
  PR 2 shipped webhook confirm, `paid_duplicate` guard, checkout dedup, and alerts when
  resume fails after `paid` (status never reverted). Still open: (1) expiry sweeper for
  orphan `created` rows after `createOrder` throw; (2) automatic/admin resume retry for
  `paid_resume_failed`. Detail: `docs/phase3/TECHNICAL_DEBT.md` — "Journey Payment — orphaned
  created PAYMENT#" and "Journey Payment — paid but resume failed".

- **Journey Platform — icon-per-field-type visual polish (deferred, no rush).** Extend the
  review screen's icon+card design to input screens for full visual consistency across the
  flow. Map icons to field type generically (`text` / `email` / `phone` / `date` / `select` /
  `number` → distinct icon) — not per-label special-casing; same "generic primitives"
  principle used elsewhere. Applies automatically to any Journey Definition (no admin config).
  Scope: input screens + review screen; thank-you / invalid states out unless revisited later.
  Deferred until a dedicated UI polish pass — not blocking GST, payment gateway, or current work.

- **M2 touch-target/mobile-parity series (M1 mobile audit follow-up) — CLOSED.** M2-A, M2-B
  (Fixes 1-4), M2-D, M2-C, M2-E, M2-F (Settings mobile section picker, B3 finding #4), and M2-G
  (sweep-up: the M2-A icon-only touch-target heuristic list across 17 files, plus a dead-code/ARIA
  pass) are all done. Detail: `docs/phase3/TECHNICAL_DEBT.md` — "M1 Mobile Audit" / "M2-A" / "M2-C
  + M2-E — mobile parity batch" / "Settings Module Audit" finding #4 / "M2-G — sweep-up batch".

  **CRM tab correction:** M1.5 listed Customer 360's CRM tab as `lg:hidden` (IMPOSSIBLE item #1).
  This did not reproduce when M2-C started — `CrmTab.tsx` had no breakpoint gate at all, already
  fully reachable and interactive at any width. See the M2-C entry in TECHNICAL_DEBT.md for the
  correction and the real (smaller) polish fix done instead.

  **After M2-C/E/G, the daily-blocking capability gaps (Kanban drag, Templates preview, CRM tab,
  icon-only touch targets) are closed.** Full batch detail (M1, M1.5) lives in that audit session's
  own record, not this repo's docs.
- **Two narrower M1.5 gaps, carried over from E's original expanded scope, still not covered by
  any M2 batch.** Neither is a blocker for the bulk of daily agent work, but both are real and
  unaddressed: Contacts import's column-mapping dialog overflow (M1.5 IMPOSSIBLE item #3 — the
  mapping step still can't be completed on phone) and the remainder of M1.5's 9 HIDDEN-entry-point
  quick wins (M2-E closed 3 of them — the Contacts "New Contact" clipping, the Owner/Tags
  scroll-shadow affordance, and the Analytics tab-bar overflow — the other ~6 still need triage
  against that audit session's own record, not reproduced in this repo's docs). Not scoped to any
  session yet.
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
- **Public API — deferred v2 items (spec §11).** The public form-submission endpoint shipped
  2026-07-14 (`docs/PUBLIC_API.md`, `docs/phase3/TECHNICAL_DEBT.md` — "Public API — Form-Submission
  Endpoint"). Deliberately out of scope in v1, deferred until a real client's usage pattern is known:
  **multiple keys per company**, a **key-rotation policy**, and **per-key custom rate limits** (v1 is
  a single flat 60/min per key). Also queued: making form **traits a queryable lead attribute**
  (v1 stores them on the interaction/touch metadata only, not the `LEAD#` item). Not started.
- **Outgoing webhooks (APForce → client's own system).** Distinct from the inbound Meta webhook
  (already built, unrelated) and the Public API form-submission endpoint (already shipped — that's
  client-to-APForce, this is the reverse direction). Scoped, not built — deferred until a real client
  asks for it (e.g. "notify my CRM when a lead's stage changes to Won", "ping our Slack when a lead
  replies").

  Proposed shape (reuses the AutomationEngine trigger architecture built for the Public API — no new
  architecture, one new action type):
  - New automation action type `send_webhook`, alongside the existing `send_template` step type,
    configured per-workflow same as any other action.
  - Company-level webhook URL + a generated signing secret, in Settings (mirrors the API Keys
    section's generate/reveal-once/revoke pattern).
  - Outbound POST signed with HMAC-SHA256 (`X-Signature` header) so the client can verify the payload
    genuinely came from APForce — same verification model Meta's own inbound webhook uses, mirrored
    in reverse.
  - Retry on failure: 3 attempts, exponential backoff — same resilience expectation as the inbound
    webhook direction.

  Estimated effort: ~1 session. Do NOT build until a real client's actual requirements are known
  (payload shape, which events, retry expectations) — building speculatively risks guessing wrong and
  redoing it.
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
- ~~**Bulk delete's `restore` route is a dead end.**~~ RESOLVED 2026-07-18 (Stage 5 of the
  2026-07-17 360° audit fix plan) — product decision: removed the dead `POST /leads/:id/restore`
  route rather than build real soft-delete; delete stays permanent.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Bulk-Deleted Contacts Are Unrecoverable".
- ~~**Unknown-contact delete's CONV#/TL# purge coverage is unverified.**~~ RESOLVED 2026-07-18
  (Stage 5) — confirmed reachable in production; `deleteUnknownContact()` now purges a linked
  `CONV#`/`TL#CONV#` pair too, mirroring `deleteLead()`'s existing purge.
  *Detail:* `docs/phase3/TECHNICAL_DEBT.md` — "Unknown-Contact Delete Never Purges CONV#/TL#".
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

- **Meta App Review — Business Verification and Access Verification both cleared; App Review itself
  still pending as of 2026-07-25.** Submitted 2026-07-12 (13 days elapsed at last check); Meta's
  stated review window is up to 20 days, so this is not yet overdue. The `apforce.in` marketing page
  and the public legal pages (Privacy Policy, Terms, Data Deletion) were shipped as prerequisites.
  Business Verification and Access Verification — two separate Meta gates that sit ahead of App
  Review itself — are both confirmed cleared. No action pending on our side — waiting on Meta's
  response.

  **Embedded Signup is built (PR 7a-7c, ADR-024, 2026-07-29) but blocked on a Meta-console config_id
  the user must create.** Superseded by this — the entry above described the pre-PR-7 state (plain
  OAuth only) and no longer reflects the codebase: `src/services/EmbeddedSignupService.js` plus 3 new
  `/api/whatsapp/embedded-signup/*` routes and a full frontend wizard now exist as a third `setupMethod`
  alongside `manual`/`oauth`. **What's still needed before this is live-usable:** create a "WhatsApp
  Embedded Signup" Configuration in the Meta App Dashboard (Business Manager → the app → WhatsApp →
  Embedded Signup → Configurations) and set `META_EMBEDDED_SIGNUP_CONFIG_ID` in the Lambda environment —
  a manual, one-time Meta-console step outside this codebase's control. Until then, `GET
  /embedded-signup/config` returns 501 and the frontend's "Connect WhatsApp (Guided Setup)" button
  stays disabled — the existing OAuth/manual paths are unaffected and remain the working fallback.
  *Detail:* `docs/bible/19_DECISION_LOG.md` Era 57; `docs/adr/ADR-024-embedded-signup-onboarding.md`.
- **DNS/email (`apforce.in`, `support@apforce.in`) — fully live, no action needed.** Confirmed
  correct: all 3 DNS records DNS-only/unproxied in Cloudflare, correct values. Listed here only so
  a future session doesn't waste time re-checking something already closed.
