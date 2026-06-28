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
  // Phone uniqueness lock
  phoneLockPK,
  phoneLockSK,
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
  // Employees
  empPK,
  empSK,
  // Company
  companyPK,
  companySK,
  // GSI names
  GSI,
};
