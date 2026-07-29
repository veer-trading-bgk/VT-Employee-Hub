# ADR-024 — Embedded Signup: A Third WABA-Connect Method

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Engineering

---

## Context

APForce had two ways for a company to connect its WhatsApp Business Account before this ADR, both
requiring the admin to already have a WABA and know how to find its IDs:

1. **Manual connect** (`POST /manual-connect`) — paste a System User access token + Phone Number ID
   directly; APForce auto-discovers the WABA ID where possible.
2. **Classic OAuth** (`GET /auth/init` / `GET /auth/callback`) — a plain `facebook.com/dialog/oauth`
   dialog, followed by server-side discovery calls (`/me` → `/{userId}/whatsapp_business_accounts` →
   `/{wabaId}/phone_numbers`) to find the first WABA/phone number on the authenticated user's account.

Neither is Meta's actual **Embedded Signup** product — the hosted flow where Meta itself renders
Business Manager creation/selection, WABA creation/selection, and Phone Number creation/selection
inside its own popup (`FB.login()` with a `config_id`), so a brand-new customer with zero prior
Meta/WhatsApp setup can connect without ever leaving APForce or needing to know what a WABA is.
`docs/PENDING_WORK.md` explicitly flagged this gap so it wouldn't be mistaken for already built.

PR 7 adds Embedded Signup as a genuinely new, third connect method.

---

## Decision

**Add Embedded Signup as a third `setupMethod` (`'embedded_signup'`), alongside — not replacing —
`'manual'` and `'oauth'`.**

Embedded Signup requires a Meta-side `config_id` (created once per Meta app, in the App Dashboard)
and, in practice, Tech Provider status for a fully self-serve multi-tenant rollout. Not every
deployment or environment will have this configured. `manual`/`oauth` remain the fallback whenever
`META_APP_ID`/`META_EMBEDDED_SIGNUP_CONFIG_ID` aren't both set — the new connect button on the
Settings → WhatsApp page disables itself with an inline message rather than the feature silently
being the only way to connect.

### The pipeline is orchestration, not a Graph-helper — kept in a new service, not `graphApiHelpers.js`

`src/services/graphApiHelpers.js` is the established single home for **generic, reusable Meta Graph
API helpers** shared by all three connect methods (`subscribeWabaWebhooks`, `registerPhoneNumber`,
`getBusinessProfile`, `computeHealthSnapshot`, etc.) — every one of them takes a `cfg` and performs
one Meta operation. Embedded Signup's automatic configuration pipeline is a different kind of
thing: a **stateful, resumable orchestrator** that chains several of those helpers together and
persists step-by-step progress to DynamoDB. Mixing that concern into `graphApiHelpers.js` would
blur its "pure helper" shape for every other caller. It lives in a new
`src/services/EmbeddedSignupService.js` instead, which itself calls into `graphApiHelpers.js` for
every individual Meta operation (`subscribeWabaWebhooks`, `registerPhoneNumber`,
`getBusinessProfile`, the newly-extracted `syncTemplatesFromMeta`, `computeHealthSnapshot`) —
reusing all of it unchanged.

There is deliberately **no automatic "send a test message" pipeline step** — the pipeline has no
destination phone number to send to. Messaging capability is covered by the `healthCheck` step's
own `capabilities.messaging`/`token.valid` fields; the already-shipped Send Test Message button
(PR 5, `POST /send-test`) is what a user clicks after onboarding to prove sending end-to-end, per
this feature's own acceptance criteria ("Click Send Test Message... successfully send a message").

### Access tokens: encrypt new tokens only, never migrate old ones

`src/utils/encryption.js` (AES-256-CBC, `ENCRYPTION_KEY`) already exists but, before this ADR, was
used only for 2FA backup codes — every `accessToken` written by `manual-connect`/`auth/callback`/
`PUT /config` has always been plaintext in DynamoDB. Embedded Signup's `runOnboardingPipeline()` is
the **only** write path that encrypts (`accessTokenEncrypted: true`); `manual`/`oauth` connects are
untouched, on purpose — no migration, no behavior change, no risk to companies already connected.

This is safe to do without touching any other file because every reader of `cfg.accessToken` in the
codebase (`WhatsAppSendService.js`, `FlowManagementService.js`, every helper in
`graphApiHelpers.js`, `routes/whatsapp.js` itself) obtains `cfg` from `getWabaConfig()` /
`getCachedWabaConfig()` and nowhere else. Decrypting transparently inside `getWabaConfig()` (when
`accessTokenEncrypted` is set) is therefore the single choke point — zero other call site changed.
A decrypt failure (corrupt ciphertext, wrong/rotated `ENCRYPTION_KEY`) fails closed —
`accessToken: null` plus a logged error — rather than throwing, so a problem with one company's
encrypted token can never crash config reads for every other (plaintext) company sharing the same
function.

**Deliberately not done in this PR:** migrating existing plaintext tokens to encrypted form. That's
a separate, higher-risk change (touches every already-connected company, not just new signups) and
was explicitly scoped out — a candidate for a dedicated future PR, not bundled here.

### Step-tracking model (resumability)

`onboardingStatus` on the `CONFIG#WABA#{companyId}` item records `{ startedAt, completedAt, steps }`,
one entry per pipeline step (`persistConfig`, `subscribeWebhooks`, `registerPhone`,
`syncBusinessProfile`, `syncTemplates`, `healthCheck`), each `{ status: pending|done|failed, at,
error? }`. The status is persisted to DynamoDB **after every step**, not just at the end — a step
that throws (network timeout, a transient Meta 5xx) leaves every prior step's success durably
recorded, and `resumeOnboardingPipeline()` re-runs only the steps not yet `done`. This is what makes
"the user closed the tab mid-pipeline" and "one step failed transiently" both recoverable without
redoing Facebook login.

---

## Non-goals

This ADR does not fix `GET /webhook`'s pre-existing gap where webhook-verification only checks the
global `process.env.META_WEBHOOK_VERIFY_TOKEN`, never the per-company `webhookVerifyToken` override
stored on `CONFIG#WABA#{companyId}` (`routes/whatsapp.js`). That gap predates this feature, applies
identically to all three `setupMethod`s, and is out of scope here — flagged so it isn't mistaken for
something Embedded Signup was supposed to close.

This ADR does not migrate existing plaintext `accessToken`s to encrypted form (see above).

---

## Revisit trigger

Revisit the "encrypt new tokens only" decision once a customer count or compliance requirement
(e.g. a BFSI security audit) makes plaintext tokens for pre-existing `manual`/`oauth` companies an
unacceptable residual risk — at that point, a dedicated migration PR should encrypt them in place.

---

## Related

- `src/services/EmbeddedSignupService.js` — the pipeline implementation
- `src/services/graphApiHelpers.js` — `getWabaConfig()`'s decrypt-on-read, `syncTemplatesFromMeta()`
- `src/routes/whatsapp.js` — `GET/POST /embedded-signup/*` routes
- `src/utils/encryption.js` — the pre-existing encryption primitive this reuses
- ADR-012 — outbound WhatsApp messaging (the pipeline has no send step, deliberately; the existing
  Send Test Message path stays the only sender, unchanged)
- `docs/PENDING_WORK.md` — the entry recording that Embedded Signup was previously "not scoped as work"
