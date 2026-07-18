# ADR-019 — Conversions API (Meta Signal) Service Boundary

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Engineering + business owner (event-name and dedup mechanics revised from the original spec after doc-verification — see Context)

---

## Context

The "Meta Signal" feature reports CRM conversions (a lead tagged
`demat_opened`, an MF purchase) back to Meta's **Conversions API for Business
Messaging**, so CTWA ad campaigns can optimize on real outcomes instead of
message-opens. This is a new outbound Meta surface: `POST
/{dataset_id}/events`, plus dataset provisioning via `POST /{waba_id}/dataset`.

Two findings from the pre-implementation audit (2026-07-18, verified against
Meta's live docs, not assumed) shaped this ADR and overrode the feature's
original spec:

1. **Meta's business-messaging CAPI accepts a FIXED event list** (Purchase,
   LeadSubmitted, QualifiedLead, InitiateCheckout, AddToCart, ViewContent,
   OrderCreated/Shipped/Delivered/Canceled/Returned, CartAbandoned,
   RatingProvided, ReviewProvided). Custom names ("DematOpened") are
   undocumented/unsupported on this channel — the general web-CAPI "custom
   event" language does not apply to `action_source: business_messaging`.
2. **Meta does not deduplicate business-messaging events** ("Meta does not
   assist with deduplicating events for Conversions API for Business
   Messaging" — verbatim). An `event_id` alone dedups nothing; send-once
   semantics must be enforced client-side.

---

## Decision

### Rule 1 — All Conversions API calls go through `CapiService`

`src/services/CapiService.js` is the single entry point for every dataset
provisioning call and every conversion-event POST APForce makes. No route,
component, or other service calls the dataset/events endpoints directly.
Sibling to `WhatsAppSendService`, not an extension — same relationship as
`FlowManagementService` (WABA-level asset management) and `EmbeddingService`
(ADR-017): a different call shape from message sending, and ADR-012 governs
sends only. `CapiService` never sends WhatsApp messages.

### Rule 2 — The payload constants are hard-coded, never configurable

`action_source: "business_messaging"` and `messaging_channel: "whatsapp"` are
constants inside `CapiService`, asserted by contract tests.
`action_source: "website"` silently breaks CTWA attribution (Meta's most
common CAPI integration bug). `ctwa_clid` rides inside `user_data` UNHASHED
("Do not hash" — Meta's own parameter doc).

### Rule 3 — Event names come from the fixed allowlist

`CapiService.SUPPORTED_EVENTS` (mirrored as `META_SIGNAL_EVENTS` in
`dashboard/src/types/automations.ts` — keep in sync) is the only accepted
`event_name` set, enforced at the service (typed `UNSUPPORTED_EVENT_NAME`
rejection before any Meta call) and presented as a dropdown, never free text,
in the workflow editor. Per-product identity (Demat vs MF vs Insurance) lives
in APForce's tags/workflows, not in invented event names.

### Rule 4 — Once-ever is enforced by a claim-first marker, not by `event_id`

Before any POST, `reportForLead()` writes a permanent claim marker on the
lead's own partition — `SK: CAPI#{metaEventName}`, conditional
`attribute_not_exists(PK)`, **deliberately no TTL** (same reasoning as the
stage-membership `ENROLLED#` marker: an expired claim would let a re-added tag
double-count the conversion at Meta, and per Context #2 Meta will not catch
it). Ordering is load-bearing: the WABA gate and dataset resolution run
BEFORE the claim, so a config failure never burns the claim; only a
post-claim `/events` failure is terminal (not auto-retried, visible in
CAPILOG#). The deterministic `event_id`
(`{companyId}:{leadId}:{metaEventName}`) still rides in the payload as
hygiene.

### Rule 5 — Credentials and gating mirror `FlowManagementService`

Per-company credentials come from `CONFIG#WABA#{companyId}/CURRENT` via
`graphApiHelpers` only. The gate requires `accessToken` AND `wabaId` and a
clean `detectInvalidWabaConfig()` — NOT the send service's
accessToken+phoneNumberId check, because dataset provisioning hangs off the
WABA and the OAuth path can legitimately store `wabaId: null`. There is no
global/fallback credential.

### Rule 6 — The dataset id is a cache, provisioned lazily

`ensureDataset()` calls Meta's create-or-return `POST /{waba_id}/dataset` on
first need and caches the id as `capiDatasetId` on the `CONFIG#WABA#` item
via a targeted `SET` (composes with the routes' full-item writes; any
`CONFIG#WABA#` write still invalidates the shared config cache per ADR-012's
standing rule). An OAuth reconnect that drops the field self-heals — the next
event re-resolves the SAME dataset. A manually-written `capiDatasetId` (the
approved fallback when auto-provisioning fails) is honored by the same cache
check, no separate path.

### Rule 7 — Best-effort toward the workflow, observable via CAPILOG#

`reportForLead()` never rejects on Meta/config problems — outcomes come back
as `sent | skipped | failed` and every outcome writes a TTL'd (90-day)
`CAPILOG#{companyId}` row (`{timestamp}#{leadId}#{metaEventName}`), including
skips with a reason (`no_ctwa_clid`, `already_reported`). The `meta_signal`
engine case throws only on `failed` so the execution path records a failed
node; the runner's per-node catch keeps the workflow itself running, same as
every sibling action. Alerting follows the embed-service precedent: an
HTTP-level Meta rejection pages (`logger.error`), a network timeout does not
(`logger.warn`).

---

## Consequences

### Positive

One place to change the dataset/events integration; contract tests pin the
two attribution-critical constants; conversion reporting can never spam Meta
with duplicates or break a customer-facing workflow; every outcome an admin
might ask about ("did we report it? why not?") has a queryable row.

### Constraints

- `CapiService.js` must have no `require()` on `WhatsAppSendService` (same
  enforcement style as ADR-017's constraint).
- The token needs the `whatsapp_business_manage_events` permission with
  **advanced access** — an App-Dashboard application, not a code change, and
  a real pre-launch operational dependency.
- The BM docs do not document an attribution window for late conversions;
  whether Meta credits an ad weeks after the click is unverified until tested
  live.
- v2 (offline PII-hashed matching for pure-offline leads) is explicitly out
  of scope; Meta's manual CSV upload in Events Manager covers the interim.

---

## Related

- ADR-012 — governs message sends only; quoted precedent for why this is a
  sibling, not an extension
- ADR-017 — the sibling-service doctrine this follows
- `src/services/FlowManagementService.js` — the structural template (gate,
  `_metaError`, per-call Bearer auth)
- `src/core/entityKeys.js` — `capiClaimSK` / `capiLogPK` / `capiLogSK`
- `docs/bible/19_DECISION_LOG.md` Era 53 — the implementation record,
  including the two spec revisions and their evidence
