# 11 — Security

Status: verified against repo state 2026-07-02 (commit `43b89af`, branch `main`).

**Document type: Hybrid.** Everything above the "POLICY GAPS" section is generated directly from code —
file paths and line behavior are accurate as of the commit above. The POLICY GAPS section is not generated
from code; those are open questions the team has not yet decided. Do not treat anything in that section as
implemented.

---

## Authentication

File: `src/middleware/auth.js`

- Scheme: JWT (`jsonwebtoken`), read from `req.cookies.accessToken` (HttpOnly cookie) or the
  `Authorization: Bearer <token>` header — either is accepted, cookie is checked first.
- Verified with `jwt.verify(token, process.env.JWT_SECRET)`. The secret is a single shared string, not a
  per-tenant key.
- **Access token expiry:** `JWT_EXPIRE` env var, default `'1h'` if unset (`src/routes/auth.js:55`).
- **Refresh token expiry:** hardcoded 30 days (`src/routes/auth.js:60`), signed with a *separate* secret
  (`REFRESH_TOKEN_SECRET`).
- Refresh flow (`POST /api/auth/refresh`, `src/routes/auth.js:328`): reads `refreshToken` cookie, verifies
  it, re-reads the user from DynamoDB (rejects if `status !== 'active'`), and re-issues both tokens. This is
  the only revocation check in the system — an active refresh token for a since-deactivated user is refused,
  but a still-active user's refresh token cannot be revoked early (no denylist/version field).
- Both tokens are set via `Set-Cookie` as `HttpOnly`. `Secure; SameSite=None` in production, `SameSite=Strict`
  otherwise (`cookieAttrs()`, `src/routes/auth.js:35`).
- The JWT payload carries `id, email, role, name, companyId, plan, planStatus, trialEndsAt` — i.e. plan/role
  state is baked into the token at issuance and only refreshed on next login or `/refresh` call. A role or
  plan change made by an admin mid-session does not take effect until the user's token is refreshed.
- **Temp tokens (2FA gate):** login with `totpEnabled: true` issues a 5-minute `{ temp: true }` token instead
  of a full session token (`src/routes/auth.js:127`). `authMiddleware` explicitly rejects any token with
  `temp === true` on protected routes (`auth.js:15-18`) — a temp token cannot be used to bypass 2FA.
- JWT verification failures are branched by error type: `TokenExpiredError` and `JsonWebTokenError` both
  return 401 without detail; any other failure (e.g. missing `JWT_SECRET`) is logged as `logger.error` (real
  bug) rather than `logger.warn` (expected user event).

## Authorization

### Route-level RBAC

File: `src/middleware/auth.js`

Three route guards:

- `adminMiddleware` — allows `role === 'admin'` or `role === 'superadmin'`.
- `platformAdminMiddleware` — allows `role === 'superadmin'` only. Used to gate `src/routes/platform.js`
  (APForce staff/support routes, not tenant-facing).
- `checkRole(allowedRoles)` — allows `superadmin` unconditionally (support/debug override), otherwise
  requires `req.user.role` to be in the given list.

**Full role enumeration** (grepped across `src/routes/*.js` `checkRole()` calls and the `role` enums in
`src/utils/validation.js`):

| Role | Assignable via registration? | Notes |
|---|---|---|
| `superadmin` | No — not in any zod `role` enum | Platform-level, APForce staff only. Bypasses every `checkRole()` check. Gates `src/routes/platform.js` via `platformAdminMiddleware`. |
| `admin` | Yes | Company-level admin. Full access to `src/routes/admin.js` (router-level `adminMiddleware`), most write routes. |
| `manager` | Yes (via `updateEmployeeSchema`, not `registerSchema`) | Broad read/write across CRM, campaigns, automations, WhatsApp config. |
| `team_lead` | Yes | Narrower — e.g. `metrics.js:930` `/my-team` and `metrics.js:949` `/add-for-member`. |
| `agent` | Yes | One of the three `RESTRICTED_ROLES` in `WhatsAppSendService` (see below). |
| `telecaller` | Yes (default role in `registerSchema`) | One of the three `RESTRICTED_ROLES`. |
| `intern` | Yes | One of the three `RESTRICTED_ROLES`. |

Observations:
- `registerSchema` (self-serve employee creation by an admin) only allows assigning
  `admin, manager, team_lead, agent, telecaller, intern` — `superadmin` cannot be created through the
  product. How `superadmin` accounts are actually provisioned is not in the route code (see Policy Gaps).
