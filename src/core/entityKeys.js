'use strict';

// ─── METRICS TABLE ────────────────────────────────────────────────────────────
// All PK / SK constructors for the METRICS (vt-metrics) DynamoDB table.
// No module may concatenate these strings inline — always call these functions.

// Contact entity
// Base:  PK = CONTACT#${companyId}#${contactId}  SK = CONTACT#META
// GSI1 (ContactPhoneIndex):   phoneE164 PK | companyId SK
// GSI2 (ContactsByCompany):   contactCompanyPK PK | createdAt SK
function contactPK(companyId, contactId) { return `CONTACT#${companyId}#${contactId}`; }
function contactSK()                      { return 'CONTACT#META'; }
// Attribute written to each contact item so it appears in the ContactsByCompany GSI.
// Uses a dedicated value to avoid appearing in the leadsByCompany GSI (which keys on raw companyId).
function contactCompanyGsiPK(companyId)   { return `CONTACT#${companyId}`; }

// Phone uniqueness lock — written atomically alongside the contact via TransactWrite.
// Ensures no two requests create duplicate contacts for the same phone+company pair.
// PK = PHONE#${companyId}#${phoneE164}  SK = LOCK
function phoneLockPK(companyId, phoneE164) { return `PHONE#${companyId}#${phoneE164}`; }
function phoneLockSK()                      { return 'LOCK'; }

// Lead phone uniqueness lock — written atomically alongside the LEAD# item via TransactWrite.
// Prevents concurrent requests from creating two leads for the same phoneNorm.
// Distinct prefix from Contact phone lock (Contact uses E.164; Lead uses 10-digit phoneNorm).
// PK = LEAD_PHONE#${companyId}#${phoneNorm}  SK = LOCK
// NOTE: When a lead is hard-deleted, this lock MUST also be deleted, or it is
// orphaned and the phone number becomes permanently un-creatable (2026-07-03
// production incident). Enforced in crm.js's DELETE handler; CIS also self-heals
// a surviving orphaned lock via _reclaimIfOrphaned() as a backstop.
function leadPhoneLockPK(companyId, phoneNorm) { return `LEAD_PHONE#${companyId}#${phoneNorm}`; }
function leadPhoneLockSK()                      { return 'LOCK'; }

// Idempotency lock — written atomically with every CustomerIdentityService resolveOrCreate() call.
// Prevents duplicate interactions and double enrichment on webhook retry storms.
// TTL: 24 hours. DynamoDB TTL must be enabled on the 'ttl' attribute.
// PK = IDEM#${companyId}#${sha256HexKey}  SK = LOCK
function idemPK(companyId, sha256HexKey) { return `IDEM#${companyId}#${sha256HexKey}`; }
function idemSK()                         { return 'LOCK'; }

// Conversation entity
// Base:  PK = CONV#${companyId}#${conversationId}  SK = CONV#META
// GSI1 (ConvByCompany):   convCompanyPK PK | lastActivityAt SK
// GSI2 (ConvByContact):   convContactPK PK | lastActivityAt SK
function conversationPK(companyId, conversationId) { return `CONV#${companyId}#${conversationId}`; }
function conversationSK()                           { return 'CONV#META'; }
// convCompanyPK uses CONV# prefix — distinct attribute name from raw companyId,
// avoids indexing conversations in the existing leadsByCompany GSI.
function convCompanyGsiPK(companyId)                { return `CONV#${companyId}`; }
// convContactPK scopes by companyId for multi-tenant safety.
function convContactGsiPK(companyId, contactId)     { return `CONV_CONTACT#${companyId}#${contactId}`; }

// Lead entity — existing production pattern, centralised here as reference.
// Existing routes continue to concatenate strings directly; they migrate in later commits.
// PK = LEAD#${companyId}#${leadId}  SK = METADATA
function leadPK(companyId, leadId) { return `LEAD#${companyId}#${leadId}`; }
function leadSK()                   { return 'METADATA'; }

// INBOX entity — existing WhatsApp inbox pattern, centralised here as reference.
// PK = INBOX#${companyId}#${phone10digit}  SK = CONTACT | MSG#${ts}#${msgId}
function inboxPK(companyId, phone10digit) { return `INBOX#${companyId}#${phone10digit}`; }
function inboxContactSK()                  { return 'CONTACT'; }
function inboxMsgSK(timestamp, msgId)      { return `MSG#${timestamp}#${msgId}`; }

// Timeline entity — authoritative source moves here; timeline.js re-exports these.
// PK = TL#${companyId}#${entityType}#${entityId}
// SK = ${timestamp}#${eventType}#${eventId}
function tlPK(companyId, entityType, entityId) { return `TL#${companyId}#${entityType}#${entityId}`; }
function tlSK(timestamp, eventType, eventId)   { return `${timestamp}#${eventType}#${eventId}`; }

// Meta Signal (Conversions API) — see CapiService.js / ADR-019.
// Once-ever claim marker, written on the LEAD's own partition BEFORE any
// /events POST. Deliberately NO TTL (unlike IDEM#/PENDINGFLOW#): Meta does
// not dedup business-messaging events, so an expired claim would let a
// re-added tag double-count the conversion at Meta — same "expiry re-triggers
// an outbound side effect" reasoning as StageMembershipScheduler's ENROLLED#.
// PK = <lead PK>  SK = CAPI#${metaEventName}
function capiClaimSK(metaEventName) { return `CAPI#${metaEventName}`; }

