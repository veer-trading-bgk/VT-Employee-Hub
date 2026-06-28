'use strict';

const dynamodb = require('../config/dynamodb');
const {
  contactPK,
  contactSK,
  phoneLockPK,
  phoneLockSK,
  GSI,
} = require('../core/entityKeys');

// Read table name at call time — allows tests to set env before first call.
function table() {
  return process.env.DYNAMODB_TABLE_METRICS;
}

// ─── Update expression builder ────────────────────────────────────────────────
// Converts a flat patch object into a DynamoDB UpdateExpression.
// Handles REMOVE clauses signalled by the _removeAttrs array (from restoreMeta).
function buildUpdateExpression(patch) {
  const { _removeAttrs, ...fields } = patch;
  const setExprs    = [];
  const removeExprs = [];
  const names       = {};
  const values      = {};

  for (const [key, val] of Object.entries(fields)) {
    const n = `#f_${key}`;
    const v = `:f_${key}`;
    names[n]  = key;
    values[v] = val;
    setExprs.push(`${n} = ${v}`);
  }

  for (const attr of (_removeAttrs ?? [])) {
    const n = `#r_${attr}`;
    names[n] = attr;
    removeExprs.push(n);
  }

  const parts = [];
  if (setExprs.length)    parts.push(`SET ${setExprs.join(', ')}`);
  if (removeExprs.length) parts.push(`REMOVE ${removeExprs.join(', ')}`);

  return { expr: parts.join(' '), names, values };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a single contact by its primary key.
 * Returns the item object, or null if not found.
 */
async function getById(companyId, contactId) {
  const result = await dynamodb.get({
    TableName: table(),
    Key: { PK: contactPK(companyId, contactId), SK: contactSK() },
  }).promise();
  return result.Item ?? null;
}

/**
 * Fetch a contact by phone number within a company using the ContactPhoneIndex GSI.
 * Returns the first non-deleted matching item, or null.
 * At most one non-deleted contact per phone+company should exist (enforced by phoneLock).
 */
async function queryByPhone(companyId, phoneE164) {
  const result = await dynamodb.query({
    TableName:                 table(),
    IndexName:                 GSI.CONTACT_PHONE,
    KeyConditionExpression:    'phoneE164 = :phone AND companyId = :cid',
    FilterExpression:          'attribute_not_exists(deletedAt)',
    ExpressionAttributeValues: { ':phone': phoneE164, ':cid': companyId },
    Limit:                     1,
  }).promise();
  return result.Items?.[0] ?? null;
}

/**
 * List contacts for a company using the ContactsByCompany GSI.
 * Returns { items, lastKey } for cursor-based pagination.
 * Newest contacts first (ScanIndexForward: false).
 * Excludes soft-deleted contacts.
 *
 * @param {string}  companyId
 * @param {object}  opts
 * @param {number}  [opts.limit=50]    max records per page
 * @param {object}  [opts.lastKey]     ExclusiveStartKey from previous response
 */
async function queryByCompany(companyId, opts = {}) {
  const { limit = 50, lastKey } = opts;
  const result = await dynamodb.query({
    TableName:                 table(),
    IndexName:                 GSI.CONTACT_COMPANY,
    KeyConditionExpression:    'contactCompanyPK = :pk',
    FilterExpression:          'attribute_not_exists(deletedAt)',
    ExpressionAttributeValues: { ':pk': `CONTACT#${companyId}` },
    ScanIndexForward:          false,
    Limit:                     Math.min(100, Math.max(1, limit)),
    ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
  }).promise();
  return { items: result.Items ?? [], lastKey: result.LastEvaluatedKey ?? null };
}

/**
 * Atomically create a contact record and its phone uniqueness lock.
 * Uses TransactWrite so both items are written or neither is.
 *
 * If the phone lock already exists (TransactionCanceledException), the caller
 * detects this as a duplicate and re-fetches the existing contact.
 *
 * @param {object} contactItem   — fully-formed contact record (all fields)
 * @param {object} phoneLockItem — phone lock record { PK, SK, contactId, createdAt }
 * @throws TransactionCanceledException when the phone is already registered
 * @throws any other DynamoDB error (caller must handle)
 */
async function transactCreate(contactItem, phoneLockItem) {
  await dynamodb.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName:           table(),
          Item:                phoneLockItem,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName:           table(),
          Item:                contactItem,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ],
  }).promise();
}

/**
 * Update a contact with optimistic locking.
 * Uses expectedVersion to prevent lost updates under concurrent writes.
 *
 * @param {string} companyId
 * @param {string} contactId
 * @param {object} patch            — from updateMeta() / softDeleteMeta() / restoreMeta()
 * @param {number} expectedVersion  — current version before update
 * @returns {object} updated contact item (ALL_NEW)
 * @throws ConditionalCheckFailedException on version conflict or missing contact
 */
async function updateItem(companyId, contactId, patch, expectedVersion) {
  const { expr, names, values } = buildUpdateExpression(patch);
  const result = await dynamodb.update({
    TableName:                 table(),
    Key:                       { PK: contactPK(companyId, contactId), SK: contactSK() },
    UpdateExpression:          expr,
    ConditionExpression:       'attribute_exists(PK) AND #cv = :cv',
    ExpressionAttributeNames:  { '#cv': 'version', ...names },
    ExpressionAttributeValues: { ':cv': expectedVersion, ...values },
    ReturnValues:              'ALL_NEW',
  }).promise();
  return result.Attributes;
}

module.exports = {
  getById,
  queryByPhone,
  queryByCompany,
  transactCreate,
  updateItem,
};