- Route-level RBAC is applied inconsistently in *where* it's declared: most routers apply `checkRole()`
  per-route (e.g. `whatsapp.js`, `crm.js`, `campaigns.js`); `src/routes/admin.js` instead applies
  `router.use(authMiddleware, adminMiddleware)` once at the top of the file, then does its own **inline**
  tenant-isolation checks per-route (see below) rather than further role branching.
- `src/routes/companies.js` applies `router.use(authMiddleware)` (any authenticated user) and reserves
  `adminMiddleware` only for mutating routes (`PUT /profile`, `GET /onboarding`, `GET /export`) — read of
  `GET /profile` and `GET /trial` is allowed to any role in the company.

### Resource-level authorization (beyond route RBAC)

Route-level RBAC answers "can this role call this endpoint." It does not answer "can this specific user act
on this specific record." Two concrete patterns fill that gap in the current code:

**1. `RESTRICTED_ROLES` in `WhatsAppSendService`** (`src/services/WhatsAppSendService.js:32`,
`:198-206`) — the canonical worked example:

```js
const RESTRICTED_ROLES = new Set(['telecaller', 'agent', 'intern']);

_assertSendPermission(user, contact) {
  if (
    RESTRICTED_ROLES.has(user.role) &&
    contact.isLead &&
    contact.leadItem?.assignedTo !== user.id
  ) {
    throw this._err('Not your lead', 403);
  }
}
```

Every `send*` method (`sendText`, `sendTemplate`, `sendInteractive`, `sendMedia`) calls
`resolveContact()` then `_assertSendPermission()` before touching the Meta API. `admin` and `manager` are
*not* in `RESTRICTED_ROLES`, so they can message any lead in the company; `telecaller`/`agent`/`intern` are
blocked with `403 "Not your lead"` unless `leadItem.assignedTo === user.id`. Unknown contacts (`INBOX#`,
`contact.isLead === false`) have no assignment concept, so all roles can reach them — this is a deliberate
gap, not an oversight (see the docstring at line 194-197).

**2. Inline tenant-isolation checks in `src/routes/admin.js`** — every route that operates on a specific
employee record checks `req.user.role !== 'superadmin' && employee.companyId !== req.user.companyId'` (7
occurrences: lines 65, 152, 239, 287, 361, 432, 722) before allowing the operation. This is the
cross-tenant guard: an `admin` at Company A cannot read/edit/delete an employee record belonging to Company
B, but `superadmin` can (support/debug). This check is hand-written per-route, not centralized in a
service — there is no `AdminResourceService` equivalent to `WhatsAppSendService` for this pattern yet.

Both patterns are **ad hoc, not framework-enforced** — a new route author has to remember to add the check;
nothing fails closed by default if they forget.

## Rate Limiting

Files: `src/middleware/rateLimiter.js`, `src/middleware/totpRateLimiter.js`.

Both are DynamoDB-backed (atomic `ADD` update expression + TTL), not in-memory — correct for a
multi-instance Lambda deployment where in-memory counters would be per-container and useless.

**No global rate limit is applied.** There is no `app.use(rateLimit(...))` in `src/app.js`. Rate limiting is
opt-in, added per-route by whoever wrote that route. Concretely:

| Limiter | Scope | Threshold | Window | Applied to |
|---|---|---|---|---|
| `loginRateLimiter` | per-email | 10 failed attempts | 15 min | `POST /api/auth/login` only |
| `totpRateLimitCheck` | per-email | 5 failed attempts | 15 min | `POST /api/auth/verify-totp`, `POST /api/auth/verify-totp-backup` |
| `rateLimit(limit, windowMs)` generic IP limiter | per-IP | varies (5–30 requests) | 60 s (all current call sites) | ~30 specific write routes (see below) — **not applied globally** |

Generic `rateLimit()` call-site thresholds as grepped from `src/routes/*.js` (all use a 60-second window):

- `5` req/min — `whatsapp.js:2166` (`POST /templates/sync`, calls Meta API)
- `10` req/min — `crm.js:662` (delete lead), `crm.js:712` (restore lead), `campaigns.js:125` (audience
  validate), `campaigns.js:515` (campaign launch), `whatsapp.js:2110` (submit template to Meta)
- `20` req/min — most WhatsApp inbox/messaging routes (send, canned responses, pin/resolve/reopen, notes,
  availability, auto-assign, welcome-config), `contacts.js:203` (stage update)
