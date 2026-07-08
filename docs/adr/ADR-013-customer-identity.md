# ADR-013 — Customer Identity & Recipient Resolution

**Status:** Accepted  
**Date:** 2026-07-01  
**Deciders:** Engineering

---

## Context

APForce receives customers through multiple independent entry points.  As of the date of this ADR, each entry point implements its own identity resolution independently:

| Entry Point | File | Phone Normalisation | Dedup Method | Gap |
|---|---|---|---|---|
| Manual lead (CRM) | `crm.js:211` | `to10Digit()` ✓ | `CIS.resolveOrCreate()` ✓ | — (fully compliant, see Status Update below) |
| Form submission | `forms.js:115` | `to10Digit()` ✓ | GSI query before insert | — |
| Meta Lead Ads webhook | `forms.js:224` | `to10Digit()` ✓ | GSI query before insert | — |
| CSV / bulk import | `crm.js:841` | `to10Digit()` ✓ | In-memory scan + map | **Not GSI — race window** |
| WhatsApp inbound (known lead) | `whatsapp.js:1279` | `to10Digit()` ✓ | GSI query (implicit) | — |
| WhatsApp inbound (unknown) | `whatsapp.js:1360` | `to10Digit()` ✓ | None before INBOX# creation | **No phone lock — race window** |
| CTWA (Click-to-WhatsApp) | _(future)_ | — | — | **Not yet implemented** |
| Public API / partner import | _(future)_ | — | — | **Not yet implemented** |

`CustomerIdentityService` (`src/services/CustomerIdentityService.js`) was authored to solve exactly this problem.  It provides atomic customer creation with a `LEAD_PHONE#` DynamoDB TransactWrite lock, `IDEM#` idempotency locks for webhook deduplication, and `company-phone-index` GSI lookups.  **It is not called by any route.**

Additional inconsistencies found:

- ~~`contacts.js` deduplicates INBOX# records against LEAD# using **raw phone strings** (`l.phone`), not `phoneNorm` — a bug when numbers differ only in formatting.~~ **Fixed 2026-07-08** — see Status Update below Migration Required.
- The Phase 2 `ContactService` normalises to **E.164** (`+91XXXXXXXXXX`) while every other path normalises to **10-digit** (`XXXXXXXXXX`).  Two formats coexist with no explicit mapping rule.
- CSV import scans all company leads into memory before checking for duplicates, bypassing the GSI and creating a race window for concurrent imports.

---

## Decision

### Rule 1 — `phoneNorm` is the canonical customer identity

```
phoneNorm = to10Digit(rawPhone)   // always a 10-digit string for Indian numbers
```

`phoneNorm` is the **only** value used to compare, look up, or deduplicate customers.  Raw phone strings (`lead.phone`, `req.body.phone`, webhook payloads) must never be compared directly.  Always pass through `to10Digit()` first.

**Phase 1 scope:** Indian numbers only (10-digit after stripping country code).  International number support will be addressed in a future ADR when geo-routing is introduced.  The `normalizeE164()` utility in `src/utils/phoneNormalize.js` handles display and outbound API calls; it is NOT used as a lookup key.

### Rule 2 — `CustomerIdentityService.resolveOrCreate()` is the single entry point for customer creation

Every entry point that creates or claims a customer must call:

```js
const CIS = require('../services/CustomerIdentityService');

const { lead, created, enriched } = await CIS.resolveOrCreate(companyId, {
  phone,          // any raw format — CIS normalises internally
  name,
  source,         // 'form' | 'whatsapp' | 'import' | 'ctwa' | 'api' | 'manual'
  // …additional fields
}, context);      // { idempotencyKey? } for webhook idempotency
```

Callers must NOT:
- Query `company-phone-index` directly to check for duplicates before writing
- Write LEAD# METADATA items directly in route handlers
- Implement their own dedup logic

### Rule 3 — Never compare raw phone numbers

