'use strict';

// Shared per-contact mutation logic for CRM leads / INBOX contacts — used by
// both the existing single-contact routes (crm.js's /leads/:id/assign,
// contacts.js's /stage, tags.js's /contacts) and the new bulk endpoint
// (contacts.js's POST /bulk-update), so the actual DynamoDB logic exists in
// exactly one place (same discipline as fetchFilteredContacts, Track A2).
//
// Pure business logic — assumes the caller has already validated required
// fields/shapes; throws NotFoundError for a missing record, lets any other
// error (validation, DynamoDB) propagate for the caller to handle.

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { to10Digit } = require('../utils/phone');
const { leadPhoneLockPK, leadPhoneLockSK, conversationPK, tlPK } = require('../core/entityKeys');
const { ENTITY } = require('../events/catalog');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

class NotFoundError extends Error {}

const leadKey  = (companyId, leadId) => ({ PK: `LEAD#${companyId}#${leadId}`, SK: 'METADATA' });
const inboxKey = (companyId, phone)  => ({ PK: `INBOX#${companyId}#${to10Digit(phone)}`, SK: 'CONTACT' });

function contactKey(companyId, { leadId, phone }) {
  if (leadId) return leadKey(companyId, leadId);
  if (phone)  return inboxKey(companyId, phone);
  throw new Error('leadId or phone required');
}

// ── Query every item under a PK and batch-delete them ───────────────────────
// Shared by deleteLead and deleteUnknownContact — was duplicated inline in
// both (deleteLead as a local nested function, deleteUnknownContact as its
// own copy of the same query+batchWrite loop) until Stage 5 of the 2026-07-17
// 360° audit fix plan hoisted it out, needed to also purge deleteUnknownContact's
// linked CONV#/TL# partitions without writing that loop a third time.
async function purgePartition(pk) {
  const items = [];
  let lk;
  do {
    const r = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ...(lk && { ExclusiveStartKey: lk }),
    }).promise();
    items.push(...(r.Items ?? []));
    lk = r.LastEvaluatedKey;
  } while (lk);
  for (let i = 0; i < items.length; i += 25) {
    await dynamodb.batchWrite({
      RequestItems: {
        [TABLE]: items.slice(i, i + 25).map((it) => ({
          DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
        })),
      },
    }).promise();
  }
}

// ── Assign employee to a lead ────────────────────────────────────────────────
// Unconditional SET of absolute values (assignedTo/assignedToName/chatStatus),
// never reads-then-merges — two concurrent assigns to the same lead are just
// last-write-wins on the same shape, no lost-update race is possible here by
// construction. (Confirmed 2026-07-10 while diagnosing the Contacts bulk-
// action partial-failure report — this route was never the race some of that
// report's framing assumed; see updateTags() below for where a real race does exist.)
async function assignLead(companyId, leadId, { assignedTo, assignedToName }) {
  const Key = leadKey(companyId, leadId);
  const existing = await dynamodb.get({ TableName: TABLE, Key }).promise();
  if (!existing.Item) throw new NotFoundError('Lead not found');

  await dynamodb.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
    ExpressionAttributeValues: {
      ':at': assignedTo,
      ':atn': assignedToName ?? null,
      ':cs': 'open',
      ':ua': new Date().toISOString(),
    },
  }).promise();

  return { assignedTo, assignedToName: assignedToName ?? null };
}

// ── Change pipeline stage for a lead or unknown contact ─────────────────────
// Same shape as assignLead — unconditional SET, no read-modify-write, no race.
// stageChangedAt stamped alongside stage (this path previously stamped no
// timestamp at all) — the Sales Kanban board sorts each column by it so a
// just-moved contact floats to the top of its new column (dashboard
// sales/page.tsx, 2026-07-17). Also covers the bulk-update 'stage' operation,
// which calls this same function for both leads and unknown contacts.
async function updateStage(companyId, { leadId, phone }, stage) {
  const Key = contactKey(companyId, { leadId, phone });
  await dynamodb.update({
    TableName: TABLE,
    Key,
    UpdateExpression: 'SET stage = :s, stageChangedAt = :sca',
    ExpressionAttributeValues: { ':s': stage, ':sca': new Date().toISOString() },
  }).promise();
  return { stage };
}

// ── Fetch a contact's current assignee (ownership check for callers) ────────
// Used by tags.js's single-contact PUT /contacts route to enforce own-only
// tagging for restricted roles. Read-only — resolves existence + assignedTo,
// nothing else; the caller owns the actual role decision.
async function getContactAssignee(companyId, { leadId, phone }) {
  const Key = contactKey(companyId, { leadId, phone });
  const r = await dynamodb.get({ TableName: TABLE, Key }).promise();
  if (!r.Item) return { exists: false, assignedTo: null };
  return { exists: true, assignedTo: r.Item.assignedTo ?? null };
}

