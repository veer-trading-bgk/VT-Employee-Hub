# 20 — Current State (Read This First)

Status: synthesized from chapters 06–19 of this Bible, verified against repo state at commit
`50771ba` (branch `main`) — see **Freshness** at the end before trusting any specific line number.

This is the entry point. Read this chapter before any of the other 12. It exists to give a new
CTO, engineer, or AI a single accurate snapshot of what APForce actually is, what's actually
shipped, and — most importantly — where the real risk is, before they go read 400+ pages of
detailed chapters that could otherwise be skimmed past without absorbing the load-bearing facts.

Nothing in this chapter is new research. Every claim cites the chapter it came from. Where a claim
from another chapter didn't hold up under a second look, that's said explicitly rather than
repeated.

---

## 1. What APForce is today

APForce (repo: `vt-employee-bot`, GitHub: `VT-Employee-Hub`) is a multi-tenant, WhatsApp-first CRM
and customer-engagement SaaS platform built for AP/sub-brokers in the Indian financial trading
market. Each tenant ("company") connects its own WhatsApp Business Account via the Meta Cloud API;
APForce gives that company's team a shared inbox, a CRM pipeline, broadcast/campaign tooling,
workflow automation, and an HR/performance layer (attendance, payroll, gamified metrics) — all
scoped to that one company's data inside a single shared DynamoDB table. *(06_ARCHITECTURE.md §1)*

Stack: Express backend on two AWS Lambda functions behind API Gateway (one for the REST API, one
for a WebSocket real-time-push channel — both deployed from the identical zip, split only by
which file is invoked as the handler), a single DynamoDB table doing most of the heavy lifting via
single-table design (plus four smaller purpose-specific tables), S3 for WhatsApp media, and a
Next.js 14 dashboard on Vercel. Deploys are continuous: every push to `main` goes straight to
production via GitHub Actions — there is no staging environment and no manual promotion step.
*(06_ARCHITECTURE.md §2, §8; 13_DEPLOYMENT.md Overview; 14_RELEASES.md Current Model)*

---

## 2. What's actually shipped and working

| Module | One-line honest status |
|---|---|
| **WhatsApp messaging** | Fully shipped and centralized. Every real outbound send (text/template/interactive/media) goes through `WhatsAppSendService` per ADR-012, with real-time delivery via a WebSocket layer and S3-backed media handling that keeps large payloads out of the Lambda request path. One narrow, known bypass exists (read-receipts) — see §3. *(06_ARCHITECTURE.md §4a-4b, §7; 08_MODULES.md `WhatsAppSendService`)* |
| **Campaigns** | Shipped and working for WhatsApp broadcast campaigns: audience build/preview/validate, a race-safe atomic launch state machine, and a 5-minute EventBridge scheduler for scheduled sends — all funneling through the same `_launchCampaign()` whether triggered manually or by the scheduler. Audience/Analytics tabs and CTWA (Click-to-WhatsApp Ads) are not fully built — see §4. *(06_ARCHITECTURE.md §4c; 19_DECISION_LOG.md Era 6-7)* |
| **CRM / Customer 360** | The CRM pipeline (lead stages, assignment, follow-ups, CSV import) and the Customer 360 detail page (7 frozen tabs: Profile, Conversation, Timeline, CRM, Tasks, Notes, Documents) are both shipped and in daily use. The identity layer underneath them (which service is authoritative for creating a customer) is **not** actually wired up — this is the single biggest finding in this document, see §3. *(08_MODULES.md `crm.js`, `contacts.js`; 19_DECISION_LOG.md Era 3)* |
| **Attendance / Compensation / Metrics / Gamification** | All shipped, all in active use — daily metric entry with a manager-verification workflow, payroll calculation with snapshot/lock/adjustment support, attendance/leave tracking, and a badges+points gamification layer. The gamification layer specifically has an internal consistency problem — three different code paths compute "total points" independently — see §3. *(08_MODULES.md `metrics.js`, `compensation.js`, `attendance.js`, cross-file finding) )* |
| **Automations** | Shipped and, as of 2026-07-04, branching — `AutomationEngine.js` runs either a legacy flat `steps[]` pipeline or a new graph (`nodes[]`/`edges[]`) with if/else `condition` nodes (CRM-field match with live re-fetch, or WhatsApp button-reply branching), sharing one distributed-claim wait/resume infra across both shapes so concurrent ticks can't double-resume a paused execution. Built after ADR-012/013 existed and correctly cites both in its own commit message and code comments. As of 2026-07-05, a `keyword_message` trigger type also exists — fires on an inbound WhatsApp text message or button/list tap matching an author-configured exact/contains/any-of-list keyword rule, editable from both the linear drawer's trigger dropdown and (new) the branching canvas's own trigger panel; this same change fixed a real, previously-silent gap where a tapped Message+List row was dropped by the webhook entirely (not stored, no WS push — the node type had no working inbound counterpart until now). `tests/automationEngine.test.js` has 58 tests as of this commit (verified by direct run — treat the file's own historical "14 tests" figure as already stale before this change, not something this update caused); `tests/automationsRoutes.test.js` and a new `tests/whatsappListReply.test.js` add route- and webhook-level coverage for this trigger specifically (this line previously claimed route-level `automations.js`/`whatsapp.js` had no dedicated tests at all — narrow that to "no *full-handler* tests for whatsapp.js's webhook existed before 2026-07-05"; the established, still-current convention for that file is unit-testing its exported pure helpers, e.g. `isButtonReply`/`sendWelcomeMessage`, not full HTTP-level tests). *(08_MODULES.md `AutomationEngine.js`, `whatsapp.js`; 19_DECISION_LOG.md Era 6, Era 10)* |
| **Multi-tenant platform admin** | Shipped — a superadmin-only cross-tenant console (`platform.js`) for listing/inspecting/suspending companies, plus company-scoped admin tooling for employee lifecycle, 2FA, and CRM auto-assign config. Tenancy itself is enforced consistently via `companyId` embedded in primary keys and JWT-derived scoping, not just query-time filtering. *(06_ARCHITECTURE.md §3; 08_MODULES.md `platform.js`, `admin.js`)* |

