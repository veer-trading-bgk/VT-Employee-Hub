# 10 — Testing Guide

Status: verified against repo state 2026-07-02 (commit `43b89af`, branch `main`).

**Correction:** an earlier internal planning table labeled the backend runner "Vitest." That was wrong.
There is no Vitest anywhere in this repo. The backend runner is **Jest**. Confirmed directly from
`package.json`: `"test": "jest"`, `devDependencies: { "jest": "^30.4.2" }`. Do not repeat the Vitest error
in any downstream document or prompt.

---

## Overview

Two test frameworks, two layers, two repos-in-one:

| Layer | Location | Framework | What it exercises |
|---|---|---|---|
| Backend unit/integration | `f:\aws\vt-employee-bot\tests\` | **Jest ^30.4.2** | `src/services`, `src/repositories`, `src/utils`, `src/core`, `src/events`, `src/middleware` — all mocked-DDB, no network |
| Frontend E2E | `f:\aws\vt-employee-bot\dashboard\e2e\` | **Playwright ^1.61.1** | Real browser against a running dashboard + live backend API |

There is no third framework. No Mocha, no Chai, no Vitest, no Cypress, no Jasmine. `jest.config.js` at
repo root is the only test config for the backend.

---

## How to run tests locally

### Backend (Jest)

From `f:\aws\vt-employee-bot`:

```
node_modules/.bin/jest
```

**Do not run `npm test` from a Git Bash / POSIX-sh shell on this machine.** It fails immediately with:

```
npm error code ENOENT
npm error syscall spawn cmd.exe
npm error errno -4058
npm error enoent spawn cmd.exe ENOENT
```

This is npm's child_process trying to resolve `cmd.exe` and failing under this shell's `PATH`/environment —
not a Jest problem, not a code problem. It was reproduced live during this doc's verification (exit
reported as 0 by the wrapper but the actual npm invocation errored above `EXIT: 0` is misleading — treat
any `npm error` line in the output as a failed run regardless of the reported exit code). Calling the Jest
binary directly bypasses npm's script-runner spawn entirely and always works. If you're in a real Windows
PowerShell/cmd.exe session (not Git Bash), `npm test` is likely fine — but `node_modules/.bin/jest` works
everywhere and is the safe default to reach for first.

Useful variants:

```
node_modules/.bin/jest --verbose              # show every test name, not just suite summary
node_modules/.bin/jest tests/leadService.test.js   # single file
node_modules/.bin/jest --watch                # rerun on change (local dev only)
node_modules/.bin/jest -t "resolveForInbox"   # filter by test name
```

`jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  testTimeout: 10000,
};
```

No coverage threshold is configured. No `--coverage` flag is run in CI. Coverage % is not currently tracked
anywhere for this repo.

### Frontend (Playwright E2E)

From `f:\aws\vt-employee-bot\dashboard`:

```
npm run test:e2e          # headless, CLI reporter + HTML report
npm run test:e2e:ui       # Playwright's interactive UI mode
npm run test:e2e:headed   # headed browser, useful for debugging locally
```

E2E tests need real credentials for a live (or locally-run) environment — see auth section below. Without
`E2E_EMAIL` / `E2E_PASSWORD` set, the `setup` project's `login()` call throws immediately
(`E2E_EMAIL and E2E_PASSWORD must be set`).

`playwright.config.ts` starts the dashboard itself via `webServer` (`npm run dev`, port 3001,
`reuseExistingServer: !process.env.CI` — so locally it'll reuse an already-running `next dev` instead of
starting a second one).

---

## What's covered — backend (Jest)

Verified live run, this session:

```
Test Suites: 18 passed, 18 total
Tests:       433 passed, 433 total
Snapshots:   0 total
Time:        2.189 s
```

18 files in `tests/`, all passing, all fast (mocked DDB — no real AWS calls, no network I/O). Grouped by
what they actually exercise:

### Core primitives (`src/core/`)
- **`core.test.js`** — `src/core/id.js` (ULID generation, `PREFIX` constants, per-entity ID generators,
  `getPrefix()`, `extractTimestamp()`, ID safety/no-embedded-business-data) and `src/core/systemMeta.js`
  (`newMeta()`, `updateMeta()` version increment, `softDeleteMeta()`, `restoreMeta()`, full lifecycle
  version monotonicity).
- **`entityKeys.test.js`** — `src/core/entityKeys.js`: Contact keys, phone-lock keys, Conversation keys,
  Lead keys, Inbox keys, Timeline keys, Employee/Company keys, GSI name constants, and explicit
  cross-entity key-collision isolation checks.

### Utils (`src/utils/`)
- **`phoneNormalize.test.js`** — `normalizeE164()`: Indian numbers, WhatsApp JID stripping, international
  numbers, invalid-input handling, idempotency; `isE164()`.
- **`featureFlags.test.js`** — `DEFAULTS` (frozen, all-false Phase-1 defaults), `getFlags()` (global →
  company override precedence, per-company caching, `_clearCache()`, fail-open to DEFAULTS on DDB error),
  `isEnabled()`.
- **`dedupPut.test.js`** — idempotent-write helper: new item → true, `ConditionalCheckFailedException` →
  false (duplicate webhook), unexpected DDB errors propagate (not swallowed), uses
  `attribute_not_exists(SK)`.
- **`wsConnections.test.js`** — `saveConnection` (TTL ~2h, `SUPERADMIN` fallback when `companyId` null),
  `deleteConnection`, `getConnectionsByCompany` (GSI query, empty-array fail-open on DDB error).
- **`wsNotify.test.js`** — `notifyCompany`: guard clauses (no `WS_ENDPOINT`, no `companyId`, no
  connections), happy path (posts to every connection, scopes GSI query by company), 410-Gone handling
  (deletes stale connection), continues sending to remaining connections after one fails, never throws.
- **`conversationResolver.test.js`** — `resolveForInbox()`, `resolveForLead()`, `syncConvStatus()`,
  `syncMarkRead()`: Contact/Conversation creation on first contact, `if_not_exists` race guarding,
  displayName fallback logic, idempotent updates when `convId` already present, and — repeated
  consistently across every function — "never throws" contracts (DDB errors, service errors all caught
  and logged, not propagated).

### Services (`src/services/`)
- **`contactService.test.js`** — `createContact()` (dedup-on-phone, `sourceHistory`, `identities[]`
  shape, `CONTACT_CREATED` event), `getContact()`, `findContactByPhone()`, `updateContact()` (allowed-field
  allowlist, `CONTACT_UPDATED` event), `softDeleteContact()`, `restoreContact()`, `listContacts()`.
- **`conversationService.test.js`** — `createConversation()` (shape, AI-reserved-fields defaults,
  `conversationType`/`isBotActive`/`handoffState` defaults and overrides, GSI attrs), `getConversation()`,
  `assignConversation()`, `resolveConversation()`, `reopenConversation()`, `snoozeConversation()`,
  `pendConversation()`, `markRead()`, `incrementUnread()`, `updateLastMessage()` (200-char truncation),
  `softDeleteConversation()`, `restoreConversation()`, `listByCompany()`, `listByContact()`, and exported
  constants (`STATUS`, `VALID_CHANNELS`, `CONVERSATION_TYPE`, `HANDOFF_STATE`).
- **`leadService.test.js`** — `linkContactToLead()`: Contact creation when none exists, reuse when one
  does, `if_not_exists` race-safe write of `contactId`, full idempotency when already linked, displayName/
  source derivation, "never throws" contract on every failure branch.

### Repositories (`src/repositories/`)
- **`contactRepository.test.js`** — `getById()`, `queryByPhone()` (non-deleted filter), `queryByCompany()`
  (GSI, pagination, `ExclusiveStartKey`, 100-item cap), `transactCreate()` (dual-Put transaction,
  `attribute_not_exists(PK)` on both, `TransactionCanceledException` propagation), `updateItem()`
  (optimistic-lock condition, `_removeAttrs` → `REMOVE` clause, `ConditionalCheckFailedException`
  propagation).
- **`conversationRepository.test.js`** — `getById()`, `queryByContact()`, `queryByCompany()` (GSI,
  reserved-word filter aliasing, 100-item cap), `putConversation()` (`attribute_not_exists` guard),
  `updateItem()` (optimistic lock, `_removeAttrs`), `incrementUnread()` (no version lock — atomic by
  design), `updateLastMessage()` (no version lock — best-effort by design).

### Events (`src/events/`)
- **`events.test.js`** — event catalog shape (`E`/`ENTITY` constant naming conventions), handler registry
  (`onEvent`/`getHandlers`/`clearHandlers`/`clearAllHandlers`, throws `TypeError` for non-function
  handlers), timeline key builders (`tlPK`/`tlSK`, chronological lexicographic sort), `writeTlRecord`
  (dup-write silently ignored via `ConditionalCheckFailedException`, skips write when `TABLE` env unset),
  `writeTlRecords` fan-out (parallel writes, `Promise.allSettled` partial-failure tolerance), `publishEvent`
  guard clauses (missing `eventType`/`companyId`/`entityType`/`entityId` → warn + skip, never throws
  synchronously — fire-and-forget contract), `publishEvent` happy path (`evt_`-prefixed IDs, ISO
  timestamps, `additionalEntities` fan-out), handler invocation after write (one failing handler doesn't
  block others, DDB failure in the deferred TL# write doesn't surface).

### Middleware (`src/middleware/`)
- **`auth.test.js`** — `authMiddleware`: no token → 401, expired/invalid token → 401, temp
  (2FA-incomplete) token → 401, valid token → sets `req.user` + calls `next()`, reads token from cookie as
  well as `Authorization` header.
- **`rateLimiter.test.js`** — `loginRateLimiter`: `isBlocked` threshold logic (limit = 10), `recordFail`
  increment, `reset`, and fail-open behavior on DynamoDB errors for both `isBlocked` and `recordFail`.

### Media (`src/utils/`, S3/Meta integration logic)
- **`storeInboundMedia.test.js`** — guards (empty `MEDIA_BUCKET`, missing access token, missing media ID,
  no download URL from Meta), happy path (Meta download → S3 upload → correct `s3Key`), MIME-to-extension
  mapping (video → `.mp4`), S3 `AccessDenied` → returns null AND sends a Telegram alert, Meta API failure →
  returns null without touching S3.

### Cross-cutting smoke
- **`smoke.test.js`** — a lighter, redundant top-level sanity sweep across `id.js`, `entityKeys.js`,
  `systemMeta.js`, `phoneNormalize.js`, `featureFlags.js`, `operationalMetrics.js`, and
  `ConversationService` constants. Exists as a fast canary; the dedicated per-module files above are the
  real depth.

---

## What's covered — frontend E2E (Playwright)

`f:\aws\vt-employee-bot\dashboard\e2e\` — **4 spec/setup files, 7 tests total.**

| File | Role |
|---|---|
| `auth.setup.ts` | Playwright `setup` project. Logs in once via `login()`, persists `storageState` to `e2e/.auth/user.json`. Every other spec reuses this — no per-test login. |
| `helpers/login.ts` | Shared login helper — see auth mechanics below. Not a spec itself. |
| `smoke/auth.spec.ts` | 2 tests, runs **without** saved auth state (`storageState: { cookies: [], origins: [] }`) to verify the login flow itself: login page renders (`APForce` text, email/password inputs, sign-in button visible), and unauthenticated `/inbox` redirects to `/login`. |
| `smoke/pages.spec.ts` | 5 tests, uses saved auth state. Each just asserts the page loads: dashboard (`/home`, "My Work" text), inbox (`/inbox`), campaigns (`/campaigns`), templates tab inside campaigns (click + text check), automation (`/automation`, heading check). Every test's core assertion is "sidebar (`<aside>`) becomes visible and URL isn't `/login`" — i.e. these are render/auth smoke checks, not functional/business-logic tests. |

### Auth mechanics (`e2e/helpers/login.ts`)

- Required env vars: `E2E_EMAIL`, `E2E_PASSWORD`. Missing either throws immediately.
- Optional: `E2E_TOTP_SECRET` — a base32 TOTP secret. The helper implements TOTP generation **inline using
  Node's built-in `crypto`** (HMAC-SHA1, 30s period, 6 digits) — no external TOTP library dependency.
- Flow: fill email/password → submit → if an `input[autocomplete="one-time-code"]` becomes visible within
  4s, treat the account as 2FA-enabled, compute the current TOTP code, fill it (the TOTP step
  auto-submits on 6 digits) → wait for URL to leave `/login` (20s timeout).
- If a 2FA-enabled account is hit but `E2E_TOTP_SECRET` isn't set, the helper throws a clear error rather
  than hanging.

### `playwright.config.ts` — key settings

- `testDir: './e2e'`, two projects: `setup` (`auth.setup.ts`) and `chromium` (depends on `setup`, reuses
  `e2e/.auth/user.json` as `storageState`).
- `baseURL`: `E2E_BASE_URL` env var, defaults to `http://localhost:3001`.
- `webServer`: runs `npm run dev` itself and waits on port 3001; `reuseExistingServer: !process.env.CI`
  (so local runs reuse an already-running dev server; CI always starts fresh).
