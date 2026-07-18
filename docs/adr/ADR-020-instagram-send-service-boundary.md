# ADR-020 — Instagram Send Service Boundary

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Engineering + business owner (scope narrowed to "lightweight, no CRM" mid-implementation — see Context)

---

## Context

Instagram DM automation is APForce's second messaging channel, added after a
dedicated audit (2026-07-18, verified against Meta's live Instagram
Messaging API docs and cross-checked against two real reference
implementations, not assumed) found the trigger layer largely reusable but
identified one blocking architectural question: `CustomerIdentityService`
(ADR-013) hard-requires a phone number, and Instagram never provides one —
it gives an opaque IGSID instead.

The business owner resolved this explicitly, mid-planning, with a locked
decision: **Instagram is lightweight only, no CRM integration.** Instagram
contacts are never `LEAD#` records. `CustomerIdentityService.js` is not
touched by this feature at all — no phone-or-igsid relaxation, no new lock,
no lead-item fields. This ADR governs the send/webhook boundary that
decision left standing.

---

## Decision

### Rule 1 — All Instagram Graph API calls go through `InstagramSendService` (sends) and `igGraphApiHelpers` (config)

`src/services/InstagramSendService.js` is the single entry point for every
outbound Instagram DM. Sibling to `WhatsAppSendService`, not an extension —
same relationship as `FlowManagementService`/`CapiService`: a different call
shape (`POST /{ig_business_account_id}/messages`, an Instagram Login token,
`graph.instagram.com` not `graph.facebook.com`), and ADR-012 governs
WhatsApp sends only. `InstagramSendService` never sends WhatsApp messages;
`WhatsAppSendService` is never touched by this feature.

### Rule 2 — Instagram contacts are `IGCONTACT#` records, never `LEAD#`

`src/services/InstagramContactService.js` owns get-or-create for
`IGCONTACT#{companyId}#{igsid}`/`CURRENT` — a deliberately minimal shape (no
stage, no assignedTo, no pipeline, no CRM fields of any kind).
`CustomerIdentityService.js`/ADR-013 is not involved and not modified.
Simpler than CIS by construction: an IGSID is a single Meta-issued canonical
identity with no normalization ambiguity, so no idempotency-lock/TransactWrite
machinery is needed — a conditional-put-if-absent is sufficient.

### Rule 3 — A dedicated webhook route, not a shared-route branch

`src/routes/instagram.js` is a standalone route (`/api/instagram/webhook`),
not a branch inside `whatsapp.js`'s `/webhook` — a validation-pass decision:
a wrong-shaped payload hitting the wrong parser degrades to a visible 200
no-op in a dedicated route, versus a silent one in a shared route with no
prior shape check. Internally, the route branches on `entry.changes[]`
(comments — WhatsApp-Cloud-API-shaped, v1 stub) vs `entry.messaging[]`
(DMs/story-events — Messenger-Platform-shaped, v1's real path) — confirmed
by direct reference-implementation code read, not assumed from Meta's docs
alone.

### Rule 4 — v1 is DM-keyword-reply only; everything else is a structural stub

Comment-to-DM, story reply, and story mention are logged and 200'd, not
processed — the route and webhook payload branches are shaped so v2 doesn't
require a redesign, only filling in the stubbed branches.
`keyword_message` fires unmodified (its matcher is pure string-matching,
proven channel-blind by direct code read) against a context sourced from
`IGCONTACT#`, not a lead — no `leadPK`/`stage`/`assignedTo`, and no
CRM-lifecycle triggers (`lead_created`/`tag_added`/`stage_changed`) fire for
Instagram at all. The one new engine capability is `send_instagram_message`
(plain text only — no WhatsApp send concept beyond plain text has a 1:1
Instagram equivalent per the audit).

### Rule 5 — Credentials: `CONFIG#IG#{companyId}`, Instagram API with Instagram Login

Per-company credentials live in `CONFIG#IG#{companyId}`/`CURRENT`
(`igGraphApiHelpers.js`, sibling to `graphApiHelpers.js`) — `accessToken`,
`tokenExpiresAt`, `igBusinessAccountId`, `igUsername`. Uses the Instagram API
with Instagram Login permission family (`instagram_business_basic` +
`instagram_business_manage_messages`), which doesn't require a linked
Facebook Page — the simpler of the two live families, matching the
cross-checked reference implementation. Its own
`INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET`, deliberately not
`META_APP_ID`/`META_APP_SECRET` (scoped to the Facebook-Login-style WABA Tech
Provider app). A reverse index (`CONFIG#IGID#{igBusinessAccountId}`) resolves
the webhook's `entry.id` to a `companyId`, mirroring WhatsApp's
`CONFIG#PHONEID#`.

### Rule 6 — Tokens are long-lived (60 days) and refreshed on a scheduled sweep

Unlike WhatsApp's Tech-Provider-issued tokens, Instagram Login tokens expire
and must be refreshed. `InstagramTokenScheduler.js` rides the existing
5-minute EventBridge tick (no new AWS provisioning), self-throttled to once
daily via a cursor item (same pattern as `LeadScoringScheduler.js`),
refreshing any token expiring within 7 days.

### Rule 7 — Signature verification is non-negotiable, reused unmodified

`verifyMetaWebhookSignature()` is genuinely product-agnostic (validates
against the app secret regardless of which Meta product delivered the
webhook) and is called first, unconditionally, in the POST handler — same
guarantee as `whatsapp.js`'s webhook. Its own dedicated verify token
(`META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN`) is intentionally separate from
WhatsApp's, so either product's webhook subscription can rotate
independently.

---

## Consequences

### Positive

A second channel that reuses the CRM-trigger layer with zero engine changes;
the identity question that would have made this a large parallel-build
effort is sidestepped entirely by the lightweight decision; the webhook
route's stub branches make v2 (comment-to-DM, story reply/mention) additive,
not a redesign.

### Constraints

- `InstagramSendService.js`/`InstagramContactService.js` must have no
  `require()` on `CustomerIdentityService.js` or `WhatsAppSendService.js` —
  the two are architecturally unrelated by design.
- v1 is genuinely headless: no dashboard surface reads
  `IGCONTACT#`/conversation history. If a "view Instagram conversations"
  screen is ever needed, that is a deliberate future decision, not built now.
- The `/oauth/authorize` dialog URL/params are the standard documented shape
  for the Instagram Login family; not independently doc-fetched this
  session (the token-exchange URLs were, against a real reference
  implementation) — smoke-test against the live Meta App Dashboard config
  before production use.
- `tag_added`/`stage_changed`/`lead_created` do not exist for Instagram
  contacts — any future feature wanting CRM-style automation on Instagram
  contacts requires either extending `IGCONTACT#` with its own trigger types
  or revisiting the "lightweight, no CRM" decision.

---

## Related

- ADR-012 — governs WhatsApp sends only; the precedent for this being a
  sibling, not an extension
- ADR-019 — `CapiService`, the structural template this mirrors (gate,
  `_metaError`, per-call Bearer auth, sibling doctrine)
- `src/services/FlowManagementService.js` — credential-gate pattern origin
- `src/core/entityKeys.js` — `igConfigPK`/`igIdConfigPK`/`igContactPK`
- `docs/bible/19_DECISION_LOG.md` Era 54 — the implementation record,
  including the mid-planning scope correction (CRM integration → lightweight)
