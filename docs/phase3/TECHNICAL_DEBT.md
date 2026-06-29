# Phase 3 — Technical Debt

## GSI Pollution — leadsByCompany

**Issue:** `leadsByCompany` GSI contains METRICS, CONV, CONTACT, and CONFIG records because all share the `companyId` attribute. The GSI indexes every record that has `companyId`, not just leads.

**Fix:** Add an `entityType` attribute to all DynamoDB records (e.g. `LEAD`, `CONV`, `CONTACT`, `CONFIG`, `METRIC`). Recreate or add a filtered GSI that keys on `companyId` with a filter condition on `entityType = 'LEAD'`.

**Priority:** Medium — must be resolved before the table reaches ~10,000+ records to avoid query performance degradation and excessive read costs from filtering noise out of GSI results.