- `retries: 1` in CI, `0` locally. `workers: 1` in CI (serial), unconstrained locally.
- `fullyParallel: true`, `forbidOnly: !!process.env.CI` (a stray `.only` in a spec fails CI instead of
  silently skipping the rest of the suite).

E2E scope today is **render/auth smoke only** — "does the page load and show a sidebar without bouncing to
login." No E2E test sends a WhatsApp message, creates a contact, launches a campaign, or otherwise
exercises business logic end-to-end.

---

## CI integration (`.github/workflows/deploy.yml`)

**Updated 2026-07-12 for the path-based job filtering added 2026-07-09 (commit `8baede4`)** — the
rest of this section's step-by-step detail is otherwise unchanged from the 2026-07-02 verification.

Single workflow, `on: push: branches: [main]`, **four** jobs: a `changes` job (runs first, via
`dorny/paths-filter@v3`) plus the three original jobs below, each now conditionally gated on
`changes`'s output instead of running unconditionally on every push:

| `changes` output | Paths matched | Gates job |
|---|---|---|
| `backend` | `src/**`, `package.json`, `package-lock.json` | `deploy-backend` |
| `dashboard` | `dashboard/**` | `deploy-dashboard` |
| `e2e` | `dashboard/**`, `src/routes/**`, `src/services/**` | `e2e` |
| `workflow` | `.github/**` | all three (OR'd into every job's condition) |

