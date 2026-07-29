# Password Reset Production Sign-Off

**Date:** 2026-07-29
**Feature commits:** `25b1b13` (backend, 2026-07-25), `455aa24` (frontend, 2026-07-25)
**Observability commit:** `366d4b6` (2026-07-29)

---

## Overview

- Feature completed — self-service "forgot password" / "reset password" is fully implemented,
  backend and frontend, since 2026-07-25.
- Production validated — the full flow was exercised end-to-end against the real production API
  (`https://api.viirtrading.com`), real AWS SES, and real production DynamoDB on 2026-07-29, after
  fixing one live infrastructure defect (see **Root Cause Found** below).
- Ready for deployment — all code involved (feature + observability enhancement) is committed
  locally on `main`; nothing has been pushed yet. This document is part of the pre-push sign-off.

---

## Architecture

**Password reset request flow** (`POST /api/auth/forgot-password`, `src/routes/auth.js`):
1. Client submits an email address.
2. The route looks up the account via `findUserByEmail()`. Regardless of whether the account
   exists, is inactive, or the lookup fails, the route returns one identical generic response —
   only a real, active account triggers the steps below.
3. For a real, active account: `PasswordResetService.createResetToken(user)` then
   `PasswordResetService.sendResetEmail(user.email, token, { companyId, userId })`.

**Token generation & DynamoDB storage** (`src/services/PasswordResetService.js`):
- `generateToken()` — 256-bit token from Node's CSPRNG (`crypto.randomBytes(32).toString('hex')`),
  not derived from any guessable input.
- `createResetToken(user)` writes one item to the shared metrics table
  (`PK`/`SK` from `pwResetPK(token)`/`pwResetSK()`, `src/core/entityKeys.js`), storing
  `employeeId`, `email`, `companyId`, `createdAt`, `expiresAt` (45 minutes out), and a DynamoDB
  `ttl` field for eventual cleanup (the `expiresAt` field, not `ttl`, is the actual security
  boundary — checked explicitly on every use).

**Amazon SES delivery** (`src/config/ses.js`, `PasswordResetService.sendResetEmail()`):
- `Source`: `SES_FROM_ADDRESS` (env var, defaults to `noreply@apforce.in` — the verified domain).
- `Destination`: the requesting user's email.
- Plain-text + HTML body containing the reset link and expiry notice.
- Send failures are caught and logged, never surfaced to the caller (see **Security Controls**).

**Reset page** (`dashboard/src/app/reset-password/page.tsx`, served at
`https://app.apforce.in/reset-password?token=...`): accepts the token from the query string,
collects a new password, and calls `POST /api/auth/reset-password`.

**Password update** (`POST /api/auth/reset-password`):
1. `PasswordResetService.validateAndClaimToken(token)` — validates and atomically claims the token
   in one call (see **Security Controls**).
2. On a valid claim: bcrypt-hashes the new password, updates the employee record, resets any login
   lockout, and logs an audit event.
3. On an invalid claim (missing/expired/already-used — deliberately not distinguished): a single
   generic `400` error.

**Login verification**: the updated password is immediately usable via the existing
`POST /api/auth/login`; the previous password is immediately rejected.

---

## Security Controls

- **256-bit CSPRNG token** — `crypto.randomBytes(32)`, not predictable, not derived from user/time data.
- **Token stored server-side, never re-derivable from the link alone** — the DynamoDB item is the
  sole source of truth; the link only carries the opaque token value.
- **45-minute expiry** — `TOKEN_TTL_MS`, checked explicitly against `expiresAt` on every use
  (independent of DynamoDB's own TTL cleanup, which is best-effort/eventual and not relied on for
  the actual security boundary).
- **Single-use token** — atomic conditional claim: `UPDATE ... SET usedAt = :now` with
  `ConditionExpression: attribute_not_exists(usedAt)`, so two concurrent redemption attempts on the
  same token cannot both succeed (race-safe, not just check-then-act).
- **Generic API responses** — `POST /forgot-password` returns the identical
  `{ success: true, message: "If that email is registered, we've sent a reset link." }` regardless
  of whether the account exists, is inactive, or the SES send itself failed. `POST /reset-password`
  returns the identical generic `400` for a missing, expired, or already-used token. Both are
  deliberate anti-enumeration measures.
- **Password hashing** — bcrypt (`bcryptjs`, cost factor matching the rest of the codebase), never
  stored or logged in plaintext.
- **Audit logging** — every request (success and no-such-account/inactive-account branches) writes
  an audit record via `logAudit()`.
- **Rate limiting** — `passwordResetRateLimiter` (`src/middleware/rateLimiter.js`): max 3 requests
  per email per 15-minute window (DynamoDB-backed, not in-memory — correct for a multi-instance
  Lambda deployment), layered under the route's own generic per-IP `rateLimit(10, 60_000)`.

**Known, deliberate, already-accepted residual gap** (not introduced by this sign-off, not fixed
here): `POST /forgot-password`'s response *timing* still differs slightly between a real account
(extra DynamoDB write + SES call) and a non-existent one — a theoretical timing side-channel,
flagged in code comments as an accepted trade-off rather than silently patched.

---

## AWS Infrastructure

- **Amazon SES** — Production Access confirmed **enabled** (`ProductionAccessEnabled: true`,
  `SendingEnabled: true`, `EnforcementStatus: HEALTHY`), 50,000/24h send quota, 14/s max rate.
- **Domain:** `apforce.in` — `VerificationStatus: SUCCESS`.
- **DKIM:** enabled and signing (`SigningEnabled: true`, `Status: SUCCESS`, RSA 2048-bit).
- **Sandbox removed** — confirmed via `aws sesv2 get-account`; previously sandbox mode meant sends
  only succeeded to individually-pre-verified recipients.
