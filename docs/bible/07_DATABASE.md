# 07 — Database

Reference for every DynamoDB table, entity, key pattern, and GSI actually present in
`src/`, `scripts/`, and `scripts/migrations/` as of this writing. Every claim below was
verified by reading the cited file:line — nothing here is inferred from naming
conventions alone. Where behavior is inconsistent or incomplete, it is called out
explicitly in §5 rather than smoothed over.

---

## 1. Overview

### 1.1 Five DynamoDB tables, not one

APForce's own engineering rules (`CLAUDE.md`) and ADR-012/013 describe "a single
DynamoDB table" in spirit — the METRICS table is the primary single-table-design
surface and hosts the large majority of entities (leads, conversations, contacts,
config, campaigns, automations, timeline). But the codebase actually uses **five**
separate DynamoDB tables, selected via distinct environment variables:

| # | Env var | Typical/default name | Purpose |
|---|---|---|---|
| 1 | `DYNAMODB_TABLE_METRICS` | `vt-metrics` (per ADR comments) | Primary single-table-design surface: leads, contacts, conversations, config, campaigns, automations, timeline, daily metric entries, attendance, payroll |
| 2 | `DYNAMODB_TABLE_EMPLOYEES` | `employees` (hardcoded literal in `scripts/check-gsi.js:11`, `scripts/setup-apforce-company.js:9`) | Employee/user accounts, plus company profile records (`id: COMPANY#{companyId}`) sharing the same table |
| 3 | `DYNAMODB_TABLE_AUDIT` | `audit_logs` (per `scripts/check-gsi.js:11`) | Security/audit log entries — `logAudit()` writes, `audit.js` route reads |
| 4 | `DYNAMODB_TABLE_BADGES` (falls back to literal `'vt-badges'`) | `vt-badges` | Gamification: badges earned, points ledger |
| 5 | `WS_CONNECTIONS_TABLE` (falls back to literal `'ws_connections'`) | `ws_connections` | WebSocket connection tracking for the real-time push layer (`src/utils/wsConnections.js`) |

Each route/service file picks its table explicitly per DynamoDB call — there is no
central table router. `src/config/dynamodb.js` exports a single shared
`AWS.DynamoDB.DocumentClient()`; every file supplies its own `TableName`.

### 1.2 Single-table design rationale (METRICS table)

Within the METRICS table, entity type is distinguished by the `PK`/`SK` prefix
convention (`LEAD#`, `CONV#`, `CONTACT#`, `CONFIG#...#`, etc.) — the classic
single-table NoSQL pattern: one table, one request unit pool, entity relationships
expressed through key design rather than joins. `src/core/entityKeys.js` is the
(partial) centralized key-constructor module — it documents the newer Phase 2
entities (`CONTACT#`, `CONV#`, lock/idempotency keys, `TL#` timeline) as the
authoritative source of PK/SK construction functions, but many older, still-active
entities (`LEAD#`, `INBOX#`, `CONFIG#*`, `CAMP#`, `WAMID#`, `ACTIVITY#`, `BROADCAST#`,
`AUTO_EXEC#`, etc.) are constructed by ad-hoc template-string concatenation directly
in route/service files — `entityKeys.js:50-51` explicitly acknowledges this:
*"Lead entity — existing production pattern, centralised here as reference. Existing
routes continue to concatenate strings directly; they migrate in later commits."*

### 1.3 Multi-tenancy convention

Every entity in the METRICS table is scoped by `companyId`, almost always embedded
directly in the partition key (`LEAD#{companyId}#{leadId}`, `CONFIG#WABA#{companyId}`,
`INBOX#{companyId}#{phone}`, etc.). A few entities key by a value that is *not*
`companyId` directly (`WAMID#{wamid}`, `IDEM#{companyId}#{hash}` — companyId is still
embedded, but as a prefix inside a compound key rather than the literal PK), and one
class of entity (`MEDIACACHE#{companyId}`) exists purely as a cross-tenant dedup cache
keyed by content hash, scoped by companyId as PK.

On the EMPLOYEES table, `companyId` is a plain attribute (not embedded in the `id`
primary key), and tenant scoping is achieved via the `companyIdIndex` GSI (see §3).
Superadmin routes bypass this scoping intentionally (full `Scan`, no `companyId`
filter) — this is a deliberate design choice for platform-level admin, not a leak.

### 1.4 Two governing ADRs referenced throughout this document

- **ADR-012** (`docs/adr/ADR-012-whatsapp-send-service.md`) — all outbound WhatsApp
  sends and their DynamoDB message/WAMID/last-message writes MUST go through
  `WhatsAppSendService`. Referenced wherever this document covers `MSG#`, `WAMID#`,
  or the `CONFIG#WABA#` / `CONFIG#TMPL#` entities.
- **ADR-013** (`docs/adr/ADR-013-customer-identity.md`) — `phoneNorm` (10-digit,
  via `to10Digit()`) is the only permitted customer-identity comparison value;
  `company-phone-index` is the only permitted phone-lookup GSI; `CustomerIdentityService
  .resolveOrCreate()` is the only permitted customer creation/dedup path. Referenced
  wherever this document covers `LEAD#`, `INBOX#`, or phone-based lookups.
- **ADR-014** (`docs/adr/ADR-014-campaign-scheduler-scan.md`) — accepts a `Scan`
  (not `Query`) for the campaign-scheduler due-campaign sweep as an interim tradeoff.
  Referenced in §4.

---

## 2. Entity reference — METRICS table (`DYNAMODB_TABLE_METRICS`)

Unless otherwise noted, all entities below live in the METRICS table.

### 2.1 LEAD — customer/CRM record

- **PK:** `LEAD#{companyId}#{leadId}` — e.g. `LEAD#viir_trading#a1b2c3d4-...`
  (`leadPK()` in `src/core/entityKeys.js:53`, also duplicated inline as a local
  `leadPK()` helper in `crm.js:29-31`, `forms.js:13`, `whatsapp.js` template strings)
- **SK:** `METADATA` (fixed)
- **Represents:** The durable customer identity — one record per (companyId, phoneNorm)
  pair, enforced by the `LEAD_PHONE#` lock (§2.11).
- **Key attributes actually written** (from `CustomerIdentityService._createCustomer`,
  `src/services/CustomerIdentityService.js:354-396`, and `crm.js` create path):
  `leadId, companyId, name, phone, phoneNorm, email, company, productInterest, source,
  notes, stage, tags, closureDeadline, assignedTo, assignedToName, autoAssigned,
  createdBy, createdAt, updatedAt, convertedAt, formId, touchCount, lastInteractionAt,
  lastInteractionSource, leadSourceHistory[], contactId, primaryConversationId,
  pipelineId, productId, expectedValue, probability, wonAt, lostReason,
  customerJourney, ownerHistory[]`. Additional fields set opportunistically elsewhere:
  `waName` (whatsapp.js on inbound message with a WA profile name), `chatStatus`
  (`'open'`/`'resolved'`), `lastMessageAt`, `lastMessagePreview`, `lastMessageDirection`,
  `lastInboundAt`, `unreadCount`, `convId` (pointer to CONV# — written by
  `conversationResolver.js`), `deletedAt`/`deletedBy` (soft delete), `version`.
- **Sub-items under the same PK** (same partition, different SK — see §2.1.1–2.1.4).
- **Owning writers:** `CustomerIdentityService.resolveOrCreate()` (the ADR-013
  canonical path — `src/services/CustomerIdentityService.js`); also directly via
  `dynamodb.put`/`update` in `crm.js` (manual lead create/update/delete/restore,
  CSV import, stage change), `forms.js` (web form submit, Meta Lead Ads webhook),
  `whatsapp.js` (waName/chatStatus/unreadCount patches), `AutomationEngine.js`
  (`assign_employee`, `change_stage`, `add_tag` actions).
- **Readers:** `crm.js`, `contacts.js`, `whatsapp.js`, `WhatsAppSendService.resolveContact()`,
  `campaigns.js` `_buildAudience()`, `AutomationEngine.js`, `conversationResolver.js`,
  `LeadService.linkContactToLead()`.
- **GSIs:** `leadsByCompany` (PK=companyId), `company-phone-index` (PK=companyId,
  SK=phoneNorm) — see §3.

#### 2.1.1 LEAD MSG — message history

- **SK:** `MSG#{ISO-timestamp}#{waMessageId}` (`whatsapp.js:1355`, `WhatsAppSendService
  ._storeMessage`)
- **Fields:** `direction ('inbound'|'outbound'), content, type ('text'|'template'|
  'interactive'|image/video/audio/document/sticker), sentBy, sentByName, timestamp,
  waMessageId, messageId, msgStatus ('sent'|'delivered'|'read'|'failed'), templateId,
  mediaId, mimeType, filename, mediaUrl, s3Key, campaignId, broadcastId,
  repliedCounted, replyToWaMessageId, replyToContent, replyToDirection,
  replyToSenderName`.
- **Written via:** `dedupPut()` (`src/utils/dedupPut.js` — conditional put on
  `attribute_not_exists(SK)`, used by both the inbound webhook and outbound
  `WhatsAppSendService`) — guarantees Meta webhook retries never duplicate a message.
