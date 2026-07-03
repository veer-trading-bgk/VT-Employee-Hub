# 08 — Modules: Ownership & Responsibility Map

Every module in APForce, one entry each: what it owns, what it exports, who depends on it.
Purpose: answer "which file owns X" without searching. Facts only — verified by reading the
code, not inferred from file names or old docs. Line numbers cited below are accurate as of
2026-07-02 and will drift as files change; treat them as pointers, not permanent addresses.

Two services are **ADR-enforced single owners** — every other module in this document is
judged against whether it correctly defers to them:

| Service | Enforces | ADR |
|---|---|---|
| `src/services/WhatsAppSendService.js` | The only code path allowed to call `graph.facebook.com/*/messages` for outbound sends | ADR-012 |
| `src/services/CustomerIdentityService.js` | The only code path allowed to create/dedupe customers | ADR-013 |

**Headline finding — UPDATED 2026-07-03, no longer current, kept for history:** this section
originally reported that `CustomerIdentityService.js` was fully built and correct but **zero
routes called it** (verified as of 2026-07-02 by reading all 20 files in `src/routes/`). As of
commit `1b89521`, that has changed: `crm.js`'s `POST /leads` and `POST /import` (new-lead branch)
and both of `forms.js`'s lead-creating routes now call `CIS.resolveOrCreate()` directly. This is
no longer a "ready but unused" service — it is live and load-bearing, and (2026-07-03) had its
first production incident: a DynamoDB GSI eventual-consistency race in the phone-lock recovery
path, root-caused and fixed, see `src/services/CustomerIdentityService.js`'s per-file entry below
for the full writeup and `tests/customerIdentityService.test.js` for its first test coverage.
`whatsapp.js`'s unknown-contact path and `contacts.js`'s dedup remain unmigrated (ADR-013's
original items 1 and 3) — those two gaps are still open and still the highest-leverage remaining
work against the ADR-013 contract.

**Second headline finding:** ADR-012 is close to fully enforced. Exactly one call site bypasses
`WhatsAppSendService` — `whatsapp.js` line 2478, a read-receipt POST to the same Graph
`/messages` endpoint a real send would use, for which no `WASendSvc` method exists. Every actual
message send (text/template/interactive/media) across every route file correctly goes through
`WASendSvc.send*()`.

---

## Layer index