- **IAM policy added for the Lambda execution role** (`vt-employee-bot-lambda-role`), inline policy
  `vt-employee-bot-ses-access`:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["ses:SendEmail", "ses:SendRawEmail"],
        "Resource": [
          "arn:aws:ses:ap-south-1:657672949684:identity/apforce.in",
          "arn:aws:ses:ap-south-1:657672949684:configuration-set/my-first-configuration-set"
        ]
      }
    ]
  }
  ```

---

## Production Validation

All checks below were performed live against the production API (`https://api.viirtrading.com`),
production DynamoDB, and production SES — not a local or mocked environment.

| Check | Result | Notes |
|---|---|---|
| Forgot Password API | ✓ PASS | `POST /forgot-password` → `200`, generic response, real admin account (`emp_1781596612438`) |
| SES email delivery | ✓ PASS | No error in CloudWatch after the IAM fix (see Root Cause below) |
| Email received in Inbox | ✓ PASS | Confirmed directly by the account owner |
| Reset link opened | ✓ PASS | `https://app.apforce.in/reset-password` confirmed live (`200`), including with a token query param |
| Password updated | ✓ PASS | Verified via an isolated, disposable test account created specifically for this purpose — deliberately **not** the real admin account, so production credentials were never at risk during mechanical verification |
| Login with new password | ✓ PASS | Same isolated test account: new password accepted (`200`), old password rejected (`401`) |
| Single-use enforcement | ✓ PASS | Same token redeemed twice on the isolated test account: first `{valid:true}`, immediate second `{valid:false}` |
| Expiry enforcement | ✓ PASS | A fresh token's `expiresAt` was forced into the past; redemption correctly rejected (`{valid:false}`) |
| Audit log | ✓ PASS | `password_reset_requested` audit entries confirmed in CloudWatch for the real admin account |
| CloudWatch verification | ✓ PASS | Direct log inspection at every step — see Root Cause section for the exact error lines found and resolved |

---

## Root Cause Found

**Initial failure:**
```
PasswordResetService: SES send failed (code: AccessDenied, status: 403)
User `arn:aws:sts::657672949684:assumed-role/vt-employee-bot-lambda-role/vt-employee-bot-api'
is not authorized to perform `ses:SendEmail' on resource
`arn:aws:ses:ap-south-1:657672949684:identity/apforce.in'
```
The Lambda execution role had no `ses:*` permission at all — confirmed by listing its attached
(`AWSLambdaBasicExecutionRole`, logs-only) and inline policies (WebSocket/Bedrock/DynamoDB/S3
access, none SES-related). SES itself was fully production-ready; the role simply had never been
granted permission to call it.

**First resolution attempt — partial:** added inline policy `vt-employee-bot-ses-access` scoped to
the `apforce.in` identity ARN. Retesting surfaced a **second, distinct** `AccessDenied` on a
different resource:
```
... is not authorized to perform `ses:SendEmail' on resource
`arn:aws:ses:ap-south-1:657672949684:configuration-set/my-first-configuration-set'
```
The `apforce.in` identity has a default configuration set attached; SES requires a separate IAM
permission on that configuration-set resource in addition to the identity resource.

**Final resolution:** updated the same inline policy to grant `ses:SendEmail`/`ses:SendRawEmail`
on **both** resources (identity + configuration set). Retested — no error logged, real end-to-end
delivery confirmed by the recipient.

---

## Observability

**Enhancement:** SES `MessageId` logging on every successful send (`366d4b6`,
`src/services/PasswordResetService.js`).

**Logged fields:**
- `messageId`
- `template`
- `companyId`
- `userId`

**Not logged:**
- reset token
- reset URL
- password
- email body
- secrets (AWS credentials, SES request internals, etc.)

This is an additive, observability-only change: `sendResetEmail()` gained one new optional
parameter (`meta`, default `{}`); the SES request, the return value, and the entire error/catch
path are unchanged. Verified via the existing `tests/passwordReset.test.js` (16/16 passing,
unchanged) plus the full backend suite (142/143 suites, 2271/2273 tests — identical to the
pre-change baseline) and one live functional check against real SES producing a real `MessageId`.

---

## Final Status

**Production Ready**

**Status:** PASS

**Deployment Recommendation:** Approved for Production.

---

## Files Changed

Feature (2026-07-25, already on `main` prior to this sign-off):
- `src/routes/auth.js` — `POST /forgot-password`, `POST /reset-password`
- `src/services/PasswordResetService.js`
- `src/config/ses.js`
- `src/utils/validation.js` — `forgotPasswordSchema`, `resetPasswordSchema`
- `dashboard/src/app/reset-password/page.tsx`
- `dashboard/src/app/forgot-password/page.tsx`
- `tests/passwordReset.test.js`

Observability enhancement (2026-07-29, this sign-off):
- `src/services/PasswordResetService.js` — SES MessageId logging
- `src/routes/auth.js` — pass `{ companyId, userId }` metadata through

Infrastructure (AWS, not a repo file):
- IAM inline policy `vt-employee-bot-ses-access` on role `vt-employee-bot-lambda-role`

Documentation (this sign-off):
- `docs/reports/PASSWORD_RESET_PRODUCTION_SIGNOFF_2026-07-29.md` (this file)
- `docs/bible/08_MODULES.md`
- `docs/bible/09_API_GUIDE.md`
- `docs/bible/11_SECURITY.md`

---

## Commit History

```
366d4b6 feat(auth): log SES MessageId for password reset emails
```

(Feature commits `25b1b13` and `455aa24`, 2026-07-25, predate this sign-off and are unchanged by it.)