- `30` req/min — lead create (`crm.js:211`), lead update (`crm.js:449`), followup create (`crm.js:789`),
  campaign create/preview (`campaigns.js:102,204`), automation create (`automations.js:110`),
  unknown-contact delete (`contacts.js:160`)

Routes with **no rate limit at all**: essentially everything read-only (all `GET` routes), plus several
write routes that don't chain `rateLimit()` — e.g. `admin.js` employee CRUD, `compensation.js` payroll
writes, `automations.js` status/delete, `tags.js`, `forms.js`. This is a real gap for a multi-tenant SaaS
(e.g. no throttle on `POST /api/admin/employees/:id/setup-2fa` or on CRM stats/export endpoints), not
something the code currently defends against — flagged here as fact, refine-as-policy in the gaps section.

On rate-limiter internal failure (DynamoDB error), both `atomicIncrement()` and `getCount()) fail open
(return 0 / allow the request) rather than fail closed — a DynamoDB outage would silently disable rate
limiting rather than block traffic.

## 2FA / TOTP

Dependency: `speakeasy` (`^2.0.0`, confirmed in `package.json`). QR provisioning via `qrcode`.

- **Optional, not mandatory, for any role.** Enrollment is entirely admin-triggered:
  `POST /api/admin/employees/:id/setup-2fa` (`src/routes/admin.js:349`) — an admin sets up 2FA *for* an
  employee (generates secret + QR + backup codes server-side), not a self-service "enable 2FA for my own
  account" flow initiated by the employee. Reset is symmetric:
  `DELETE /api/admin/employees/:id/2fa` (`admin.js:420`).
- Once `totpEnabled: true` + `totpSecret` are set on a user record, 2FA becomes **mandatory for that user's
  next login** — `src/routes/auth.js:126` checks `user.totpEnabled && user.totpSecret` and forces the
  temp-token/2FA round trip; there's no way to skip it once enabled short of an admin disabling it again.
- Verification: `speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 })` — a ±30s clock
  skew tolerance (`src/routes/auth.js:198-203`).
- **Backup codes**: generated at enrollment, stored AES-256-CBC encrypted (`src/utils/encryption.js`,
  `encrypt()`/`decrypt()`, random IV per value) in the user record's `backupCodes` array. Redeemable once
  each via `POST /api/auth/verify-totp-backup`; marks `used: true` + `usedAt` on redemption. Warns the user
  in the response payload when `unusedCount <= 2`.
- Failed-attempt lockout: shared `totpRateLimiter` — 5 fails / 15 min, alerts APForce admins via Telegram
  bot on lockout (`src/middleware/totpRateLimiter.js:43-47`).
- **Dev-only bypass paths exist** in `verify-totp` (`src/routes/auth.js:190-196`):
  `TOTP_DISABLED_FOR_DEV === 'true'` (accepts any 6-digit code) and `TEST_TOTP_CODE` (accepts one fixed
  code). Both are hard-gated behind `process.env.NODE_ENV !== 'production'` — cannot activate in the
  production Lambda unless `NODE_ENV` itself were misconfigured there.

## Secrets Management

File: `src/config/secrets.js` (`loadSecrets()`).

- **Production**: fetches a single JSON secret blob from AWS Secrets Manager, secret name
  `vt-employee-bot/production` (overridable via `SECRETS_MANAGER_SECRET_NAME`). On success, a fixed
  allowlist of keys is copied into `process.env`:
  `JWT_SECRET, REFRESH_TOKEN_SECRET, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID`. Result
  is cached in a module-level variable for the Lambda container's lifetime (cleared on cold start).
- **If Secrets Manager is unavailable or the secret doesn't exist**, the code catches the error, logs a
  warning, and falls through silently to whatever is already in Lambda's environment variables — it does
  not hard-fail. This means a misconfigured Secrets Manager permission produces no loud error, just a
  console warning.
- **Local dev** (`NODE_ENV !== 'production'`): Secrets Manager is skipped entirely; `dotenv` (`.env` file)
  is the source, per `src/app.js:1`.
- **`scripts/lambda-env.json`** exists and defines the Lambda function's `Environment.Variables` block used
  by the `deploy:env` npm script (`aws lambda update-function-configuration ... --environment
  file://scripts/lambda-env.json`). This file is checked in and, as inspected for this chapter, **currently
  contains live plaintext values** for `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `TELEGRAM_BOT_TOKEN`,
  `ANTHROPIC_API_KEY`, and `ENCRYPTION_KEY`, alongside non-secret config
  (`DYNAMODB_TABLE_*`, `FRONTEND_URL`, `META_WEBHOOK_VERIFY_TOKEN`, `BACKEND_URL`, `SESSION_TIMEOUT_MINUTES`,
  `MAX_LOGIN_ATTEMPTS`, `WA_MEDIA_BUCKET`, `WS_CONNECTIONS_TABLE`, `WS_ENDPOINT`). Values are not reproduced
  in this document. **This is a finding, not a policy question**: a secrets-bearing file lives in the repo
  and (per Lambda's env var model) is also visible in plaintext in the Lambda console/CLI to anyone with
  `lambda:GetFunctionConfiguration` — it bypasses Secrets Manager's access-control and rotation benefits
  entirely for the keys that are also duplicated here. Whether this file is `.gitignore`'d or has ever been
  pushed to the remote was not verified as part of this chapter (git history audit is a separate task) —
  flagged for immediate team follow-up.
- `ENCRYPTION_KEY` (used by `src/utils/encryption.js` for backup-code AES-256-CBC) must be a 64-char hex
  string (32 bytes) — enforced by a runtime `throw` in `getKey()` if malformed or missing, not by any secret
  schema validation.

## CORS

File: `src/app.js:31-54`.

- Origin allowlist, not wildcard. Static list (`STATIC_ORIGINS`):
  `https://app.apforce.in`, `https://dashboard.viirtrading.com`, `https://vt-employee-hub.vercel.app`,
  `http://localhost:3001`, `http://localhost:3000`.