// ── Add/remove tags ───────────────────────────────────────────────────────────
// THE REAL RACE (2026-07-10 diagnosis correction): `tags` is stored as a plain
// DynamoDB List (a JS array via the document client), not a native String Set
// (SS). A List has no atomic ADD/DELETE-by-value update expression — that
// requires every existing contact/lead across every company to be migrated to
// Set-typed `tags`, real-data work with a much larger blast radius than this
// fix and gated by the hold-for-review-before-touching-real-records rule.
// Optimistic concurrency (conditional write on updatedAt, retry on conflict)
// gets the same race-free guarantee without touching storage shape: a losing
// writer's condition fails, it re-reads the now-current tags and retries its
// own add/remove against that state, bounded by MAX_RETRIES. This is what
// actually eliminates the lost-update race for two rapid tag toggles on the
// SAME contact (e.g. ContactTags.tsx in Inbox/Customer 360) — the scenario
// the original report's "race" framing was really describing, just not in
// the bulk-select flow (which always targets distinct contacts and can't
// collide with itself).
const MAX_RETRIES = 5;

async function updateTags(companyId, { leadId, phone }, { add = [], remove = [] }) {
  const Key = contactKey(companyId, { leadId, phone });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await dynamodb.get({ TableName: TABLE, Key }).promise();
    const current = r.Item?.tags ?? [];
    const currentUpdatedAt = r.Item?.updatedAt ?? null;
    const updated = [
      ...current.filter((t) => !remove.includes(t)),
      ...add.filter((t) => !current.includes(t)),
    ];
    const now = new Date().toISOString();

    try {
      await dynamodb.update({
        TableName: TABLE,
        Key,
        UpdateExpression: 'SET tags = :t, updatedAt = :ua',
        ConditionExpression: currentUpdatedAt ? 'updatedAt = :expected' : 'attribute_not_exists(updatedAt)',
        ExpressionAttributeValues: {
          ':t': updated,
          ':ua': now,
          ...(currentUpdatedAt ? { ':expected': currentUpdatedAt } : {}),
        },
      }).promise();
      return { tags: updated };
    } catch (e) {
      // Another writer (tag mutation OR any other route touching this
      // contact's updatedAt) won this round — re-read the fresh state and
      // retry our own add/remove against it rather than clobbering theirs.
      if (e.code === 'ConditionalCheckFailedException' && attempt < MAX_RETRIES) continue;
      throw e;
    }
  }
}

