# ADR-023 — Password Reset Does Not Invalidate Existing Sessions (Known Gap)

**Status:** Accepted (gap acknowledged, fix deferred)
**Date:** 2026-07-25
**Deciders:** Engineering — surfaced during adversarial security review of the new self-service
password reset feature; confirmed to be a pre-existing gap, not something the new feature introduced.

---

## Context

APForce's auth is stateless JWT: a 1-hour access token and a 30-day refresh token, both signed at
login (`src/routes/auth.js`'s `issueTokens()`). `authMiddleware` (`src/middleware/auth.js:6-37`)
validates signature and expiry only — `jwt.verify(token, JWT_SECRET)`, no DynamoDB call, no
per-request revocation check of any kind. `POST /refresh` is the only DB-backed gate anywhere in the
JWT flow, and it checks exactly one thing on the employee record: `result.Item.status !== 'active'`.
It does not check when the password was last changed, and neither password-reset path — the new
self-service flow (`POST /reset-password`, `src/services/PasswordResetService.js`) nor the
pre-existing admin-initiated `PUT /employees/:id/reset-password` (`src/routes/admin.js`) — touches
`status`, rotates a signing secret, or writes anything an existing token's validity could be
conditioned on.

**Net effect:** resetting a password — self-service or admin-initiated — does not invalidate any
access or refresh token issued before the reset. An access token keeps working for up to its
remaining 1-hour lifetime; a refresh token keeps working for up to its remaining 30-day lifetime,
silently re-minting fresh access tokens the whole time via `/refresh`, because that route's only
check (`status === 'active'`) is unaffected by a password change. If the reason for the reset was a
compromised credential, an attacker already holding a valid token from before the reset keeps a
working session after it — undermining the reset's purpose in exactly the scenario it exists to
cover.

This is a pre-existing architectural gap. It was already true of the admin-initiated reset path
before this session; the new self-service flow inherits it rather than causing it, which is why it's
being formally recorded now instead of left as an unrecorded assumption.

---

## Decision

Accept this gap for now, explicitly and on the record, rather than block the self-service password
reset feature on fixing it. Do not paper over it with a partial mechanism scoped only to
`/reset-password` (e.g. a resetPassword-only session-kill) — any real fix must cover both reset
paths and any future credential-change action uniformly, or it just becomes another gap of the same
shape.

**The real fix, when undertaken:** add a `tokenVersion` (or `passwordChangedAt`) claim to both access
and refresh tokens at issuance, and store the current value on the employee record. Check it in two
places:

1. `authMiddleware` — so a stale access token is rejected on its very next request, not just at its
   natural 1-hour expiry.
2. `POST /refresh` — so a stale refresh token can never mint a new access token.

Any credential-change path (self-service reset, admin reset, and — if ever added — an explicit
"log out all other sessions" action) bumps the stored value once, which invalidates every
previously-issued token in a single write. No token blocklist, no additional DynamoDB table, no
change to the stateless-JWT model itself — just one more field checked at the two points that already
do a DB-backed check today (`/refresh`) or would need one added (`authMiddleware`, which currently
has none).

---

## Revisit trigger

Revisit before onboarding customer #5+, before any BFSI security audit, or immediately on any
suspected credential compromise — whichever comes first. "No incident yet" is not evidence this is
safe to leave indefinitely; the triggers above are the actual gate, not a vague someday.

---

## Related

- `docs/phase3/TECHNICAL_DEBT.md` — `/forgot-password` timing side-channel entry, found in the same
  adversarial review as this gap
- `src/routes/auth.js` — `issueTokens()`, `POST /refresh`, `POST /forgot-password` / `POST
  /reset-password`
- `src/middleware/auth.js` — `authMiddleware`
- `src/services/PasswordResetService.js` — the new self-service token lifecycle that inherits, not
  introduces, this gap
- `src/routes/admin.js` — `PUT /employees/:id/reset-password`, the pre-existing admin-initiated path
  with the identical gap