- The last two (`localhost:3001`/`3000`) were added per commit `3ab56b4` (`fix(cors): add
  localhost:3001/3000 to static allowed origins for E2E tests`) — i.e. **local dev/CI origins are
  allowlisted unconditionally in the same static list as production origins**, not gated behind
  `NODE_ENV !== 'production'`. In the current code, `localhost:3000/3001` would also be accepted by the
  production Lambda if a request ever arrived with that `Origin` header (browsers won't send it from a
  real localhost page to a public API in a way that matters for a real attacker, but it's not
  environment-gated — worth a follow-up if the team wants production strictly production-only).
- Additional origins can be appended via `FRONTEND_URL` env var (comma-separated), merged and de-duplicated
  with the static list.
- `credentials: true` is set — required since auth uses HttpOnly cookies, but this is also why the origin
  callback logic matters (cannot combine `credentials: true` with a wildcard origin per the CORS spec, and
  the code correctly avoids that).
- `helmet()` is applied with all defaults — no custom CSP, HSTS, or frame-options overrides found in
  `src/app.js`.

## Input Validation

File: `src/utils/validation.js`. Dependency: `zod` (`^4.4.3`).

- Applied **ad hoc, not consistently**. Confirmed zod schemas exist for: login, registration, TOTP verify,
  backup-code verify, employee update, company signup, metric entry, lead create/update, followup create.
  Each route calls `.parse(req.body)` explicitly (e.g. `src/routes/auth.js:90`,
  `:164`, `:243`, `:376`, `:443`) — validation failures throw a `ZodError`, caught by the route's `next(error)`
  and presumably formatted by a central error handler (`src/middleware/errorHandler.js`, not audited in
  this chapter).