// ── Delete a CRM lead — hard-purge: removes all DDB items for this lead ─────
// Extracted verbatim from crm.js's DELETE /leads/:id (Track A5 fast-follow,
// 2026-07-10) so the bulk-delete path reuses the exact same purge logic
// instead of a shortcut that only deletes the LEAD# record and leaves
// orphaned CONV#/TL# partitions behind.
//
// Deletes METADATA + all MSG/NOTE items under LEAD# PK, the INBOX# CONTACT
// shadow record and any pre-promotion INBOX# messages for the same phone,
// the lead's own TL# timeline, and — if a WhatsApp conversation was ever
// linked (leadItem.convId, written by conversationResolver.js) — that CONV#
// entity and its TL# timeline too. Also checks INBOX#'s OWN convId pointer
// (Era 41): before the Era 41 fix, resolveForInbox() and resolveForLead()
// could independently create two different CONV# entities for the same
// contact (a genuine cross-call-stack race, see 19_DECISION_LOG.md Era 41)
// — Era 37's purge only ever followed the lead's own convId, silently
// leaving the INBOX#-linked one behind as a permanent orphan. This purges
// that one too, whenever it differs from the lead's.
// CONTACT#'s own TL# partition (TL#{cid}#CONTACT#{contactId}) is
// deliberately left alone: the Contact entity is a separate, longer-lived
// identity that survives this lead's deletion (this function never touches
// CONTACT# at all), so its timeline — which may include fan-out entries
// from this conversation — legitimately continues to exist. See
// docs/bible/19_DECISION_LOG.md Era 36/37/41 and docs/phase3/TECHNICAL_DEBT.md
// for the incident this closes.
//
// Audit logging and the partial-failure response message stay with the
// caller (same split as assignLead/updateStage/updateTags above) — this
// returns enough (phone/convId/inboxConvId/convTlPurge) for the caller to
// log and format a response, but never calls logAudit itself.
async function deleteLead(companyId, leadId) {
  const PK = leadKey(companyId, leadId).PK;

  const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
  if (!existing.Item) throw new NotFoundError('Lead not found');
  const phone = existing.Item.phone;

  // 1. Delete all items under LEAD# PK (METADATA, MSG#*, NOTE#*, etc.)
  await purgePartition(PK);

  // 2. Delete all items under INBOX# PK for this phone (shadow CONTACT + pre-promotion MSG#*).
  //    Read the INBOX# CONTACT item's own convId FIRST, before purging it away —
  //    Era 37 only ever checked the LEAD#'s own convId; this can differ (see Era 41).
  let inboxConvId = null;
  if (phone) {
    const inboxItem = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `INBOX#${companyId}#${phone}`, SK: 'CONTACT' },
    }).promise().catch(() => ({}));
    inboxConvId = inboxItem.Item?.convId ?? null;
    await purgePartition(`INBOX#${companyId}#${phone}`).catch(() => {});
  }

  // 3. Delete the lead's own TL# timeline (touch_received entries, written by
  //    CustomerIdentityService on every resolveOrCreate() call — independent of
  //    whether a CONV# was ever created). Outcome is tracked (not just logged) so
  //    it can be surfaced on the audit record and, if it failed, in the response.
  const convTlPurge = { tlLead: true, conv: null, tlConv: null };
  await purgePartition(tlPK(companyId, ENTITY.LEAD, leadId))
    .catch((e) => {
      convTlPurge.tlLead = false;
      logger.warn(`ContactBulkOps.deleteLead: TL#LEAD delete failed leadId=${leadId}: ${e.message}`);
    });

  // 4. Delete the linked CONV# entity + its TL# timeline, if a WhatsApp conversation
  //    was ever started for this lead. convId is written onto LEAD# METADATA (alongside
  //    contactId, via if_not_exists) by src/utils/conversationResolver.js the first time
  //    an inbound message is resolved — leads that pre-date that pointer, or that never
  //    received an inbound WhatsApp message, simply have no convId. That is not an error
  //    condition: purge what exists, skip what doesn't. (conv/tlConv stay `null` — not
  //    applicable — rather than `true`, so the audit record can distinguish "nothing to
  //    purge" from "purge attempted and succeeded".)
  const convId = existing.Item.convId;
  if (convId) {
    convTlPurge.conv = true;
    convTlPurge.tlConv = true;
    await purgePartition(conversationPK(companyId, convId))
      .catch((e) => {
        convTlPurge.conv = false;
        logger.warn(`ContactBulkOps.deleteLead: CONV# delete failed leadId=${leadId} convId=${convId}: ${e.message}`);
      });
    await purgePartition(tlPK(companyId, ENTITY.CONV, convId))
      .catch((e) => {
        convTlPurge.tlConv = false;
        logger.warn(`ContactBulkOps.deleteLead: TL#CONV delete failed leadId=${leadId} convId=${convId}: ${e.message}`);
      });
    logger.info(`ContactBulkOps.deleteLead: leadId=${leadId} purged linked conversation convId=${convId}`);
  } else {
    logger.info(`ContactBulkOps.deleteLead: leadId=${leadId} has no convId — skipping CONV#/TL#(CONV) purge (pre-dates conversation pointer or never messaged)`);
  }

  // 4b. (Era 41) The INBOX# CONTACT item's own convId can point at a DIFFERENT
  //     conversation than the lead's — resolveForInbox() and resolveForLead() used
  //     to race independently before the Era 41 fix, each creating its own CONV#
  //     for the same contact. Purge that orphan too, whenever it's not the same
  //     one just purged above (or wasn't purged because the lead had no convId).
  convTlPurge.inboxConv = null;
  convTlPurge.tlInboxConv = null;
  if (inboxConvId && inboxConvId !== convId) {
    convTlPurge.inboxConv = true;
    convTlPurge.tlInboxConv = true;
    await purgePartition(conversationPK(companyId, inboxConvId))
      .catch((e) => {
        convTlPurge.inboxConv = false;
        logger.warn(`ContactBulkOps.deleteLead: INBOX-linked CONV# delete failed leadId=${leadId} inboxConvId=${inboxConvId}: ${e.message}`);
      });
    await purgePartition(tlPK(companyId, ENTITY.CONV, inboxConvId))
      .catch((e) => {
        convTlPurge.tlInboxConv = false;
        logger.warn(`ContactBulkOps.deleteLead: TL#(INBOX-linked CONV) delete failed leadId=${leadId} inboxConvId=${inboxConvId}: ${e.message}`);
      });
    logger.info(`ContactBulkOps.deleteLead: leadId=${leadId} purged orphaned INBOX-linked conversation inboxConvId=${inboxConvId}`);
  }
  const convTlPartialFailure = Object.values(convTlPurge).some((v) => v === false);

  // 5. Release the LEAD_PHONE# uniqueness lock (a separate PK, written by
  //    CustomerIdentityService._createCustomer). This was previously left
  //    behind, orphaning the lock: every future create for this number then
  //    failed its ConditionExpression and surfaced a raw "Transaction
  //    cancelled" 500 (production incident 2026-07-03). phoneNorm is the
  //    lock's key component — fall back to normalising the stored phone for
  //    older records written before phoneNorm was persisted.
  //    Associated IDEM# locks (24h TTL) can't be enumerated by leadId here;
  //    CIS ignores a stale idem lock whose lead no longer exists instead.
  const phoneNorm = existing.Item.phoneNorm || (phone ? to10Digit(phone) : null);
  if (phoneNorm) {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: leadPhoneLockPK(companyId, phoneNorm), SK: leadPhoneLockSK() },
    }).promise().catch((e) => logger.warn(`ContactBulkOps.deleteLead: phone lock delete failed phoneNorm=${phoneNorm}: ${e.message}`));
  }

  return {
    phone,
    convId: convId ?? null,
    inboxConvId: inboxConvId ?? null,
    convTlPurge,
    convTlPartialFailure,
  };
}