---

## 3. Critical findings — read this before making any architectural decision

Every item below was independently re-verified while writing this chapter (grep and/or direct file
read), not just copied from the source chapter. All held up as stated.

**✅ FIXED (2026-07-02) — ADR-013 was unenforced for the four highest-volume creation paths;
now closed for those four.** `crm.js`'s `POST /leads`, `crm.js`'s `POST /import` (new-lead path
only — the explicit `duplicateAction=overwrite` path is deliberately still a direct update; CIS's
conservative enrich-merge isn't the same operation as a forced overwrite), and both of `forms.js`'s
lead-creating routes (public form submit, Meta Lead Ads webhook) now call
`CIS.resolveOrCreate()`. The Meta Lead Ads webhook additionally now passes an explicit
`idempotencyKey` (`meta_lead_ads:${leadgen_id}`) so a redelivered webhook is recognised as the same
event rather than racing the dedup check again. **Still open, not touched by this fix (out of
scope — these two were not in the migrated list):** `whatsapp.js`'s unknown-contact webhook path
(still creates `INBOX#` via `if_not_exists` field guards, no CIS call) and `contacts.js`'s
read-time dedup (still compares raw `l.phone`, not `l.phoneNorm`). See `19_DECISION_LOG.md` for the
fix entry. Original finding (verbatim, for history): every customer/lead-creation entry point in
the live app bypassed CIS; most did correctly normalize phone numbers via `to10Digit()` and dedup
via `company-phone-index` first, so Rule 1 (canonical phoneNorm) was mostly honored even before
this fix — the actual gap was the missing atomic `LEAD_PHONE#` lock, which concurrent requests
could race past. See **06_ARCHITECTURE.md §4a/§5, 07_DATABASE.md §5.3, 08_MODULES.md, 09_API_GUIDE.md
(ADR-013 section + CRM/WhatsApp/Contacts/Forms sections — now partially stale, four of six paths
listed there are fixed), 11_SECURITY.md, 19_DECISION_LOG.md**.

**✅ FIXED (2026-07-02) — ADR-012's one confirmed bypass is closed.** `whatsapp.js`'s
`POST /inbox/:leadId/mark-read` now calls a new `WhatsAppSendService.sendReadReceipt()` method
instead of a direct `axios.post` to Meta's Graph API. The ADR-012 doc's method table has been
updated accordingly. See **19_DECISION_LOG.md** for the fix entry; `08_MODULES.md`/`09_API_GUIDE.md`
still describe the pre-fix bypass and are now stale on this specific point.

**✅ FIXED (2026-07-02) — the WhatsApp inbound webhook now verifies `X-Hub-Signature-256`.** A
shared utility (`src/utils/verifyMetaWebhookSignature.js`) computes HMAC-SHA256 over the true raw
request body (`req.rawBody`, captured via an `express.json({ verify })` hook added in `app.js` —
the pre-fix version of this same check in `forms.js` computed the HMAC over `JSON.stringify(req.body)`,
which is not guaranteed byte-identical to what Meta sent; that was fixed too, not just copied
forward). Both Meta webhook consumers (`whatsapp.js`, `forms.js`'s Lead Ads webhook) now share this
one implementation and fail closed (401) on a bad or missing signature when `META_APP_SECRET` is
configured; a startup warning fires from `config/secrets.js` if that secret is absent in production.
See **19_DECISION_LOG.md**; `11_SECURITY.md`'s "Webhook Security" section is now stale on this point.

**✅ FIXED (2026-07-02) — `points.js`'s `POST /award` now requires `admin`/`manager`/`team_lead`.**
Matches the role set already used by `metrics.js`'s analogous `POST /add-for-member`. Note from the
fix: this endpoint had zero callers anywhere in the frontend before the fix — the RBAC gap was real
but latent, not actively exploited traffic.

**✅ FIXED (2026-07-02) — the three points/leaderboard implementations now share one formula.**
`points.js`'s `/award`, `admin.js`'s `/points-rebuild`, and `metrics.js`'s `/leaderboard` all now
call the same `calcPoints()` (plus a new shared `buildCustomWeights()` helper), both added to
`config/metricsConfig.js`. The `WEEKEND_MULTIPLIER = 1.5` that only `points.js` applied was
**removed**, not centralized — `metrics.js`'s leaderboard operates on already-aggregated monthly
totals with no per-entry date retained, so a weekend multiplier can't be correctly applied at that
level without a larger aggregation-layer change. **Product decision, approved 2026-07-02:** the
removal is intentional and final, not a placeholder pending reinstatement — weekend metric entries
now earn the same points as weekday entries via `/award`, matching the other two points surfaces.
See **19_DECISION_LOG.md**; `08_MODULES.md`'s "three uncoordinated points-total writers" finding is
now stale on this point.

**`config/telegram.js` is a hardcoded stub that never actually calls Telegram.** Re-verified by
reading the file in full — it is 9 lines, `bot.sendMessage()` does `console.log` and
`Promise.resolve()`, nothing else. Every proactive Telegram alert built on top of this stub
silently no-ops: `compensation.js`'s payroll-lock notifications, `platform.js`'s suspend/unsuspend
alerts, `admin.js`'s 2FA-setup alert, and `metrics.js`'s suspicious-entry alerts. **This is a
different mechanism from two other, real Telegram integrations in the same codebase** — do not
conflate them: `config/logger.js`'s `tgAlert()` (used internally by `logger.error()`/
`logger.alert()`) genuinely posts to Telegram and is, per 16_PLAYBOOKS.md, effectively the closest
thing this system has to real-time incident notification today; and `routes/telegram.js` runs a
real, separate Telegraf bot instance handling `/link`, `/add_kyc`, and similar chat commands. Only
`config/telegram.js`'s `bot` export is fake. See **08_MODULES.md (`admin.js` notable section);
16_PLAYBOOKS.md (Runbook: Tailing Lambda logs)**.

**`Customer360Provider` and `InboxContext` are fully built per the frontend's own architecture doc
but never actually mounted as the shared data layer they were designed to be.** The shipped
`/contacts/[contactId]` and `/inbox` routes each reimplement their own state independently — this
directly violates `dashboard/CLAUDE.md`'s own commit-level enforcement rule, quoted verbatim here:
*"No component fetches `['contact', leadId]` directly — all tabs consume via `useCustomer360()`."*
See **06_ARCHITECTURE.md §4a step 6, §6, §7 (InboxContext architecture description, which describes
InboxContext operating independently rather than through the shared provider)**. Note: this
document's source chapters describe InboxContext's real, working behavior in detail (its own
direct WS listener, its own refetch logic) — they establish that it functions as an independent
system, which is the factual basis for saying it is not operating as a shared/mounted layer in the
way `dashboard/CLAUDE.md`'s architecture principles describe.

**Zero test coverage on `WhatsAppSendService.js` and `CustomerIdentityService.js`** — the two files
the codebase's own ADRs treat as the most compliance-critical. Confirmed by
10_TESTING_GUIDE.md's direct grep against all 18 test files: zero references to either. 433/433
Jest tests pass, but they test services, repositories, utils, and middleware in isolation — no
route file and neither ADR-enforced service has any coverage. A regression in either file would
break every outbound message or every customer-creation path platform-wide with nothing in CI to
catch it before Lambda. See **10_TESTING_GUIDE.md ("ADR-012's own choke point," "ADR-013's own
resolver"); 17_CODING_STANDARDS.md A8**.

**No staging environment; push-to-main deploys straight to production, with no rollback path.**
Confirmed: there is no `develop`/`staging` branch, no pre-prod AWS stack, and the only automated
gate is the Jest suite plus a post-deploy `/health` smoke test that runs *after* the new code is
already live and serving traffic — it can fail the CI pipeline but cannot prevent bad code from
reaching customers. Rollback is not automated: S3 versioning on the deploy bucket
(`apforce-wa-media`) was checked directly and is **not enabled**, so the previous deploy zip is not
recoverable once the next deploy overwrites it at the same fixed key; no Lambda version or alias is
ever published, so there is no `$LATEST-1` to fall back to either. The only real "rollback" today is
re-deploying from an earlier git commit — i.e., rolling forward to old code, not a true rollback
primitive. See **13_DEPLOYMENT.md (Gaps #1, #2); 14_RELEASES.md (No staging environment exists
today; POLICY GAPS #3, #4)**.

**The V3 sidebar nav is flat items plus one collapsible group — not the "Communications/Customers"
grouping some earlier planning material assumed.** Verified structure from `V3Sidebar.tsx`: flat
top-level items (My Work, Inbox, Contacts, Sales CRM, Campaigns), a collapsible "Team" group
(HR/workforce items), and bottom flat items (Analytics, Automation, Platform, Settings).
`/communications` and `/customers` exist only as small `redirect()` shim files pointing to `/inbox`
and `/contacts` — they are legacy URLs kept alive for old bookmarks, not live navigation
destinations or a real nav grouping. See **06_ARCHITECTURE.md §6**.

**Dead/unused code confirmed:** `src/services/notifications.js` (Expo push-notification wrapper,
zero requires outside its own file), `src/utils/featureFlags.js` (a real, working DynamoDB-backed
flag system with 8 flags, all defaulting to `false` — built and tested but confirm current callers
before assuming it's live for any given flag), `dashboard/src/hooks/useRealTime.ts` (a fully-built
polling hook, zero imports found anywhere outside its own file — superseded by `useFetch.ts`'s
built-in polling), and `src/jobs/` is an empty directory. `src/utils/operationalMetrics.js` is
referenced by name in 10_TESTING_GUIDE.md's smoke-test description as something the smoke test
imports — treat it as exercised-by-smoke-test rather than fully dead, a narrower claim than "zero
callers." See **08_MODULES.md (`notifications.js`); 12_PERFORMANCE.md (Real-Time vs Polling,
`useRealTime.ts`); 14_RELEASES.md (Feature Flags); 08_MODULES.md Layer index (`src/jobs/`)**.

**Root-level `RUNBOOK.md` has a real P1-P4 severity table but references deploy tooling
(`serverless deploy`/`serverless rollback`) that doesn't exist in this repo** — there is no
`serverless.yml` anywhere; the actual mechanism is raw `aws-cli` calls inside GitHub Actions. This
needs re-ratification against current tooling, not a full rewrite — its WebSocket and CRM-lead
sections are described as still architecturally accurate. See **16_PLAYBOOKS.md (header note,
POLICY GAPS "Incident severity classification")**.

---

## 4. What's explicitly incomplete / Coming Soon

- **Campaigns' Audience (Saved Segments) and Analytics tabs** are not part of the shipped Campaigns
  surface described in the source chapters — the shipped functionality is audience *filtering* at
  send time (`_buildAudience()`), not saved/reusable segments, and campaign-level stats live on the
  campaign list/detail rather than a dedicated analytics tab.
- **CTWA (Click-to-WhatsApp Ads) campaigns are record-only** — `campaigns.js` accepts a `type:
  'ctwa'` campaign but `_launchCampaign()` explicitly rejects non-`whatsapp_broadcast` types at
  launch time; CTWA campaigns are configured in Meta Ads Manager directly, not launched from
  APForce. There is no Meta Ads API integration in this codebase. *(06_ARCHITECTURE.md §4c step 1)*
- **WhatsApp Calling** has not been started as of this writing — no route, service, or Graph API
  call site referencing WhatsApp's calling capability was found in any of the 12 source chapters.

---

## 5. Open policy decisions awaiting the team

Consolidated from the "POLICY GAPS"/"Open architectural questions" sections of 11_SECURITY.md,
12_PERFORMANCE.md, 13_DEPLOYMENT.md, 14_RELEASES.md, 16_PLAYBOOKS.md, and 19_DECISION_LOG.md. Each
of these is a real, undecided question — none has a documented answer anywhere in this repo today.
See the cited chapter for full tradeoff discussion; this list is a pointer, not a replacement.

- **Identity & access governance.** No `superadmin` provisioning/governance process, no session or
  token revocation mechanism (no denylist, no "log out all sessions"), and two different password
  policies coexist in code (8-char login minimum vs. 12-char-complex registration minimum) with no
  stated intended baseline. → **11_SECURITY.md POLICY GAPS #1-3**.
- **Incident response.** No incident severity scheme currently ratified for the present
  architecture (root `RUNBOOK.md`'s P1-P4 table is V2-era and needs re-confirmation), no on-call
  rotation or paging tool, no customer-communication procedure during an outage, no postmortem
  template, and no SLA commitments recorded anywhere. → **16_PLAYBOOKS.md POLICY GAPS**;
  **11_SECURITY.md POLICY GAPS #4**.
- **Data governance.** No PII retention/deletion policy despite storing PAN/Aadhaar numbers and
  WhatsApp chat history indefinitely (no TTL, no right-to-erasure flow), and no defined minimum
  audit-logging coverage. → **11_SECURITY.md POLICY GAPS #5-6**.
- **Security hardening timeline.** The webhook signature-verification gap (§3 above) and the
  presence of live plaintext secrets in a checked-in file (`scripts/lambda-env.json`) both need an
  owner and a timeline, plus a decision on whether/when a first penetration test or dependency scan
  is warranted. → **11_SECURITY.md POLICY GAPS #7-9**.
- **Deployment safety.** Whether to enable S3 versioning / Lambda aliases for real rollback
  capability, whether to make the EventBridge campaign-scheduler provisioning step (currently
  `continue-on-error: true`) a hard gate or add a loud verification step instead, and whether a
  staging environment is worth the infrastructure cost as customer count grows. →
  **13_DEPLOYMENT.md Gaps #1-3**; **14_RELEASES.md POLICY GAPS #3-4**.
- **Release process.** No decided policy on semantic versioning, changelog maintenance, or git
  tagging cadence — two `package.json` files have never had their version bumped since creation,
  and git tags exist only for two historical "phase" milestones with nothing since. →
  **14_RELEASES.md POLICY GAPS #1-2, #5**.
- **Performance headroom, not yet a fire.** No load testing has ever been done on this system.
  Several Scan-based access patterns sit on hot, customer-facing, or externally-triggered paths
  (campaign audience building on every filter keystroke, WhatsApp inbox load, public form
  submission, the CSV import dedup) where cost grows with the thing APForce is selling — more
  leads, more contacts, more campaigns. None of these have caused an observed incident; all are
  flagged as "watch this as volume grows," not "fix now." → **12_PERFORMANCE.md Scan classification
  table + Recommendations**.
- **Operational ownership gaps.** No automated detection for a campaign stuck mid-launch (requires
  a human to notice today), and no owner assigned for the EventBridge/CI-IAM silent-failure risk
  described in §3's campaign-scheduler runbook. → **16_PLAYBOOKS.md POLICY GAPS (final two bullets)**.

---

## 6. How to use this Bible

Read this chapter first. Then go to whichever of the following actually answers your question —
they are written to stand alone, cite their own sources, and not require reading each other in
order (except that all of them assume you've read this one first for orientation).

| Chapter | Covers | Read it when... |
|---|---|---|
| **06_ARCHITECTURE.md** | System-level view: Lambda topology, multi-tenancy model, the four major request/data flow narratives (inbound WhatsApp, outbound send, campaign launch), real-time WebSocket architecture, frontend nav structure | You need the big picture before touching any cross-cutting system, or you're onboarding and need "how does a message actually get from Meta to the browser." |
| **07_DATABASE.md** | Every DynamoDB table, entity, PK/SK pattern, and GSI actually in use, plus a full Scan-vs-Query access-pattern audit | You're adding a new entity, writing a migration, or need to know exactly what's stored where before changing a key shape. |
| **08_MODULES.md** | File-by-file ownership map for every route, service, middleware, util, and repository — what it owns, what it exports, who depends on it | You need to know "which file owns X" without grepping, or you're about to touch a file and want to know its ADR-compliance status first. |
| **09_API_GUIDE.md** | Every HTTP endpoint, grouped by resource: auth, method, request/response shape, notable errors | You're integrating with or documenting the API, or need to know exactly what a given endpoint actually accepts/returns today. |
| **10_TESTING_GUIDE.md** | Both test frameworks (Jest backend, Playwright E2E), how to run them, exactly what's covered, exactly what isn't, and how CI gates (or doesn't gate) deploys on them | Before writing a test, before trusting "tests pass" as a safety signal, or when deciding how risky a change to an untested file really is. |
| **11_SECURITY.md** | Auth/authorization/2FA/secrets/CORS/input-validation/webhook-security, generated from code, plus a separate POLICY GAPS section of undecided questions | Before any security review, before touching auth/RBAC code, or when someone asks "is X actually secure today." |
| **12_PERFORMANCE.md** | Full DynamoDB Scan inventory and classification, caching patterns, Lambda cold-start behavior, real-time-vs-polling mechanics, concurrency/fan-out patterns in campaign sends | Before a performance investigation, before adding a new Scan, or when campaign/contact volume is starting to grow and you need to know which access patterns will feel it first. |
| **13_DEPLOYMENT.md** | The actual CI/CD pipeline step-by-step, required secrets, manual/local fallback paths, environment variable resolution order | Before changing `deploy.yml`, before running any manual deploy fallback, or when a deploy fails and you need to know exactly what step could be responsible. |
| **14_RELEASES.md** | Branching model, what gates a deploy, versioning (or the current absence of it), the real feature-flag system, plus release-process POLICY GAPS | When deciding how a change should ship (flagged vs. immediate), or when someone asks about version numbers/changelogs/tags. |
| **16_PLAYBOOKS.md** | Operational runbooks for specific failure scenarios this system can actually have (deploy failure, WhatsApp misconfiguration, stuck campaigns, missing inbound messages, scheduler not firing, the Lambda credential gotcha, log tailing) | During an actual incident — each runbook is written to be followed under pressure, with exact AWS CLI commands. |
| **17_CODING_STANDARDS.md** | What patterns the codebase actually follows today (thin routes, phoneNorm dedup, conditional-update claims, error handling, comment philosophy, ADR process, frontend conventions), plus proposed-but-undecided future standards | Before writing new code, so it matches the codebase's real conventions rather than generic best practice. |
| **19_DECISION_LOG.md** | Chronological history of every major architectural/product decision from the repo's origin through the current commit, with commit hashes and "why," across two separate ADR numbering systems | When you need to understand *why* something is shaped the way it is, not just what it currently does. |

---

## 7. Freshness

This snapshot reflects the repository at commit **`50771ba`** (`fix(campaigns): wire scheduled
launch, delivery/reply stats, and harden the scheduler`) on branch `main`, confirmed via `git log -1
--oneline` at the time this chapter was written. Note for anyone reconciling dates: several of the
12 source chapters (06, 10, 16, and parts of 17) state their own verification point as commit
`43b89af` — the commit immediately *before* `50771ba`. That one-commit gap is real, not a
transcription error, and it is itself a small live example of the point below: even documentation
written and verified within the same day can drift out from under the actual HEAD by the time the
next document in the same set is written.

**This kind of document decays.** It is a snapshot of a fast-moving, continuously-deployed
codebase — by design, every push to `main` is live in production within minutes (§14_RELEASES.md),
which means the gap between "what this document says" and "what the code does" starts growing the
moment it's written. Treat every specific line number, file size, and "as of this writing" claim in
this chapter and its 12 siblings as accurate at the cited commit, not as a permanent fact.

Recommendation: regenerate this document (and, periodically, the chapters it summarizes) from a
fresh read of the source rather than hand-editing it indefinitely as the system evolves. A
hand-patched "current state" document that quietly falls out of sync with reality is more dangerous
than an old one clearly labeled as old — it looks current and isn't. If a future regeneration finds
that a "critical finding" in §3 has actually been fixed, that's good news and should be removed
from that section (with a note in 19_DECISION_LOG.md recording when and how) — do not let fixed
problems linger in a "critical findings" list out of inertia, and do not let this document become
the kind of stale artifact its own advice warns against.
