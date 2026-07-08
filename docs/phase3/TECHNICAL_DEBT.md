# Phase 3 — Technical Debt

## GSI Pollution — leadsByCompany

**Issue:** `leadsByCompany` GSI contains METRICS, CONV, CONTACT, and CONFIG records because all share the `companyId` attribute. The GSI indexes every record that has `companyId`, not just leads.

**Fix:** Add an `entityType` attribute to all DynamoDB records (e.g. `LEAD`, `CONV`, `CONTACT`, `CONFIG`, `METRIC`). Recreate or add a filtered GSI that keys on `companyId` with a filter condition on `entityType = 'LEAD'`.

**Priority:** Medium — must be resolved before the table reaches ~10,000+ records to avoid query performance degradation and excessive read costs from filtering noise out of GSI results.

## Incomplete Hard-Purge — CONV#/TL# Not Cleaned Up

**Issue:** `DELETE /api/crm/leads/:id` (`crm.js:607-669`) purges the `LEAD#`/`INBOX#` partitions and releases the phone-uniqueness lock, but never touches `CONV#`/`TL#` — a separate, newer (Phase 2 Customer 360) entity family this route's partition list was never extended to cover. A "hard purge" today leaves conversation content behind (`CONV#META`'s `lastMessageText`, potentially `aiSummary`) in orphaned records pointing at a lead/contact that no longer exists.

**Fix:** Extend the purge route's partition list to also delete the `CONV#{companyId}#{conversationId}` partition and the associated `TL#{companyId}#CONTACT#{contactId}` / `TL#{companyId}#CONV#{conversationId}` timeline entries.

**Priority:** Must fix before this route is ever run against a real customer's data (e.g. a genuine right-to-erasure request) — connects directly to the already-open "no PII retention/deletion policy" gap (`20_CURRENT_STATE.md` §5, "Data governance"). Not urgent today — confirmed test-data-only usage so far (`19_DECISION_LOG.md` Era 36).