```js
// ❌ Prohibited
if (lead.phone === incomingPhone) …
const phones = leads.map(l => l.phone)

// ✅ Required
if (lead.phoneNorm === to10Digit(incomingPhone)) …
const phoneNorms = leads.map(l => l.phoneNorm ?? to10Digit(l.phone))
```

This applies to deduplication in memory (CSV import, contacts list), in FilterExpressions, and in application logic.

### Rule 4 — Never create duplicate customers

Two records for the same `(companyId, phoneNorm)` must never coexist as active LEAD# METADATA items.

`CustomerIdentityService` enforces this atomically via a `LEAD_PHONE#${companyId}#${phoneNorm}` item written in the same TransactWrite as the LEAD# METADATA item.  If a concurrent write races to the same phone, one transaction fails; the loser re-reads the winner's record and returns it.  No 409 conflict is surfaced to the customer.

### Rule 5 — INBOX# contacts are a temporary staging area, not a second identity

An `INBOX#${companyId}#${phone}` record exists only when a WhatsApp message arrives from a number that has no corresponding LEAD#.  It is a staging record, not a permanent customer identity.

- The WhatsApp webhook must call `CIS.resolveOrCreate()` for every inbound message.  If a LEAD# is found or created, messages are stored under the LEAD# PK.  If `resolveOrCreate()` returns a new lead with `source: 'whatsapp'`, the INBOX# record (if any) must be migrated to the LEAD# PK.
- INBOX# records must not be treated as durable customer identity by any other service.
- `WhatsAppSendService.resolveContact()` already falls back to INBOX# for outbound sends — this is acceptable for UNKNOWN contacts only, and must never bypass `CIS` for contacts that should have a LEAD#.

### Rule 6 — The `company-phone-index` GSI is the only permitted lookup mechanism

```js
// ✅ Only valid lookup pattern
await dynamodb.query({
  TableName: TABLE,
  IndexName: 'company-phone-index',
  KeyConditionExpression: 'companyId = :cid AND phoneNorm = :norm',
  FilterExpression: 'SK = :meta AND attribute_not_exists(deletedAt)',
  ExpressionAttributeValues: { ':cid': companyId, ':norm': to10Digit(phone), ':meta': 'METADATA' },
  Limit: 1,
}).promise();
```

Full-table scans and in-memory phone maps for dedup (currently in CSV import) are prohibited.

---

## Migration Required

The following changes must be made before this ADR is fully enforced.  Until each item is completed, the affected entry point is in a **transition** state.

| # | Entry Point | Gap | Required Change |
|---|---|---|---|
| 1 | WhatsApp webhook (unknown) | No phone lock before INBOX# | Call `CIS.resolveOrCreate()` on every inbound msg; write MSG# under returned PK |
| 2 | CSV import | In-memory scan dedup | Replace with `CIS.resolveOrCreate()` per row (or batch GSI check + `LEAD_PHONE#` lock) |
| 3 | `contacts.js` | Raw phone dedup | Replace `l.phone` comparisons with `l.phoneNorm ?? to10Digit(l.phone)` |
| 4 | CTWA entry | Not yet built | Must route through CIS from day one; no direct DDB write in route handler |
| 5 | Public partner API | Not yet built | Same as CTWA |

Items 1–3 are bug fixes.  Items 4–5 are future-proofing rules.

### Status Update (2026-07-08 — Wave 1 audit fixes)

- **Manual lead (CRM), `crm.js:211`** — the entry-points table above described this
  row as already compliant (`to10Digit()` ✓, no gap) as of this ADR's original
  authoring date, but the live code at the time did not match: `POST /leads`
  digit-stripped `body.phone` with an ad-hoc `String(...).replace(/\D/g, '')`
  and never truncated to 10 digits, so a country-code-prefixed number 400'd
  against `createLeadSchema`'s exact-10-digit regex before ever reaching CIS.
  Separately, this route's CIS migration itself (Rule 2) had already landed in
  a prior, unrelated commit (`1b89521a`) — there was no direct `dynamodb.put`
  left to remove. Both halves are now resolved: the strip uses `to10Digit()`
  (commit `734a031`), and the route has called `CIS.resolveOrCreate()` since
  `1b89521a`. **This entry point is now fully compliant with Rules 1–3.**