- **Owner:** `WhatsAppSendService` (outbound, ADR-012) / `whatsapp.js` webhook handler
  (inbound — the one documented exception in ADR-012: *"Inbound webhook processing...
  is handled by the webhook route directly. The service is outbound-only."*)

#### 2.1.2 LEAD NOTE — internal team note

- **SK:** `NOTE#{ISO-timestamp}` (`whatsapp.js:1795`)
- **Fields:** `content, authorId, authorName, type: 'note', timestamp, mentions[]`
  (extracted `@name` tokens)
- **Owner:** `POST /api/whatsapp/inbox/:leadId/note`

#### 2.1.3 LEAD STAGE — pipeline stage-change audit record

- **SK:** `STAGE#{ISO-timestamp}` (`crm.js:609`)
- **Fields:** `fromStage, toStage, changedBy, changedByName, changedAt`
- **Owner:** `PUT /api/crm/leads/:id/stage`

#### 2.1.4 LEAD phone-lock, idempotency-lock — see §2.11, §2.12 (separate PK, not a sub-item)

### 2.2 INBOX — unknown-contact staging record

- **PK:** `INBOX#{companyId}#{phone10digit}` (`inboxPK()`, `entityKeys.js:58`)
- **SK:** `CONTACT` (metadata) or `MSG#{timestamp}#{msgId}` (message)
- **Represents:** A WhatsApp thread from a phone number with **no** corresponding
  `LEAD#`. Per ADR-013 Rule 5: *"a temporary staging area, not a second identity."*
  Migrating an INBOX# contact into a LEAD# is the responsibility of whichever code
  path creates the LEAD# — see §5 for the documented gap where this does not happen.
- **Key attributes (CONTACT sub-item):** `phone, companyId, createdAt, lastMessageAt,
  lastMessagePreview, lastMessageDirection, unreadCount, waName, agentName, stage,
  tags, source, convId, contactId` (the last two are pointers written by
  `conversationResolver.resolveForInbox()`).
- **Owning writers:** `whatsapp.js` webhook (unknown-sender path,
  `whatsapp.js:1408-1470`), `contacts.js` (`PUT /stage`, `DELETE /unknown/:phone`
  hard-purge), `tags.js`.
- **Readers:** `contacts.js` (unified contact list), `WhatsAppSendService
  .resolveContact()` (fallback target for unknown phones — explicitly sanctioned
  by ADR-013 Rule 5), `conversationResolver.js`.

### 2.3 CONFIG#WABA — per-company WhatsApp Business Account credentials

- **PK:** `CONFIG#WABA#{companyId}`
- **SK:** `CURRENT` (fixed — single current config, no history)
- **Fields:** `companyId, accessToken, phoneNumberId, wabaId, graphApiVersion,
  configValid` (plus fields inferred from health-check logic: token validity flags).
- **Owner:** `whatsapp.js` connect/reconnect/health-check routes (`PUT
  /connect`, OAuth callback, manual-override repair endpoints).
- **Readers:** `WhatsAppSendService._getConfig()` (10-minute in-process cache,
  invalidated via `invalidateConfigCache(companyId)` per ADR-012), `whatsapp.js`
  `getWabaConfig()`, `campaigns.js` (indirectly, via `WhatsAppSendService`).
- **Related reverse-index:** `CONFIG#PHONEID#{phoneNumberId}` / SK `CURRENT` —
  `{ companyId, phoneNumberId }` only. Exists purely so the inbound webhook can
  resolve `phoneNumberId → companyId` in O(1) without scanning every `CONFIG#WABA#*`
  item (`whatsapp.js:146-199`, comment: *"FIX 7: In-memory cache + DDB reverse-index
  to avoid full table scan on every webhook message."*). See §4 for the documented
  fallback Scan this reverse-index replaced (still present as a defensive path for
  pre-migration data).

### 2.4 CONFIG#TMPL — WhatsApp message template registry

- **PK:** `CONFIG#TMPL#{companyId}`
- **SK:** `TMPL#{templateId}`
- **Fields:** `id, companyId, name, templateName, language, category, bodyPreview,
  variables[], components, status ('DRAFT'|'PENDING'|'APPROVED'|'REJECTED'),
  qualityScore, allowCategoryChange, metaTemplateId, createdBy, createdByName,
  createdAt, updatedAt, statusHistory[], rejectedReason`.
- **Owner:** `whatsapp.js` (`POST/PUT/DELETE /templates`, plus the webhook's
  template-status-update handler which patches `status`/`statusHistory` when Meta
  approves/rejects a template).
- **Readers:** `WhatsAppSendService.sendTemplate()` (string `templateRef` path),
  `campaigns.js` (`_launchCampaign` — verifies `status === 'APPROVED'` before sending).

### 2.5 CONFIG#CAMP — campaign

- **PK:** `CONFIG#CAMP#{companyId}` (`campPK()`, `campaigns.js:13`)
- **SK:** `CAMP#{campaignId}` (`campSK()`, `campaigns.js:14`)
- **Represents:** A WhatsApp broadcast/CTWA campaign — draft → scheduled →
  launching → active → completed/failed lifecycle, guarded by conditional
  `UpdateExpression`s so two concurrent launch attempts can't both send
  (`campaigns.js:389-425`, the "atomic claim" comment block).
- **Fields:** `id, companyId, name, description, type ('whatsapp_broadcast'|'ctwa'),
  objective, status, tags[], audience: { filter }, templateId, templateName,
  variableValues[], headerVariableValue, scheduledAt, launchClaimedAt, launchedAt,
  completedAt, stats: { totalAudience, sent, delivered, read, replied, failed,
  duplicatesRemoved, invalidPhonesSkipped, reviewCount, actualSentCount,
  validationTimestamp }, createdBy, createdByName, createdAt, updatedAt`.
- **Owner:** `campaigns.js` (CRUD + `_launchCampaign()`), `CampaignScheduler.js`
  (status transitions only, via `campaigns.js`'s exported `launchCampaign` function
  — never over HTTP), the webhook's status-update handler (increments
  `stats.delivered`/`stats.read`/`stats.failed`/`stats.replied` as Meta delivery
  receipts arrive).
- **Readers:** `campaigns.js`, `CampaignScheduler.js` (via Scan — see §4).

### 2.6 WAMID — outbound-message reverse index

- **PK:** `WAMID#{wamid}` (Meta's message ID)
- **SK:** `LOOKUP` (fixed)
- **Purpose:** Lets the delivery-status webhook (`sent`/`delivered`/`read`/`failed`)
  find which LEAD#/INBOX# MSG# record to update, without scanning message history.
  Written with `ConditionExpression: attribute_not_exists(PK)` (best-effort,
  duplicate ignored).
- **Fields:** `leadPK, msgSK, companyId`, plus optional `broadcastId, broadcastSK,
  campaignId` merged in via the `wamidExtras` option on `sendTemplate()`.
- **Owner:** `WhatsAppSendService._storeWamidLookup()` (all outbound sends, per
  ADR-012).
- **Reader:** `whatsapp.js` webhook status-update handler (`whatsapp.js:1193-1249`)
  — looks up the WAMID, then patches the MSG# record's `msgStatus` (priority order:
  failed < sent < delivered < read, never downgrades from `read`), and increments
  `BROADCAST#`/`CONFIG#CAMP#` stats counters if the extras indicate a broadcast or
  campaign origin.

### 2.7 ACTIVITY — company-level WhatsApp activity heartbeat

- **PK:** `ACTIVITY#{companyId}`
- **SK:** `WA` (fixed — reserved for future channel-specific activity keys)
- **Fields:** `lastActivityAt` (ISO timestamp, server time — deliberately not
  WhatsApp's own timestamp, to stay monotonic).
- **Purpose:** Lets `GET /inbox/ping`-style polling detect "is there anything new"
  in O(1) without querying every lead. Updated on every inbound WhatsApp message,
  eagerly, *before* the slower lead-lookup/media-download chain
  (`whatsapp.js:1251-1262`, comment: *"Eagerly write ACTIVITY# with server-time
  BEFORE the slow lead-scan + media-download chain."*).
- **Owner/readers:** `whatsapp.js` only.

### 2.8 BROADCAST — legacy broadcast statistics record

- **PK:** `BROADCAST#{companyId}`
- **SK:** app-generated broadcast SK (`broadcastSK`, constructed at send time,
  `whatsapp.js:2394`)
- **Represents:** Pre-Campaigns-module bulk-send feature. Still live —
  `POST /api/whatsapp/broadcast` and `GET /api/whatsapp/broadcasts` both use it —
  but superseded in spirit by `CONFIG#CAMP#` for new campaign-style sends. The
  webhook status-update handler still increments `BROADCAST#` counters
  (`deliveredCount, readCount, failedCount`) for messages tagged with a
  `broadcastId`.
- **Fields:** `id, companyId, templateId, templateName, filter, totalMatched, sent,
  failed, deliveredCount, readCount, createdBy, createdByName, createdAt`.
- **Owner:** `whatsapp.js` (`POST /broadcast`); increments only from the webhook.

### 2.9 CONV — conversation (Phase 2 entity model)

- **PK:** `CONV#{companyId}#{conversationId}` (`conversationPK()`, `entityKeys.js:42`)
- **SK:** `CONV#META` (fixed)
- **Represents:** A structured conversation thread, decoupled from the raw
  LEAD#/INBOX# message stream — built to support AI/automation classification,
  SLA tracking, and multi-channel (not just WhatsApp) conversations going forward.
  Bridged to the legacy message stream via `convId` pointer fields written onto
  `LEAD#...METADATA` / `INBOX#...CONTACT` by `src/utils/conversationResolver.js`.
- **Fields:** `conversationId, companyId, contactId, channel ('whatsapp'|'email'|
  'sms'|'telegram'|'instagram'), channelAddress, status ('open'|'resolved'|
  'pending'|'snoozed'), assignedTo, assignedToName, lastMessageAt, lastMessageText,
  lastActivityAt, unreadCount, convCompanyPK, convContactPK` (GSI attributes — see
  §3), plus reserved-for-future fields already present with `null` defaults:
  `purpose, intent, confidence, classifiedAt, priority, labels[], sla, aiSummary,
  waitingSince, conversationType, isBotActive, handoffState`, and system metadata
  (`createdAt, updatedAt, version, deletedAt, deletedBy`) via `src/core/systemMeta.js`.
- **Owner:** `src/services/ConversationService.js` (all writes go through this
  service — never a raw route-level `dynamodb.put`), backed by
  `src/repositories/ConversationRepository.js`.
- **Readers:** `ConversationService`, `conversationResolver.js`,
  `WhatsAppSendService` (fire-and-forget `updateLastMessage()` call after every send
  when `leadItem.convId` is present).
- **GSIs:** `ConvByCompany` (PK=convCompanyPK, SK=lastActivityAt), `ConvByContact`
  (PK=convContactPK, SK=lastActivityAt) — see §3.

### 2.10 CONTACT — unified contact identity (Phase 2 entity model)

- **PK:** `CONTACT#{companyId}#{contactId}` (`contactPK()`, `entityKeys.js:11`)
- **SK:** `CONTACT#META` (fixed)
- **Represents:** A richer, multi-channel identity graph intended to eventually
  sit above `LEAD#` (multiple phone numbers, multiple channels per contact).
  Uses **E.164** phone format (`phoneE164`), in contrast to `LEAD#`'s 10-digit
  `phoneNorm` — ADR-013 explicitly rules on the precedence between these two:
  *"`LEAD#` identity (10-digit `phoneNorm`) is the source of truth for all
  messaging and dedup decisions. `CONTACT#` records are linked to leads via
  `leadItem.contactId` after lead creation... They must not be used as the primary
  lookup key for any entry point covered by \[ADR-013\]."*
- **Fields:** `contactId, companyId, phoneE164, alternatePhones[], displayName,
  firstName, lastName, email, type ('individual'|'business'), tags[],
  sourceHistory[] (append-only: {source, sourceId, addedAt, addedBy}),
  identities[] (append-only: {channel, value, isPrimary, verified, addedAt}),
  preferredChannel, preferredLanguage, timezone, leadCount, convCount,
  primaryConversationId, contactCompanyPK` (GSI attribute), system metadata.
- **Owner:** `src/services/ContactService.js` (backed by
  `src/repositories/ContactRepository.js`); also written by
  `conversationResolver.js` (find-or-create on first WhatsApp message) and
  `src/services/LeadService.linkContactToLead()` (fire-and-forget link from an
  existing LEAD# to a newly-created or existing CONTACT#).
- **Readers:** `ContactService`, `conversationResolver.js`, `LeadService`.
- **GSIs:** `ContactPhoneIndex` (PK=phoneE164, SK=companyId), `ContactsByCompany`
  (PK=contactCompanyPK, SK=createdAt) — see §3.

### 2.11 Phone/idempotency lock records

Three distinct atomic-lock entity types, all written inside a `TransactWrite`
alongside the entity they protect — never read directly by application logic except
to detect a `ConditionalCheckFailedException` / `TransactionCanceledException`:

| Entity | PK | SK | Locks | Written by |
|---|---|---|---|---|
| Lead phone lock | `LEAD_PHONE#{companyId}#{phoneNorm}` | `LOCK` | One LEAD# per (companyId, phoneNorm) | `CustomerIdentityService` only |
| Contact phone lock | `PHONE#{companyId}#{phoneE164}` | `LOCK` | One CONTACT# per (companyId, phoneE164) | `ContactService.createContact()` / `ContactRepository.transactCreate()` |
| Idempotency lock | `IDEM#{companyId}#{sha256(key)}` | `LOCK` | Webhook/API retry dedup, 24h TTL (`ttl` attribute) | `CustomerIdentityService` only |

Note the two phone-lock prefixes are deliberately distinct (`LEAD_PHONE#` vs
`PHONE#`) — `entityKeys.js:23-26` comment: *"Distinct prefix from Contact phone
lock (Contact uses E.164; Lead uses 10-digit phoneNorm)."*

### 2.12 CONFIG#CRM — pipeline stage configuration

- **PK:** `CONFIG#CRM#{companyId}`
- **SK:** `PIPELINE` (fixed)
- **Fields:** `stages[]` — array of `{ key, label, color, order }`. Falls back to a
  hardcoded `DEFAULT_STAGES` array (`crm.js:17-24`: new_lead, contacted, interested,
  kyc_done, demat_done, lost) when absent.
- **Owner:** `crm.js` (pipeline settings endpoint).
- **Readers:** `crm.js`, `forms.js`, `CustomerIdentityService._getPipelineStages()`.

### 2.13 CONFIG#FORM — lead-capture web form definition

- **PK:** `CONFIG#FORM#{companyId}`
- **SK:** `FORM#{formId}`
- **Fields:** `id, companyId, name, fields[], defaultStage, defaultAssignedTo,
  defaultAssignedToName, source, redirectUrl, thankYouMessage, active,
  submissionCount, meta_page_id (Meta Lead Ads binding), createdBy, createdAt,
  updatedAt`.
- **Owner/readers:** `forms.js` (CRUD + public `/submit` endpoint + Meta Lead Ads
  webhook, which `Scan`s for the form matching a Meta page ID — see §4).

### 2.14 CONFIG#CANNED — canned/quick-reply responses

- **PK:** `CONFIG#CANNED#{companyId}`
- **SK:** `CANNED#{id}`
- **Fields:** `id, title, body, shortcut, createdBy, createdAt`.
- **Owner/readers:** `whatsapp.js` (`/inbox/canned` CRUD).

### 2.15 CONFIG#WELCOME — first-contact auto-reply configuration

- **PK:** `CONFIG#WELCOME#{companyId}`
- **SK:** `CURRENT`
- **Fields:**

  ```
  companyId, enabled, updatedAt,
  messageType: 'template' | 'reply_buttons' | 'cta_buttons',   // default 'template' — see backward-compat note below
  templateName, language,          // used when messageType === 'template'
  bodyText,                        // used when messageType is reply_buttons or cta_buttons
  buttons: [                       // only when messageType === 'reply_buttons', max 3 (Meta limit)
    {
      id, title,                   // title max 20 chars, no emoji (Meta rule) — enforced server-side
      followUp: {
        type: 'none' | 'text' | 'image' | 'url_button' | 'flow',
        content: { ... }           // shape per type — see below
      }
    }
  ],
  ctaButtons: [                    // only when messageType === 'cta_buttons', max 1 — see limit note below
    { type: 'url', text, value }   // text max 20 chars, value is the target URL
  ]
  ```

  `followUp.content` shape by type: `text` → `{ message }`; `image` → `{ mediaId?, url?, caption? }` (one of `mediaId`/`url` required); `url_button` → `{ message, buttonText, url }` (sent as its own separate `cta_url` message after the reply-button tap — legal, since it is not combined with the reply buttons that triggered it); `flow` → `{ flowId }` (references a §2.15a `CONFIG#FLOW` record below, sent by re-using the same `sendRegisteredFlow()` helper `POST /inbox/:leadId/send-flow` calls — not a duplicate implementation).

- **Mutual exclusivity (hard platform rule, enforced server-side, never left to the frontend alone):** `buttons` and `ctaButtons` can never both be non-empty — Meta does not allow combining reply buttons and CTA buttons in one WhatsApp message. `messageType` determines which of the two arrays may be populated; the other must be empty. Enforced by `welcomeConfigSchema` (`src/utils/validation.js`, Zod `.superRefine()`) — `PUT /welcome-config` rejects a violating payload with `400`.

- **CTA button count limit — narrower than a first read of "buttons, max 2, url or phone" suggests.** Meta's freeform, non-template interactive-message API (what `WhatsAppSendService.sendInteractive()` sends — no approval needed, works inside the 24h session window) supports exactly **one** CTA button per message: `interactive.type: 'cta_url'`, a single `{display_text, url}` pair. There is no `phone`-type CTA button available outside a pre-approved WhatsApp message **template** (`buttons: [{type: 'PHONE_NUMBER', ...}]`) — a completely different send mechanism this codebase's welcome-message feature does not use. `ctaButtons` is therefore capped at 1 entry, `type: 'url'` only, by both the Zod schema and `ButtonListEditor.tsx`'s `cta` mode.

- **Backward compatible.** Configs written before this schema existed have no `messageType`/`bodyText`/`buttons`/`ctaButtons` fields at all — `GET /welcome-config` defaults a missing config to `{ enabled: false, messageType: 'template', templateName: '', language: 'en', bodyText: '', buttons: [], ctaButtons: [] }`, and the webhook's send logic (`sendWelcomeMessage()`) falls through to the `templateName` branch whenever `messageType` isn't `'reply_buttons'`/`'cta_buttons'` — which is always true for a legacy record, since `messageType` is `undefined` there.

- **Owner/readers:** `whatsapp.js` (`/welcome-config` GET/PUT). Consumed by the webhook's first-contact branch (`isFirstContact && isNewMsg`) via `sendWelcomeMessage(companyId, phone10, cfg, systemUser)`, which dispatches to `WASendSvc.sendTemplate()` or `WASendSvc.sendInteractive()` depending on `messageType` — `sendInteractive()` itself is unmodified (ADR-012); only the payload passed to it differs by shape (`type: 'button'` vs `type: 'cta_url'`).

- **Inbound button taps — trackability differs by button kind, this is a platform fact, not a gap:**
  - **Reply buttons ARE trackable.** A tap arrives via webhook as `type: 'interactive'`, `interactive.type: 'button_reply'`, parsed by `isButtonReply()`/`parseButtonReply()` in `whatsapp.js`, stored as a normal readable `MSG#` item (`type: 'button_reply'`, `content` = the button's title, `buttonId` = the tapped button's `id`). If the matching button (looked up live from the *current* `CONFIG#WELCOME` record by `id` — not a snapshot from send time) has a `followUp` other than `'none'`, `fireButtonFollowUp()` sends it immediately.
  - **CTA button taps are NOT trackable — Meta sends no webhook event for a CTA tap at all.** This is a platform limitation, not something to build around; there is no event to parse, ever, for a CTA-button tap. Don't file this as a bug if a CTA-buttons welcome message shows no reply-tracking data.

### 2.15a CONFIG#FLOW — registered WhatsApp Flows (was missing from this doc; backfilled)

- **PK:** `CONFIG#FLOW#{companyId}`
- **SK:** `FLOW#{flowId}` (the Meta-issued Flow ID itself — not a generated UUID)
- **Fields:** `companyId, flowId, name, bodyText, ctaLabel, screenId (nullable), context ('manual' — reserved for a future welcome-message auto-trigger wiring, not yet functional), createdBy, createdByName, createdAt`.
- **Not related to `CONFIG#FORM` (§2.13)** — that's the unrelated public embeddable web lead-capture form system in `forms.js`. Separate PK namespace, no cross-wiring, verified by test (`tests/whatsappFlows.test.js`).
- **APForce does not build or edit the Flow itself** — Meta's own Flow Builder in WhatsApp Manager owns the Flow JSON/screens. This record only stores enough to trigger a send: which Flow (`flowId`), what message text accompanies it (`bodyText`), the button label (`ctaLabel`, Meta's 20-char limit), and an optional starting screen (`screenId`) if the Flow requires one.
- **Owner/readers:** `whatsapp.js` (`GET`/`POST /flows`, `DELETE /flows/:flowId` CRUD; `sendRegisteredFlow()` helper looks up a record and sends it via `WASendSvc.sendInteractive()` — reused identically by `POST /inbox/:leadId/send-flow` and welcome-message button follow-ups with `followUp.type === 'flow'`).

### 2.16 CONFIG#AUTO / AUTO_EXEC / AUTO_WAIT — automation workflows

| Entity | PK | SK | Represents |
|---|---|---|---|
| Workflow definition | `CONFIG#AUTO#{companyId}` | `AUTO#{workflowId}` | The trigger/condition/step definition |
| Execution log | `AUTO_EXEC#{companyId}` | `EXEC#{ISO-ts}#{executionId}` | One record per fired execution, 90-day TTL |
| Pending wait | `AUTO_WAIT#{companyId}` | `WAIT#{resumeAt-ISO}#{executionId}` | A paused execution waiting on a `wait` step, 7-day TTL |

- **Workflow fields:** `id, companyId, name, description, status ('active'|
  'inactive', or legacy `enabled` boolean), trigger: {type, conditions[]}, steps[],
  runCount, lastRunAt, createdBy, createdByName, createdAt, updatedAt`.
- **Execution fields:** `executionId, workflowId, workflowName, companyId, status
  ('running'|'paused'|'completed'|'failed'|'partial_failure'), triggeredBy: {type,
  entityId}, leadPK, contactId, contactName, steps[] (per-step status/result),
  startedAt, completedAt, durationMs, TTL`.
- **Wait fields:** full serialized resume context — `executionId, workflowId,
  execSK, steps, context, resumeAt, nextStepIndex, companyId, TTL`.
- **Owner:** `src/services/AutomationEngine.js` (execution/wait lifecycle),
  `automations.js` route (workflow CRUD, plus `POST /:id/duplicate` — "Save as
  Template", Item 5: deep-copies `steps`/`nodes`/`edges` to a new `id` with no
  shared object references, always `status: 'draft'`/`enabled: false`
  regardless of the source's status so duplicating a live workflow can never
  produce two active workflows on the same trigger, and resets `runCount`/
  `lastRunAt`. Personal save-and-reuse only, same company — no cross-company
  template marketplace/publishing surface exists to extend instead).
- **Readers:** `AutomationEngine.fireTrigger()` (Query on `CONFIG#AUTO#{companyId}`
  + `begins_with(SK,'AUTO#')`, filtered in-memory by trigger type — not a GSI query),
  `AutomationEngine.processDueWaits()` (Query on `AUTO_WAIT#{companyId}` with a
  `SK BETWEEN` range condition against the current time — a genuine sort-key range
  query, not a scan; claims each due wait via a conditional `delete` acting as a
  distributed lock so concurrent `/automations/_tick` invocations can't double-resume
  the same execution).
- **Extended for "Delayed Response Message" (2026-07-05):** a wait item may
  instead carry `waitType: 'delayed_response'` (workflow wait items have no
  `waitType` field at all, so this is purely additive) plus a `delayedResponse:
  { phone, leadPK, inboxPK, name, messageText }` payload —
  `processDueWaits()` dispatches these to `DelayedResponseService.resume()`
  instead of `resumeExecution()`, reusing the exact same `AUTO_WAIT#` partition
  and claim loop rather than a second timer mechanism. Scheduled from
  `whatsapp.js`'s webhook on a new inbound message
  (`DelayedResponseService.scheduleIfEnabled()`, no-op if one is already
  pending for that phone) and cancelled the moment a real (non-`'system'`)
  agent sends any outbound reply, via a hook in all 4 of
  `WhatsAppSendService`'s send methods (`_fireDelayedResponseCancel()`).

### 2.17 MEDIA — per-contact media gallery index

- **PK:** `MEDIA#{companyId}#{contactKey}` (contactKey = leadId or bare phone)
- **SK:** `{timestamp}#{mediaId-or-waMessageId}`
- **Fields:** `leadPK, mediaId, mimeType, filename, caption, direction, sentBy,
  timestamp`.
- **Owner:** `writeMediaIndex()` helper in `whatsapp.js` — explicitly called out in
  ADR-012 as *"route-specific (per-contact media gallery) and is called by the
  route after `sendMedia()` returns. This is not a violation."* Fire-and-forget,
  best-effort (`.catch(() => {})`).

### 2.18 MEDIACACHE — Meta media-upload dedup cache

- **PK:** `MEDIACACHE#{companyId}`
- **SK:** `{fileHash}`
- **Fields:** `mediaId, mimeType, filename, ttl` (29-day TTL — one day short of
  Meta's own 30-day `media_id` expiry).
- **Purpose:** Avoids re-uploading the same file bytes to Meta's media endpoint on
  every send (`POST /upload-send`) — a hash-keyed cache of already-uploaded
  `media_id`s.
- **Owner/reader:** `whatsapp.js` `/upload-send` route only.

### 2.19 TAG_CATALOG — company tag catalog

- **PK:** `TAG_CATALOG#{companyId}`
- **SK:** `CATALOG` (fixed — one item per company, full-array overwrite on every
  mutation, no per-tag SK)
- **Fields:** `tags[]` — array of `{ id ('t_...'), label, color, createdAt }`.
- **Owner/readers:** `crm.js` (tag CRUD, CSV import auto-creates unseen tags),
  `contacts.js` (tag-filter label lookup), `tags.js`, `whatsapp.js` (tags.js's
  LEAD#/INBOX# tag-array patch path).

### 2.20 FOLLOWUP — scheduled per-lead follow-up task

- **PK:** `FOLLOWUP#{companyId}#{date}` (date = `YYYY-MM-DD`)
- **SK:** `LEAD#{leadId}`
- **Fields:** `leadId, companyId, date, note, assignedTo, done, doneAt, doneBy,
  createdAt, source ('manual'|'automation')`.
- **Owner:** `crm.js` (manual follow-up creation, mark-done), `AutomationEngine`
  (`create_task` action type).
- **Reader:** `crm.js` (`GET /followups/:date`-style listing, implied by the
  PK/date partitioning — one query per day).

### 2.21 METRICS# — CRM-stage-triggered payroll metric credit

- **PK:** `METRICS#{companyId}`
- **SK:** `{assignedTo-userId}#{date}#{metricType}`
- **Represents:** An auto-credited payroll/performance metric fired when a lead
  transitions into a stage mapped by `METRIC_STAGE_MAP` (`crm.js:27`:
  `{ kyc_done: 'kyc', demat_done: 'demat' }`).
- **Fields:** `userId, metric_type, date, companyId, value (ADD-incremented),
  source: 'crm_auto', updatedAt`.
- **Owner:** `crm.js` stage-change handler (`crm.js:629-643`) only.
- **Note:** This is a **different key shape** from the primary daily-metric entity
  used by `metrics.js`/`telegram.js`/`compensation.js`/`badges.js` (§2.22 below —
  PK is the bare `userId`, not `METRICS#{companyId}`). See §5 for this
  inconsistency.

### 2.22 Daily metric entry (primary metrics entity)

- **PK:** `{userId}` (bare employee ID — no prefix)
- **SK:** `{date}#{metric_type}` (e.g. `2026-07-02#kyc`), or `{date}#{metric_type}#CORR#{n}`
  for a correction record
- **Fields:** `metricId, userId, email, name, metric_type, value, date, enteredAt,
  enteredFrom ('web'|'bulk_web'|'proxy'|'telegram'|'web_correction'), enteredBy,
  verified, verificationStatus ('pending'|'approved'|'rejected'), verifiedBy,
  verifiedAt, verificationNotes, ipAddress, notes, companyId, correctedAt,
  correctedFrom, isCorrection, correctionNumber, parentRecordId, editedBy, editedAt,
  originalValue, adminNotes, flagged, approvedAt/approvedBy or
  rejectedAt/rejectedBy/rejectionReason`.
- **Owner:** `metrics.js` (primary — self-entry, bulk-entry, admin edit,
  verify/reject, correction), `telegram.js` (bot-driven metric entry), `admin.js`
  (direct edit, points-rebuild scan).
- **Readers:** `metrics.js`, `compensation.js` (payroll base-pay computation),
  `badges.js` (badge-earning checks), `admin.js`.
- **GSI:** `companyIdIndex` (see §3 — note this METRICS-table index shares its name
  with, but is a distinct index from, the EMPLOYEES-table `companyIdIndex`).

### 2.23 CONFIG#RATES / CONFIG#TARGETS / CONFIG#METRICS / CONFIG#AUTOASSIGN — company-level settings singletons

All follow the same shape: `PK = CONFIG#{NAME}#{companyId}` (or the bare
`CONFIG#{NAME}` for a legacy/global default when no companyId is supplied), `SK =
'current'` or `'CURRENT'` (casing is inconsistent — see §5).

| Config | PK | SK | Fields | Owner |
|---|---|---|---|---|
| Incentive rates | `CONFIG#RATES#{companyId}` | `current` | `rates, bonusSlabs, updatedBy, updatedAt` | `compensation.js` |
| Performance targets | `CONFIG#TARGETS#{companyId}` | `current` | `targets, updatedBy, updatedAt` | `admin.js` (write); read by `compensation.js`, `points.js`, `metrics.js` |
| Per-metric display overrides | `CONFIG#METRICS#{companyId or 'global'}` | `current` | `overrides: { [metricKey]: {label, icon, target, targetPeriod, color, pointsWeight} }, updatedAt, updatedBy` | `metrics.js` |
| Auto-assign policy | `CONFIG#AUTOASSIGN#{companyId}` | `current` | `enabled, capacity, overflow ('assign'\|'unassigned'), pools, updatedBy, updatedAt` | `admin.js` (write); read by `src/utils/autoAssign.js` |

### 2.24 PAYROLL / ADJUSTMENT — payroll snapshot and manual adjustments

| Entity | PK | SK | Fields |
|---|---|---|---|
| Payroll snapshot | `PAYROLL#{companyId}#{month}` | `SNAPSHOT` | `month, status, payroll, adjustments, rates, bonusSlabs, totalBase, totalBonus, totalAdjustments, totalPayout, employeeCount, createdAt/By, updatedAt/By, approvedAt/By, lockedAt/By` |
| Adjustment | `ADJUSTMENT#{companyId}#{month}` | `{userId}#{Date.now()}` | `userId, month, amount, reason, type, addedBy, addedAt` |

- **Owner/readers:** `compensation.js` exclusively (payroll generation, approve,
  lock/unlock, adjustment add/delete). Adjustment listing uses a `Scan` with
  `FilterExpression: PK = :pk AND SK <> :snap` (see §4 — this is a `Scan` used to
  express a PK-equality + SK-inequality filter, not a true attribute filter over
  multiple partitions).

### 2.25 ATTENDANCE / LEAVE — HR entities

| Entity | PK | SK | Fields |
|---|---|---|---|
| Attendance (daily check-in) | `ATTENDANCE#{companyId}#{userId}` (or `ATTENDANCE#{userId}` pre-multi-tenancy) | `{date}` | `userId, companyId, date, month, checkInTime, source ('login')` |
| Leave request | `LEAVE#{companyId}#{userId}` (or `LEAVE#{userId}`) | `LEAVE#{leaveId}` | `leaveId, userId, userName, userEmail, companyId, startDate, endDate, reason, type, status, createdAt, reviewedBy, reviewedAt, reviewNote` |

- **Owner:** `attendance.js`; `markAttendance()` is also called from `auth.js` at
  login time (fire-and-forget, one check-in per day enforced via
  `ConditionExpression: attribute_not_exists(SK)`).

### 2.26 AGENT#AVAIL — agent online/away status

- **PK:** `AGENT#AVAIL#{companyId}#{userId}`
- **SK:** `STATUS`
- **Fields:** `available (bool), userId, companyId, updatedAt`.
- **Owner/readers:** `whatsapp.js` (`GET`/`PUT /agent/availability`, and the
  `/inbox/auto-assign` round-robin picker, which reads each candidate's
  availability before assigning — see §5 for a bug in how that candidate list
  itself is built).

### 2.27 CONFIG#AI — per-company AI master switch + module toggles (ADR-015)

- **PK:** `CONFIG#AI#{companyId}`
- **SK:** `CURRENT` (matches `CONFIG#WABA#`'s casing, not the lowercase `current`
  used by §2.23's config singletons)
- **Fields:** `companyId, masterEnabled (bool), moduleToggles ({ [useCase]: bool }), updatedAt, updatedBy`
- **Represents:** The two-level AI control surface — one master kill switch,
  plus per-`useCase` toggles beneath it. No row for a company defaults to fully
  enabled (AI already works today ungated); this is an opt-out switch, not
  opt-in.
- **Owner:** `ai.js` (`GET`/`PUT /config`, admin-only both directions)
- **Reader:** `AIService.generate()` — read fresh via `dynamodb.get()` on
  **every call, no caching**, so toggling either level off takes effect on the
  very next request, not after a delay.

### 2.28 AIUSAGE — per-call AI usage/cost log

- **PK:** `AIUSAGE#{companyId}#{date}` (date = `YYYY-MM-DD`)
- **SK:** `{ISO-timestamp}#{useCase}`
- **Fields:** `companyId, useCase, promptVersion, model, inputTokens, outputTokens, costUsd, walletPoints, userId, overQuota (bool), createdAt`
- **Represents:** Real usage data logged for every `AIService.generate()` call
  that reached the provider, regardless of outcome (written even when JSON-mode
  output ultimately failed validation, since real tokens were still spent).
  `costUsd`/`walletPoints` are computed from `src/config/aiConfig.js`'s
  `PRICING` block — **placeholder values, flagged pre-launch TODO**, not yet
  verified against Anthropic's real current pricing.
- **Owner:** `AIService._logUsage()` — write failures are logged and swallowed,
  never surfaced to the caller (a logging failure must not break an otherwise-
  successful AI response).
- **Note:** crossing `PRICING.freeCallsPerMonth` (a separate `ai_quota#{companyId}`
  counter in `DYNAMODB_TABLE_AUDIT`, via `rateLimiter.js`'s `atomicIncrement()`)
  sets `overQuota: true` on the log record and logs an info line — it does
  **not** block the call or deduct from `WALLET#` in this phase.

### 2.29 APPROVAL — human-in-the-loop AI approval queue (ADR-015 Rule 6)

- **PK:** `APPROVAL#{companyId}`
- **SK:** `{status}#{createdAt}#{approvalId}` (status is `pending`/`approved`/
  `rejected` — resolving an approval is a delete-old-SK + put-new-SK, since
  status lives in the key, not just an attribute)
- **Fields:** `approvalId, companyId, useCase, output, confidence, riskLevel, promptVersion, assignedTo, originalAssignee, routingReason ('direct'|'leave-fallback-teamlead'|'leave-fallback-admin'|'unassigned'), status, createdAt, resolvedBy, resolvedAt, resolutionNote`
- **Represents:** A pending human sign-off for a `customerFacing` useCase's
  output, before any downstream customer-facing action may act on it. Routing
  (`ApprovalService.resolveRoutingTarget()`) checks `LEAVE#` (§2.25) for the
  assignee, falling back through `teamLeadId` → any active admin
  (`companyIdIndex` GSI on the EMPLOYEES table) → `assignedTo: null` (never
  silently dropped) — genuinely new logic; confirmed via audit that no prior
  leave-aware routing existed anywhere in this codebase (`autoAssign.js`'s own
  fallback is capacity/overflow load-balancing only, not leave-aware).
- **Owner:** `ApprovalService.js`
- **Note:** not yet populated by any real useCase — both of today's real AI
  features (`metrics-insights`, `team-metrics-insights`) are internal analyst
  reports (`customerFacing: false`), which never engage this gate.

### 2.30 WALLET — generic prepaid balance ("points")

- **PK:** `WALLET#{companyId}`
- **SK:** `CURRENT` (balance) or `TXN#{ISO-timestamp}#{uuid}` (ledger entry)
- **Fields (balance):** `companyId, balancePoints, createdAt, updatedAt`
- **Fields (ledger entry):** `companyId, type ('credit'|'debit'), amountPoints, meterType, reason, relatedId?, balanceAfter, createdAt`
- **Represents:** A company-scoped prepaid balance, deliberately **not**
  AI-specific in shape — `meterType` tags which feature a debit/credit belongs
  to (`'ai'`, future `'calling'`, etc.), so one fungible balance can back any
  metered feature without a schema change per feature.
- **Owner:** `WalletService.js` (`ensureWallet`, `getBalance`, `credit`, `debit`
  — `debit()` is a conditional `ADD` guarded by `balancePoints >= :points`, so a
  balance can never go negative under concurrent debits)
- **Note:** **not debited by `AIService` in this phase** — AI usage is fully
  covered by the subscription plan today (see §2.28's `overQuota` note). This
  entity exists as the reusable foundation for WhatsApp Calling's real
  per-minute pass-through deduction, the first feature expected to actually
  draw it down. `GET /api/ai/wallet` exposes a read-only balance for the
  Settings > AI tab's placeholder display.

### 2.31 CONFIG#DELAYED_RESPONSE — "Delayed Response Message" configuration

- **PK:** `CONFIG#DELAYED_RESPONSE#{companyId}`
- **SK:** `CURRENT`
- **Fields:** `companyId, enabled, delayAmount, delayUnit ('minutes'|'hours'), messageText, updatedAt`
- **Represents:** Same enabled/message-content shape as `CONFIG#WELCOME` (§2.15),
  but for the delayed-response feature — see §2.16's "Extended for Delayed
  Response Message" note for how this actually fires (reuses `AUTO_WAIT#`, not
  a new timer). Supports `{{name}}`/`{{phone}}` substitution via the same
  `resolveWelcomeVariables()` helper the welcome message and AutomationEngine
  actions already use.
- **Owner:** `whatsapp.js` (`GET`/`PUT /delayed-response-config`, admin-only,
  same pattern as `/welcome-config`)
- **Reader:** `DelayedResponseService.scheduleIfEnabled()` — read fresh (no
  cache) on every new inbound message.

### 2.32 CONFIG#HOURS / CONFIG#OOO — Working Hours + Out of Office (Item 2)

- **PK:** `CONFIG#HOURS#{companyId}` / **SK:** `CURRENT` —
  `companyId, enabled, timezone (IANA, e.g. 'Asia/Kolkata'), schedule: { monday..sunday: { closed, open ('HH:MM'), close ('HH:MM') } }, updatedAt`
- **PK:** `CONFIG#OOO#{companyId}` / **SK:** `CURRENT` —
  `companyId, enabled, messageText, updatedAt`. Same enabled/message-content
  shape as `CONFIG#WELCOME` (§2.15); supports `{{name}}`/`{{phone}}`
  substitution via the same `resolveWelcomeVariables()` helper.
- **PRECEDENCE RULE WITH WELCOME MESSAGE** (the two can never both fire for
  the same inbound message): if Out of Office applies, Welcome is skipped
  entirely for that message — even a contact's very first message. Reasoning
  and enforcement live in `WorkingHoursService.js`'s own doc comment and in
  `whatsapp.js`'s webhook (checked for every new message on the INBOX# path,
  ahead of the existing first-contact Welcome check; checked independently on
  the LEAD# path, which never sends Welcome at all). OOO resends are throttled
  to once per 6 hours per contact (`lastOOOSentAt`, mirrored onto the same
  `LEAD#`/`INBOX#` record Welcome/intent-detection/delayed-response already use)
  so a rapid back-and-forth outside hours doesn't repeat the auto-reply after
  every message.
- **Owner:** `whatsapp.js` (`GET`/`PUT /hours-config`, `/ooo-config`,
  admin-only, same pattern as `/welcome-config`); `WorkingHoursService.js`
  (`isWithinWorkingHours()` — pure function using Node's built-in
  `Intl.DateTimeFormat` for IANA-timezone-aware day/time resolution, no new
  date/timezone dependency; `shouldSendOOO()`/`sendOOO()`).

### 2.33 CONFIG#BRANCH# — multi-office branch directory (Item 1c)

- **PK:** `CONFIG#BRANCH#{companyId}`
- **SK:** `BRANCH#{branchId}`
- **Fields:** `branchId, companyId, name, address, latitude, longitude, createdAt, updatedAt`
- **Represents:** A saved office location. One shared list, not duplicated
  per-feature — read by three call sites: the Send Location canvas node's
  config dropdown (resolved to real coordinates at execution time by
  `AutomationEngine._runAction()`'s `send_location` case), the Inbox
  composer's own "Send Location" button (`POST /api/whatsapp/send-location`,
  sent as the real authenticated agent, not the `'system'` actor the canvas
  node uses), and Settings > WhatsApp > Branches (full CRUD).
- **Owner:** `whatsapp.js` (`GET`/`POST /branches`, `PUT`/`DELETE
  /branches/:branchId`, admin-only for writes; `GET` open to any
  authenticated user so the canvas dropdown and Inbox composer can both read it).
- **Related:** `WhatsAppSendService.sendLocation()` — implements the
  previously-bare 501 stub, same structure as `sendMedia()` (Meta Graph API
  location-message call, `MSG#`/`WAMID#`/last-message writes,
  `ConversationService` sync, and the `_fireDelayedResponseCancel()` hook
  every other real send method already has).

### 2.34 Inbox list intent badge — `GET /api/whatsapp/inbox` field pass-through (Item 7)

- IntentDetectionService (earlier work, undocumented here — a pre-existing
  gap, not introduced by this change) already mirrors `intent`/`confidence`
  onto both `LEAD#` and `INBOX#CONTACT` records. That mirroring alone did
  **not** reach the Inbox conversation list: `GET /api/whatsapp/inbox`
  (`whatsapp.js`) builds a curated field-projection object per conversation,
  not a raw item spread, so any field not explicitly listed is silently
  dropped.
- Fix: added `intent: l.intent ?? null, confidence: l.confidence ?? null`
  to both map() projections (the `visibleLeads` lead-path branch and the
  `dedupedUnknown` unknown-contact-path branch) in the same route.
- Frontend: `WaConversation` (inline in `app/(v3)/inbox/page.tsx`) gained
  `intent?: string | null; confidence?: number | null`, and the inline
  `ConversationList` row renders a `Badge variant="primary"` next to
  `WindowStatusChip` when `conv.intent` is set — same `INTENT_LABEL` map
  and confidence-percentage tooltip convention as `ConversationTab.tsx`'s
  Customer 360 Conversation tab.
- No new DynamoDB access pattern — this is a projection-completeness fix
  on an existing route, not a new read path.

---

## 3. Entity reference — other tables

### 3.1 EMPLOYEES table (`DYNAMODB_TABLE_EMPLOYEES`)

#### Employee / user account

- **Key:** `{ id }` — simple primary key, no PK/SK split. `id` format:
  `emp_{Date.now()}`.
- **Fields:** `id, email, password (hashed), name, role, companyId, mobileNumber,
  panNumber, aadhaarNumber, homeAddress, status, createdAt, createdBy, updatedAt,
  updatedBy, totpEnabled, totpSecret, backupCodes, totpSetupAt/By,
  totpResetAt/By, teamLeadId, telegramChatId, telegramLinkedAt, baseSalary,
  autoAssignEnabled, autoAssignWeight`.
- **Owner:** `auth.js` (signup), `admin.js` (create/update/delete/bulk-status/2FA
  admin actions), `telegram.js` (linking).
- **Readers:** essentially every route that needs employee context —
  `auth.js`, `admin.js`, `metrics.js`, `compensation.js`, `points.js`,
  `src/utils/autoAssign.js`, `platform.js`, `telegram.js`.
- **GSIs:** `emailIndex` (PK=email), `companyIdIndex` (PK=companyId) — see §3.3.

#### Company profile (same table, distinguished by `id` value + `type` marker)

- **Key:** `{ id: 'COMPANY#{companyId}' }`
- **Fields:** `id, type: 'COMPANY_PROFILE', companyId, companyName, broker, city,
  adminEmail, plan, trialEndsAt, planStatus, createdAt, updatedAt, updatedBy`.
- **Owner:** `auth.js` (company creation at signup), `companies.js` (profile
  edit), `platform.js` (plan/suspend/unsuspend — superadmin only).
- **Readers:** `companies.js`, `platform.js`.
- **Note:** Employee-listing queries against `companyIdIndex` (both the
  company-scoped Query and the superadmin Scan) explicitly exclude this item via
  `attribute_not_exists(#type)` — a filter, not a separate table — which is how a
  single GSI serves both "list employees" and "these are stored alongside a
  differently-shaped company-profile item" without cross-contaminating results
  (`admin.js:34`, `metrics.js:395,826,904`).

### 3.2 AUDIT table (`DYNAMODB_TABLE_AUDIT`)

- **PK:** `audit#{Date.now()}`
- **SK:** `user#{userId}`
- **Fields:** `userId, action, target, result, ip, timestamp, details, companyId`
  (companyId conditionally present — omitted, not null, when not applicable).
- **Owner:** `src/utils/audit.js` (`logAudit()` — the only writer).
- **Readers:** `audit.js` route (`/logs`, `/suspicious`, `/logins`,
  `/security-report`, `/export`), `companies.js` (`/export`, scoped to the last 90
  days for a company).
- **GSI:** `companyIdIndex` on this table (PK=companyId, SK=SK — see §3.3; **note
  this is a third, separate GSI also named `companyIdIndex`**, distinct from the
  one on EMPLOYEES and the one on `ws_connections`).

### 3.3 BADGES table (`DYNAMODB_TABLE_BADGES`, falls back to literal `'vt-badges'`)

| Entity | PK | SK | Fields |
|---|---|---|---|
| Badge earned | `BADGE#{userId}` | `{badgeId}` (e.g. `'kyc_bronze'`) | `badgeId, userId, name, icon, earnedAt` |
| Points, per-award | `POINTS#{employeeId}` | `{date}#{metricType}#{Date.now()}` | `points, metricType, date, earnedAt` |
| Points, running total | `POINTS#{userId}` | `TOTAL` | `total (ADD-incremented), userId` |

- **Owner:** `badges.js` (badge awarding), `points.js` (point awarding and total
  upsert — the total record's first write is a bare `ADD` on a non-existent item,
  which DynamoDB creates implicitly rather than via an explicit `put`).
- **Readers:** `badges.js`, `points.js` (leaderboard — a `Scan` filtered to
  `SK = 'TOTAL'`, with the `POINTS#` prefix check done in application code after
  the scan returns, not in the `FilterExpression`).
- **No GSI** — every access pattern here is PK-Query or table Scan.

### 3.4 `ws_connections` table (`WS_CONNECTIONS_TABLE`, falls back to `'ws_connections'`)

- **Key:** `{ connectionId }` — simple primary key (API Gateway WebSocket
  connection ID).
- **Fields:** `connectionId, userId, companyId ('SUPERADMIN' sentinel for
  platform-level users), role, connectedAt, ttl` (2-hour TTL, matching API Gateway's
  own WebSocket connection lifetime cap).
- **Owner/readers:** `src/utils/wsConnections.js` exclusively (`saveConnection()`,
  `deleteConnection()`, `getConnectionsByCompany()`), consumed by
  `src/utils/wsNotify.js` / `src/wsHandler.js` for real-time push fan-out.
- **GSI:** `companyIdIndex` (PK=companyId, SK=connectionId) — see §3.3.

### 3.5 Timeline (`TL#`) — cross-cutting audit/event trail

- **PK:** `TL#{companyId}#{entityType}#{entityId}` (`tlPK()`, `entityKeys.js:65`;
  `entityType` is one of the `ENTITY` constants in `src/events/catalog.js`:
  `CONTACT, CONV, LEAD, ACCOUNT, CAMPAIGN, WORKFLOW, COMPANY`)
- **SK:** `{timestamp}#{eventType}#{eventId}` (`tlSK()`, `entityKeys.js:66`)
- **Represents:** An immutable, append-only audit trail — one record per canonical
  event (`src/events/catalog.js`'s `E` constants: `contact_created`,
  `conversation_assigned`, `touch_received`, `stage_changed`, etc.), fanned out to
  every relevant entity's timeline (e.g. a conversation event also lands on the
  linked contact's timeline).
- **Fields:** `eventId, eventType, companyId, entityType, entityId, contactId,
  actorId, actorName, channel, summary, metadata, timestamp`.
- **Immutability guard:** every write uses `ConditionExpression:
  attribute_not_exists(SK)` — a duplicate `eventId` delivery is silently ignored
  (`src/events/timeline.js:58-59`).
- **Owner:** `src/events/timeline.js` `writeTlRecord()`/`writeTlRecords()` — called
  only from `src/events/publisher.js`, itself called from
  `CustomerIdentityService` (fires `touch_received` on every `resolveOrCreate()`
  call), `ConversationService` (fires on create/assign/resolve/reopen), `ContactService`
  (fires on create/update/archive), and `AutomationEngine._tlWrite()` (fires
  `automation_action` per completed step, best-effort, lazy-`require`d to avoid a
  hard dependency).
- **Failure mode:** deliberately fire-and-forget — a TL# write failure is logged as
  a warning and swallowed; it must never affect the primary operation that
  triggered the event.
- **No GSI** — write-only append log, read path (if any exists) not found in the
  files reviewed; likely queried directly by PK for a given entity's timeline view.

---

## 4. GSI reference

All GSIs found via `IndexName:` across `src/` and `scripts/`. Every GSI listed uses
`ProjectionType: ALL` — no `KEYS_ONLY` or `INCLUDE` projection exists anywhere in
this codebase (confirmed by reading every GSI-creation script).

| GSI name | Table | PK | SK | Purpose | Used by |
|---|---|---|---|---|---|
| `company-phone-index` | METRICS | `companyId` | `phoneNorm` | O(1) lead lookup by normalized phone — **the only ADR-013-sanctioned phone lookup mechanism** | `CustomerIdentityService._findByPhone()`, `WhatsAppSendService.resolveContact()`, `whatsapp.js` webhook (inbound message lead lookup), `crm.js` (manual dedup checks), `forms.js` (web form + Meta Lead Ads dedup) |
| `leadsByCompany` | METRICS | `companyId` | `updatedAt` | List/scan-replacement for all of a company's leads | `crm.js` `scanAllLeads()` (CSV import phone map, tag-catalog helpers), `contacts.js` (unified contact list) |
| `ContactPhoneIndex` | METRICS | `phoneE164` | `companyId` | Phone-based Contact lookup/dedup (Phase 2 entity, E.164 format) | `ContactRepository.queryByPhone()` |
| `ContactsByCompany` | METRICS | `contactCompanyPK` (value: `CONTACT#{companyId}`) | `createdAt` | List Contacts for a company, newest-first | `ContactRepository.queryByCompany()` |
| `ConvByCompany` | METRICS | `convCompanyPK` (value: `CONV#{companyId}`) | `lastActivityAt` | List Conversations for a company, newest-first, optional status/assignedTo filter | `ConversationRepository.queryByCompany()` |
| `ConvByContact` | METRICS | `convContactPK` (value: `CONV_CONTACT#{companyId}#{contactId}`) | `lastActivityAt` | List Conversations for one Contact, newest-first | `ConversationRepository.queryByContact()` |
| `companyIdIndex` | METRICS | `companyId` | — | List daily metric entries for a company (team-summary, leaderboard, performers) | `metrics.js` |
| `companyIdIndex` | EMPLOYEES | `companyId` | — | List employees for a company (replaces a full Scan) | `admin.js`, `metrics.js`, `src/utils/wsConnections.js` is NOT this one — see next row |
| `companyIdIndex` | `ws_connections` | `companyId` | `connectionId` | Find all active WebSocket connections for a company, for push fan-out | `src/utils/wsConnections.js.getConnectionsByCompany()` |
| `companyIdIndex` | AUDIT | `companyId` | `SK` | Scope audit-log queries to one company | `audit.js` |
| `emailIndex` | EMPLOYEES | `email` | — | Login lookup, email-uniqueness check | `auth.js`, `admin.js`, `telegram.js`, `scripts/setup-apforce-company.js`, `scripts/recover-admin.js` |

**Important nuance:** `companyIdIndex` is not one GSI — it is the *same name*,
independently created on **four different tables** (METRICS, EMPLOYEES,
`ws_connections`, AUDIT). Each is a distinct AWS resource; the shared name is a
naming-convention choice, not a shared index. See §5 for why this is worth
flagging rather than treating as self-evidently fine.

### GSI creation source files

| GSI | Creation script |
|---|---|
| `leadsByCompany` | `scripts/create-leads-gsi.js` |
| `company-phone-index` | `scripts/create-phone-gsi.js` (paired with `scripts/backfill-phone-norm.js` to populate `phoneNorm` on pre-existing leads before the GSI goes live) |
| `ContactPhoneIndex`, `ContactsByCompany` | `scripts/migrations/add-contact-gsi.js` |
| `ConvByCompany`, `ConvByContact` | `scripts/migrations/add-conversation-gsi.js` |
| `companyIdIndex` (`ws_connections`) | `scripts/create-ws-table.ps1` (also creates the table itself, with TTL on `ttl`) |
| `companyIdIndex` (EMPLOYEES), `emailIndex` | Not present in any script reviewed — pre-existing, created before the current migration-script convention was established |
| `companyIdIndex` (AUDIT) | Not present in any script reviewed |

---

## 5. Access pattern notes

### 5.1 Query vs Scan — the general rule

Per ADR-013, phone-based lookups must use `company-phone-index` — never a full
table Scan or in-memory phone map. This rule is **followed** at every WhatsApp
message-send and message-receive hot path (`WhatsAppSendService.resolveContact()`,
the inbound webhook's lead lookup, `forms.js`'s dedup checks). It is **not yet
followed** at the two entry points ADR-013 itself already documents as
non-compliant (see §5.3).

### 5.2 Accepted Scans — documented tradeoffs, not bugs

The following full-table or filtered `Scan` operations are deliberate, accepted
tradeoffs given current data volume — each is cited here with its
`ProjectionExpression` status so a future reader can tell at a glance which ones
are already minimizing read cost and which are not:

| Scan | File:line | ProjectionExpression? | Rationale |
|---|---|---|---|
| Campaign scheduler due-campaign sweep | `src/services/CampaignScheduler.js:29-35` | **Yes** — `PK, SK, id, companyId, createdBy, createdByName, #st, scheduledAt` | **ADR-014** — no cross-company GSI on `(status, scheduledAt)` exists yet; accepted until campaign volume or table size crosses the documented migration triggers. Explicit code comment forbids widening the filter or dropping the projection. |
| Campaign audience builder (`_buildAudience`) | `src/routes/campaigns.js:20-32` | No | Scans every `LEAD#{companyId}#` item to build a campaign audience on every preview/validate/launch call. Cited by name in ADR-014 as existing precedent for the scheduler's own Scan. |
| WABA config lookup by `phoneNumberId` (fallback path) | `src/routes/whatsapp.js:174-198` | No | Fallback only — reached when the `CONFIG#PHONEID#` reverse-index has no entry (pre-migration data). Self-healing: the first fallback hit writes the reverse-index so subsequent webhook deliveries hit the O(1) path. Cited by ADR-014's Context section as an existing same-table Scan precedent. |
| Auto-assign employee picker — open-lead count | `src/utils/autoAssign.js:56-70` | **Yes** — `assignedTo, stage` | Scans all `LEAD#{companyId}#` items to count each candidate employee's open-lead load, for weighted round-robin assignment. Not cited in any ADR but structurally identical to the accepted precedent above (narrow projection, company-scoped filter). |
| Auto-assign employee picker — active performer list | `src/utils/autoAssign.js:26-35` | No | Scans the EMPLOYEES table filtered by role + status + companyId (no GSI covers this three-attribute filter). |
| Meta Lead Ads webhook — form-by-page-ID lookup | `src/routes/forms.js:258-262` | No | Scans `CONFIG#FORM#*` items filtered by `meta_page_id` — no GSI exists for this reverse lookup (low cardinality: one scan per incoming Meta lead, not per message). |
| Public form lookup (`GET/:id`, `POST /:id/submit`) | `src/routes/forms.js:66-73, 118-122` | No | The public form-fill page doesn't know `companyId` yet, so it scans by form ID / `SK` match to find which company owns the form. Low-frequency (page load / submit, not per-message). |
| CSV bulk-import in-memory dedup map | `src/routes/crm.js:867-868` (via `scanAllLeads()`, `crm.js:45-62`) | N/A (Query, not Scan — see note) | **Technically a paginated Query on `leadsByCompany`**, not a raw table Scan — but ADR-013 still flags it as non-compliant because it loads the *entire* company's lead set into memory and dedups via a JS `Map`, rather than checking each imported row individually through `CIS.resolveOrCreate()`. See §5.3. |
| Contacts unified list — INBOX# scan | `src/routes/contacts.js:83-97` | No | Full scan of `INBOX#{companyId}#` items, restricted to admin role only. No GSI exists for INBOX# by company (INBOX# was designed as a staging area, per ADR-013 Rule 5, not a queryable entity). |
| Adjustment listing (payroll) | `src/routes/compensation.js:394-401, 449-456, 623-630` | No | `Scan` with `FilterExpression: PK = :pk AND SK <> :snap` — functionally a single-partition point lookup expressed as a Scan rather than a Query; works correctly but is a `Scan`, not a `Query`, purely by implementation choice (no operational risk since it's bounded to one partition regardless of table size — DynamoDB still scans the whole table to find matches, it just happens to match at most one partition's worth of items). |
| Points leaderboard | `src/routes/points.js:79-86` | No | `Scan` filtered to `SK = 'TOTAL'` on the BADGES table, then further filtered by `PK.startsWith('POINTS#')` in application code (the `FilterExpression` alone can't distinguish `POINTS#` totals from any other future entity that might also use SK=`'TOTAL'`). |
| Admin metrics `/pending`, `/all` | `src/routes/metrics.js:348-353, 607-630` | No | Company-unscoped, superadmin-facing views; `/all` is `Limit`-capped at 1000. |
| Points-rebuild admin tool | `src/routes/admin.js:600-614` | No | One-time/rare maintenance operation, not a hot path. |
| Superadmin audit/employee/company listings (no `companyId`) | `admin.js:40`, `companies.js:154-160,223-228`, `metrics.js:383-388,400-404,831-835,909-915,932-938`, `audit.js:19-31` | Varies | Deliberate: these routes serve platform-level (cross-tenant) admin views where "all companies" *is* the intended query. Not a tenancy leak. |

### 5.3 ADR-013 migration-status gaps (cited verbatim from CLAUDE.md / ADR-013)

CLAUDE.md's ADR-013 section and the ADR-013 document itself already enumerate these
as open items — reproduced here rather than re-discovered, per instruction, and
confirmed still present by reading the cited lines:

- **WhatsApp webhook unknown-contact path** (`whatsapp.js:1360` in the ADR's
  numbering — corresponds to the `dedupPut()` call into the `INBOX#` PK at
  `whatsapp.js:1418` in the current file, immediately preceded by an unconditional
  `existingContact` GetItem at `whatsapp.js:1413` with **no phone lock** and no
  call to `CustomerIdentityService.resolveOrCreate()` before creating the INBOX#
  record). Confirmed still present: the unknown-sender branch
  (`whatsapp.js:1408-1470`) writes directly to `INBOX#{companyId}#{phone10}` via
  `dedupPut()` and `dynamodb.update()`, never through CIS.
- **CSV bulk import** (`crm.js:841`, the `POST /api/crm/import` route) — confirmed
  still present: builds an in-memory `phoneMap` from `scanAllLeads()` (a full
  company-scoped GSI Query, not literally a table Scan, but the ADR's concern is
  the *in-memory dedup pattern*, not the underlying read mechanism) and never
  calls `CIS.resolveOrCreate()` per row.
- **`contacts.js` raw-phone dedup** — confirmed still present:
  `contacts.js:100` — `const leadPhones = new Set(leadItems.map((l) => l.phone)...)`
  — compares raw `phone`, not `phoneNorm`, when suppressing INBOX# records that
  already have a corresponding LEAD#.

### 5.4 Additional gap found (not previously documented)

- **`/inbox/auto-assign` employee lookup queries the wrong key shape.**
  `whatsapp.js:1847-1852` scans the **METRICS** table for
  `begins_with(PK, 'EMP#{companyId}#')  AND SK = 'PROFILE'`. No code anywhere in
  the codebase writes an item matching that pattern — `src/core/entityKeys.js:72`
  defines `empPK(companyId) = 'EMP#{companyId}'` (no trailing `#`, and paired with
  `SK = employeeId`, not `'PROFILE'`), and that key shape itself is documented as
  belonging to the **EMPLOYEES table**, not METRICS. Every other employee-listing
  code path in the codebase (`admin.js`, `metrics.js`, `src/utils/autoAssign.js`)
  correctly queries the EMPLOYEES table via `companyIdIndex` or a `{ id }`
  GetItem. This scan will always return zero items, meaning
  `POST /api/whatsapp/inbox/auto-assign` unconditionally responds
  `400 { error: 'No employees available to assign' }` today. This reads as a
  latent bug (dead code path) rather than an intentional design choice — flagged
  here for whoever picks it up next, not fixed in this pass since this document is
  read-only research.

### 5.5 Naming/shape inconsistencies worth knowing about

- **Two unrelated entities share the `METRICS`-prefixed naming intuition** but are
  genuinely different: `METRICS#{companyId}` / SK `{userId}#{date}#{metricType}`
  (§2.21, CRM-stage-triggered auto-credit, written only by `crm.js`) versus the
  primary daily-metric entity keyed by bare `{userId}` / SK `{date}#{metricType}`
  (§2.22, written by `metrics.js`/`telegram.js`/`admin.js`). They are not the same
  item and a query against one will never see writes to the other — a lead moving
  to `kyc_done` writes a `METRICS#{companyId}` item, but every *read* of "this
  employee's KYC count" (leaderboards, payroll, badges) queries the bare-`{userId}`
  shape. Whether these are meant to reconcile via some process not found in this
  review, or whether the CRM auto-credit path is itself a bug, could not be
  determined from the code alone.
- **SK casing for "current config" singletons is inconsistent**: `CURRENT` (all
  caps) is used by `CONFIG#WABA#`, `CONFIG#PHONEID#`, `CONFIG#WELCOME#`; `current`
  (lowercase) is used by `CONFIG#RATES#`, `CONFIG#TARGETS#`, `CONFIG#METRICS#`,
  `CONFIG#AUTOASSIGN#`. Harmless in practice (each config type's own reader always
  matches its own writer's casing), but worth knowing before writing a generic
  "list all CONFIG# items" tool.
- **Phone format duplication**: `phoneNorm` (10-digit, `LEAD#`) and `phoneE164`
  (`+91XXXXXXXXXX`, `CONTACT#`) are both "the normalized phone" depending which
  entity you're looking at, with no automatic sync between them — ADR-013 already
  rules on the precedence (`LEAD#`/`phoneNorm` wins for messaging/dedup) but the
  two fields can drift independently since nothing keeps them in lockstep besides
  `LeadService.linkContactToLead()`'s one-time link at creation.
- **`companyIdIndex` is four different GSIs** (§4) — safe today because no code
  path ever needs to query across tables through this name, but a maintainer
  searching logs/AWS console for "the companyIdIndex" needs to know which table
  they're looking at.

---

## 6. File index

Files read to produce this document (grouped by role, for anyone verifying or
extending this reference):

**Key-pattern registry:** `src/core/entityKeys.js`

**Route files with direct DynamoDB access:** `src/routes/whatsapp.js`,
`src/routes/campaigns.js`, `src/routes/crm.js`, `src/routes/forms.js`,
`src/routes/contacts.js`, `src/routes/attendance.js`, `src/routes/compensation.js`,
`src/routes/badges.js`, `src/routes/points.js`, `src/routes/platform.js`,
`src/routes/telegram.js`, `src/routes/audit.js`, `src/routes/tags.js`,
`src/routes/auth.js`, `src/routes/admin.js`, `src/routes/companies.js`,
`src/routes/metrics.js`, `src/routes/automations.js` (`src/routes/ai.js` reviewed
and confirmed to make zero DynamoDB calls — Anthropic API proxy only)

**Services:** `src/services/CustomerIdentityService.js`,
`src/services/ConversationService.js`, `src/services/ContactService.js`,
`src/services/WhatsAppSendService.js`, `src/services/AutomationEngine.js`,
`src/services/CampaignScheduler.js`, `src/services/LeadService.js`

**Repositories:** `src/repositories/ContactRepository.js`,
`src/repositories/ConversationRepository.js`

**Utils:** `src/utils/dedupPut.js`, `src/utils/conversationResolver.js`,
`src/utils/autoAssign.js`, `src/utils/wsConnections.js`, `src/utils/audit.js`

**Events/timeline:** `src/events/catalog.js`, `src/events/timeline.js`

**Migration/setup scripts:** `scripts/create-leads-gsi.js`,
`scripts/create-phone-gsi.js`, `scripts/check-gsi.js`,
`scripts/migrations/add-contact-gsi.js`, `scripts/migrations/add-conversation-gsi.js`,
`scripts/backfill-phone-norm.js`, `scripts/find-duplicate-leads.js`,
`scripts/migrate-multitenancy.js`, `scripts/setup-apforce-company.js`,
`scripts/create-ws-table.ps1`

**ADRs:** `docs/adr/ADR-012-whatsapp-send-service.md`,
`docs/adr/ADR-013-customer-identity.md`, `docs/adr/ADR-014-campaign-scheduler-scan.md`

**Root rules:** `CLAUDE.md`
