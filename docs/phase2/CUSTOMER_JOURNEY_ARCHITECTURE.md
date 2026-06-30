# Customer Journey Architecture

**Status:** Approved — pending implementation  
**Date:** 2026-06-30  
**Supersedes:** Initial draft (inline proposal, same session)

---

## The Mindset Shift

APForce is not a lead manager. It is a **Customer Journey Platform**.

| Old mental model | New mental model |
|---|---|
| Lead | Customer |
| Lead creation | First interaction |
| Duplicate rejection | Identity resolution + enrichment |
| Form submission creates a record | Customer arrives through a channel |
| 409 Conflict | Welcome back — journey continues |

The database entity is still called `LEAD#` (renaming it would be a destructive migration). The **domain model** is Customer. Every service, every API response, every UI label should speak in terms of customers, not leads.

```
Customer
  └── Identity        (phoneNorm — canonical; phone — display; leadId — system key)
  └── Profile         (name, email, stage, assignedTo — enriched over time)
  └── Journey         (ordered list of Interactions)
  └── Conversation    (WhatsApp thread — continues across all touches)
  └── Pipeline        (stage, follow-ups, tasks)
  └── Timeline        (unified TL# event stream — immutable)
```

---

## Part 1 — Identity Model

Three levels of identity exist simultaneously and serve different purposes:

| Identity | Field | Type | Purpose |
|---|---|---|---|
| System identity | `leadId` | UUID | Primary key, foreign keys, URL params, query keys, TL# partition |
| Canonical matching identity | `phoneNorm` | 10-digit string | All duplicate detection, GSI lookups, inbox dedup, channel linking |
| Display identity | `phone` | Raw string | Shown to users; stored as entered; never used for comparison |

**Rule:** When any data enters the system with a phone number, the resolution order is:

```
1. Strip non-digits               → rawDigits
2. to10Digit(rawDigits)           → phoneNorm
3. GSI query(companyId, phoneNorm) → existing customer?
     YES → enrich + record interaction
     NO  → create customer + record first interaction
```

No entry point may skip step 3. No entry point may compare raw `phone` strings for dedup.

---

## Part 2 — The Immutability Contract

This is a permanent platform rule. It cannot be overridden by any feature, migration, or automation.

### Fields that are NEVER automatically overwritten

Once set, these fields belong to the customer. Only a human can change them — through an explicit UI action.

