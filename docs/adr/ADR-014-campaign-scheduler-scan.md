# ADR-014 — Campaign Scheduler: Scan-Based Due-Campaign Sweep (Interim)

**Status:** Accepted (interim)
**Date:** 2026-07-02
**Deciders:** Engineering

---

## Context

`src/services/CampaignScheduler.js` runs every 5 minutes (EventBridge rule, see
`.github/workflows/deploy.yml`) and must find every campaign across every company
whose `scheduledAt` has passed. Campaign items are keyed by `PK = CONFIG#CAMP#{companyId}`
— company-scoped, not sortable by `scheduledAt` across companies. There is no index
that lets "all due campaigns, any company" be queried directly.

At current scale (single-digit to low-tens of companies; campaign items are a tiny
fraction of total items in `DYNAMODB_TABLE_METRICS`), a `Scan` with a narrow
`ProjectionExpression` and `FilterExpression` is cheap enough to run on a 5-minute
cadence. This mirrors existing precedent already in the codebase: `_buildAudience()`
(`src/routes/campaigns.js`) scans all of a company's leads on every audience preview/
launch, and the WhatsApp webhook scans WABA config by `wabaId` for template-status
updates — both accepted low-cardinality, infrequent-lookup Scans against this table.

## Decision

Accept a `Scan` for the due-campaign sweep now. **Do not add a GSI yet.**

A GSI (e.g. `GSI_PK = status`, `GSI_SK = scheduledAt`) would turn this into a cheap
`Query`, but adds an always-on write cost to every campaign status transition
(`draft`/`scheduled` → `launching` → `active` → `completed`/`failed`) and requires a
backfill/migration on an existing table. That cost isn't justified while campaign
volume is low.

### Migration trigger — revisit and add the GSI when any of these becomes true

- `DYNAMODB_TABLE_METRICS` crosses roughly 1M items, such that a 5-minute Scan
  cadence becomes a measurable RCU/cost line item.
- The number of companies with active campaigns grows past ~50.
- CloudWatch shows the scheduler's Scan consuming a disproportionate share of
  read capacity relative to the rest of the API.

### What must not regress in the meantime

- The Scan must always use `ProjectionExpression` — fetch only the fields the
  scheduler needs (`PK`, `SK`, `id`, `companyId`, `createdBy`, `createdByName`,
  `status`, `scheduledAt`), never full items.
- The Scan must stay filtered to `begins_with(SK, 'CAMP#')` — never widened to
  cover other entity types.
- Due campaigns must be processed in bounded batches (see `BATCH_SIZE` in
  `CampaignScheduler.js`), not unbounded concurrency.

## Related

- `src/services/CampaignScheduler.js` — the implementation; carries a
  `// TODO(ADR-014)` comment pointing back here
- `docs/adr/ADR-012-whatsapp-send-service.md` — same-table Scan precedent