1. [Routes](#1-routes) — `src/routes/*.js`
2. [Services](#2-services) — `src/services/*.js`
3. [Middleware](#3-middleware) — `src/middleware/*.js`
4. [Utils](#4-utils) — `src/utils/*.js`
5. [Core](#5-core) — `src/core/*.js`
6. [Events](#6-events) — `src/events/*.js`
7. [Repositories](#7-repositories) — `src/repositories/*.js`
8. [Config](#8-config) — `src/config/*.js`
9. [Entry Points](#9-entry-points) — `src/handler.js`, `src/app.js`, `src/wsHandler.js`
10. [Jobs (empty)](#10-jobs-empty)
11. [Frontend](#11-frontend) — `dashboard/src/`

---

## 1. Routes

`src/routes/*.js` — 20 files. All are Express routers mounted in `src/app.js`. Route handlers
should be thin (ADR-012): validate input, call a service, return a response. Several older
files (`crm.js`, `whatsapp.js`, `forms.js`) predate that rule and contain direct DynamoDB
read/write logic inline — noted per file below.

### `src/routes/whatsapp.js` (2,732 lines — largest file in the backend)

**Purpose:** WhatsApp Business API integration — WABA connection setup/health/diagnostics, the
inbound webhook, the Inbox UI's backing endpoints, template management, and broadcast.

**Owns:** `CONFIG#WABA#${companyId}` connection config, `CONFIG#TMPL#${companyId}` template
catalog, `CONFIG#WELCOME#${companyId}` welcome-message config, INBOX# unknown-contact records
(creation only — see ADR-013 gap below), canned replies, agent availability.

**Endpoint groups** (not exhaustive — representative by section):
- Connection lifecycle: `GET /connection`, `GET /config/full`, `GET /auth/init`, `GET /auth/callback`, `POST /manual-connect`, `DELETE /connection`, `PUT /config`, `POST /connection/probe`, `POST /connection/repair`, `GET /connection/health`, `GET /connection/diagnose` — all `checkRole(['admin'])`, all use direct `axios.get` calls to Meta Graph API for connection diagnostics (see ADR-012 note below — these are reads, not sends).
- Webhook: `GET /webhook` (Meta verification handshake, no auth — public by design), `POST /webhook` (inbound message ingestion, no auth — verified by Meta's own signature scheme, not JWT).
- Inbox: `POST /send`, `GET /inbox`, `GET /inbox/ping`, `GET /inbox/unknown/:phone/messages`, `POST /inbox/unknown/:phone/send`, `PUT /inbox/:leadId/resolve`, `PUT /inbox/:leadId/reopen`, `PUT /inbox/:leadId/pin`, `PUT /contact/name`, `POST /inbox/:leadId/note`, `PUT /inbox/:leadId/note/:timestamp`, `DELETE /inbox/:leadId/note/:timestamp` (edit/delete added 26a553a-follow-up — author or admin/manager/superadmin only, `canModifyNote()` in whatsapp.js), `POST /inbox/:leadId/mark-read`, `POST /inbox/unknown/:phone/mark-read`.
- Agent tools: `GET /agent/availability`, `PUT /agent/availability`, `POST /inbox/auto-assign`, `GET /inbox/canned`, `POST /inbox/canned`, `DELETE /inbox/canned/:id`.
- Templates: `GET /templates`, `POST /templates`, `PUT /templates/:id`, `DELETE /templates/:id`, `POST /templates/:id/submit`, `POST /templates/sync`, `GET /templates/:id/history`.
- Send/broadcast: `POST /send-template`, `POST /broadcast`, `GET /broadcasts`, `GET /welcome-config`.
- Media: `GET /upload-url` (presigned S3 PUT — browser uploads directly, Lambda never in the file path), `GET /s3-url` (presigned GET for gallery), `POST /upload-send`.

**Key requires():** `axios`, `aws-sdk/clients/s3`, `../middleware/auth`, `../middleware/rateLimiter`, `../utils/dedupPut`, `../utils/phone` (`to10Digit`), `../utils/mediaConstants`, `../utils/wsNotify`, `../utils/conversationResolver` (`resolveForInbox`, `resolveForLead`, `syncConvStatus`, `syncMarkRead`), `../services/ConversationService`, `../services/WhatsAppSendService`.

**ADR-012 compliance:**
- Correctly delegates actual message sends to `WASendSvc.sendText()` / `sendTemplate()` / `sendMedia()` — 7 call sites (lines 1477, 1510, 1693, 2290, 2370, 2590, 2695).
- Defines a **local duplicate** of the service's private URL builder: `const GRAPH = ...` (line 19) and `function getGraphUrl(cfg) {...}` (lines 20-23) — byte-for-byte the same logic as `WhatsAppSendService._graphUrl()`. Used for ~20 `axios.get()` calls to Meta (OAuth token exchange, `/me`, `/debug_token`, WABA/phone-number lookups, connection health/diagnose). All of these are **reads** for connection setup and diagnostics, not message sends — ADR-012 explicitly scopes its rule to the send + persistence steps, so this is not a violation of the letter of the ADR, but it is duplicated logic that should arguably live in a shared helper.
- **Gray-area case, cite exactly:** line 2478 — `await axios.post(\`${GRAPH}/${cfg.phoneNumberId}/messages\`, { messaging_product: 'whatsapp', status: 'read', message_id: lastWaMessageId }, ...)` inside `POST /inbox/:leadId/mark-read`. This is a direct `axios.post` to the exact endpoint pattern ADR-012 prohibits, hitting the same `/messages` path a real send would use — but the payload is a **read-receipt status update** (blue ticks), not a message. It writes no DDB message record, no WAMID index, no conversation update — none of `WhatsAppSendService`'s owned responsibilities apply to a read receipt. Flagged here verbatim so a future reviewer can judge it explicitly rather than have it hide inside a 2,700-line file.
- `writeMediaIndex()` (per-contact media gallery helper) is called by the route after `sendMedia()` returns — explicitly called out in ADR-012 itself as not a violation (route-specific orchestration after the service completes).

**ADR-013 compliance — the primary documented gap:**
- **Line 1410** (verified current line number — ADR-013 cited this as line 1360, drift is normal in an actively-edited file): inside the webhook's unknown-contact branch, `const PK = \`INBOX#${companyId}#${phone10}\`;` — an INBOX# record is created/written to directly with **no phone lock and no `CIS.resolveOrCreate()` call**. This is the exact gap ADR-013's migration table lists as item 1.
- Known-lead branch (around line 1279 per ADR-013, message-append logic near line 1355-1407 as read directly) does look up leads via GSI correctly, but does not route through CIS either — it's a direct `dynamodb.get`/`update` pattern predating CIS.

**Auth:** Every route except `GET/POST /webhook` (Meta-facing, no JWT) and `GET /auth/callback` (OAuth redirect) applies `authMiddleware` inline per-route. Many admin-only routes additionally apply `checkRole(['admin'])` or `checkRole(['admin', 'manager'])`. Rate limits (`rateLimit(N, 60_000)`) are applied per-route with hand-picked limits (20/min typical for sends, 5-10/min for template submit/sync). **Not** gated by `subscriptionMiddleware` at the `app.js` mount level (see [Middleware](#3-middleware) for the precise implication).

**Surprising:** This file alone is larger than most entire microservices. It has grown organically — connection diagnostics, webhook processing, inbox backend, templates, and broadcast all live in one file. A future split along those five sub-domains would reduce blast radius per change.

---

### `src/routes/crm.js` (1,123 lines)

**Purpose:** CRM lead pipeline — pipeline stage config, lead CRUD, assignment, stage transitions, soft-delete/restore, follow-ups, CSV bulk import, and CRM-scoped stats/analytics.

**Owns:** `CONFIG#CRM#${companyId}` pipeline stage config, `LEAD#${companyId}#${leadId}` METADATA records (the primary customer entity used everywhere else in the system), `FOLLOWUP#${companyId}#${date}` records.

**Endpoints:** `GET/PUT /pipeline`, `GET/POST /leads`, `GET/PUT/DELETE /leads/:id`, `PUT /leads/:id/assign`, `PUT /leads/:id/stage`, `POST /leads/:id/restore`, `GET /followups`, `POST /leads/:id/followup`, `PUT /followups/:date/:leadId/done`, `POST /import`, `GET /stats`, `GET /crm-analytics`.

**Key requires():** `../middleware/auth`, `../config/dynamodb`, `../utils/audit`, `../utils/autoAssign`, `../middleware/rateLimiter`, `../utils/validation` (`createLeadSchema`, `updateLeadSchema`, `createFollowupSchema`), `../utils/wsNotify`, `../utils/phone` (`to10Digit`), `../services/LeadService`.

**ADR-012 compliance:** N/A — this file does not send WhatsApp messages.

**ADR-013 compliance — the second documented gap, plus one additional gap not in CLAUDE.md's list:**
- Defines its own local `leadPK(companyId, leadId)` helper (lines 29-31) rather than importing from `core/entityKeys.js` — matches `entityKeys.js`'s own comment: "existing routes continue to concatenate strings directly; they migrate in later commits."
- **`POST /leads` (line 211) — additional gap, verified directly, not in CLAUDE.md's cited list:** creates leads via a direct `dynamodb.put` (around line 340+), not `CIS.resolveOrCreate()` — a literal instance of the rule "Do NOT write LEAD# METADATA items directly in route handlers." That said, the dedup check immediately preceding it (lines 225-251) is genuinely well-built and correctly compliant with the *normalization* rule: it computes `normPhone = to10Digit(cleanPhone)` (line 230) and queries `company-phone-index` by `phoneNorm` (lines 240-247) — an O(1) GSI lookup, not a scan — with inline comments explicitly stating the platform rule ("phoneNorm is the canonical matching identity... every lead creation path... must compute normPhone and use this check," lines 227-239). Returns `409` with the existing lead's ID on a hit rather than silently creating a duplicate. This is a partial-compliance case: correct normalization and lookup mechanism, non-compliant creation path.
- **`POST /import` (line 841), CSV bulk import — the third documented gap, cited verbatim in CLAUDE.md:**
  - Line 867: `const existingLeads = await scanAllLeads(companyId);` — `scanAllLeads()` (defined at line 45) actually issues a **GSI Query** against `leadsByCompany` (company-scoped — the function's own comment says "O(company-size) instead of O(table-size)"), paginated correctly. This is *not* a full-table scan.
  - Line 868: `const phoneMap = new Map(existingLeads.map((l) => [l.phoneNorm || to10Digit(l.phone), l]));` — the actual gap is here: dedup is computed by building an **in-memory Map** and checking membership per CSV row (line 926: `const existing = phoneMap.get(to10Digit(phone));`), rather than calling `CIS.resolveOrCreate()` per row or doing a per-row GSI point lookup. Under concurrent imports this is a race window (two imports could both miss each other's brand-new leads). The comparison key itself is computed correctly (`phoneNorm` preferred, `to10Digit(l.phone)` fallback) — the violation is the dedup *mechanism* (in-memory batch map vs. atomic per-row lock), not the normalization.
- Calls `LeadService.linkContactToLead()` (see [Services](#2-services)) after lead creation to bridge into the Phase-2 `CONTACT#` entity graph.

**Auth:** `authMiddleware` on every route; `checkRole(['admin', 'manager'])` or `checkRole(['admin'])` on writes; `rateLimit()` on create/update/delete/import paths (30/min typical, 10/min for delete/restore).

---

### `src/routes/contacts.js` (233 lines — read in full)

**Purpose:** Unified contact list endpoint — merges `LEAD#` and `INBOX#` records into one paginated, searchable, filterable view for the Contacts UI. Also owns unknown-contact purge and a shared stage-setter that works for both leads and unknown contacts.

**Owns:** Nothing durable of its own — it's a read/merge/normalize layer over `LEAD#` and `INBOX#` data owned elsewhere, plus the `DELETE /unknown/:phone` hard-purge path.

**Endpoints:** `GET /` (unified contact list), `DELETE /unknown/:phone` (hard-purge all INBOX# items for a phone), `PUT /stage` (set CRM stage for a lead or unknown contact by whichever ID is provided).

**Key requires():** `../middleware/auth`, `../config/dynamodb`, `../middleware/rateLimiter`, `../utils/phone` (`to10Digit`).

**ADR-013 compliance — the third documented gap, confirmed verbatim, current line number:**
- Line 100: `const leadPhones = new Set(leadItems.map((l) => l.phone).filter(Boolean));` — used at line 105 to suppress an INBOX# record from the merged list if its phone already exists as a LEAD#. Uses **raw `l.phone`**, not `l.phoneNorm`. Two numbers that are the same subscriber but differ in formatting (e.g. `9876543210` vs `+919876543210` if such a record ever exists) would both appear in the unified list instead of being deduplicated. This is the exact item CLAUDE.md's migration-status list cites as "`contacts.js` — deduplicates using raw `l.phone`, not `l.phoneNorm`."
- Elsewhere in the same file, phone handling is done correctly: `to10Digit()` is used for the INBOX# key construction in `DELETE /unknown/:phone` (line 163) and `PUT /stage` (line 219) — the gap is isolated to the one dedup line, not the whole file.

**Auth:** `authMiddleware` on all three routes; `checkRole(['admin'])` on the purge; `rateLimit()` on purge (30/min) and stage-set (20/min).

---

### `src/routes/forms.js` (325 lines — read in full)

**Purpose:** Public lead-capture forms (company-configurable, embeddable) and the Meta Lead Ads webhook — two distinct customer-entry channels that don't go through the authenticated app.

**Owns:** `CONFIG#FORM#${companyId}` form definitions.

**Endpoints:** `GET /`, `POST /` (admin-created form), `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/submit` (**public, no auth** — this is the embeddable form's submit target), `GET /meta-leads/webhook`, `POST /meta-leads/webhook` (Meta Lead Ads webhook receiver).

**Key requires():** `../middleware/auth`, `../config/dynamodb`, `../utils/autoAssign`, `../utils/phone` (`to10Digit`).

**ADR-013 compliance:** Does **not** call `CIS.resolveOrCreate()` in either lead-creating path — defines its own local `leadPK()` helper (line 13, same local-concatenation pattern as `crm.js`) and writes `LEAD#` METADATA directly in both `POST /:id/submit` (public form, direct `dynamodb.put` around line 188) and `POST /meta-leads/webhook` (Meta Lead Ads ingestion, direct `dynamodb.put` around lines 298-311). Both paths **do** correctly normalize with `to10Digit()` (lines 132 and 255 respectively) and dedup via the `company-phone-index` GSI before inserting (lines 176-186 and 272-280 — near-identical GSI query blocks, a third copy of the same pattern also seen in `crm.js`'s `POST /leads`; a candidate for extraction into one shared helper). ADR-013's own entry-point table lists both `forms.js:115` and `forms.js:224` as already doing "`to10Digit()` ✓ / GSI query before insert ✓" — i.e. compliant with the *normalization* rule even though neither calls CIS. This is a materially better state than the three explicitly-flagged non-compliant items (`whatsapp.js:1410`, `crm.js:867-868`, `contacts.js:100`), which is presumably why ADR-013's "Migration Required" table doesn't list `forms.js` — but by the letter of the rule ("Do NOT write LEAD# METADATA items directly in route handlers"), both routes in this file are still non-compliant creation paths, just with correct dedup underneath.
- `POST /:id/submit` finds the form via a `dynamodb.scan` (line ~118, `FilterExpression: 'SK = :sk AND active = :true'`) because the companyId isn't known ahead of time from a bare form ID — an accepted low-cardinality scan, same category as ADR-014's precedent.
- `POST /meta-leads/webhook` verifies Meta's HMAC-SHA256 signature (`x-hub-signature-256` header) in place of JWT auth — the correct pattern for a platform-to-platform webhook.

**Auth:** Admin CRUD routes (`GET /`, `POST /`, `PUT/DELETE /:id`) are `authMiddleware` + implicitly company-scoped; `POST /:id/submit` is intentionally public (embedded on external sites); `meta-leads/webhook` is Meta-signature-verified, not JWT.

---

### `src/routes/auth.js` (543 lines — read in full)

**Purpose:** The only route file that issues, verifies, and refreshes authentication tokens. Owns the entire login/2FA/session lifecycle.

**Owns:** JWT issuance (`accessToken` + `refreshToken` cookies), TOTP secret verification, backup-code verification, login-failure rate limiting (delegated to `loginRateLimiter`), company self-signup.

**Endpoints:** `POST /login`, `POST /verify-totp`, `POST /verify-totp-backup`, `POST /refresh`, `POST /register` (authenticated — admin creating a sub-account), `POST /logout`, `POST /company-signup` (public — new tenant onboarding), `GET /me`.

**Key requires():** `bcryptjs`, `jsonwebtoken`, `speakeasy`, `../utils/validation`, `../utils/audit` (`logAudit`), `../utils/encryption`, `../middleware/rateLimiter` (`loginRateLimiter`), `../middleware/auth` (`authMiddleware`, `fetchCompanyPlan`), `../middleware/totpRateLimiter`.

**Notable pattern:** `issueTokens()` (line 42) embeds `plan`, `planStatus`, `trialEndsAt` directly into the JWT payload so `subscriptionMiddleware` (see [Middleware](#3-middleware)) can gate writes without a DB round-trip on every request — comment explicitly labeled `// FIX 4`. `attachPlan()` (line 70) calls `fetchCompanyPlan()` (5-minute cache) to refresh plan data on login/`/me` without waiting for a full re-login.

**Auth:** `POST /login`, `/verify-totp`, `/verify-totp-backup`, `/refresh`, `/company-signup` are public by necessity (pre-auth flows). `/register`, `/logout`, `/me` require `authMiddleware`.

---

### `src/routes/campaigns.js` (530 lines — read in full including exports)

**Purpose:** WhatsApp broadcast campaign management — audience building/preview/validation, campaign CRUD, and the launch pipeline (atomic claim → template validation → audience resolution → fan-out send).

**Owns:** `CONFIG#CAMP#${companyId}` campaign records. Owns the single audience-building algorithm (`_buildAudience()`) used identically by preview, validate, and launch — "built exactly once per request... no double-rebuild" per its own comment.

**Endpoints:** `GET /stats`, `POST /audience/preview`, `POST /audience/validate`, `GET /`, `POST /`, `GET/PUT/DELETE /:id`, `POST /:id/launch`.

**Key requires():** `../middleware/auth`, `../middleware/rateLimiter`, `../config/dynamodb`, `../services/WhatsAppSendService`.

**Notable export pattern:** This file exports more than a router. Lines 527-528, before `module.exports = router` (line 530):
```js
router.launchCampaign = _launchCampaign;
router.CampaignLaunchError = CampaignLaunchError;
```
Properties are attached directly onto the Express router object, so `require('../routes/campaigns')` gives callers both a mountable router **and** two named exports. This is how `src/services/CampaignScheduler.js` reuses the exact same launch logic the HTTP `/launch` endpoint uses (see [Services](#2-services) — an unusual, intentional reverse dependency: a service importing a route file).

**ADR-012 compliance:** Delegates sends to `WASendSvc` — correctly imports `WhatsAppSendService` and does not implement its own Graph API calls.

**ADR-013 compliance:** `_buildAudience()` (line 20) does its own scan-based audience build (`FilterExpression: begins_with(PK, 'LEAD#${companyId}#') AND SK = 'METADATA' AND attribute_not_exists(deletedAt)'`) — an accepted-scale scan, not a CIS violation since it's reading existing leads, not creating customers. Its dedup-by-phone step (line 46: `const norm = l.phoneNorm || l.phone;`) explicitly comments `// Dedup by phoneNorm — one recipient per unique WhatsApp account (ADR-013)` — this is a **documented, intentional** application of the phoneNorm rule (with a defensive raw-phone fallback for legacy records that predate the field), a materially different and better-aligned pattern than `contacts.js`'s unguarded raw-phone comparison.

**Auth:** `authMiddleware` + `checkRole(['admin', 'manager'])` on nearly everything; `checkRole(['admin'])` only on `DELETE /:id`; `rateLimit()` on writes/launch (10-30/min).

---

### `src/routes/automations.js` (263 lines — read in full)

**Purpose:** Workflow automation CRUD and execution introspection. Delegates all actual trigger-firing and step-execution logic to `AutomationEngine`.

**Owns:** `CONFIG#AUTO#${companyId}` workflow definitions (CRUD only — execution state lives in `AutomationEngine`'s `AUTO_EXEC#`/`AUTO_WAIT#` items).

**Endpoints:** `GET /stats`, `GET /executions`, `POST /_tick` (JWT-admin manual trigger path), `GET /`, `POST /`, `GET/PUT /:id`, `PUT /:id/status`, `DELETE /:id`.

**Key requires():** `../middleware/auth`, `../middleware/rateLimiter`, `../config/dynamodb`, `../services/AutomationEngine`.

**Notable exported function:** `runAutomations(companyId, triggerType, context)` (line 19) — a thin wrapper around `AutomationEngine.fireTrigger()`, exported so `crm.js`, `whatsapp.js`, and `campaigns.js` can fire workflow triggers without importing `AutomationEngine` directly (per its own comment: "called by crm.js, whatsapp.js, campaigns.js").

**Dual `/_tick` path — intentional, not a bug:** `src/app.js` intercepts `POST /api/automations/_tick` **before** the `authMiddleware`-gated router mount (`app.post('/api/automations/_tick', automationsRoutes.processTick)`, line 85 of `app.js`) so the EventBridge scheduler can hit it without a JWT. The router's own `POST /_tick` (line 89, gated by `checkRole(['admin'])`) is a secondary path for manual/admin-triggered ticks — its own comment confirms: "EventBridge bypass is handled in app.js BEFORE auth middleware via `processTick()`. This router handler covers the admin-with-JWT case."

**Auth:** `authMiddleware` + `checkRole(['admin', 'manager'])` on reads, `checkRole(['admin'])` on writes; `rateLimit(30, 60_000)` on create.

---

### `src/routes/ai.js` (150 lines — read in full)

**Purpose:** Two Anthropic Claude-backed endpoints that generate natural-language performance insights from metrics data already computed elsewhere.

**Owns:** Nothing durable — pure request/response, no DDB writes.

**Endpoints:** `POST /insights` (individual employee insight, any authenticated role — role is derived from the JWT, never trusted from the client body), `POST /team-insights` (`checkRole(['admin', 'manager'])`).

**Key requires():** `../middleware/auth`, `../config/logger`. Calls `fetch('https://api.anthropic.com/v1/messages', ...)` directly with `model: 'claude-haiku-4-5-20251001'`, reading `ANTHROPIC_API_KEY` from `process.env` (populated by `config/secrets.js` in production).

**Surprising:** This is the **only** route file that calls an external LLM API directly. `ANTHROPIC_API_KEY` is one of five keys in `secrets.js`'s `MANAGED_KEYS` list, confirming this is an intentional, provisioned integration, not experimental.

---

### `src/routes/metrics.js` (1,062 lines — read in full)

**Purpose:** Daily performance metric entry, correction, verification (manager approval workflow), team summaries, bulk entry, per-metric config, and the leaderboard.

**Endpoints:** `POST /add`, `PUT /set`, `POST /correction`, `GET /my`, `GET /all` (`adminMiddleware`), `GET /team-summary`, `POST /bulk-entry`, `GET /config`, `PUT/DELETE /config/:metricKey`, `GET /pending`, `POST /verify`, `POST /pending/dismiss`, `POST /verify/:metricId`, `GET /leaderboard`, `GET /performers`, `GET /my-team` (`checkRole(['team_lead'])`), `POST /add-for-member`.

**Key requires():** `../utils/validation` (`addMetricSchema`), `../utils/audit` (`logAudit`), `../middleware/auth` (`authMiddleware`, `adminMiddleware`, `checkRole`), `../config/metricsConfig`, `../config/dynamodb`, `../utils/db` (`queryAll`), `../config/telegram` (`bot`), `../config/logger`, `../utils/wsNotify` (`notifyCompany`).

**Owns:** Raw `PK=userId, SK=date#metric_type` metric records — the canonical source of truth for all performance metrics platform-wide (`telegram.js`'s `recordMetric()` explicitly mirrors this same write shape).

**Auth:** Inconsistent pattern within the file, worth knowing before touching it: some routes have explicit `authMiddleware` (e.g. `GET /config`), most rely on `checkRole([...])` alone with no visible preceding `authMiddleware` on the same line (e.g. `router.get('/team-summary', checkRole(['admin', 'manager']), ...)`). This only works if `checkRole` itself requires `req.user` to already be populated, or if this router is mounted after an implicit auth chain — mounted with both `authMiddleware` and `subscriptionMiddleware` at the `app.js` level (one of five write-heavy routers gated this way), which resolves the ambiguity in practice, but individual routes should not be copied as a pattern without that context. `adminMiddleware` explicitly gates `/all` and `/config/:metricKey` (PUT/DELETE).

**Surprising:** `POST /verify` and `POST /verify/:metricId` are two separate, near-duplicate implementations of the same "approve/reject a metric" operation — one resolves the target via a body-supplied generic key, the other via a legacy `metricId` path param. Duplicated logic within the same file, not across files.

---

### `src/routes/admin.js` (870 lines — read in full)

**Purpose:** Employee lifecycle management (create/update/delete/bulk-status), 2FA setup/teardown, per-employee metric overrides, target configuration, and auto-assign config.

**Endpoints:** `GET/POST /employees`, `GET/PUT/DELETE /employees/:id`, `PUT /employees/:id/reset-password`, `POST /employees/:id/setup-2fa`, `DELETE /employees/:id/2fa`, `PUT /metrics/:userId/:date/:metricType`, `GET/PUT/DELETE /targets`, `POST /points-rebuild` (`adminMiddleware`), `GET/PUT /crm/auto-assign`, `GET /employees/:id/metrics`, `POST /employees/bulk-status`, `DELETE /employees/bulk`.

**Key requires():** `../utils/encryption` (`encrypt`), `../utils/audit` (`logAudit`), `speakeasy`, `qrcode`, `../config/telegram` (`bot`).

**Notable — 2FA setup flow verified directly (lines 349-416):** `POST /employees/:id/setup-2fa` generates a TOTP secret via `speakeasy.generateSecret()`, a QR code via `QRCode.toDataURL()`, and 5 backup codes, each individually encrypted via `encrypt()` from `utils/encryption.js` before storage (line 379: `encryptedCode: encrypt(code)`) — plaintext codes are returned once in the response and never stored. Fires a Telegram alert via `bot.sendMessage()` from the **stub** `config/telegram.js` (see [Config](#8-config) — this alert does not actually reach Telegram).

**Auth:** `router.use(authMiddleware, adminMiddleware)` blanket-applied to every route in the file — this router is admin-only by default, not opt-in per-route. Also mounted with `authMiddleware` + `subscriptionMiddleware` at the `app.js` level (redundant with the in-file `authMiddleware`, harmless). Company-scope is additionally re-verified manually inline for superadmin-vs-admin boundary checks (e.g. `req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId`).

---

### `src/routes/attendance.js`, `src/routes/audit.js`, `src/routes/companies.js`, `src/routes/compensation.js`, `src/routes/platform.js`, `src/routes/tags.js`, `src/routes/points.js`, `src/routes/badges.js`, `src/routes/analytics.js`, `src/routes/telegram.js`

Endpoint-level detail confirmed by direct read/grep; full line-by-line audit not required for these (no WhatsApp-send or customer-creation logic present in any of them).

| File | Purpose | Key endpoints | Auth pattern |
|---|---|---|---|
| `attendance.js` | Check-in/out marking, leave requests + admin approval | `POST /mark`, `POST /leave`, `GET /leave/admin`, `GET /leave`, `PUT /leave/:userId/:leaveId`, `GET /:userId`, `GET /` | `authMiddleware` everywhere, `checkRole(['admin','manager'])` on admin views |
| `audit.js` | Security/audit log viewer — logs, suspicious activity, login history, exports | `GET /logs`, `/suspicious`, `/logins`, `/security-report`, `/export` | `adminMiddleware` on every route |
| `companies.js` | Company profile, trial status, onboarding checklist, data export | `GET/PUT /profile`, `GET /trial`, `GET /onboarding`, `GET /export` | Mix of bare + `adminMiddleware` |
| `compensation.js` (~29KB) | Payroll: rate config, calculation, history, payroll snapshots, lock/unlock, adjustments | `GET/PUT/DELETE /rates`, `GET /calculate/:userId`, `GET /history/:userId`, `GET /payroll`, `POST /payroll/snapshot`, `PUT /payroll/status`, `GET/POST/DELETE /adjustments`, `POST /payroll/unlock` | `authMiddleware` + `checkRole(['admin'])` on writes |
| `platform.js` | **Superadmin-only** cross-tenant console — list/inspect/suspend companies, platform-wide stats | `GET /companies`, `GET/PUT /companies/:companyId`, `POST /companies/:companyId/unsuspend`, `GET /stats` | `authMiddleware` + `platformAdminMiddleware` (superadmin only) |
| `tags.js` | Tag catalog CRUD, contact-tag assignment (catalog storage delegated to `TagService`) | `GET/POST /`, `PUT /contacts`, `PUT/DELETE /:id` | `authMiddleware`, `checkRole` varies (`admin`/`manager`/`superadmin`) |
| `points.js` | Gamification point awards, leaderboard, personal point history | `POST /award`, `GET /leaderboard`, `GET /my` | `authMiddleware` on all |
| `badges.js` | Achievement badge lookup and eligibility check | `GET /user/:userId`, `POST /check` | `authMiddleware` on both. `logAudit` is imported (line 3) but never called anywhere in the file — dead import. |
| `analytics.js` | System-wide analytics dashboard data | `GET /` (`checkRole(['admin','manager'])`) | `authMiddleware` + role check |
| `telegram.js` | Telegram bot command handler (`/link`, `/add_kyc`, etc.) — lets employees log metrics via Telegram chat commands | Webhook-style command dispatch, not conventional REST | Bot-linked via `telegramChatId` scan, not JWT |

**`telegram.js` detail:** Uses `Telegraf` (a real Telegram bot framework — distinct from the `config/telegram.js` stub and `config/logger.js`'s alert mechanism). `findEmployeeByChatId()` does a `dynamodb.scan` with `FilterExpression: 'telegramChatId = :chatId'` — an accepted scan given the low employee-count-per-company scale. Its own `recordMetric()` helper (lines 55-94) explicitly comments "mirrors POST /api/metrics/add," writing to the identical metric-record key shape `metrics.js` owns.

### Cross-file finding: three uncoordinated points-total writers, verified directly

`points.js`, `admin.js`, and `metrics.js` each independently compute gamification point totals
from the same underlying metric data, and two of the three write to the **identical** DynamoDB
key — confirmed by direct read, not inference:

| File | Line | Writes |
|---|---|---|
| `points.js` | 51, 63 | `PK: POINTS#${employeeId}, SK: TOTAL` — via `POST /award`, includes a `WEEKEND_MULTIPLIER = 1.5` (line 14) the other two paths don't apply |
| `admin.js` | 647 | `PK: POINTS#${userId}, SK: TOTAL` — via `POST /points-rebuild`, a full recompute from raw metrics |
| `metrics.js` | — | `GET /leaderboard` computes points inline via `calcPoints()` (from `config/metricsConfig.js`) on the fly, without persisting to `POINTS#`/`TOTAL` at all |

`points.js` and `admin.js` write to the **exact same key** with different formulas (one applies a
weekend multiplier, one doesn't) — whichever ran most recently silently overwrites the other's
total, with no reconciliation. This is a genuine "which system is authoritative for points?"
open question, not a documentation gap — resolving it (pick one writer, make the others read from
it or delete them) is a real fix, not just a note.

---

## 2. Services

`src/services/*.js` — 8 files. This is where APForce's core business logic is meant to live.
Two files here are the ADR-enforced single owners; the rest range from fully-adopted to
fully-built-but-unused.

### `src/services/WhatsAppSendService.js` — ADR-012 single owner (21,649 bytes, read in full)

**Purpose:** The sole authoritative engine for every outbound WhatsApp message in APForce.

**Owns (exhaustive, per its own header comment and verified against the code):**
- Contact resolution across 5 target shapes (`resolveContact()`, lines 144-191): `resolvedContact`, `leadPK`, `leadId`, `phone`, `phoneNorm` — the `phone`/`phoneNorm` path uses an O(1) `company-phone-index` GSI query (lines 173-179), falling back to `INBOX#${companyId}#${phone}` for numbers with no CRM lead.
- RBAC enforcement (`_assertSendPermission()`, lines 198-206): `telecaller`/`agent`/`intern` roles can only message leads assigned to them; unknown (INBOX#) contacts are reachable by all roles.
- WABA config lookup + 10-minute in-process cache (`_getConfig()`, `_cfgCache` Map, `CFG_TTL_MS = 10 * 60 * 1000`, lines 36-37, 62-72), invalidated via `invalidateConfigCache(companyId)` (line 75-77) — callers **must** call this manually on disconnect/reconnect; it is not automatic.
- E.164 normalisation for outbound Meta calls (`_toE164()`, lines 49-54) — Indian 10-digit and 11-digit-leading-0 only.
- Meta Graph API calls for every implemented message type.
- DynamoDB message record persistence (`_storeMessage()`), WAMID reverse-index (`_storeWamidLookup()`, conditional put swallowing duplicate-key errors), last-message preview + unread-count update on both LEAD# and CONTACT# entities (`_updateLastMessage()`).
- Fire-and-forget `ConversationService.updateLastMessage()` sync when `leadItem.convId` is present.

**Key exports** (singleton instance, `module.exports = new WhatsAppSendService()`):

| Method | Line | Status | Notes |
|---|---|---|---|
| `resolveContact(companyId, target)` | 144 | Implemented | Public — the canonical way to turn any target shape into a contact |
| `invalidateConfigCache(companyId)` | 75 | Implemented | Must be called manually after WABA config writes |
| `sendText(companyId, target, message, user, options)` | 223 | **Implemented** | Supports quoted-reply via `options.replyToWaMessageId` |
| `sendTemplate(companyId, target, templateRef, variableValues, user, options)` | 294 | **Implemented** | `templateRef` string = DDB lookup by ID; object `{templateName, language}` = skip lookup (Automation/welcome path) |
| `sendInteractive(companyId, target, interactive, user)` | 377 | **Implemented** | Raw Meta Interactive Message spec passthrough |
| `sendMedia(companyId, target, media, user)` | 433 | **Implemented** | image/video/audio/document/sticker via `mediaId` or `url` |
| `sendCatalog()` | 491 | **Stub — throws 501** | `'Catalog messages not yet implemented'` |
| `sendPayment()` | 492 | **Stub — throws 501** | |
| `sendFlow()` | 493 | **Stub — throws 501, deliberately left unfilled** | The actual WhatsApp Flows feature (send + receive, `src/routes/whatsapp.js` `/flows` CRUD + `/inbox/:leadId/send-flow`) calls `sendInteractive()` directly instead — Meta's Flow-send payload (`{type:'flow', action:{name:'flow', parameters:{...}}}`) is just another `interactive` subtype, so the existing generic passthrough already covers it with zero service changes. Filling in this stub as a second, parallel send path would have duplicated `sendInteractive()`'s body for no reason — audit this call site before ever implementing this stub for real. |
| `sendPoll()` | 494 | **Stub — throws 501** | |
| `sendLocation()` | 495 | **Stub — throws 501** | |
| `sendContact()` | 496 | **Stub — throws 501** | |

Verified directly against the source — ADR-012's method-status table is accurate, not stale.

**Depended on by:** `src/routes/campaigns.js`, `src/routes/whatsapp.js`, `src/services/AutomationEngine.js` (aliased `WASendSvc`).

**Internal dependencies:** `axios`, `../config/dynamodb`, `../config/logger`, `../utils/phone` (`to10Digit`), `./ConversationService`.

**Hardcoded default worth knowing:** `GRAPH = \`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0'}\`` (line 29) — configurable via env var, `v25.0` is only the fallback. Per-company override available via `cfg.graphApiVersion` (`_graphUrl()`, lines 43-47). `src/routes/whatsapp.js` independently defines the identical `GRAPH`/`getGraphUrl()` pair (see Routes section) — worth consolidating.

---

### `src/services/CustomerIdentityService.js` — ADR-013 single owner (23,469 bytes, read in full)

**Purpose:** The sole authorized path for customer identity resolution, atomic deduplication, and creation/enrichment.

**Update (2026-07-02, commit `1b89521`, discovered stale during this entry's own bug-fix pass):** the "confirmed unused by any route" claim below is now **false** — `crm.js`'s `POST /leads` and `POST /import` (new-lead branch), and both of `forms.js`'s lead-creating routes, now call `CIS.resolveOrCreate()`. The claim is left in place below verbatim (not deleted) because it was true when written and the surrounding grep evidence is still a useful record of the pre-migration state — but do not trust it as current. `whatsapp.js`'s unknown-contact path and `contacts.js`'s dedup remain unmigrated (ADR-013's items 1 and 3).

**Owns (exhaustive):**
- Phone normalisation to canonical `phoneNorm` via `_normPhone()` → `to10Digit()` (line 48-52).
- Identity resolution via `company-phone-index` GSI (`_findByPhone()`, lines 110-120, uses `GSI.LEAD_BY_PHONE`).
- Atomic phone uniqueness via `LEAD_PHONE#${companyId}#${phoneNorm}` lock item, written in the same `TransactWrite` as the `LEAD#` METADATA item (`_createCustomer()`, lines 325-465).
- Customer enrichment with an explicit immutability contract (`computeDelta()`, lines 190-246): protected fields never overwritten (`assignedTo`, `stage`, `notes`, `closureDeadline`); smart-update fields replaced only under specific conditions (`name` only if current value is a phone-placeholder; `email`/`company` only if currently null); additive-only union for `tags`/`productInterest`; always-updated fields (`lastInteractionAt`, `lastInteractionSource`, `updatedAt`, a 10-entry-capped rolling `leadSourceHistory`).
- Idempotency via `IDEM#${companyId}#${sha256(key)}` lock, 24h TTL (`IDEM_TTL_SECONDS = 86_400`) — explicit caller-provided key or auto-derived SHA-256 of `companyId|phoneNorm|source|campaign` plus a **5-minute time bucket** (`_deriveIdemKey()`, lines 71-76) — note this 5-minute bucket window is a *different* constant from the 24-hour lock TTL; don't conflate them.
- Race resolution & orphaned-lock self-heal: if a create finds the `LEAD_PHONE#` lock already present, it re-resolves as an enrich against the winner's record. It first retries the GSI lookup up to 4× with linear backoff (250/500/750/1000ms) — a benign defence for a genuine, transient concurrent race. If that finds no winner, it then reads the lock and its referenced lead **directly from the base table (strongly consistent)**: when the referenced lead no longer exists, the lock is **orphaned** and CIS **reclaims** it (guarded overwrite) and creates the new lead instead of throwing (`_reclaimIfOrphaned()`). **Production root cause (2026-07-03):** an admin hard-purged a lead but the purge left the `LEAD_PHONE#` lock behind (see crm.js `DELETE /leads/:id`, since fixed to release the lock), permanently blocking re-creation of that number; every create surfaced a raw `TransactionCanceledException` as an unhandled 500. This was **not** GSI eventual-consistency lag — an earlier fix (`6d6028f`) misdiagnosed it that way; the retry loop cannot fix an orphaned lock. Verified by direct DynamoDB inspection (lock present, referenced `LEAD#` METADATA absent) and remediated by deleting the 2 confirmed orphaned locks. Also: the idempotency fast path now validates the cached lead still exists and clears a stale `IDEM#` lock pointing at a purged lead. Test coverage: `tests/customerIdentityService.test.js` (5 cases) and `tests/leadPurgeRecreate.test.js` (real purge route + CIS against a shared in-memory DynamoDB fake, mutation-verified against pre-fix code).
- Auto-assignment on creation via `../utils/autoAssign` (`getAutoAssignConfig`, `pickNextEmployee`), falling back to the triggering actor if auto-assign is disabled.
- Fire-and-forget `TL#` touchpoint recording via `publishEvent(E.TOUCH_RECEIVED, ...)` on every call, both create and enrich paths (`_recordInteraction()`).

**Key exports (only two — verified against `module.exports`, lines 534-537):**

```js
async function resolveOrCreate(companyId, data, context)   // THE entry point — lines 506-532
function computeDelta(existing, incoming)                   // exported for CSV enrich mode + tests
```

Everything else (`_normPhone`, `_findByPhone`, `_createCustomer`, `_enrichCustomer`, `_checkIdem`, `_recordInteraction`, etc.) is internal, unexported.

**DynamoDB keys written:** `LEAD#${companyId}#${leadId}` / `METADATA` (customer record), `LEAD_PHONE#${companyId}#${phoneNorm}` / `LOCK` (uniqueness lock), `IDEM#${companyId}#${sha256HexKey}` / `LOCK` (idempotency lock).

**Depended on by (current, 2026-07-03):** `src/routes/crm.js`'s `POST /leads` and `POST /import` (new-lead branch) call `CIS.resolveOrCreate()` directly — confirmed both by code and by CloudWatch production logs (`crm/leads POST error` originates from this call, see the race-resolution note above). `forms.js`'s two lead-creating routes also call it as of commit `1b89521`.

*(Historical note, no longer accurate — kept for record of the pre-migration state:)* At the time this section was first written, `grep -rn "require.*CustomerIdentityService\|resolveOrCreate" src/` returned only comment-only references in `src/core/entityKeys.js` and `src/events/catalog.js`, and every route file was confirmed to not call this service. That has since changed; see the "Update" note near the top of this entry. `whatsapp.js`'s unknown-contact path and `contacts.js`'s dedup are still unmigrated.

**Internal dependencies:** `uuid`, `crypto`, `../config/dynamodb`, `../config/logger`, `../events/publisher` (`publishEvent`), `../events/catalog` (`E`, `ENTITY`), `../utils/phone` (`to10Digit`), `../core/entityKeys` (`leadPK`, `idemPK`, `idemSK`, `leadPhoneLockPK`, `leadPhoneLockSK`, `GSI`), `../utils/autoAssign`.

**What this means practically:** as of commit `1b89521`, `crm.js` and `forms.js` are migrated onto this service; `whatsapp.js`'s unknown-contact path and `contacts.js`'s dedup (ADR-013's items 1 and 3) remain open, along with the not-yet-built CTWA/partner-API entry points. Wiring the remaining two known entry points is still the highest-leverage backend change available relative to the ADR-013 contract, but the service is no longer merely "ready and unused" — it is live, load-bearing, and (as of 2026-07-03) has its first production incident and fix on record.

---

### `src/services/AutomationEngine.js` (18,085 bytes, read in full)

**Purpose:** Orchestrates workflow automation — fires triggers, evaluates conditions, runs a sequential step pipeline (send template, assign employee, change stage, add tag, create task, wait/resume).

**Owns:** `AUTO_EXEC#${companyId}` execution records (90-day TTL), `AUTO_WAIT#${companyId}` deferred-step records (7-day grace TTL past resume time), workflow run-count/last-run-at stats.

**Key exports** (singleton class instance): `fireTrigger(companyId, triggerType, context)` — entry point, fires matching active workflows fire-and-forget after condition evaluation; `resumeExecution(companyId, waitRecord)`; `processDueWaits(companyId)` — called by `POST /api/automations/_tick`, claims due waits via a conditional-delete distributed-claim pattern (prevents double-resume under concurrent ticks), max 50 per call.

**File-header self-documentation, verified accurate:** `// ADR-012: all WA sends delegated to WhatsAppSendService.` — confirmed: the `send_template` action case (line ~224) calls `WASendSvc.sendTemplate()` correctly. `// ADR-013: never creates customers; reads existing leads only.` — confirmed: no lead-creation code anywhere in this file.

**Depended on by:** `src/routes/automations.js`.

**Internal dependencies:** `uuid`, `../config/dynamodb`, `../config/logger`, `./WhatsAppSendService` (aliased `WASendSvc`), and a lazy `require('../events/timeline')` inside `_tlWrite()` wrapped in try/catch (soft dependency — silently no-ops if the timeline module is unavailable).

**Notable correctness details:** `add_tag` action uses `list_append` + `ConditionExpression: 'not contains(tags, :tagVal)'` to avoid a read-modify-write race (explicitly commented as intentional). `wait`/`end` step types are deliberately kept outside the per-action try/catch to prevent double-execution (a failed wait must not both resume later AND continue the loop immediately).

---

### `src/services/CampaignScheduler.js` — ADR-014 documented Scan exception (read in full)

**Purpose:** Sweeps all companies every 5 minutes (EventBridge → `src/handler.js`) to find campaigns whose `scheduledAt` has passed and launches them in bounded concurrent batches.

**Owns:** The due-campaign sweep only — launch logic itself is delegated to `campaignsRouter.launchCampaign()` (see below), whose own atomic Scheduled/Draft → Launching conditional claim (not this sweep) is what makes overlapping EventBridge invocations idempotent.

**Key export:** `runDueCampaigns()` — runs the ADR-014-sanctioned `Scan` (narrow `ProjectionExpression`, filtered to `begins_with(SK, 'CAMP#') AND status = 'scheduled' AND scheduledAt <= now`), chunks results into batches of `BATCH_SIZE = 5`, calls `campaignsRouter.launchCampaign()` per campaign via `Promise.allSettled`.

**Carries a load-bearing guardrail comment** (lines 25-28): `// TODO(ADR-014): this Scan is an accepted interim approach ... Do not widen this Scan's FilterExpression or drop the ProjectionExpression.` — this is a permanent constraint, not a stray TODO to "clean up."

**Depended on by:** `src/handler.js` only — "Invoked by an EventBridge scheduled rule... never reachable over HTTP" per its own header comment.

**Unusual reverse dependency:** imports `../routes/campaigns` to call its `launchCampaign` and `CampaignLaunchError` exports (see `campaigns.js` entry above for how those get attached to the router object) — a service depending on a route file, inverting the typical direction seen everywhere else in this codebase.

---

### `src/services/ContactService.js` (10,918 bytes)

**Purpose:** CRUD + lifecycle service for the Phase 2 `CONTACT#` entity — a separate, richer identity graph (E.164 phone format) for future multi-channel/multi-number contact features, distinct from the `LEAD#` entity CIS/WhatsAppSendService operate on.

**Owns:** `CONTACT#${companyId}#${contactId}` items, atomic phone-uniqueness via `phoneLockPK`/`phoneLockSK` TransactWrite (same pattern as CIS's lock, but E.164-keyed instead of `phoneNorm`-keyed), `sourceHistory` append-only trail, soft-delete/restore lifecycle, optimistic-locking `version` field.

**Key exports:** `createContact(companyId, data, actorId)` → `{contact, created}` (atomic create-or-return-existing, mirrors CIS's race-loser pattern — never throws duplicate errors, re-queries and returns the winner instead); `getContact()`; `findContactByPhone()`; `updateContact()` (whitelist-based patch); `softDeleteContact()`; `restoreContact()`; `listContacts()` (cursor-paginated).

**Depended on by:** `src/utils/conversationResolver.js`, `src/services/LeadService.js`. **No route file requires this directly** — it's consumed only by other services/utils, not by `contacts.js`'s route handlers (which operate on `LEAD#`/`INBOX#` data directly, a separate and older code path).

**Internal dependencies:** `../repositories/ContactRepository`, `../events/publisher`, `../events/catalog`, `../core/id` (`generateContactId`), `../core/systemMeta`, `../core/entityKeys`, `../utils/phoneNormalize` (`normalizeE164`) — confirms the E.164-vs-phoneNorm split described in ADR-013 and in the [Utils](#4-utils) section below. `../config/logger` is imported but has no call sites in the file — a dead import.

---

### `src/services/ConversationService.js` (15,577 bytes, read in full)

**Purpose:** CRUD + status-lifecycle for the Phase 2 `CONV#` entity — a conversation thread linked to a `CONTACT#`, with reserved (currently-unpopulated) fields for future AI classification, SLA tracking, and bot handoff state.

**Owns:** `CONV#${companyId}#${conversationId}` items, the status state machine (`open`/`resolved`/`pending`/`snoozed`), `unreadCount` (both a versioned reset and an unversioned high-frequency atomic increment), last-message preview fields (200-char cap), the `lastActivityAt` GSI sort key.

**Key exports:** `STATUS`, `CONVERSATION_TYPE`, `HANDOFF_STATE`, `VALID_CHANNELS` (frozen enums); `createConversation()`, `getConversation()`, `assignConversation()`, `resolveConversation()`, `reopenConversation()`, `snoozeConversation()`, `pendConversation()`, `markRead()`, `incrementUnread()`, `updateLastMessage()` (the method `WhatsAppSendService` calls fire-and-forget after every send), `softDeleteConversation()`, `restoreConversation()`, `listByCompany()`, `listByContact()`.

**Depended on by:** `src/services/WhatsAppSendService.js` (`.updateLastMessage()`), `src/utils/conversationResolver.js`, `src/routes/whatsapp.js`.

**Self-documented pending work (lines 78-81):** "Each call creates a distinct conversation even if one already exists... The WhatsApp webhook (Commit 9) will contain the 'find or create' business logic." **This is now resolved** — `src/utils/conversationResolver.js` (`resolveForInbox`/`resolveForLead`) is exactly that find-or-create bridge, and it's wired into `whatsapp.js` today. The comment is a stale forward-reference, not an open gap.

**Internal dependencies:** `../repositories/ConversationRepository`, `../events/publisher`, `../events/catalog`, `../core/id` (`generateConversationId`), `../core/systemMeta`, `../core/entityKeys`.

---

### `src/services/LeadService.js` (2,300 bytes — tiny, single-purpose, read in full)

**Purpose:** The only bridge in the codebase between the legacy `LEAD#` entity model and the Phase-2 `CONTACT#` entity model.

**Owns:** The `contactId` write-once field on `LEAD#` METADATA items (via `if_not_exists` guard).

**Key export:** `linkContactToLead(companyId, leadPK, phone, leadName)` → `Promise<void>` — never throws (all errors caught and logged). Three-step idempotent flow: check if `leadPK` already has a `contactId` (bail if so) → `ContactService.findContactByPhone()` or `createContact()` → race-safe `SET contactId = if_not_exists(contactId, :ctid)`.

**Depended on by:** `src/routes/crm.js` (fire-and-forget, after lead creation).

**Gap worth flagging:** not automatically invoked by CIS's `_createCustomer()` — if/when CIS is wired up per ADR-013's migration plan, `linkContactToLead()` will need to be called from inside or immediately after `resolveOrCreate()` to preserve the Contact-linking behavior `crm.js` currently provides.

---

### `src/services/TagService.js` (single owner of the tag catalog + tag filter matching)

**Purpose:** Single source of truth for the company tag catalog (`TAG_CATALOG#<companyId>` / `CATALOG`) and for tag-filter matching semantics across the platform.

**Owns:** Catalog reads/writes and the ID↔label tolerance rule: contacts store catalog tag IDs (`t_xxx`), but legacy records/filters may still hold label strings, so every filter value is expanded to accept both its ID and its label (case-insensitive).

**Key exports:** `getCatalog(companyId)`, `saveCatalog(companyId, tags)`, `expandTagFilter(companyId, filterTags)` → lowercase accept-`Set`, `matchesTagFilter(contactTags, acceptSet)` → boolean.

**Depended on by:** `routes/tags.js` (catalog CRUD), `routes/campaigns.js` (`_buildAudience` tag filter), `routes/whatsapp.js` (broadcast segment filter), `routes/contacts.js` (list tag filter).

**Tests:** `tests/tagService.test.js`.

---

### `src/services/PipelineService.js` (single owner of the CRM pipeline + stage-key validation)

**Purpose:** Single source of truth for the company's CRM pipeline (`CONFIG#CRM#<companyId>` / `PIPELINE`) and for validating a `stage` value against it before it's ever written.

**Owns:** `DEFAULT_STAGES` (the 6-stage fallback used when a company hasn't customized their pipeline), `getPipelineStages(companyId)`, and `isValidStage(companyId, stageKey)` — every write path that persists a lead's `stage` must call the latter first.

**Key exports:** `DEFAULT_STAGES`, `getPipelineStages(companyId)` → `Promise<PipelineStage[]>`, `isValidStage(companyId, stageKey)` → `Promise<boolean>`.

**Depended on by:** `routes/crm.js` (extracted from here — was previously duplicated inline; now used by `GET/PUT /pipeline`, `PUT /leads/:id/stage`, `POST /leads`, `POST /import`, `GET /stats`, `GET /crm-analytics`), `routes/contacts.js` (`PUT /stage`, the shared LEAD#/INBOX# setter), `services/AutomationEngine.js` (`change_stage` action).

**History:** Before this existed, `PUT /leads/:id/stage` was the only write path that validated a stage key against the real pipeline. `crm.js POST /leads`, `contacts.js PUT /stage`, and `AutomationEngine.js`'s `change_stage` action all wrote an unvalidated `stage` value straight to DynamoDB — meaning a stage key that didn't exist in a company's customized pipeline would silently corrupt a lead record (no downstream code could ever resolve a label/color for it again). All three now call `isValidStage()` first and reject/throw on a bad key. `AutomationEngine`'s case is the most important of the three: it runs unattended from a workflow step, so there's no user-facing save/toast to ever have surfaced the bad write before this fix — the thrown error is caught by the existing per-step try/catch and recorded onto the execution's `steps[].error`, visible in the Executions tab with no new plumbing.

**Known, deliberately unconsolidated duplicate:** `CustomerIdentityService.js` has its own near-identical `_getPipelineStages()` (used only to default an *omitted* stage on lead creation, not to validate a *supplied* one — so it isn't a corruption risk the way the three above were). Left alone: CIS is the ADR-013 chokepoint with zero existing test coverage, and folding it in is a separate, more careful pass.

**Tests:** `tests/pipelineService.test.js`, `tests/automationEngine.test.js` (the `change_stage` validation specifically).

---

### `src/services/notifications.js` (880 bytes — dead code)

**Purpose:** A stateless wrapper around Expo's push-notification API.

**Key export:** `sendPushNotification(token, title, body, data)` → `Promise<void>` — no-ops if `token` is falsy or doesn't start with `'Expo'`; POSTs to `https://exp.host/--/api/v2/push/send`; uses native `fetch` (the only service file that does — everything else uses `axios`).

**Depended on by:** **Nobody.** `grep -rn "require.*services/notifications" src/` returns zero matches outside the file itself. Confirmed dead code — either unwired scaffolding for a future mobile-push feature, or an abandoned integration. Flagged here so an AI assistant asked "which file owns push notifications" answers correctly (this one, but it's inert) rather than assuming the feature doesn't exist at all.

---

## 3. Middleware

`src/middleware/*.js` — 4 files.

### `src/middleware/auth.js` (5,371 bytes)

**Purpose:** The authentication, authorization, and subscription-gating hub — all three concerns live in this one file. **There is no separate `subscriptionMiddleware.js` file** — confirmed by direct read and by the absence of that filename anywhere in `src/middleware/`.

**Key exports:**

| Export | What it does |
|---|---|
| `authMiddleware` | Verifies JWT (cookie or `Authorization: Bearer`), rejects `decoded.temp === true` (pre-2FA tokens) with 401, attaches `req.user = decoded` |
| `adminMiddleware` | Requires `req.user.role` in `{admin, superadmin}` |
| `platformAdminMiddleware` | Requires `req.user.role === 'superadmin'` — APForce platform staff only |
| `checkRole(allowedRoles)` | Factory; `superadmin` always passes (support bypass); else requires role membership |
| `subscriptionMiddleware` | Bypasses for missing user, `superadmin`, or `plan === 'internal'`; reads `planStatus`/`trialEndsAt` from the JWT (not a DB read); 402 `ACCOUNT_SUSPENDED` or 402 `TRIAL_EXPIRED` as appropriate |
| `fetchCompanyPlan(companyId)` | Helper (not middleware) — 5-minute in-process cache for a fresher plan read than the JWT provides |
| `invalidatePlanCache(companyId)` | Clears the plan cache entry |

**Depended on by:** `src/app.js` (router-level mounting) plus individual `authMiddleware`/`checkRole` imports in 19 of the 20 route files (all except the pure-webhook edges of a couple of files).

**Verified directly against `src/app.js` — subscriptionMiddleware coverage is intentionally partial, not a blanket gate:**

Mounted with both `authMiddleware` + `subscriptionMiddleware`: `/api/metrics`, `/api/admin`, `/api/crm`, `/api/automations`, `/api/campaigns`.
Mounted with `authMiddleware` only (no subscription gate): `/api/audit`, `/api/ai`, `/api/analytics`, `/api/badges`, `/api/points`, `/api/compensation`, `/api/attendance`.
Mounted with **neither** at the router level: `/api/auth`, `/api/companies`, `/api/platform`, `/api/telegram`, `/api/whatsapp`, `/api/contacts`, `/api/tags`, `/api/forms`.

`app.js`'s own comment (lines 63-66) explains the intent: read-only routes stay open so a trial-expired company can still view its data; the webhook POST is inbound, not a user write, so it's excluded. **Important nuance, verified by reading `whatsapp.js` and `contacts.js` directly:** neither of those two routers is actually unauthenticated — both apply `authMiddleware` **inline, per-route**, for every endpoint except the true webhook/OAuth-callback edges (`GET/POST /webhook`, `GET /auth/callback` in `whatsapp.js`). So the real gap is narrower than "no auth at all": these two routers are authenticated but not subscription-gated, meaning a suspended or trial-expired company could still send WhatsApp messages and edit contacts through them. Whether that's intentional (avoid blocking a paying customer's ability to talk to their own customers mid-dispute) or an oversight is a product decision, not something this document can resolve — but it should be a known, deliberate choice, not a surprise.

**Provenance markers:** inline comments `// FIX 4:` (line 66, subscriptionMiddleware) and `// FIX 5:` (near `platformAdminMiddleware`) suggest these two pieces were later patches rather than original design.

---

### `src/middleware/errorHandler.js` (1,053 bytes)

**Purpose:** The global Express error handler — the last `app.use()` in `app.js`.

**Key export:** `errorHandler(err, req, res, next)` — special-cases `ZodError` (400 + validation details), `TokenExpiredError`/`JsonWebTokenError` (401, logged as `warn` — "expected auth failures, never production alerts"), everything else → `logger.error()` (which **does** fire a real Telegram alert, see `config/logger.js`) + `res.status(err.status || 500).json({error, timestamp})`.

**Depended on by:** `src/app.js` only.

---

### `src/middleware/rateLimiter.js` (3,195 bytes)

**Purpose:** Two rate-limiting mechanisms sharing one DynamoDB-backed atomic-increment primitive: a general per-IP Express middleware, and a per-email login-attempt limiter.

**Key exports:** `rateLimit(limit = 100, windowMs = 60_000)` — factory returning Express middleware, buckets by `ip_limit#${req.ip}` / time window, **fails open** on DynamoDB errors (logs and calls `next()` regardless); `loginRateLimiter` — plain object (not middleware) with `isBlocked(email)`, `recordFail(email)`, `reset(email)`, 15-minute window, `MAX_LOGIN_FAILS = 10`. Both use `DYNAMODB_TABLE_AUDIT`, not the metrics table.

**Depended on by:** `rateLimit()` applied inline on ~35 individual routes across `campaigns.js`, `whatsapp.js`, `automations.js`, `crm.js`, `contacts.js` with hand-picked per-route limits (no single global default). `loginRateLimiter` used only in `auth.js`.

**Design note:** fails open by deliberate choice (availability over strictness) — rate limiting is not a hard guarantee during a DynamoDB outage.

---

### `src/middleware/totpRateLimiter.js` (2,879 bytes)

**Purpose:** A second, independent rate limiter dedicated to 2FA/TOTP verification attempts, including a Telegram admin alert on lockout — parallel to, not built on top of, `rateLimiter.js`.

**Key exports:** `totpRateLimitCheck(email, userId, res)` → `Promise<boolean>` — not classic middleware (no `next` param; caller checks the boolean manually, must call before validating the TOTP code); `recordTotpFailure(email, userId)` → increments failure count, at `MAX_ATTEMPTS = 5` writes an audit log entry and sends a Telegram alert (both fire-and-forget); `clearTotpAttempts(email)` — called on successful verification. 15-minute window (`WINDOW_MS`), `DYNAMODB_TABLE_AUDIT`.

**Depended on by:** `src/routes/auth.js` only (two call sites, both TOTP-verification flows).

**Duplication note:** implements its own DDB `ADD`-based window-bucketing logic rather than sharing `rateLimiter.js`'s `atomicIncrement` helper — functionally correct but a candidate for future consolidation. Same fail-open philosophy as `rateLimiter.js` (`catch { return 0; }`).

---

## 4. Utils

`src/utils/*.js` — 14 files, all read in full.

| File | Purpose | Key exports | Depended on by | Notes |
|---|---|---|---|---|
| `audit.js` | Writes admin/security audit log entries + Telegram alert for sensitive actions | `logAudit(userId, action, target, result, ip, details, companyId)`, `getAuditLogs(userId, hoursBack)` | `crm.js`, `auth.js`, `metrics.js`, `audit.js`(route), `analytics.js`, `admin.js`, `platform.js`, `companies.js`, `compensation.js`, `telegram.js`, `badges.js`, `middleware/totpRateLimiter.js` | `getAuditLogs()` uses a full-table `scan`, not a Query — will not scale. Telegram alert goes through the **stub** `config/telegram.js` (see below) — silently a no-op today. |
| `autoAssign.js` | Round-robin/weighted lead-assignment engine | `getAutoAssignConfig(companyId)`, `pickNextEmployee(companyId, source, cfg)` | `crm.js`, `CustomerIdentityService.js`, `forms.js` | Two full `scan`s per assignment decision (active employees, then paginated open-leads count). `CLOSED_STAGES` hardcoded here (`converted`, `churned`). |
| `conversationResolver.js` | Bridges legacy `LEAD#`/`INBOX#` message storage to the V2 `CONV#` entity layer — the actual "find or create" logic `ConversationService.js` still references as pending | `resolveForInbox()`, `resolveForLead()`, `syncConvStatus()`, `syncMarkRead()` — all fire-and-forget, never throw | `whatsapp.js` (only consumer) | Imports `ContactService`+`ConversationService` directly for contact find-or-create — a **second** contact-creation path that exists alongside (not through) `CustomerIdentityService`. |
| `db.js` | Generic DynamoDB Query paginator | `queryAll(params)` | `metrics.js`, `analytics.js`, `admin.js` | Query-only (not Scan) — distinct from the ad hoc pagination loops duplicated inline elsewhere (e.g. `autoAssign.js`, `crm.js`). |
| `dedupPut.js` | Generic idempotent-write helper | `dedupPut(dynamodb, TableName, item)` → boolean | `whatsapp.js` | `events/timeline.js`'s `writeTlRecord()` reimplements the identical `attribute_not_exists(SK)` pattern inline rather than calling this — duplicated idiom. |
| `encryption.js` | AES-256-CBC encrypt/decrypt for secrets-at-rest + display masking | `encrypt()`, `decrypt()`, `maskToken()` | `auth.js`, `admin.js` (2FA backup codes, verified directly) | Requires `ENCRYPTION_KEY` env var (64-hex-char / 32 bytes) or throws. |
| `featureFlags.js` | Two-tier (global → company override) feature-flag system, 60s cache | `getFlags(companyId)`, `isEnabled(companyId, flag)`, `DEFAULTS` (8 flags, all `false`), `_clearCache()` | **Nobody** — fully built, zero call sites anywhere in routes/services | Dead/unwired. Flag names (`contact_hub`, `workflow_builder`, `conversation_v2_ui`, etc.) line up with Phase 2/3 roadmap items — scaffolding ahead of adoption, not abandoned code. |
| `mediaConstants.js` | WhatsApp media MIME allow-list + Meta size limits | `ALLOWED_MIME` (Set), `META_SIZE_LIMITS` | `whatsapp.js` (only consumer) | Pure constants. |
| `operationalMetrics.js` | CloudWatch EMF metric emission via stdout | `emitMetric(namespace, name, value, unit, dimensions)` | **Nobody** — zero consumers found | Same "built, unwired" pattern as `featureFlags.js`. Ready-made for adoption once someone starts instrumenting hot paths. |
| `phone.js` | Canonical **`phoneNorm`** producer — the ADR-013 comparison key | `to10Digit(p)` → bare 10-digit string, permissive (no length validation on output) | `whatsapp.js`, `WhatsAppSendService.js`, `crm.js`, `CustomerIdentityService.js`, `forms.js`, `contacts.js`, `conversationResolver.js`, `tags.js` | Widely adopted — this is the correctly-centralized half of the phone-normalization story. |
| `phoneNormalize.js` | E.164 producer for the separate `CONTACT#` entity's phone field | `normalizeE164(raw)` → `+91XXXXXXXXXX` or `null` (strict — validates output), `isE164(s)` | `ContactService.js` **only** | Narrow reach by design — see the comparison table below. |
| `validation.js` | Zod schemas for auth/employee/company-signup/CRM request bodies | `loginSchema`, `registerSchema`, `verifyTotpSchema`, `verifyBackupSchema`, `updateEmployeeSchema`, `companySignupSchema`, `createLeadSchema`, `updateLeadSchema`, `createFollowupSchema`, `addMetricSchema` | `crm.js`, `auth.js`, `metrics.js`, `admin.js`, `telegram.js` | `registerSchema` requires a special character in the password; `companySignupSchema` does not — an inconsistent password policy between the two signup paths. `VALID_SOURCES` (used in lead schemas) doesn't fully overlap with ADR-013's example source list (`ctwa`/`api` absent here; `whatsapp_ai`/`walk_in`/`social`/`webinar`/etc. present). |
| `wsConnections.js` | CRUD over the WebSocket-connections table | `saveConnection()`, `deleteConnection()`, `getConnectionsByCompany()` | `wsHandler.js`, `wsNotify.js` | 2-hour TTL matches API Gateway WebSocket's max connection lifetime. |
| `wsNotify.js` | Broadcasts a JSON payload to every WS connection for a company | `notifyCompany(companyId, payload)` | `whatsapp.js`, `crm.js`, `attendance.js`, `metrics.js` | Self-heals stale (410 Gone) connections by deleting them; no-ops cleanly if `WS_ENDPOINT` is unset (local dev/CI). |

### `phone.js` vs `phoneNormalize.js` — do not conflate these

| | `phone.js` | `phoneNormalize.js` |
|---|---|---|
| Export | `to10Digit(p)` | `normalizeE164(raw)`, `isE164(s)` |
| Output | bare 10 digits (`9876543210`) | E.164 (`+919876543210`) or `null` |
| Backs | `LEAD#` entity, `company-phone-index` GSI, `CustomerIdentityService`, WhatsApp outbound targeting | `CONTACT#` entity's `phoneE164` field, `ContactPhoneIndex` GSI |
| Validation | Permissive — always returns *a* string, even if malformed | Strict — returns `null` on unparseable input |
| ADR role | **The** canonical dedup/comparison key (ADR-013) | Supporting utility for the separate, newer Contact entity |

These are two parallel, differently-normalized phone representations for two different entity
types (`LEAD#` vs `CONTACT#`) in the same system. Neither supersedes the other today.

---

## 5. Core

`src/core/*.js` — 3 files, all read in full. This is the target pattern for key construction and
ID generation — per `entityKeys.js`'s own comments, older routes (`crm.js`, `forms.js`) have not
yet migrated to call these and still concatenate PK/SK strings inline.

### `src/core/entityKeys.js` (6,675 bytes)

**Purpose:** Centralizes every DynamoDB PK/SK constructor for both tables plus all GSI name constants — "No module may concatenate these strings inline — always call these functions" (line 5, an aspiration not yet universally followed).

**Owns:** The key-schema contract for `CONTACT#`, `PHONE#` lock (Contact, E.164-keyed), `LEAD_PHONE#` lock (Lead, `phoneNorm`-keyed — explicitly a distinct prefix from the Contact lock, per its own comment), `IDEM#` lock, `CONV#`, `LEAD#`, `INBOX#`, `TL#`, `EMP#`, `COMPANY#`, and the `GSI` name lookup object (8 GSI names across both tables).

**Key exports:** `contactPK/SK`, `contactCompanyGsiPK`, `phoneLockPK/SK`, `leadPhoneLockPK/SK`, `idemPK/SK`, `conversationPK/SK`, `convCompanyGsiPK`, `convContactGsiPK`, `leadPK/SK`, `inboxPK`, `inboxContactSK`, `inboxMsgSK`, `tlPK/SK`, `empPK/SK`, `companyPK/SK`, `GSI` (frozen object).

**Depended on by:** `CustomerIdentityService.js`, `ContactService.js`, `ConversationService.js`, `ConversationRepository.js`, `ContactRepository.js`, `events/timeline.js`.

---

### `src/core/id.js` (3,970 bytes)

**Purpose:** ULID (lexicographically-sortable unique ID) generator plus per-entity-type prefixed ID generators — "every new entity ID MUST use one of these generators" (line 47).

**Key exports:** `ulid()` (26-char: 10-char Crockford-base32 timestamp + 16-char random); `PREFIX` (frozen: `contact_`, `conv_`, `lead_`, `account_`, `task_`, `doc_`, `campaign_`, `wf_`, `evt_`); `generateContactId()` through `generateEventId()` (one per prefix); `getPrefix(id)`; `extractTimestamp(id)` (decodes creation time from an ID without a DB round-trip).

**Depended on by:** `ContactService.js`, `ConversationService.js`.

**Inconsistency worth flagging:** `PREFIX.EVENT` (`evt_`) is defined here with a ready-made `generateEventId()`, but `src/events/publisher.js` has its **own separate** `generateEventId()` producing `evt_<20 random hex chars>` via `crypto.randomBytes(10)` — not a ULID, and not calling this module at all. Two independent ID schemes coincidentally share the `evt_` prefix; timeline event IDs are consequently not lexicographically sortable the way every other entity ID in the system is.

---

### `src/core/systemMeta.js` (2,347 bytes)

**Purpose:** Standardizes the `createdAt/updatedAt/version/deletedAt` metadata envelope for V2 entities (Contact, Conversation), including optimistic-locking version bumps and soft-delete/restore.

**Key exports:** `newMeta(actorId)` → `{createdAt, updatedAt, createdBy, updatedBy, version: 1}`; `updateMeta(current, actorId)` → version+1 patch, never touches `createdAt`/`createdBy`; `softDeleteMeta(current, actorId)` → adds `deletedAt`/`deletedBy`, item preserved not removed; `restoreMeta(current, actorId)` → update fields plus a `_removeAttrs: ['deletedAt', 'deletedBy']` sentinel array that is **not itself persisted** — it signals the caller to add a DynamoDB `REMOVE` clause.

**Depended on by:** `ContactService.js`, `ConversationService.js`.

**Duplication note:** the `_removeAttrs` destructuring/REMOVE-clause-building logic is independently reimplemented, identically, in both `ContactRepository.buildUpdateExpression()` and `ConversationRepository.buildUpdateExpression()` — a candidate for extraction, currently harmless since both copies match exactly.

---

## 6. Events

`src/events/*.js` — 4 files, all read in full. This is a third, self-contained single-owner
pattern (not ADR-numbered, but architecturally the same idea as ADR-012/013): **all cross-module
side-effect recording goes through `publishEvent()`.**

### `src/events/publisher.js` (5,128 bytes)

**Purpose:** The single fire-and-forget entry point for recording that a domain event occurred. Per its own header: "No module writes TL# records directly. No module calls cross-module functions directly. All cross-module communication flows through this."

**Key export:** `publishEvent(eventType, payload)` → `void` (never a Promise — callers must not `await` it, and it never throws). Validates required fields synchronously (logs+returns early if missing), then defers all real work via `setImmediate()` so the primary HTTP response is never blocked: writes to all relevant `TL#` timeline partitions (primary entity + any `additionalEntities` fan-out), then runs any registered handlers for that event type.

**Depended on by:** `CustomerIdentityService.js`, `ContactService.js`, `ConversationService.js`.

**Lambda-freshness risk, self-documented:** `setImmediate` relies on the Lambda execution context staying alive until the event loop drains — acceptable for "Phase 1," explicitly slated for replacement by direct `EventBridge.putEvents()` in "Phase 3" per the file's own comment, with callers needing no code changes when that swap happens.

**ID-generation duplication:** its internal `generateEventId()` (`evt_` + `crypto.randomBytes(10).toString('hex')`) duplicates the purpose of `core/id.js`'s `generateEventId()`/`PREFIX.EVENT` but uses a different, non-sortable algorithm and doesn't import `core/id.js` — see the `core/id.js` entry above.

---

### `src/events/catalog.js` (5,836 bytes)

**Purpose:** The canonical enum of every domain event-type string (`E`) and entity-type token (`ENTITY`) — "every module that calls `publishEvent()` MUST use these constants... never pass a raw string."

**Key exports:** `E` (~45 constants across Contact/Conversation/Message/Lead/Customer-Journey/Task/Campaign/Workflow/AI/Document/Account sections — roughly half explicitly marked "Phase 2"/"Phase 3," reserved names with no current publisher, not dead code); `ENTITY` (7 tokens: `CONTACT`, `CONV`, `LEAD`, `ACCOUNT`, `CAMPAIGN`, `WORKFLOW`, `COMPANY`).

**Depended on by:** `CustomerIdentityService.js`, `ContactService.js`, `ConversationService.js`, `events/handlers.js`.

---

### `src/events/handlers.js` (1,765 bytes)

**Purpose:** In-memory pub/sub registry mapping event types to handler-function arrays, invoked by `publisher.js` after each timeline write. Per its own header: "Phase 1: empty — no handlers registered. Phase 2: automation engine registers handlers here."

**Key exports:** `onEvent(eventType, handler)` (registers), `getHandlers(eventType)` → `function[]` (always safe to iterate, `[]` if none), `clearHandlers()`/`clearAllHandlers()` (test-only).

**Depended on by:** `events/publisher.js`.

**Confirmed at Phase 1 today:** no code anywhere in this repo calls `onEvent(...)` to register a handler. The "run registered handlers" step in `publishEvent()` is a guaranteed no-op loop right now — by design, not by omission.

---

### `src/events/timeline.js` (3,089 bytes)

**Purpose:** Private (events-module-internal) writer for immutable `TL#` timeline records — "Only publisher.js calls these functions directly."

**Key exports:** `writeTlRecord(companyId, entityType, entityId, event)` — writes with `ConditionExpression: 'attribute_not_exists(SK)'` for idempotent re-delivery protection, silently swallows the resulting `ConditionalCheckFailedException`, no-ops with a warning if `DYNAMODB_TABLE_METRICS` is unset; `writeTlRecords(event, targets)` — fans out via `Promise.allSettled` so one partition's failure never blocks the others; `tlPK`/`tlSK` — **re-exported from `core/entityKeys.js`**, not defined here (own comment: "authoritative source moves here; timeline.js re-exports these" for compatibility).

**Depended on by:** `events/publisher.js`.

**Duplication note:** the `attribute_not_exists(SK)` idempotent-write pattern here is functionally identical to `utils/dedupPut.js` but reimplemented inline rather than calling that shared helper.

---

## 7. Repositories

`src/repositories/*.js` — 2 files, both read in full. These back the Phase-2 `CONTACT#`/`CONV#`
entities exclusively — the older `LEAD#`/`INBOX#` data model has no repository layer; routes
call `dynamodb` directly for those.

### `src/repositories/ContactRepository.js` (6,056 bytes)

**Purpose:** Sole data-access layer for the `CONTACT#` entity, called exclusively by `ContactService.js`.

**Key exports:** `getById()`, `queryByPhone()` (via `ContactPhoneIndex` GSI), `queryByCompany()` (via `ContactsByCompany` GSI, cursor-paginated, newest-first), `transactCreate(contactItem, phoneLockItem)` (atomic phone-lock + contact write), `updateItem(companyId, contactId, patch, expectedVersion)` (optimistic-locked).

**Depended on by:** `ContactService.js` only.

---

### `src/repositories/ConversationRepository.js` (7,953 bytes)

**Purpose:** Sole data-access layer for the `CONV#` entity, called exclusively by `ConversationService.js`.

**Key exports:** `getById()`, `queryByContact()`, `queryByCompany()` (both GSI-backed, cursor-paginated, with optional `status`/`assignedTo` filters on the latter), `putConversation()`, `updateItem()` (optimistic-locked), `incrementUnread(companyId, conversationId, delta)` (**no version check** — deliberately safe for high-frequency concurrent inbound-message events), `updateLastMessage()` (also no version check).

**Depended on by:** `ConversationService.js` only.

**Shared implementation detail:** both repositories independently implement an identical `buildUpdateExpression(patch)` helper that destructures the `_removeAttrs` sentinel from `core/systemMeta.js`'s `restoreMeta()` output into a DynamoDB `REMOVE` clause — see the `systemMeta.js` entry above.

---

## 8. Config

`src/config/*.js` — 6 files, all read in full.

### `src/config/dynamodb.js` (1,080 bytes)

**Purpose:** Constructs and exports the single shared `AWS.DynamoDB.DocumentClient` instance used everywhere.

**Owns:** AWS credential-resolution policy — a documented past-incident fix, worth preserving verbatim: never pass static `accessKeyId`/`secretAccessKey` inside Lambda, because that silently drops the `AWS_SESSION_TOKEN` that Lambda's auto-injected temp credentials require, breaking every AWS call with "security token is invalid." Static keys are applied only outside Lambda (local dev).

**Export:** the client instance itself (not a factory).

**Depended on by:** effectively every route, service, repository, and DB-touching utility in the backend (36+ files).

---

### `src/config/logger.js` (1,542 bytes)

**Purpose:** App-wide logging façade that also delivers **real, working** Telegram alerts on every `error()`/`alert()` call, independent of `config/telegram.js`.

**Key export:** `logger` object — `info()`, `warn()`, `error(message, error)` (console + real Telegram alert via internal `tgAlert()`), `alert(message)` (same, for cases without a full `Error` object). Internal `tgAlert()` uses raw `https.request` directly against `api.telegram.org`, with `req.on('error', () => {})` making failures truly silent so alerting can never crash the app.

**Depended on by:** effectively every backend file (37+).

**Confirmed functional gap — verified directly (`utils/audit.js` lines 2 and 32):** `utils/audit.js` imports `bot` from `config/telegram.js` (the stub below), **not** this file's `logger.error()`/`alert()`. This means `logAudit()`'s "Admin Action Alert" Telegram notifications (`delete_employee`, `change_incentive`, `export_data`, `suspend_company`) are silently no-ops — they only ever reach `console.log`. Meanwhile, generic production errors routed through `logger.error()` **do** reach Telegram for real. Two independent Telegram code paths exist in this codebase; only one of them actually sends.

---

### `src/config/metricsConfig.js` (3,254 bytes)

**Purpose:** Backend mirror of the sales/performance metric-type configuration — targets, point weights, currency flags, display metadata for the 9 tracked metric types. Self-documented dual-source-of-truth risk: "mirrors `dashboard/src/lib/metrics.config.ts` — keep both in sync when adding metrics."

**Key exports:** `METRIC_CONFIG` (per-metric-type config object), `METRIC_KEYS`, `TARGET_DEFAULTS`, `calcPoints(metricTotals, customWeights)` (currency metrics divide by weight, others multiply; supports per-company weight overrides), `emptyTotals()`, `toDailyTargets()`, `toMonthlyTargets()`.

**Depended on by:** `metrics.js`, `analytics.js`, `admin.js`, `points.js`, `compensation.js`.

---

### `src/config/secrets.js` (1,572 bytes)

**Purpose:** Loads secrets from AWS Secrets Manager into `process.env` at Lambda cold-start, cached in module scope for the Lambda's lifetime.

**Key export:** `loadSecrets()` → skips Secrets Manager entirely outside production (relies on `.env`/dotenv locally); in production, fetches secret `vt-employee-bot/production`, copies exactly 5 `MANAGED_KEYS` into `process.env`: `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`. Falls back to an empty cache (relying on Lambda's own env vars) if Secrets Manager is unreachable.

**Depended on by:** `src/handler.js`, `src/wsHandler.js` (both entry points, called before handling any event).

**Confirms:** `ANTHROPIC_API_KEY` being a managed secret corroborates `routes/ai.js`'s direct Claude API integration as a real, provisioned feature.

---

### `src/config/telegram.js` (stub — read in full)

**Purpose:** Nominally a Telegram bot client. **Its actual implementation only logs to console and resolves a Promise** — `// Telegram bot - optional for now` (its own top comment).

**Export:** `bot` object, single method `sendMessage: async (chatId, message) => { console.log(...); return Promise.resolve(); }`.

**Depended on by:** `utils/audit.js` (only consumer) — see the functional gap documented under `logger.js` above. `routes/admin.js`'s 2FA-setup Telegram alert (line 400) also goes through this same stub.

**Distinct from:** `routes/telegram.js`, which uses the real `Telegraf` library for the inbound bot-command surface (`/link`, `/add_kyc`, etc.) — that integration works; this config stub does not.

---

### `src/config/wsApiClient.js` (1,092 bytes)

**Purpose:** Lazily-constructed singleton `AWS.ApiGatewayManagementApi` client for pushing to active WebSocket connections. Explicitly mirrors `config/dynamodb.js`'s Lambda-credential-safety pattern.

**Key exports:** `getWsApiClient()` (cached singleton, built from `WS_ENDPOINT` env var), `resetWsApiClient()` (test-only — clears the singleton).

**Depended on by:** `utils/wsNotify.js` only.

---

## 9. Entry Points

### `src/handler.js` (Lambda HTTP entrypoint, read in full)

**Purpose:** Wraps `app.js` (Express) with `serverless-http` for API Gateway, and forks off a separate path for EventBridge scheduled events (campaign sweeps) that never touch Express at all.

```js
exports.handler = async (event, context) => {
  await loadSecrets();  // no-op after first cold start
  if (event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event') {
    return runDueCampaigns();   // bypasses Express/serverless-http entirely
  }
  return handler(event, context);   // serverless-http-wrapped Express app
};
```

**Depended on by:** this *is* the Lambda entrypoint (referenced by deployment config, not required by app code).

---

### `src/app.js` (Express app assembly, read in full)

**Purpose:** Builds the single shared Express app — security middleware, CORS allow-list, all 18 router mounts with their auth/subscription gating, and the global error handler.

**Owns:** the route-mounting table (see the [Middleware](#3-middleware) section for the full per-router gating matrix) and the CORS allow-list (`STATIC_ORIGINS` — production domains + localhost:3000/3001 — plus `FRONTEND_URL` env var, deduped).

**Middleware order:** `helmet()` → CORS → `express.json({limit: '10mb'})` → `cookieParser()` → routes → `errorHandler`.

**Two deliberate bypasses of the normal per-router auth pattern, both confirmed by direct read:**
1. `app.post('/api/automations/_tick', automationsRoutes.processTick)` (line 85) — mounted *before* the `authMiddleware`-gated `/api/automations` line so EventBridge can hit it without a JWT.
2. `/api/whatsapp` and `/api/contacts` (and `/api/companies`, `/api/platform`, `/api/telegram`, `/api/tags`, `/api/forms`) get no router-level `authMiddleware` — but as documented above, `whatsapp.js` and `contacts.js` both apply it per-route internally for every non-webhook endpoint.

**Depended on by:** `src/handler.js`; presumably a local-dev `server.js` at the repo root (implied by `package.json`'s scripts, not itself part of this audit's file list).

---

### `src/wsHandler.js` (WebSocket Lambda entrypoint, read in full)

**Purpose:** A separate, non-Express Lambda handler for API Gateway WebSocket lifecycle events (`$connect`/`$disconnect`/`$default`) — cannot reuse `app.js`/`serverless-http` because WebSocket events have a different shape than HTTP events.

**Owns:** WS connection authentication (JWT verified from a `token` query-string parameter at `$connect` time, since WebSocket has no per-message auth header) and the connection-registry lifecycle.

**Behavior:** `$connect` — verifies JWT, rejects temp/2FA-incomplete tokens, calls `saveConnection()`. `$disconnect` — calls `deleteConnection()`, always returns 200 even on delete failure (logged only). `$default` — no-op 200, reserved for future client→server messages (today the system is server-push-only).

**Depended on by:** this *is* the WebSocket Lambda entrypoint — a separate Lambda function/API Gateway resource from the HTTP one.

### Request lifecycle summary

**HTTP path:** API Gateway → `handler.js` (`loadSecrets()`, EventBridge fork check) → `serverless-http` → `app.js` middleware chain → matched router (with whatever auth/subscription gating that router has) → route handler (should call a service per ADR-012/013, often does not yet for customer creation) → `errorHandler` on any thrown error → response.

**WebSocket path:** a separate API Gateway WebSocket resource → `wsHandler.js` directly (no Express) → JWT verified from query string at `$connect` → connection registry updated. Outbound pushes to WS clients happen exclusively from the **HTTP** side, via `utils/wsNotify.notifyCompany()` → `config/wsApiClient.js` → `postToConnection()`. The WS Lambda itself never initiates an outbound push — it only manages connection bookkeeping.

---

## 10. Jobs (empty)

`src/jobs/` contains **zero files** — confirmed via directory listing (only `.`/`..` entries) and
a repo-wide grep for the literal string `jobs`, which returns no matches in any `.js` file or in
`package.json`'s scripts. This is a genuinely empty, entirely unreferenced directory, not a
partially-used one.

Given that `CampaignScheduler.js` (invoked directly from `handler.js` for EventBridge events) and
`automations.js`'s `/_tick` endpoint both cover "background job" responsibilities today, it's
plausible `src/jobs/` was scaffolded as an intended home for this logic before it ended up living
in `services/` and route-level tick handlers instead. It owns nothing and nothing depends on it —
either dead scaffolding safe to remove, or a placeholder the team should deliberately populate or
delete.

---

## 11. Frontend

`dashboard/src/` — Next.js App Router, current UI under `dashboard/src/app/(v3)/`. This section
is intentionally lighter-touch than the backend layers above: one line per component folder,
full detail only for the context/provider files that own shared state.

### Component folders — `dashboard/src/components/`

| Folder | Owns |
|---|---|
| `ai/` | Single AI insights widget (`InsightsPanel.tsx`) — maps to the Customer 360 "Activity Panel" AI integration point, not a standalone tab |
| `automation/` | Pre-v3 workflow automation UI (dashboard, builder, execution list) — still actively used by `app/(v3)/automation/page.tsx` |
| `badges/` | Generic badge/achievement display card |
| `campaigns/` | Campaign management UI (audience builder, create drawer, list, dashboard) |
| `charts/` | Reusable chart primitives (gauge, trend line, progress bar) |
| `common/` | Small shared UI utilities (EmptyState, Loading, Skeleton) — largely superseded by `v3/ui/` for new work |
| `contacts/` | The real, shipping Customer 360 implementation: `ActivityPanel`, header/identity pieces, `ContactTabPanel.tsx` (tab shell), and a `tabs/` subfolder with all 7 frozen tabs (`ProfileTab`, `ConversationTab`, `TimelineTab`, `CrmTab`, `TasksTab`, `NotesTab`, `DocumentsTab`) — see the `Customer360Context.tsx` entry below for the rebuild that made this true |
| `dashboard/` | Generic `StatsCard.tsx` |
| `inbox/` | `ComposerToolbar.tsx` — message-composer toolbar for the WhatsApp inbox reply box (emoji/templates/quick-replies/attachments/more). The "More" panel's "Send Flow" entry is real (queries `['whatsapp-flows']`, posts to `send-flow`); "Interactive List"/"CTA Button"/"Catalog"/"Payment" alongside it are still `toast.info('...coming soon')` stubs — don't assume all four are equally unimplemented. |
| `layout/` | `ProtectedRoute.tsx` — auth-gate wrapper used by the v3 root layout |
| `settings/` | `WabaHealthPanel.tsx` (WABA health/status widget) + `WhatsAppFlowsPanel.tsx` (register/list/delete WhatsApp Flows by Meta Flow ID) + `WelcomeMessagePanel.tsx` (new — configure the first-contact auto-reply: template, reply buttons, or CTA button) — all mounted inside `WhatsAppSection` in `settings/page.tsx`, connected-only |
| `shared/` *(new folder)* | `ButtonListEditor.tsx` — the one reusable editor for both WhatsApp button kinds (`mode="reply"` or `mode="cta"` prop, never both at once per Meta's platform rule). Built for `WelcomeMessagePanel.tsx` but deliberately not welcome-message-specific — the next feature needing button configuration (automation-step buttons, Inbox manual-send buttons) should import this, not build a second one. |
| `tags/` | Tag display/pick UI shared by inbox and contacts |
| `hooks/` *(sibling of `components/`, not inside it — `dashboard/src/hooks/`)* | Shared cross-page hooks. Two own single React Query keys and should be reused rather than re-queried inline: `useTagCatalog` (`['tag-catalog']`, `GET /api/tags`) and `usePipelineStages` (`['pipeline-stages']`, `GET /api/crm/pipeline`). `usePipelineStages` is the sole source of stage options/labels/colors across the app — every hardcoded `STAGE_LABELS`-derived list has been replaced with it (inbox, contacts list + detail, sales board, campaigns audience builder + review, workflow automation builder, new-contact drawer, home dashboard, and now `Customer360Context.tsx` too — see below). `useNoteMutations.ts` (new, was `useAddNote.ts` — renamed once it grew edit/delete) is the sole owner of the internal-notes write mutations — `useAddNote`/`useEditNote`/`useDeleteNote` against `POST`/`PUT`/`DELETE /api/whatsapp/inbox/:leadId/note[/:timestamp]`, the one real notes endpoint — used by `useContactMutations`'s `addNote`, `ConversationTab.tsx`'s inline note-toggle, the Inbox sidebar's `CustomerSnapshotPanel` (now shows the note list too, not just compose), and `NotesTab.tsx`. Also exports `canModifyNote()`, a client-side mirror of the backend's author-or-manager check, used to hide edit/delete affordances the server would 403 anyway. See finding #6 below for the bug it replaced. Rest are single-purpose (`useContactMutations`, `useOwnerAssign`, `useEmployeesList`, `useDebounce`, `useMetrics*`, `useWebSocket`/`useWsEvent`, `useRealTime`, `useFetch`) |
| `templates/` | WhatsApp message template management (category/quality/status badges, live preview) |
| `ui/` | Pre-v3 generic UI kit (DataTable, Leaderboard, MetricCard) — legacy counterpart to `v3/ui/` |
| `v3/` | Current design-system + feature-shell folder — see below |
| `whatsapp/` | Legacy WhatsApp inbox UI (`ChatPane`, `ConversationList`, `LeadSidebar`) — still the real consumer of `InboxContext` (see below) |
| Loose files: `DeleteEmployeeDialog.tsx`, `EditEmployeeModal.tsx`, `EmployeeActionMenu.tsx` | All three consumed by `v3/team/EmployeesSection.tsx` |
| `ServiceWorkerRegister.tsx` | Registers the PWA service worker on mount |

**`v3/` subfolders:** `v3/layout/` (app chrome — `V3Sidebar`, `V3BottomNav`, `V3NotificationPanel`); `v3/team/` (`EmployeesSection.tsx`, the entire employee-directory feature); `v3/ui/` (the current design-system primitives, plus `CommandPalette.tsx` and `OwnerSelect.tsx`).

### Route segments — `dashboard/src/app/(v3)/`

| Segment | Renders |
|---|---|
| `layout.tsx` | V3 shell — `ProtectedRoute` + sidebar/bottom-nav/notification-panel/command-palette |
| `analytics/` | System-wide analytics dashboard |
| `attendance/` | Attendance calendar + summary per employee |
| `audit-log/` | Searchable audit-log viewer |
| `automation/` | Tabbed Dashboard/Workflows/Executions shell |
| `campaigns/` | Tabbed Dashboard/Campaigns/Audience/Analytics/History/Templates shell |
| `communications/` | Redirect stub → `/inbox` |
| `compensation/` | Payroll/compensation table, lock/unlock periods |
| `contacts/` | List page + `[contactId]` detail page (Customer360Provider-backed, see `Customer360Context.tsx` entry below) |
| `customers/` | Pure redirect stub → `/contacts/*` |
| `employees/` | Thin wrapper around `v3/team/EmployeesSection.tsx` |
| `entry/` | Daily metrics entry form |
| `home/` | Logged-in landing dashboard |
| `inbox/` | Current WhatsApp inbox workspace (see finding below) |
| `metric-target/` | Per-metric daily/monthly target + point-weight config |
| `platform/` | Superadmin tenant console |
| `sales/` | CRM pipeline board + follow-up task list |
| `settings/` | Tabbed settings (profile/company/users/WhatsApp/security/billing/etc.) |
| `templates/` | Standalone templates page (slimmer duplicate entry point to the same components also embedded in `campaigns/`) |

### Context/Provider files — state ownership

`dashboard/src/contexts/` (plural) holds `Customer360Context.tsx`, `InboxContext.tsx`,
`WebSocketContext.tsx`. **Auth state lives in a separate, singular `dashboard/src/context/`
folder** (`AuthContext.tsx`, plus `ThemeContext.tsx`) — a naming split worth remembering since
it's an easy place for both a human and an AI assistant to search the wrong directory.

#### `Customer360Context.tsx` — **now the real, mounted implementation (rebuilt — see history below)**

**State owned:** `leadId`, `contact`, `stages`, `stageObj`, `messages`, `notes`, `timeline`, `windowExpired`, `isLoading`, `isError`, `refresh()`, `followups`, `nextFollowup`, `refreshFollowups()`, backed by React Query keys `['contact', leadId]`, `['pipeline-stages']` (via `usePipelineStages()` — no longer a standalone `['crm-pipeline']` fetch), `['crm-followups', leadId]`. **Export:** `useCustomer360()` hook, `Customer360Provider` component.

**Verified directly:** `app/(v3)/contacts/[contactId]/page.tsx` mounts `<Customer360Provider leadId={contactId}>` for every real (LEAD#) contact and renders the 7 real tab components through `ContactTabPanel.tsx`. `grep -rn "Customer360Provider" dashboard/src` now returns the page's mount site in addition to the file's own definition. Seven files call `useCustomer360()`: `components/contacts/tabs/{CrmTab,NotesTab,TasksTab,TimelineTab,ConversationTab,DocumentsTab}.tsx` and `ActivityPanel.tsx` (rendered inside `ConversationTab`, not as a separate page-level sidebar — matches `docs/v3/08_CUSTOMER360_VISION.md`'s documented design, a deliberate difference from the old ad-hoc page's always-visible "Quick stats" sidebar).

**History — the anti-pattern this replaced:** Until this rebuild, the live route implemented its own `Contact360Content` with a direct `useQuery(['contact', contactId], ...)`, bypassing this provider and all 6 already-built tab components entirely — exactly the pattern the dashboard's own `CLAUDE.md` commit-level rule prohibits ("No component fetches `['contact', leadId]` directly — all tabs consume via `useCustomer360()`"). That implementation also used its own hardcoded, non-frozen tab list (`overview/conversations/notes/followups/timeline/kyc/documents` — `kyc` was never on the frozen 7). It has been fully deleted, not deprecated alongside the new code — `app/(v3)/contacts/[contactId]/page.tsx` is now a single implementation.

**Unknown (INBOX#) contacts — explicit design, not an oversight:** `Customer360Provider`'s `leadId` prop only ever receives a real `LEAD#` id; the page's `isUnknown` (10-digit-phone) check routes unknown contacts to `UnknownContactView` *before* the provider ever mounts. This was a deliberate call, not a shortcut: `ConversationTab`'s resolve/reopen, `TasksTab`'s `createTask`, `NotesTab`'s `addNote`, and `CrmTab`'s `changeStage`/`reassign`/`addTag` all write through `leadId`-keyed endpoints with no unknown-contact equivalent (the only shared LEAD#/INBOX# write path is `contacts.js PUT /stage`, which none of these 5 tabs use). Extending all 5 tabs' mutation logic to support a phone-only identity was out of scope for this rebuild.

**`DocumentsTab.tsx` — the 7th frozen tab, built for the first time.** Not a stub: lists WhatsApp media attachments already present in the context's `messages` (image/video/audio/document), with on-click lazy URL resolution mirroring `ConversationTab`'s `useMediaSrc` fallback chain. Reserves `data-slot="documents-kyc"` / `"documents-agent-uploads"` / `"documents-system"` for the other three categories `docs/v3/08_CUSTOMER360_VISION.md`'s Documents spec describes — not implemented, since they need document-storage backend endpoints that don't exist yet.

#### `InboxContext.tsx` — same pattern as Customer360Context

**State owned:** conversation selection, tab filters, 11 mutations (stage/assign/tag/resolve/reopen/note/auto-assign/pin/availability/name), query keys `wa-inbox`, `crm-pipeline`, `admin-employees`, `wa-conv`, `wa-canned`, `wa-availability`, `tag-catalog`. **Export:** `useInbox()`, `InboxProvider`.

**Verified:** only 3 real consumers, all in the legacy `components/whatsapp/` folder (`LeadSidebar.tsx`, `ChatPane.tsx`, `ConversationList.tsx`). The current production route, `app/(v3)/inbox/page.tsx`, does **not** consume `useInbox()` — it implements its own local state/queries independently, mirroring the Customer360 duplication exactly. Its own `noteMutation` (correct URL, matches finding #6's fixed endpoint) is therefore dead code too — not touched by the notes fix below since nothing renders it.

#### `WebSocketContext.tsx`

**State owned:** `connected`, `wsState`, `lastConnectedAt`, plus a module-level `EVENT_QUERY_MAP` translating WS event names (`metric_added`, `lead_created`, `whatsapp_message`, etc.) into React Query cache invalidations. **Export:** `useWsContext()`, `WebSocketProvider`. Depends on `useAuth()` from the singular `context/AuthContext` to gate connect/disconnect — must be mounted inside `AuthProvider` (confirmed in `app/layout.tsx`).

#### `AssignmentBridgeProvider.tsx`

**Owns no context value of its own** — a pure side-effect component. Listens for cross-tab owner-assignment events via `BroadcastChannel` and writes them directly into the React Query cache (`qc.setQueryData(assignmentKey(leadId), ...)`) so `OwnerSelect.tsx` consumers update instantly without an API round-trip. A synchronization mechanism, not a state owner — classify it separately from the contexts above.

#### `QueryProvider.tsx`

Instantiates the single app-wide `QueryClient` (2-min staleTime, 10-min gcTime, retry:1, no refetch-on-focus). The outermost provider in the tree. No custom hook or query-key factory — all cache-shaping logic lives downstream in the individual contexts/pages.

**Provider mount order** (from `app/layout.tsx`): `QueryProvider > AssignmentBridgeProvider > AuthProvider > WebSocketProvider > children`.

#### `AuthContext.tsx` (`dashboard/src/context/`, singular)

**State owned:** `user`, `loading`, `login()`, `verifyTotp()`, `verifyBackupCode()`, `logout()`. **Export:** `useAuth()`, `AuthProvider`. By far the most widely consumed of any frontend state owner — 26 files call `useAuth()`, including `WebSocketContext`, `ProtectedRoute`, and most `app/(v3)/*/page.tsx` route files for role-gating.

### Cross-cutting frontend findings

1. **Resolved.** Two parallel, fully-built Customer 360 implementations used to exist — the documented-architecture one (`Customer360Provider` + 7 tab components, unmounted) and the ad-hoc one that shipped (`app/(v3)/contacts/[contactId]/page.tsx`, violating the dashboard's own `CLAUDE.md` fetch-ownership rule). The ad-hoc implementation has been deleted; the page now mounts `Customer360Provider` and renders the 7 real tabs (the previously-missing `DocumentsTab.tsx` was built as part of this). See the `Customer360Context.tsx` entry above for the full history and the explicit unknown-contact design decision.
2. The same shape of duplication exists for Inbox: `InboxContext` is real and used by the legacy `components/whatsapp/*` UI, but the current `/inbox` route reimplements its own state independently.
3. Legacy and v3 UI kits coexist deliberately and are both live (`components/ui/` + `components/whatsapp/` pre-v3; `components/v3/ui/` current) — this is not migration debt so much as an incomplete migration in progress.
4. Several routes are pure redirect stubs preserving old URLs: `customers/*` → `contacts/*`, `communications` → `inbox`, `automation/logs` → `automation`.
5. **Fully resolved.** Two independent `PipelineStage` type definitions used to exist — the live one in `hooks/usePipelineStages.ts` (`{key,label,color,order}`) and one locally declared inside `Customer360Context.tsx` (`{key,label,color}`). As of the stage-hardcoding remediation, `hooks/usePipelineStages.ts`'s type is the sole one in the codebase: the hardcoded `STAGE_LABELS`/`Stage`-union pattern it replaced was traced to 10 frontend files (originating at the V3 launch, `efe9c7c`, not a later regression) and all 10 now read the live pipeline instead — 3 were write-payload risk (`inbox/page.tsx`'s stage select, `WorkflowBuilder.tsx`'s `change_stage` action config, `NewContactDrawer.tsx`'s initial-stage picker), 1 was a duplicate fetch (`sales/page.tsx` independently queried the same `GET /api/crm/pipeline` under the same `['pipeline-stages']` key `usePipelineStages` now owns), 2 were filter-availability gaps (`AudienceBuilder.tsx`, `contacts/page.tsx`'s list filter), and 4 were cosmetic label-only lookups (`contacts/page.tsx`'s CSV/table/chip, `CampaignCreateDrawer.tsx`, `home/page.tsx`). `components/v3/ui/Badge.tsx`'s `variant="stage"` also gained an optional `color` prop so a custom stage key renders with a real color instead of shape-only. As part of the Customer 360 rebuild, `Customer360Context.tsx`'s local declaration was removed and replaced with a re-export of the shared hook's type (`export type { PipelineStage }` from `usePipelineStages.ts`) — there is now exactly one `PipelineStage` type in the codebase.
6. **Fixed, then extended with edit/delete.** Three separate notes-write bugs found and closed the same week as the tags/stages duplication above — same root shape (an endpoint or UI element built once, never exercised live, and drifted). (a) `useContactMutations.ts`'s `addNote` posted to `/api/crm/leads/:id/note`, a route that never existed in `crm.js` (guaranteed 404) since the Customer 360 page's first scaffolding commit — dead until the C360 rebuild made the Notes tab reachable. (b) The Inbox `CustomerSnapshotPanel` sidebar's "Internal Notes" box (`app/(v3)/inbox/page.tsx`) was a bare `<textarea>` with no `value`/`onChange`/submit button at all — decoration only, never functional. (c) `ConversationTab.tsx`'s inline note-toggle had its own third correct-but-separate mutation hitting the one real endpoint. All three now share `hooks/useNoteMutations.ts`, the single owner of `POST`/`PUT`/`DELETE /api/whatsapp/inbox/:leadId/note[/:timestamp]`; each surface still owns its own success side-effect (cache invalidation / textarea clear) via each hook's `onSuccess` callback param, since C360's `['contact', leadId]` and Inbox's `['wa-conv', convKey]`/`['wa-inbox']` are different caches. `InboxContext.tsx`'s own fourth copy (finding #2 above) was deliberately left alone — it's unreachable dead code, so consolidating it changes nothing live. Notes remain lead-scoped only (no unknown-contact endpoint); the sidebar widget explicitly disables itself for phone-only contacts instead of silently no-op-ing.
   **Follow-up the same day:** live use surfaced two more gaps — the Inbox sidebar only had a compose box, no feed, so a note posted there was invisible on that surface even though it saved correctly (visible only via C360's Notes tab); and neither surface had edit/delete at all. Fixed: the sidebar widget now fetches and renders the note list too (sharing `['wa-conv', convKey]`, the same cache key the main chat panel's message query already owns — no extra network round trip once both are mounted), and both `NotesTab.tsx` and the sidebar widget got inline edit + delete, backed by new `PUT`/`DELETE /api/whatsapp/inbox/:leadId/note/:timestamp` routes (`src/routes/whatsapp.js`). Authorization: author or `admin`/`manager`/`superadmin` only (`canModifyNote()`, duplicated intentionally client-side in `useNoteMutations.ts` to hide the button and server-side in `whatsapp.js` as the actual enforcement — client check is UX only, never trust it alone). The `UpdateExpression` aliases every target attribute via `ExpressionAttributeNames` (`#content`, `#editedAt`, `#mentions`) rather than using bare attribute names — this codebase already had to alias `timestamp`/`count`/`ttl` elsewhere for the same reason (DynamoDB's reserved-word list is large and non-obvious), so the same defensive pattern was applied here preemptively rather than discovered by a runtime failure a mocked test wouldn't have caught.

7. **New feature.** WhatsApp Flows (Meta's native in-chat structured forms) — send + receive, not a bug fix. Deliberately does **not** include an in-app Flow designer; Meta's own Flow Builder in WhatsApp Manager owns the Flow JSON/screens, APForce only references a Flow by its Meta-issued ID. New `CONFIG#FLOW#{companyId}` / `FLOW#{flowId}` config (`GET`/`POST /flows`, `DELETE /flows/:flowId` in `whatsapp.js`) stores `flowId, name, bodyText, ctaLabel, screenId?` — deliberately **not** `CONFIG#FORM#` (the unrelated public web lead-capture system in `forms.js`; separate PK namespace, no cross-wiring, verified by test). Sending (`POST /inbox/:leadId/send-flow`) builds the Meta interactive-flow payload and calls `WASendSvc.sendInteractive()` **unmodified** — audited first and confirmed the existing generic `interactive` passthrough already covers `type:'flow'` with zero service changes; `WhatsAppSendService.js`'s own `sendFlow()` stub (line ~493, throws 501) was deliberately left unfilled rather than implemented as a second, duplicate send path — see that method's row above before ever touching it. Receiving: the webhook's inbound-message filter (`whatsapp.js` ~line 1300) now also accepts `type:'interactive'` messages where `interactive.type === 'nfm_reply'` (Meta's completed-Flow-answer shape — distinct from `button_reply`, now also handled, see finding #8 below; `list_reply` remains unhandled, still out of scope, no feature sends list messages) via new `isFlowResponse()`/`parseFlowResponse()` helpers (exported off the router for testability, same pattern as `storeInboundMedia`). `nfm_reply.response_json` is a JSON *string* keyed by the Flow's own screen-component field names — APForce doesn't have the Flow JSON (no in-app builder, by design), so field labels are humanised best-effort (`full_name` → `Full Name`), not true schema-derived labels. Stored as `type:'flow_response'` with a readable per-field `content` summary (never raw JSON) plus a structured `flowFields` array both `ConversationTab.tsx` and the live Inbox page's `MessageBubble` render as a labeled list, falling back to the plain summary text if `response_json` failed to parse. Settings CRUD lives in `WhatsAppFlowsPanel.tsx` (mounted in `WhatsAppSection`, connected-only); the Inbox composer's "Send Flow" entry (`ComposerToolbar.tsx`'s "More" panel) is disabled for unknown (phone-only) contacts — same lead-scoped-only constraint as notes, no unknown-contact endpoint exists.

8. **New feature.** Welcome-message interactive buttons — a feature directly audit-confirmed to not exist at all before this pass: `CONFIG#WELCOME` was template-only, no frontend welcome-message UI existed anywhere (removed in the V3 rewrite, never rebuilt), and no `button_reply` webhook parsing existed. Built as one combined pass (base buttons + follow-ups + CTA buttons together), not retrofitted, per explicit instruction. Full schema in `docs/bible/07_DATABASE.md` §2.15 — the short version: `messageType: 'template' | 'reply_buttons' | 'cta_buttons'` is mutually exclusive with which of `buttons[]`/`ctaButtons[]` may be non-empty (Meta platform rule — reply buttons and CTA buttons cannot combine in one message — enforced server-side via `welcomeConfigSchema` in `src/utils/validation.js`, a Zod `.superRefine()`, never left to the frontend alone).
   **Platform-constraint correction made mid-task:** the originally-scoped `ctaButtons` shape (max 2, one url + one phone) is not achievable via `WhatsAppSendService.sendInteractive()` — Meta's freeform, non-template interactive-message API supports exactly one CTA button (`interactive.type: 'cta_url'`, URL only); a phone-number CTA button exists only in pre-approved message templates, a mechanism this feature doesn't use. Confirmed with the user before building (not assumed); scope adjusted to `ctaButtons: max 1, type: 'url'` only, enforced identically in the Zod schema and `ButtonListEditor.tsx`'s `cta` mode.
   **Reuse, not duplication:** `sendInteractive()` sends both button kinds unmodified — only the `interactive` payload shape differs per call site (`type: 'button'` with an `action.buttons[]` array of up to 3 `{type:'reply', reply:{id,title}}` entries, vs `type: 'cta_url'` with a single `action.parameters:{display_text,url}`). `POST /inbox/:leadId/send-flow`'s Flow-send logic was extracted into a `sendRegisteredFlow()` helper so a button's `followUp.type === 'flow'` reuses it directly rather than re-implementing the Meta Flow-send payload a second time. `ButtonListEditor.tsx` (new, `components/shared/`) is one component with a `mode` prop, not two — its `flow` follow-up sub-form queries the same `['whatsapp-flows']` key `WhatsAppFlowsPanel.tsx` and `ComposerToolbar.tsx`'s Send-Flow picker already own.
   **Inbound handling:** `isButtonReply()`/`parseButtonReply()` (new, exported off the router for testing, same convention as `isFlowResponse`/`storeInboundMedia`) detect `type:'interactive'`, `interactive.type:'button_reply'`, store it as a normal readable `MSG#` item (`type:'button_reply'`, `content` = the button's title — renders as plain text in both chat surfaces, not the "media unavailable" placeholder style `flow_response` had to be excluded from too). `fireButtonFollowUp()` looks up the tapped button's `followUp` from the **current** `CONFIG#WELCOME` record (not a snapshot taken at send time — if the admin edited the buttons after sending, an id that no longer matches just fires nothing, same as `followUp.type: 'none'`) and dispatches to `sendText()`/`sendMedia()`/a `cta_url` `sendInteractive()` call/`sendRegisteredFlow()` depending on `followUp.type`. **CTA button taps generate no webhook event at all — confirmed as a hard Meta platform limitation, not built around, documented in both code comments and §2.15.**
   **A real, pre-existing bug found and worked around (not fixed, out of scope):** Zod 4 is installed (`node_modules/zod` v4.4.3), whose `ZodError` no longer has an `.errors` property — only `.issues`. The three existing schema-validated routes in `crm.js` (`createLeadSchema`, `updateLeadSchema`, `createFollowupSchema`) all read `parsed.error.errors` for the 400 response's `details` field, which is `undefined` today, silently dropping validation detail from those three routes' error responses. `welcomeConfigSchema`'s own route uses `.issues` correctly. This existing bug was left alone — fixing it wasn't asked for and touches call sites outside this task's scope — but it's worth fixing in a future small pass.