// Meta Signal observability log — company-scoped, newest-first Query-able,
// TTL'd (90 days; expiry is low-stakes here — the claim marker above, not
// this row, is the dedup mechanism). Same PK/SK idiom as BROADCAST#.
// PK = CAPILOG#${companyId}  SK = ${timestampISO}#${leadId}#${metaEventName}
function capiLogPK(companyId)                        { return `CAPILOG#${companyId}`; }
function capiLogSK(timestampISO, leadId, metaEventName) { return `${timestampISO}#${leadId}#${metaEventName}`; }

// Instagram config entity — sibling to CONFIG#WABA#, same CURRENT-item idiom,
// deliberately a separate item/file (igGraphApiHelpers.js), not a
// parameterized extension of graphApiHelpers.js. See ADR-020.
// PK = CONFIG#IG#${companyId}  SK = CURRENT
function igConfigPK(companyId) { return `CONFIG#IG#${companyId}`; }
function igConfigSK()           { return 'CURRENT'; }

// Instagram business-account-id → companyId reverse index (webhook routing),
// same idiom as CONFIG#PHONEID# for WhatsApp's phone_number_id → companyId.
// PK = CONFIG#IGID#${igBusinessAccountId}  SK = CURRENT
function igIdConfigPK(igBusinessAccountId) { return `CONFIG#IGID#${igBusinessAccountId}`; }
function igIdConfigSK()                     { return 'CURRENT'; }

// Instagram contact entity — deliberately NOT a LEAD# record (2026-07-18
// "lightweight, no CRM" decision — no pipeline stage, no assignedTo, no
// CustomerIdentityService/ADR-013 involvement; see InstagramContactService.js
// and docs/bible/19_DECISION_LOG.md Era 54). IGSID has no normalization
// ambiguity the way phone numbers do, so no idempotency-lock/TransactWrite
// machinery is needed — just a plain conditional-put-if-absent. Conversation
// history reuses inboxMsgSK() under this PK (channel-neutral SK shape,
// confirmed by the 2026-07-18 audit) — no new MSG# constructor needed.
// PK = IGCONTACT#${companyId}#${igsid}  SK = CURRENT | MSG#${ts}#${msgId}
function igContactPK(companyId, igsid) { return `IGCONTACT#${companyId}#${igsid}`; }
function igContactSK()                  { return 'CURRENT'; }

// Instagram comment idempotency claim (comment-to-DM v2 — see ADR-021). Meta
// allows exactly ONE private reply per comment and retries webhooks, so a
// per-comment claim marker (written via dedupPut before any private-reply send)
// makes a webhook retry a no-op instead of a second, failing send. TTL'd 30
// days — well past Meta's 7-day private-reply deadline, after which the comment
// can no longer be replied to anyway.
// PK = IGCOMMENT#${companyId}#${commentId}  SK = CLAIM
function igCommentClaimPK(companyId, commentId) { return `IGCOMMENT#${companyId}#${commentId}`; }
function igCommentClaimSK()                      { return 'CLAIM'; }

// ─── EMPLOYEES TABLE ──────────────────────────────────────────────────────────

// Employee entity
// PK = EMP#${companyId}  SK = ${employeeId}
function empPK(companyId)  { return `EMP#${companyId}`; }
function empSK(employeeId) { return employeeId; }

// Company profile entity
// PK = COMPANY#${companyId}  SK = PROFILE
function companyPK(companyId) { return `COMPANY#${companyId}`; }
function companySK()           { return 'PROFILE'; }

// ─── GSI INDEX NAMES ─────────────────────────────────────────────────────────
// Reference constants for all GSIs across both tables.
// Use these instead of raw string literals in query calls.

const GSI = Object.freeze({
  // METRICS table — Contact (Phase 1)
  CONTACT_PHONE:   'ContactPhoneIndex',   // PK: phoneE164       | SK: companyId
  CONTACT_COMPANY: 'ContactsByCompany',   // PK: contactCompanyPK | SK: createdAt
  // METRICS table — Conversation (Phase 1)
  CONV_BY_COMPANY: 'ConvByCompany',       // PK: convCompanyPK   | SK: lastActivityAt
  CONV_BY_CONTACT: 'ConvByContact',       // PK: convContactPK   | SK: lastActivityAt
  // METRICS table — Lead (existing, read-only reference)
  LEAD_BY_COMPANY: 'leadsByCompany',
  LEAD_BY_PHONE:   'company-phone-index',
  // EMPLOYEES table (existing, read-only reference)
  EMP_BY_COMPANY:  'companyIdIndex',
  EMP_BY_EMAIL:    'emailIndex',
});

module.exports = {
  // Contact
  contactPK,
  contactSK,
  contactCompanyGsiPK,
  // Contact phone uniqueness lock
  phoneLockPK,
  phoneLockSK,
  // Lead phone uniqueness lock (CustomerIdentityService)
  leadPhoneLockPK,
  leadPhoneLockSK,
  // Idempotency lock (CustomerIdentityService)
  idemPK,
  idemSK,
  // Conversation
  conversationPK,
  conversationSK,
  convCompanyGsiPK,
  convContactGsiPK,
  // Lead (existing pattern, now centralised)
  leadPK,
  leadSK,
  // Inbox (existing pattern, now centralised)
  inboxPK,
  inboxContactSK,
  inboxMsgSK,
  // Timeline
  tlPK,
  tlSK,
  // Meta Signal / Conversions API (CapiService)
  capiClaimSK,
  capiLogPK,
  capiLogSK,
  // Instagram (igGraphApiHelpers / InstagramContactService)
  igConfigPK,
  igConfigSK,
  igIdConfigPK,
  igIdConfigSK,
  igContactPK,
  igContactSK,
  igCommentClaimPK,
  igCommentClaimSK,
  // Employees
  empPK,
  empSK,
  // Company
  companyPK,
  companySK,
  // GSI names
  GSI,
};