- **Not every route with a request body has a matching schema.** Several `src/routes/*.js` write endpoints
  (e.g. much of `whatsapp.js`'s config/broadcast/template routes, `compensation.js`, `automations.js`) read
  `req.body` fields directly without an accompanying zod `.parse()` call — validation there, if any, is
  inline manual checks (`if (!x) return res.status(400)...`) rather than schema-driven. This chapter does
  not have a complete per-route audit of which write routes lack schemas; treat "zod coverage is partial"
  as the accurate summary rather than an exhaustive list.
- Where schemas exist, they are reasonably strict: PAN/Aadhaar regex formats, 10-digit phone enforcement,
  `.strict()` on `updateEmployeeSchema`/`updateLeadSchema` (rejects unknown keys outright rather than
  silently dropping them), and password complexity rules that **differ between schemas** —
  `registerSchema` requires 12+ chars with uppercase/number/special-char; `loginSchema` only requires 8+
  chars (login obviously can't enforce complexity retroactively, but note this if a "minimum password
  policy" question ever comes up — the two numbers, 8 and 12, both exist in code today).

## Webhook Security

File: `src/routes/whatsapp.js`. **This is a confirmed code fact, not a judgment call.**

- `GET /api/whatsapp/webhook` (`whatsapp.js:1020`) implements Meta's subscription handshake correctly:
  compares `hub.verify_token` query param against `META_WEBHOOK_VERIFY_TOKEN` and echoes `hub.challenge`
  back. This is a one-time setup check, not per-message security.
- `POST /api/whatsapp/webhook` (`whatsapp.js:1102`) — the handler that receives every inbound WhatsApp
  message, delivery/read status, and template status update — **does not verify the `X-Hub-Signature-256`
  header at all.** A repo-wide search for `X-Hub-Signature`, `x-hub-signature`, `hmac`, and `createHmac`
  across `src/` returns zero matches in any webhook-handling code. There is no HMAC-SHA256 check of the raw
  request body against the Meta App Secret anywhere in this codebase.
- **Practical consequence**: any actor who learns or guesses a company's `phoneNumberId` (used to resolve
  `webhookCompanyId` via `getCompanyByPhoneNumberId()`, `whatsapp.js:1178`) can POST an arbitrary,
  Meta-shaped JSON payload directly to this endpoint and have it processed as if it came from Meta —
  fabricated inbound messages written to a real company's inbox, fabricated delivery/read status updates
  applied to real message records, fabricated template-approval-status changes. The endpoint is also
  unauthenticated by design (it must be, webhooks don't carry a session), so the *only* thing that could
  have stood in for "this really came from Meta" is the signature check, and that check is absent.
- Also note in `src/app.js:66`: the code comment explicitly says *"The WhatsApp webhook POST is
  intentionally excluded [from subscriptionMiddleware] — it's inbound, not a user write."* — this confirms
  the omission of signature verification is not a documented, deliberate trade-off; the only documented
  webhook decision on record is about subscription/trial gating, not about authenticity.
- **This is the most significant finding in this chapter.** Recommended remediation (not yet implemented,
  listed here as a fact about what's missing, not as an instruction): verify `X-Hub-Signature-256` using
  `crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')` compared with a
  constant-time comparison (`crypto.timingSafeEqual`) before processing the POST body, per Meta's documented
  webhook security requirements. This requires access to the raw (unparsed) request body, which may require
  adjusting how `express.json()` is applied for this specific route.

## Dependency Posture

- **`aws-sdk` v2** (`^1.1693.0` per `package.json`) is used throughout (`src/config/secrets.js`,
  `src/config/dynamodb.js` and others, not individually re-audited here). AWS SDK for JavaScript v2 is past
  its maintenance end-of-support date; a warning to this effect surfaces in the Jest test output on every
  run. This is maintenance/security debt: v2 no longer receives security patches on the same footing as v3,
  and there's no migration in progress that this chapter's research surfaced.
- Other notable dependencies: `jsonwebtoken ^9.0.3`, `bcryptjs ^3.0.3`, `helmet ^8.2.0`, `zod ^4.4.3`,
  `speakeasy ^2.0.0`, `cors ^2.8.6`. No dependency audit (`npm audit` output) was run as part of this
  chapter — versions above are read directly from `package.json`, not verified against current CVE
  databases.

## XSS / Injection

- **DynamoDB writes**: all data access goes through the AWS SDK's parameterized `put`/`update`/`query`
  calls (`ExpressionAttributeValues`) — no string-concatenated queries were found in the files reviewed for
  this chapter. This is the standard DynamoDB SDK usage pattern and is not injectable the way raw SQL
  string-building would be.
- **Dashboard rendering**: React auto-escapes interpolated content by default. A repo-wide search for
  `dangerouslySetInnerHTML` in `dashboard/` returns exactly one hit:
  `dashboard/src/app/layout.tsx:56` — a hardcoded, non-user-controlled inline script that reads
  `localStorage.getItem('vt-theme')` to prevent a dark/light flash before hydration. The string is a fixed
  literal in the source file, not built from any request or database value — **not an XSS vector**. No other
  `dangerouslySetInnerHTML` usage exists in the dashboard.

## Data Integrity Note (ADR-013 cross-reference)

`CLAUDE.md`'s ADR-013 (`Customer Identity & Recipient Resolution`) mandates that `phoneNorm` /
`to10Digit()`-normalized values are the only permitted basis for comparing or deduplicating customer phone
numbers, and that `company-phone-index` GSI is the only permitted lookup path — no full-table scans, no
in-memory phone maps. This is adjacent to security (it's what makes `WhatsAppSendService.resolveContact()`'s
GSI-based lookup at `WhatsAppSendService.js:173-179` authoritative rather than guessable/spoofable via a
malformed phone string) as well as a data-integrity concern. ADR-013 itself documents three known
non-compliant transition items (`whatsapp.js:1360` unknown-contact path, `crm.js:841` CSV import,
`contacts.js` raw-phone dedup) — these are pre-existing, already-tracked gaps, not new findings from this
chapter.

---

## ⚠️ POLICY GAPS — NEEDS TEAM DECISION

Everything above is derived from reading the code. The items below **cannot** be answered by reading the
code — they are product/security policy decisions the team has not yet recorded anywhere in this repo.
Do not infer answers to these from the implementation; the implementation reflects defaults and convenience,
not a decided policy.

1. **Password policy.** Two different minimum-length/complexity rules currently coexist in code
   (`loginSchema`: 8 chars; `registerSchema`: 12 chars + uppercase/number/special). Is 12-char-complex the
   intended baseline for all accounts? Is there a password expiry/rotation requirement? Is password reuse
   prevented? None of this is decided or enforced today.

2. **Session / token revocation policy.** There is no denylist, no token version field, and no
   "log out all sessions" capability. If an access token or refresh token is compromised, the only
   mitigation today is waiting for the access token to expire (up to 1h) or deactivating the user
   (`status: 'inactive'`), which only blocks the *next* refresh — an already-issued, unexpired access token
   remains valid regardless. Is this acceptable, or does the product need active revocation (e.g. a
   token-version claim checked against a DB value)?

3. **`superadmin` provisioning and governance.** The code shows what `superadmin` can *do* (bypass all
   `checkRole()` checks, access any tenant's data, gate `platform.js`) but nothing about how a `superadmin`
   account is created, who is allowed to hold one, whether its use is logged/reviewed, or what happens if
   one is compromised. This is the single highest-privilege role in the system and currently has zero
   documented governance.

4. **Incident response and disclosure policy.** No runbook, escalation path, or customer-notification
   commitment exists in this repo for what happens if a breach is discovered (e.g. the webhook
   signature-verification gap above, or the secrets-in-`lambda-env.json` finding). Given this product
   handles PII (names, phone numbers, PAN/Aadhaar numbers, chat history) for end customers of AP offices,
   this needs an owner and a written process, not an ad hoc response the first time it's needed.

5. **PII data retention and deletion policy.** This product stores customer phone numbers, names, WhatsApp
   chat history/media (S3), PAN numbers, and Aadhaar numbers indefinitely as far as the code shows — no TTL,
   archival, or right-to-erasure flow was found for lead/contact/message records (contrast with the
   rate-limiter and audit-log tables, which do set DynamoDB `ttl` fields for their own operational data).
   Is there a required retention period? A deletion-on-request obligation (relevant given PAN/Aadhaar are
   regulated identifiers in India)? Who owns fulfilling a deletion request today — there is no `DELETE`
   endpoint found for a customer's full data footprint.

6. **Audit logging requirements.** `src/utils/audit.js` / `logAudit()` is called at many but not all
   sensitive actions (logins, 2FA events, registration, some admin actions) — this chapter did not perform
   a complete audit-coverage matrix. Is there a required minimum set of events that must be audited
   (e.g. every PII read, every cross-tenant `superadmin` access, every export)? How long are audit logs
   retained, and who can read them?

7. **Penetration testing / security review cadence.** No evidence of a scheduled or past third-party
   penetration test, dependency vulnerability scan (`npm audit` / Snyk / Dependabot), or scheduled internal
   security review was found in this repo (no CI step, no `SECURITY.md`, no scan config). Is one planned?
   At what cadence, and triggered by what (e.g. before onboarding a large customer, annually, per major
   release)?

8. **Webhook signature verification — remediation timeline.** This one is a confirmed code gap (see
   "Webhook Security" above), not a philosophical policy question, but *when and how it gets fixed* is a
   team decision: does it block the next deploy, or is it scheduled work? Flagging it here again because it
   is the most actionable, highest-severity item in this entire chapter.

9. **`lambda-env.json` plaintext secrets — handling.** Whether this file should be removed from the repo
   entirely, whether it needs to be purged from git history, and whether any of the values it currently
   contains need to be rotated as a precaution, is a decision for whoever owns infrastructure/secrets — not
   something this chapter can decide unilaterally. Flagged as an action item, not resolved here.