- **Item 3, `contacts.js` raw phone dedup** — **closed** (commit `2ae59ee`).
  Correction to this table's own framing: it (and the audit that cited it)
  described only half the bug. The required fix — `l.phoneNorm ?? to10Digit(l.phone)`
  — was applied to the `leadPhones` Set construction, but the *consumption*
  side of the same comparison (`leadPhones.has(u.phone)`, checking an INBOX#
  record's raw phone against that set) also needed `to10Digit()`. Normalizing
  only one side of a `Set.has()` comparison leaves it just as broken — the fix
  would have been a no-op without also normalizing `u.phone` at the point of
  comparison. Both sides are now normalized.

---

## Identity Model

```
                         Raw phone (any format)
                                │
                         to10Digit()
                                │
                           phoneNorm
                      (10-digit canonical)
                                │
                  ┌─────────────┴───────────────┐
                  │                             │
          company-phone-index              IDEM# lock
          GSI lookup (O(1))            (idempotency window)
                  │
         ┌────────┴──────────┐
         │                   │
    Found (LEAD#)      Not found
    → enrich             │
                   LEAD_PHONE# lock
                   (TransactWrite)
                         │
                  ┌──────┴──────┐
                  │             │
               Created      Race lost
               (LEAD#)      → re-read winner
                                 → enrich
```

### DynamoDB keys written by CIS

| Item | PK | SK | Purpose |
|---|---|---|---|
| Customer record | `LEAD#${companyId}#${leadId}` | `METADATA` | Durable customer identity |
| Phone lock | `LEAD_PHONE#${companyId}#${phoneNorm}` | `LOCK` | Atomic uniqueness — same TransactWrite as METADATA |
| Idempotency lock | `IDEM#${companyId}#${sha256(key)}` | `LOCK` | Deduplicates webhook retries |

### Relationship to Phase 2 Contact entity

The Phase 2 `ContactService` (`src/services/ContactService.js`) maintains a separate `CONTACT#` entity using E.164 phone format and `ContactPhoneIndex` GSI.  This is a richer identity graph for future CRM features (multiple numbers per contact, company relationships).

Rule: **`LEAD#` identity (10-digit `phoneNorm`) is the source of truth for all messaging and dedup decisions.**  `CONTACT#` records are linked to leads via `leadItem.contactId` after lead creation (see `LeadService.linkContactToLead()`).  They must not be used as the primary lookup key for any entry point covered by this ADR.

---

## Consequences

### Positive

- **Impossible duplicates.** The `LEAD_PHONE#` lock makes concurrent duplicate creation a handled, atomic failure rather than a race condition.
- **Idempotent webhooks.** Meta Lead Ads, WhatsApp Cloud API, and future CTWA webhooks can retry safely — the `IDEM#` lock returns the same result for duplicate deliveries.
- **Consistent message history.** WhatsApp messages from both known and new contacts land under the same LEAD# PK from the first message.
- **One place to fix phone normalisation.** Adding a new country code is a one-line change inside CIS.

### Constraints

- CIS uses `TransactWrite` (up to 100 items per call).  High-volume batch imports must batch rows into chunks rather than calling CIS per-row in a tight loop.  A dedicated bulk-import path (chunk-scan-then-transact) is acceptable as long as it uses the `LEAD_PHONE#` lock.
- The `IDEM#` idempotency window is time-bucketed (5-minute windows by default).  Duplicate webhooks delivered more than 5 minutes apart will create a new customer.  This is acceptable — the `LEAD_PHONE#` lock prevents the duplicate from persisting; the loser will enrich the winner's record instead.
- **A hard-purge of a lead must also delete its `LEAD_PHONE#` lock, or the lock is orphaned and the phone becomes permanently un-creatable.** The `LEAD_PHONE#` lock is a separate item from the `LEAD#` METADATA; deleting only the METADATA leaves a lock that references a lead that no longer exists. Every subsequent `resolveOrCreate()` for that number then fails the lock's `ConditionExpression`, and the loser's "re-read the winner" step never finds a winner (there is none — it was purged), so it surfaces a raw, unhandled `TransactionCanceledException` ("Transaction cancelled, please refer cancellation reasons...") as a 500. **This was the true root cause of the 2026-07-03 production incidents** (`POST /api/crm/leads`, the endpoint the Inbox's unknown-contact "assign" picker calls): an admin purged a lead (`crm_lead_purged`) at 12:41; every create for that number failed from 12:48 onward — verified by direct DynamoDB inspection (lock present, referenced `LEAD#` METADATA absent). It is **not** a GSI eventual-consistency lag issue; an earlier fix (commit `6d6028f`) misdiagnosed it as such and added a retry loop, which cannot help — no retry budget makes a purged record reappear. **Fixed (three parts):**
  1. `crm.js`'s `DELETE /api/crm/leads/:id` now deletes the `LEAD_PHONE#${companyId}#${phoneNorm}` lock alongside the `LEAD#`/`INBOX#` records (see also the note in `src/core/entityKeys.js`).
  2. `CIS._createCustomer` now self-heals: after the retry budget is exhausted with no GSI winner, it reads the lock and its referenced lead directly (strongly consistent); if the lead is gone, it **reclaims the orphaned lock** (guarded overwrite) and creates the new lead instead of throwing. This also repairs any locks orphaned before fix #1 shipped.
  3. `CIS.resolveOrCreate`'s idempotency fast path now validates the cached lead still exists before returning it, and deletes a stale `IDEM#` lock that points at a purged lead (idem locks can't be enumerated by leadId at purge time, so they are cleaned lazily here).
  - The retry-with-backoff from `6d6028f` is kept — it is a harmless, correct defence for a genuine (transient) concurrent race, and its added log line is what made this diagnosis possible — but it is not the fix. First test coverage: `tests/customerIdentityService.test.js` and `tests/leadPurgeRecreate.test.js` (the latter drives the real purge route + CIS against a shared in-memory DynamoDB fake).

---

## Enforcement

### Code review checklist

Before merging any PR that creates or claims a customer:

- [ ] No direct `dynamodb.put({ Item: { PK: 'LEAD#...', SK: 'METADATA' } })` in route handlers
- [ ] No in-memory phone comparison (`l.phone === x`, `phones.includes(x)`)
- [ ] Phone looked up via `company-phone-index` GSI using `to10Digit()` normalised value
- [ ] New entry points call `CIS.resolveOrCreate()`, not ad-hoc GSI queries + puts
- [ ] CTWA and partner API routes wired to CIS from first commit

### Adding a new entry point

1. Import `CustomerIdentityService`
2. Normalise the incoming phone with `to10Digit()` only for logging/display; pass the raw value to `CIS.resolveOrCreate()` — CIS normalises internally
3. Do not write LEAD# METADATA directly; use the returned `lead` object
4. Provide a meaningful `source` string (`'ctwa'`, `'api'`, `'import'`, etc.)
5. Provide an `idempotencyKey` for webhook-based entry points (use the event ID from the platform)
6. Update the entry points table in this ADR

---

## Related

- `src/services/CustomerIdentityService.js` — the implementation (exists, not yet integrated)
- `src/utils/phone.js` — `to10Digit()` canonical normaliser
- `src/utils/phoneNormalize.js` — `normalizeE164()` for display/outbound API
- `scripts/create-phone-gsi.js` — `company-phone-index` GSI definition
- `src/services/WhatsAppSendService.js` — uses `resolveContact()` which reads the same GSI
- ADR-012 — outbound messaging (complementary; this ADR governs inbound identity)
- Commits: `1a10646`, `c58d07f` — WhatsApp send service (establishes the resolved-contact pattern)