// ── Delete an unknown (phone-only, INBOX#-only) contact ─────────────────────
// Originally extracted verbatim from contacts.js's DELETE /unknown/:phone,
// purging only the INBOX# partition (CONTACT + any pre-promotion MSG#*
// items). Found 2026-07-10 (docs/phase3/TECHNICAL_DEBT.md) to leave a real
// orphan behind: any unknown contact that ever received an inbound message
// has a CONV#/TL#CONV# pair created via resolveForInbox()
// (conversationResolver.js:211-236), with convId stamped onto this same
// INBOX# CONTACT item — deleting the contact without also purging those left
// them permanently orphaned, including lastMessageText/aiSummary content
// surviving the "delete" (a privacy/erasure concern, not just data hygiene).
// Fixed Stage 5 of the 2026-07-17 360° audit fix plan, mirroring deleteLead's
// own CONV#/TL# purge (above) rather than writing new purge logic — the only
// difference is deleteLead reads convId off a SEPARATE INBOX# partition it
// doesn't otherwise touch, while here the INBOX# CONTACT item already read
// into `existing` above IS the record convId lives on, so no extra fetch
// is needed.
async function deleteUnknownContact(companyId, phone) {
  const normPhone = to10Digit(phone);
  const PK = inboxKey(companyId, normPhone).PK;

  const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'CONTACT' } }).promise();
  if (!existing.Item) throw new NotFoundError('Unknown contact not found');

  await purgePartition(PK);

  const convId = existing.Item.convId ?? null;
  const convTlPurge = { conv: null, tlConv: null };
  if (convId) {
    convTlPurge.conv = true;
    convTlPurge.tlConv = true;
    await purgePartition(conversationPK(companyId, convId))
      .catch((e) => {
        convTlPurge.conv = false;
        logger.warn(`ContactBulkOps.deleteUnknownContact: CONV# delete failed phone=${normPhone} convId=${convId}: ${e.message}`);
      });
    await purgePartition(tlPK(companyId, ENTITY.CONV, convId))
      .catch((e) => {
        convTlPurge.tlConv = false;
        logger.warn(`ContactBulkOps.deleteUnknownContact: TL#CONV delete failed phone=${normPhone} convId=${convId}: ${e.message}`);
      });
    logger.info(`ContactBulkOps.deleteUnknownContact: phone=${normPhone} purged linked conversation convId=${convId}`);
  } else {
    logger.info(`ContactBulkOps.deleteUnknownContact: phone=${normPhone} has no convId — skipping CONV#/TL#(CONV) purge (never messaged)`);
  }
  const convTlPartialFailure = Object.values(convTlPurge).some((v) => v === false);

  return { convId, convTlPurge, convTlPartialFailure };
}

// ── Delete a contact (lead or unknown) — bulk-delete's single entry point ──
// Dispatches to deleteLead or deleteUnknownContact based on the same
// isLead test the frontend's buildContactDeleteRequest (now retired) used:
// leadId present => lead, otherwise phone-only unknown contact.
async function deleteContact(companyId, { leadId, phone }) {
  if (leadId) {
    const result = await deleteLead(companyId, leadId);
    return { isLead: true, ...result };
  }
  if (phone) {
    const result = await deleteUnknownContact(companyId, phone);
    return { isLead: false, ...result };
  }
  throw new Error('leadId or phone required');
}

module.exports = {
  assignLead, updateStage, updateTags, contactKey, getContactAssignee,
  deleteLead, deleteUnknownContact, deleteContact,
  NotFoundError,
};