| Field | Reason |
|---|---|
| `assignedTo` / `assignedToName` | Assignment is a human decision. A returning form submission does not transfer ownership. |
| `stage` | Pipeline position is earned. A new interaction does not reset progress. |
| `notes` | Agent's private observations. Never overwritten. New notes are appended as separate `NOTE#` items. |
| `follow-ups / tasks` | Pending work created by agents. Untouched. |
| `conversation` | The WhatsApp thread continues. No new thread is started for a returning customer. |
| `Customer360` | The single workspace for this customer. Unchanged. |
| `tags` | Tags are additive. New tags are unioned in. Existing tags are never removed by automation. |
| `productInterest` | Additive. New interests unioned in. Never cleared. |
| `leadSourceHistory` | Append-only. Each new touch appends one entry (capped at 10 for the summary; full history in TL#). |
| `ownerHistory` | Append-only. Written by the service layer when ownership changes via explicit human action. |
| `timeline` | Immutable. Events written once, never updated, never deleted. |
| `campaigns` / `sources` | Append-only. Never cleared. |

### Fields with Smart Update rules

These fields can be updated by the system, but only when the incoming value is demonstrably better than the existing one.

| Field | Smart update rule |
|---|---|
| `name` | Update if and only if: existing value equals `phone`, equals `phoneNorm`, is null, or is empty. Never overwrite a real name with a form field value automatically. |
| `email` | Update if and only if existing value is null or empty. First email wins. |
| `company` | Update if and only if existing value is null. |
| `lastInteractionAt` | Always update to now. |
| `lastInteractionSource` | Always update to current source. |
| `updatedAt` | Always update to now. |

### Fields that are set on creation only

| Field | Rule |
|---|---|
| `leadId` | Set once on creation. Immutable. |
| `createdAt` | Set once on creation. Immutable. |
| `createdBy` | Set once on creation. Immutable. |
| `source` (the original first-touch source) | Set once. Subsequent sources go to `leadSourceHistory` only. |
| `phoneNorm` | Set on creation from `to10Digit(phone)`. Can be recalculated but not changed by enrichment. |

---

## Part 3 — The Interaction Model

Every time a customer touches APForce — through any channel — one Interaction is recorded. Interactions are **immutable**. They are written once and never modified.

### Why `interactionId` matters

Each interaction has a unique `interactionId`. This enables, without changing the data model later:

- Attribution reports (which campaign converted which customers)
- Marketing analytics (channel performance, cost per interaction)
- AI recommendations (pattern recognition across journeys)
- Customer journey visualization (ordered touchpoint map)
- Conversion funnels (from first touch to converted stage)
- ROI by campaign (revenue attributed to each source)

### Interaction schema

```javascript
{
  // Identity
  interactionId:   'int_<uuid>',          // unique per interaction — never reused
  leadId:          '<uuid>',              // the customer this belongs to
  companyId:       '<id>',

  // When
  timestamp:       '2026-06-30T10:15:00.000Z',

  // How they arrived
  source:          'meta_lead_ads',       // web_form | meta_lead_ads | whatsapp |
                                          // csv | api | webhook | manual | landing_page
  campaign:        'Insurance_June_2026', // UTM campaign / ad set name
  medium:          'paid_social',         // organic | paid_social | email | whatsapp |
                                          // referral | direct | sms | qr_code
  landingPage:     'https://...',         // URL that triggered this interaction

  // What they expressed
  product:         'term_life',           // primary product interest (single value)
  tagsAdded:       ['insurance'],         // net-new tags added to customer on this touch
  interestsAdded:  ['term_life'],         // net-new productInterest added on this touch

  // Who recorded it
  createdBy:       'form_submit',         // user ID | 'form_submit' | 'meta_lead_ads' |
                                          // 'whatsapp_webhook' | 'csv_import' |
                                          // 'api' | 'webhook'

  // Journey position
  isFirstTouch:    false,
  touchNumber:     3,                     // sequential counter per customer

  // Free-form attribution (entry-point-specific; never schema-enforced)
  metadata: {
    formId:        'form_abc',
    leadgenId:     '...',                 // Meta Lead Ads only
    webhookId:     '...',                 // third-party webhooks
    utm_source:    'facebook',
    utm_content:   'insurance_banner_v2',
    notes:         'Submitted insurance inquiry',
    // ... any future field without model change
  }
}
```

### Where interactions live in DynamoDB

Interactions are stored as `TL#` timeline records using the **existing** timeline infrastructure. No new table, no new GSI, no new SK pattern.

```
PK:  TL#companyId#LEAD#leadId
SK:  2026-06-30T10:15:00.000Z#touch_received#evt_abc123
```

The `TL#` system is already:
- Immutable (conditional write: `attribute_not_exists(SK)`)
- Idempotent (same eventId arriving twice is silently discarded)
- Fire-and-forget (setImmediate — never blocks the HTTP response)
- Fan-out capable (same event writes to multiple partitions)

A compact summary (last 10 interactions) is also maintained in the already-reserved `leadSourceHistory` array on the METADATA item — for quick display without querying TL#.

---

## Part 4 — CustomerIdentityService

**File:** `src/services/CustomerIdentityService.js`

This service is the **only** component that may create a customer or record an interaction. No route may write directly to LEAD# METADATA for creation or enrichment — it calls `CustomerIdentityService` instead.

### Responsibilities

1. **Identity resolution** — given a phone + companyId, find the canonical customer
2. **Duplicate prevention** — phoneNorm is the matching key; raw phone strings are never compared
3. **Customer creation** — when no existing customer is found
4. **Customer enrichment** — when an existing customer is found; applies smart update rules
5. **Interaction recording** — writes one Interaction (TL# record) per call, always
6. **`leadSourceHistory` maintenance** — appends compact entry, caps at 10

### Public API (single entry point)

```javascript
/**
 * The universal entry point for every channel that brings a customer into APForce.
 *
 * Resolves the customer by phoneNorm.
 * If found:  enriches the existing customer + records an Interaction.
 * If not found: creates a new customer + records the first Interaction.
 *
 * Never throws on enrichment failure — logs and continues.
 * Never overwrites protected fields — see Immutability Contract.
 *
 * @param {string} companyId
 * @param {object} data
 *   @param {string}   data.phone              required — any format; normalized internally
 *   @param {string}   [data.name]             optional; applied only if smart-update rule passes
 *   @param {string}   [data.email]            optional; applied only if null/empty exists
 *   @param {string}   [data.company]          optional; applied only if null/empty exists
 *   @param {string}   [data.source]           entry point identifier
 *   @param {string}   [data.campaign]         UTM campaign / ad name
 *   @param {string}   [data.medium]           UTM medium
 *   @param {string}   [data.landingPage]      referring URL
 *   @param {string}   [data.product]          primary product interest
 *   @param {string[]} [data.tags]             tags from this interaction
 *   @param {string[]} [data.productInterest]  product interests to union
 *   @param {string}   [data.notes]            appended as NOTE# item if non-empty
 *   @param {string}   [data.stage]            for new customers only; ignored for returning
 *   @param {string}   [data.assignedTo]       for new customers only; ignored for returning
 *   @param {string}   [data.assignedToName]   for new customers only; ignored for returning
 *   @param {string}   [data.formId]           form identifier (goes into interaction.metadata)
 *   @param {object}   [data.metadata]         arbitrary entry-point data stored on interaction
 * @param {object} context
 *   @param {string}   context.createdBy       actor: user ID or system string
 *   @param {string}   [context.actorId]       for timeline event attribution
 *   @param {string}   [context.actorName]
 *
 * @returns {Promise<{ existed: boolean, leadId: string, action: 'created'|'enriched', interactionId: string }>}
 */
async function resolveOrCreate(companyId, data, context) { ... }
```

**Returned shape:**

```json
{
  "existed":       false,
  "leadId":        "uuid",
  "action":        "created",
  "interactionId": "int_abc123"
}
```

```json
{
  "existed":       true,
  "leadId":        "uuid",
  "action":        "enriched",
  "interactionId": "int_xyz456"
}
```

### Internal flow

```
resolveOrCreate(companyId, data, context)
  │
  ├─ normPhone = to10Digit(data.phone)
  │
  ├─ existing = GSI query(companyId, normPhone)        ← company-phone-index
  │
  ├─ if existing:
  │     delta = computeDelta(existing, data)            ← applies smart-update rules
  │     DynamoDB.update(LEAD#METADATA, delta)           ← only changed fields
  │     interactionId = recordInteraction(...)          ← TL# write via publishEvent()
  │     return { existed: true, leadId, action: 'enriched', interactionId }
  │
  └─ if not existing:
        lead = createCustomer(companyId, normPhone, data, context)
        interactionId = recordInteraction(..., isFirstTouch: true)
        return { existed: false, leadId, action: 'created', interactionId }
```

### `computeDelta()` — the smart update engine

Returns only the fields that need to be written. Never includes protected fields. Applies the immutability contract mechanically.

```javascript
function computeDelta(existing, incoming) {
  const delta = {};

  // Smart update: name
  const isPlaceholder = !existing.name
    || existing.name === existing.phone
    || existing.name === existing.phoneNorm;
  if (isPlaceholder && incoming.name?.trim()) {
    delta.name = incoming.name.trim();
  }

  // Smart update: email — first wins
  if (!existing.email && incoming.email?.trim()) {
    delta.email = incoming.email.trim();
  }

  // Smart update: company — first wins
  if (!existing.company && incoming.company?.trim()) {
    delta.company = incoming.company.trim();
  }

  // Additive: tags union
  const currentTags = new Set(existing.tags ?? []);
  const newTags = (incoming.tags ?? []).filter((t) => !currentTags.has(t));
  if (newTags.length > 0) delta.tags = [...(existing.tags ?? []), ...newTags];

  // Additive: productInterest union
  const currentInterests = new Set(existing.productInterest ?? []);
  const newInterests = (incoming.productInterest ?? []).filter((i) => !currentInterests.has(i));
  if (newInterests.length > 0) {
    delta.productInterest = [...(existing.productInterest ?? []), ...newInterests];
  }

  // leadSourceHistory — append compact entry (cap at 10)
  const newEntry = {
    source:      incoming.source ?? 'unknown',
    campaign:    incoming.campaign ?? null,
    touchedAt:   new Date().toISOString(),
    isFirstTouch: false,
  };
  delta.leadSourceHistory = [...(existing.leadSourceHistory ?? []), newEntry].slice(-10);

  // Always-update fields
  delta.lastInteractionAt     = new Date().toISOString();
  delta.lastInteractionSource = incoming.source ?? null;
  delta.updatedAt             = new Date().toISOString();

  return delta;
}
```

### `recordInteraction()` — the interaction writer

Calls `publishEvent()` with `E.TOUCH_RECEIVED`. The existing fire-and-forget publisher writes the TL# record. Returns the `interactionId` synchronously (generated before the async write).

```javascript
function recordInteraction(companyId, leadId, data, context, isFirstTouch, touchNumber) {
  const interactionId = `int_${uuidv4().replace(/-/g, '')}`;

  publishEvent(E.TOUCH_RECEIVED, {
    companyId,
    entityType: ENTITY.LEAD,
    entityId:   leadId,
    actorId:    context.actorId    ?? null,
    actorName:  context.actorName  ?? null,
    channel:    data.source        ?? null,
    summary:    buildSummary(data, isFirstTouch),
    metadata: {
      interactionId,
      source:        data.source       ?? null,
      campaign:      data.campaign     ?? null,
      medium:        data.medium       ?? null,
      landingPage:   data.landingPage  ?? null,
      product:       data.product      ?? null,
      tagsAdded:     data.tags         ?? [],
      interestsAdded: data.productInterest ?? [],
      createdBy:     context.createdBy ?? null,
      isFirstTouch,
      touchNumber,
      formId:        data.formId       ?? null,
      ...( data.metadata ?? {} ),
    },
  });

  return interactionId;
}
```

---

## Part 5 — Entry Point Unification

Every entry point calls `CustomerIdentityService.resolveOrCreate()`. The flow is identical across all channels.

### Entry point registry (full coverage)

| Entry Point | File | Current behavior | After |
|---|---|---|---|
| Manual lead creation | `crm.js POST /api/crm/leads` | Create or 409 | `resolveOrCreate()` → `{ existed, action }` |
| Lead phone update | `crm.js PUT /api/crm/leads/:id` | Update phone with dedup | No change — explicit update, not enrichment |
| CSV import | `crm.js POST /api/crm/import` | Skip or Overwrite | Enrich (default), Skip, Overwrite |
| Web form submit | `forms.js POST /api/forms/:id/submit` | Create or 409 | `resolveOrCreate()` |
| Meta Lead Ads webhook | `forms.js POST /api/forms/meta-leads/webhook` | Create or silent skip | `resolveOrCreate()` |
| WhatsApp webhook — new contact | `whatsapp.js` | Create lead (separate path) | `resolveOrCreate()` |
| WhatsApp webhook — returning contact | `whatsapp.js` | Route to existing ✅ | No change |
| Inbox unknown → assign | `inbox/page.tsx` | POST /crm/leads → 409 handled | 200 + `{ existed, action }` — UX already correct |
| Automation `lead_create` action | `automations.js` | Direct DynamoDB write | `resolveOrCreate()` when implemented |
| REST API (external) | `crm.js POST /api/crm/leads` | Same handler | Same handler — already correct after above change |
| Future: webhook integrations | Any | — | Must call `resolveOrCreate()` — documented here |
| Future: CSV from CRM integrations | `crm.js` | — | `resolveOrCreate()` |
| Future: landing page / UTM capture | New route | — | `resolveOrCreate()` |
| Future: referral system | New route | — | `resolveOrCreate()` |

### WhatsApp webhook — why it must be in the initial rollout

WhatsApp is the highest-volume entry point. If it uses a different code path from forms and manual creation, a customer who fills a form and then messages on WhatsApp may briefly have two records during the transition. Including it in Phase B (alongside forms) guarantees consistent identity resolution from day one.

---

## Part 6 — API Contract Changes

### `POST /api/crm/leads`

**Before:**
```json
409  { "error": "A lead with this phone number already exists", "existingLeadId": "..." }
201  { "success": true, "lead": { ... } }
```

**After:**
```json
200  { "success": true, "existed": true,  "leadId": "...", "action": "enriched",  "interactionId": "int_..." }
201  { "success": true, "existed": false, "leadId": "...", "action": "created",   "interactionId": "int_...", "lead": { ... } }
```

**Frontend behavior for 200 + `existed: true`:**

> *"Interaction recorded. This customer already exists in your CRM — their record has been updated. [View Customer →]"*

Not a failure. Not a conflict. A success. The agent successfully enriched a customer.

### `POST /api/forms/:id/submit`

**Before:**
```json
409  { "error": "This phone number is already in the system", "duplicate": true }
201  { "success": true, "thankYouMessage": "...", "redirectUrl": "..." }
```

**After:**
```json
200  { "success": true, "existed": true,  "action": "enriched",  "thankYouMessage": "...", "redirectUrl": "..." }
201  { "success": true, "existed": false, "action": "created",   "thankYouMessage": "...", "redirectUrl": "..." }
```

The submitter sees the thank-you page in both cases. The form experience is identical. The difference is invisible to the end customer — intentionally.

### `GET /api/crm/leads/:id` — extends to include interactions

Currently returns `messages`. Extend to also return interactions from the TL# partition:

```json
{
  "lead": { ... },
  "messages": [ ... ],
  "interactions": [
    {
      "interactionId":  "int_abc123",
      "timestamp":      "2026-05-01T09:00:00Z",
      "source":         "web_form",
      "campaign":       "Webinar_May_2026",
      "medium":         "email",
      "landingPage":    "https://...",
      "tagsAdded":      ["webinar"],
      "isFirstTouch":   true,
      "touchNumber":    1,
      "summary":        "Registered for Webinar via Landing Page"
    },
    {
      "interactionId":  "int_xyz456",
      "timestamp":      "2026-06-30T10:15:00Z",
      "source":         "meta_lead_ads",
      "campaign":       "Insurance_June_2026",
      "medium":         "paid_social",
      "tagsAdded":      ["insurance", "term_life"],
      "isFirstTouch":   false,
      "touchNumber":    2,
      "summary":        "Clicked Insurance Ad"
    }
  ]
}
```

---

## Part 7 — CSV Import Mode Update

The existing `duplicateAction` parameter gains a third option, which becomes the recommended default.

| Mode | Behavior | Recommended? |
|---|---|---|
| `enrich` | Calls `CustomerIdentityService._enrich()` — appends tags/interests, smart-updates name/email, records Interaction. Protected fields preserved. | ⭐ Yes — default |
| `skip` | If phoneNorm exists, skip the row entirely. No Interaction recorded. | Use when re-importing clean data |
| `overwrite` | Completely replaces METADATA. Preserves `createdAt`, `leadId`, `ownerHistory`. **Destructive.** | ⚠️ Danger — explicit confirmation required in UI |

The UI import wizard should label these clearly:
- **Enrich** *(Recommended)* — Update and expand existing customers
- **Skip** — Only import new customers
- **Overwrite** ⚠️ — Replace all existing data (cannot be undone)

---

## Part 8 — Customer360 Timeline Integration

### What the Timeline tab displays

The Timeline tab synthesizes all `TL#` events for a lead into a chronological feed. `TOUCH_RECEIVED` events render as Interaction cards:

```
┌─────────────────────────────────────────────────┐
│ 📋  Submitted Insurance Form         Jun 30, 2026│
│     Campaign: Insurance_June_2026                │
│     Source: Meta Lead Ads · paid_social          │
│     Tags added: insurance, term_life             │
│     Interaction #2                               │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 🌐  Registered for Webinar           May 1, 2026 │
│     Campaign: Webinar_May_2026                   │
│     Source: Web Form · email                     │
│     Tags added: webinar                          │
│     First touch ·  Interaction #1                │
└─────────────────────────────────────────────────┘
```

Other existing `TL#` event types (stage_changed, lead_assigned, note_added, message_received) continue rendering as before. Interactions are additive to the existing timeline.

### No new backend endpoint required

`GET /api/crm/leads/:id` is extended to return interactions. The Timeline tab reads from the same response object it already consumes.

---

## Part 9 — New Event Type

One addition to `src/events/catalog.js`:

```javascript
// Customer Journey
TOUCH_RECEIVED: 'touch_received',  // customer arrived through any channel (first or returning)
```

The single event type carries `isFirstTouch` in metadata to distinguish creation from return visits. One event type, one handler, one renderer.

---

## Part 10 — What Future Attribution Looks Like

Because every interaction has an `interactionId`, these become possible **without any data model change**:

### Attribution query (conceptual)
```
TL#companyId#LEAD#*  WHERE eventType = 'touch_received'
  AND metadata.campaign = 'Insurance_June_2026'
  GROUP BY metadata.source
  → shows: 34 via Meta Ads, 12 via Web Form, 8 via WhatsApp
```

### Conversion funnel
```
Customers with touchNumber >= 1 (all)
  → Customers with stage = 'interested'        (conversion rate)
  → Customers with stage = 'kyc_done'          (KYC rate)
  → Customers with stage = 'converted'         (close rate)
```

### First-touch attribution
```
For each converted customer:
  Find their first Interaction (isFirstTouch: true)
  → Credit that campaign with the conversion
```

### Multi-touch attribution
```
For each converted customer:
  All interactions in order → which campaigns appeared in journeys that converted?
```

None of this requires schema changes. The `interactionId` is the attribution anchor.

---

## Part 11 — Implementation Phases

Each phase is independently deployable and backward compatible.

### Phase A — Core service + Event catalog
- `src/events/catalog.js` — add `E.TOUCH_RECEIVED`
- `src/services/CustomerIdentityService.js` — full implementation
  - `resolveOrCreate()`
  - `_enrich()` (internal)
  - `_createCustomer()` (extracted from crm.js POST handler)
  - `computeDelta()`
  - `recordInteraction()`

### Phase B — Entry point migration (all at once)
- `src/routes/crm.js` — `POST /api/crm/leads` calls `CustomerIdentityService.resolveOrCreate()`
- `src/routes/forms.js` — web form and Meta Lead Ads call `resolveOrCreate()`
- `src/routes/whatsapp.js` — webhook new-contact path calls `resolveOrCreate()`
- API response shape changes (200 + `existed: true` replaces 409)

Justification for doing all entry points in one phase: having two different behaviors simultaneously (some paths enrich, others reject) creates a window where the same customer can still get duplicated through an unmigrated path.

### Phase C — GET /api/crm/leads/:id returns interactions
- Query TL# partition for `touch_received` events
- Return as `interactions[]` in the response

### Phase D — Customer360 Timeline renders interactions
- `touch_received` event renderer in Timeline tab
- `interactionId` displayed as a subtle reference for support

### Phase E — CSV Enrich mode
- Add `enrich` as the third `duplicateAction`
- Make it the default in the UI import wizard
- `overwrite` requires explicit confirmation

### Phase F — Attribution foundation (future)
- Admin analytics: interactions by campaign, source, medium
- Conversion funnel by interaction source
- No data model changes needed — reads from existing TL# records

---

## Part 12 — Permanent Architecture Rules

These rules are as permanent as ADR-011 (phoneNorm canonical identity):

1. **One customer, one identity.** A phone number belongs to exactly one customer per company. `CustomerIdentityService.resolveOrCreate()` is the only path to create or enrich a customer.

2. **Enrich, never replace.** When a customer returns through any channel, their existing data is never overwritten. New data is appended or smart-updated per the Immutability Contract.

3. **Every interaction is recorded.** Whether the customer is new or returning, one Interaction (`TL#` record with `interactionId`) is written. No entry point may create or enrich a customer without recording an Interaction.

4. **Interactions are immutable.** TL# records are written once, never modified, never deleted.

5. **`interactionId` is always unique.** Generated as `int_<uuid>`. Two interactions for the same customer on the same second must have different IDs.

6. **Protected fields belong to humans.** `assignedTo`, `stage`, `notes`, `follow-ups`, and `tags` (removal) are controlled by explicit human action only. No automation, webhook, or form submission may overwrite them.

7. **Entry point parity.** Every channel that brings a customer in must behave identically. A customer entering via WhatsApp, a form, a CSV, a webhook, or the manual UI must produce the same enrichment outcome.

---

## Part 13 — What Stays Unchanged

- DynamoDB table structure (no new tables)
- Existing GSIs (no new GSIs needed)
- `TL#` write pattern (already immutable and fire-and-forget)
- WhatsApp message routing (routes by phoneNorm — already correct)
- `company-phone-index` GSI (already used for O(1) lookup)
- `LEAD#` DynamoDB key prefix (renaming would be a destructive migration; domain model says "Customer," storage says "LEAD#")
- `publishEvent()` / `writeTlRecords()` contract (no changes)
- All existing TL# event types

---

## Appendix: Why not rename LEAD# to CUSTOMER# in DynamoDB?

Renaming the DynamoDB key prefix would require:
1. A full-table scan and rewrite of all `LEAD#` items to `CUSTOMER#`
2. Updating every GSI that uses the prefix (leadsByCompany, company-phone-index)
3. Updating every route, service, and script that constructs PK strings
4. A coordinated, zero-downtime cutover

The value-to-cost ratio is low. The storage key is an implementation detail. The domain model (`CustomerIdentityService`, Customer360, "customer" in API responses) already speaks the right language. Rename the keys if and when a full platform rewrite is planned. Until then: storage says `LEAD#`, domain says Customer.