A push touching only `docs/**` or root `*.md` files (no filter pattern above matches) leaves every
output `false` — all three real jobs skip, and the run shows green with nothing deployed. `e2e`
and `deploy-dashboard` both additionally require `deploy-backend.result` to be `success` **or**
`skipped` — a dashboard-only push that correctly skipped `deploy-backend` still lets both of those
jobs run; only an actual `deploy-backend` *failure* blocks them. See `13_DEPLOYMENT.md`'s
"Path-based job filtering" section for the full rationale (why `e2e`'s filter is wider than
`backend`'s, why no `docs` filter is needed).

### 1. `deploy-backend` (blocking gate)

Runs on every push to `main` **that touches `src/**`, `package.json`, `package-lock.json`, or
`.github/**`** (see table above — a dashboard- or docs-only push skips this job entirely), in this
order:

1. Checkout, Node 22 setup (`cache-dependency-path: package-lock.json`).
2. `npm install` (full install, dev deps included — needed for Jest).
3. **`npm test`** — this is the Jest suite. **If this step fails, the job stops here.** Nothing below it
   runs: no Lambda deploy, no S3 upload, no `deploy-dashboard` job (which depends on `deploy-backend` via
   `needs:`), and no `e2e` job (also `needs: [deploy-backend]`). A single failing Jest test blocks both
   backend and frontend deploys.
4. `npm ci --omit=dev` (re-install, prod deps only, for the Lambda package).
5. Verify `node_modules/serverless-http` present (hard-fail guard against a broken prod install).
6. Zip `src/`, `package.json`, `node_modules/` → `deployment.zip`.
7. Upload zip to S3 (`s3://apforce-wa-media/vt-employee-bot-api.zip`).
8. Deploy to **two** Lambda functions from that same S3 object: `vt-employee-bot-api` and
   `vt-employee-bot-ws`.
9. Wait for both functions to report updated.
10. Ensure the campaign-scheduler EventBridge rule exists (`rate(5 minutes)`, target =
    `vt-employee-bot-api`) — `continue-on-error: true`, so a failure here does NOT fail the job.
11. Smoke test: `curl` `https://api.viirtrading.com/health`, must return HTTP 200 or the job fails.

### 2. `e2e` (non-blocking, informational only)

`needs: [changes, deploy-backend]`, gated on `changes.outputs.e2e == 'true'` (or `workflow`) **and**
`deploy-backend.result` being `success` or `skipped`. In the common case (backend + dashboard both
changed) this is unchanged from before: it only starts after backend tests pass and Lambda is
already deployed and smoke-tested. **`continue-on-error: true` at the job level.**

This is a deliberate current tradeoff, not an oversight — but it's one a CTO should know explicitly:
**a failing E2E run does not fail the workflow and does not block `deploy-dashboard`.** The dashboard will
deploy to Vercel regardless of whether the Playwright smoke tests pass. E2E today is purely a signal
(uploaded as a `playwright-report` artifact, 7-day retention, only on failure) — not a gate. If this
needs to become a real gate later, that's a one-line change (`continue-on-error: false`), but doing so
without first hardening the specs (they hit the live `https://api.viirtrading.com` backend, not a
sandboxed one — see Known gaps) risks blocking dashboard deploys on flaky network/live-data conditions.

Steps: Node 24 (matches local lockfile generation per commit `4b64a9e`), `npm install`,
`npx playwright install --with-deps chromium`, `npm run test:e2e` with `E2E_BASE_URL=http://localhost:3001`
and `NEXT_PUBLIC_API_URL=https://api.viirtrading.com` — i.e. **CI E2E runs the dashboard locally
(`next dev` via `webServer`) but points it at the real production-domain backend API**, using
`E2E_EMAIL`/`E2E_PASSWORD`/`E2E_TOTP_SECRET` GitHub secrets for a real login.

### 3. `deploy-dashboard`

`needs: [changes, deploy-backend]`, gated on `changes.outputs.dashboard == 'true'` (or `workflow`)
**and** `deploy-backend.result` being `success` or `skipped` — **not** `needs: [deploy-backend,
e2e]`. Runs in parallel with (or regardless of the outcome of) the `e2e` job. Installs Vercel CLI,
`vercel deploy --prod`. This is the concrete mechanism behind "E2E doesn't block deploys": there is
no `needs: e2e` anywhere in the file.

### Summary of what blocks what

| Failure / condition | Blocks Lambda deploy? | Blocks Vercel deploy? |
|---|---|---|
| Jest test fails (`npm test` in `deploy-backend`) | Yes | Yes (dashboard job needs `deploy-backend` to succeed-or-skip; a real failure is neither) |
| `/health` smoke-test curl fails | Yes (job fails at that step, but Lambda code was already pushed in step 8 — see caveat below) | Yes |
| Playwright E2E fails | No | No |
| EventBridge rule step fails | No (`continue-on-error: true`) | No |
| Push touches only `dashboard/**` (no backend/workflow paths) | `deploy-backend` skips (not a failure) — Lambda simply isn't touched | No — `deploy-dashboard` still runs, since `deploy-backend` "skipped" satisfies its gate |
| Push touches only `docs/**` or root `*.md` | All three jobs skip — nothing deploys, run is green | Same |

Caveat worth flagging: the Lambda `update-function-code` calls happen (step 8) **before** the `/health`
smoke test (step 11). If the smoke test fails, the new code is already live on both Lambdas — the workflow
goes red, but it is not a deploy-blocking gate in the sense of "bad code never reaches Lambda." It's a
post-deploy verification that fails the *pipeline*, not a pre-deploy gate. Treat a red smoke-test step as
"already deployed, and it's unhealthy" — not "rolled back."

---

## Known gaps

These are real, observed absences — not speculation. Verified by grep across `tests/*.test.js` for
references to each file/module.

### No HTTP/route-level integration tests at all
Every one of the 433 Jest tests is a unit test against a service, repository, util, or middleware function
directly (mocked DynamoDB via `jest.mock`, no Express app instantiated, no `supertest`). **Not one file
under `src/routes/` is exercised by an automated test** — confirmed by grep: `ai.js`, `badges.js`,
`telegram.js`, `compensation.js`, `points.js`, `companies.js`, `platform.js`, `admin.js`, `analytics.js`,
`audit.js`, `tags.js`, `metrics.js`, `attendance.js`, `auth.js`, `contacts.js`, `forms.js`, `crm.js`,
`automations.js`, `whatsapp.js`, `campaigns.js` — none appear as an import or literal path in any test
file. `auth.test.js` tests `src/middleware/auth.js` (the JWT-checking middleware function), which is not
the same thing as testing `src/routes/auth.js` (the login/2FA route handlers). There is no `supertest` (or
equivalent) dependency in `package.json` at all — the tooling to write this kind of test isn't even
installed yet.

Practical effect: route wiring, request validation, status codes, and response shapes are verified only by
Playwright E2E (which covers 5 page-load smoke checks) and by production traffic. A route handler that
calls a service with the wrong arguments, or forgets to `await`, or returns the wrong HTTP status, has no
automated test that would catch it before Lambda.

### ADR-012's own choke point — `WhatsAppSendService.js` — is untested
Zero references in `tests/*.test.js` to `WhatsAppSendService`. This is the file ADR-012 designates as the
**only** legal path for outbound WhatsApp sends (`sendText`, `sendTemplate`, `sendInteractive`,
`sendMedia`, plus stubbed `sendCatalog`/`sendPayment`/`sendFlow`/`sendPoll`/`sendLocation`/`sendContact`).
499 lines, no unit test coverage. Given the ADR explicitly centralizes all outbound send logic here as a
compliance/correctness gate, this is the single highest-value gap to close — a regression in this file
silently breaks every outbound message type at once, and nothing in CI would catch it before Lambda.

### ADR-013's own resolver — `CustomerIdentityService.js` — is untested
Zero references in `tests/*.test.js`. 537 lines. ADR-013 mandates this as the sole path for customer
creation/dedup (`resolveOrCreate()`), replacing ad-hoc GSI-lookup-plus-put patterns in route handlers. Its
own migration-status section (in `CLAUDE.md`) lists three routes still non-compliant with it
(`whatsapp.js:1360`, `crm.js:841`, `contacts.js`) — none of that migration status, nor the service's core
dedup/normalization logic itself, is verified by any test.

### `AutomationEngine.js` — untested
Zero references in `tests/*.test.js`. 388 lines.

### `CampaignScheduler.js` and the campaign launch flow — untested
Zero references in `tests/*.test.js`. `CampaignScheduler.js` (76 lines) is the EventBridge-triggered
(`rate(5 minutes)`) sweep documented in `docs/adr/ADR-014-campaign-scheduler-scan.md` — a `Scan`-based
due-campaign finder with explicit constraints (must use `ProjectionExpression`, must stay filtered to
`begins_with(SK, 'CAMP#')`, must batch — see `BATCH_SIZE`) that a regression could silently violate (e.g.
widening the scan filter, or removing the projection and scanning full items) with no test to catch it.
`src/routes/campaigns.js` (530 lines) — including `_buildAudience()` (the audience-preview/launch-time
lead scan referenced in ADR-014) and the launch flow itself — also has no test coverage. Playwright's
`campaigns loads` and `templates tab loads inside campaigns` specs only assert the campaigns *page*
renders; they don't create, schedule, or launch a campaign.

### No API-level (as opposed to unit-level) integration tests anywhere
Confirms item 6 from the verification pass: there is no test in this repo — Jest or Playwright — that
sends a real (or supertest-mocked) HTTP request into an Express route and asserts on the HTTP response.
Jest tests stop at the service/repo/util boundary. Playwright tests only assert on rendered DOM state
after full-stack page loads; they don't assert on API response bodies/status codes directly. There is a
real gap between "unit tests pass" and "the API contract is correct," and nothing today closes it
automatically.

### E2E covers 5 pages, not the workflows those pages exist for
The existing Playwright specs are load/auth smoke checks (sidebar renders, no login-bounce). They do not:
send or receive a WhatsApp message in the inbox, create/edit/delete a contact, move a CRM stage, create a
task, upload a document, or launch a campaign end-to-end. If any of those workflows regress at the UI
layer, E2E will not catch it — and as noted above, even if a spec existed and failed, it wouldn't block
deploy today (`continue-on-error: true`).

### No coverage measurement
No `--coverage` flag anywhere (local docs above or CI). There's no `coverage/` output, no threshold, no
badge. "433 tests passing" is a count of assertions made, not a measurement of what fraction of `src/` is
exercised. Given the gaps above (entire services and all routes at 0%), a coverage report — if generated —
would likely reveal the overall backend `src/` percentage is far lower than "18 suites, all green" implies
on its own.
