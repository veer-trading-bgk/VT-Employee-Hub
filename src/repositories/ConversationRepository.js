'use strict';

const dynamodb = require('../config/dynamodb');
const {
  conversationPK,
  conversationSK,
  convCompanyGsiPK,
  convContactGsiPK,
  GSI,
} = require('../core/entityKeys');

function table() {
  return process.env.DYNAMODB_TABLE_METRICS;
}

// ─── Update expression builder ────────────────────────────────────────────────
// Converts a flat patch object into a DynamoDB UpdateExpression.
// Handles optional REMOVE clauses signalled by _removeAttrs (from restoreMeta).
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
 * Fetch a single conversation by its primary key. Returns null if not found.
 */
async function getById(companyId, conversationId) {
  const result = await dynamodb.get({
    TableName: table(),
    Key: { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
  }).promise();
  return result.Item ?? null;
}

/**
 * List conversations for a specific contact using the ConvByContact GSI.
 * Sorted by lastActivityAt descending (newest first).
 * Excludes soft-deleted conversations.
 *
 * @param {string} companyId
 * @param {string} contactId
 * @param {object} [opts]
 *   @param {number} [opts.limit=50]
 *   @param {object} [opts.lastKey]
 */
async function queryByContact(companyId, contactId, opts = {}) {
  const { limit = 50, lastKey } = opts;
  const result = await dynamodb.query({
    TableName:                 table(),
    IndexName:                 GSI.CONV_BY_CONTACT,
    KeyConditionExpression:    'convContactPK = :pk',
    FilterExpression:          'attribute_not_exists(deletedAt)',
    ExpressionAttributeValues: { ':pk': convContactGsiPK(companyId, contactId) },
    ScanIndexForward:          false,
    Limit:                     Math.min(100, Math.max(1, limit)),
    ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
  }).promise();
  return { items: result.Items ?? [], lastKey: result.LastEvaluatedKey ?? null };
}

/**
 * List conversations for a company using the ConvByCompany GSI.
 * Supports optional filtering by status and/or assignedTo.
 * Sorted by lastActivityAt descending (newest first).
 *
 * @param {string} companyId
 * @param {object} [opts]
 *   @param {number} [opts.limit=50]
 *   @param {object} [opts.lastKey]
 *   @param {string} [opts.status]      'open' | 'resolved' | 'pending' | 'snoozed'
 *   @param {string} [opts.assignedTo]  employeeId — filter to agent's conversations
 */
async function queryByCompany(companyId, opts = {}) {
  const { limit = 50, lastKey, status, assignedTo } = opts;

  const filterParts = ['attribute_not_exists(deletedAt)'];
  const exprNames   = {};
  const exprValues  = { ':pk': convCompanyGsiPK(companyId) };

  // 'status' is a DynamoDB reserved word — must use ExpressionAttributeNames alias.
  if (status) {
    filterParts.push('#convStatus = :status');
    exprNames['#convStatus'] = 'status';
    exprValues[':status']    = status;
  }

  if (assignedTo) {
    filterParts.push('assignedTo = :assignedTo');
    exprValues[':assignedTo'] = assignedTo;
  }

  const result = await dynamodb.query({
    TableName:                 table(),
    IndexName:                 GSI.CONV_BY_COMPANY,
    KeyConditionExpression:    'convCompanyPK = :pk',
    FilterExpression:          filterParts.join(' AND '),
    ExpressionAttributeValues: exprValues,
    ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
    ScanIndexForward:          false,
    Limit:                     Math.min(100, Math.max(1, limit)),
    ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
  }).promise();

  return { items: result.Items ?? [], lastKey: result.LastEvaluatedKey ?? null };
}

/**
 * Write a new conversation item.
 * Fails with ConditionalCheckFailedException if the conversationId already exists
 * (ULID collision — virtually impossible in practice, defensive guard only).
 *
 * @param {object} item — fully-formed conversation record (all fields set)
 */
async function putConversation(item) {
  await dynamodb.put({
    TableName:           table(),
    Item:                item,
    ConditionExpression: 'attribute_not_exists(PK)',
  }).promise();
}

/**
 * Update a conversation with optimistic locking.
 *
 * @param {string} companyId
 * @param {string} conversationId
 * @param {object} patch            — fields to SET/REMOVE (supports _removeAttrs)
 * @param {number} expectedVersion  — current version before update
 * @returns {object} updated conversation item (ALL_NEW)
 * @throws ConditionalCheckFailedException on version conflict or missing conversation
 */
async function updateItem(companyId, conversationId, patch, expectedVersion) {
  const { expr, names, values } = buildUpdateExpression(patch);
  const result = await dynamodb.update({
    TableName:                 table(),
    Key:                       { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
    UpdateExpression:          expr,
    ConditionExpression:       'attribute_exists(PK) AND #cv = :cv',
    ExpressionAttributeNames:  { '#cv': 'version', ...names },
    ExpressionAttributeValues: { ':cv': expectedVersion, ...values },
    ReturnValues:              'ALL_NEW',
  }).promise();
  return result.Attributes;
}

/**
 * Atomically increment the unread message counter.
 * No version condition — called per inbound message, concurrency-safe by design.
 * Also updates lastActivityAt to keep GSI sort order current.
 *
 * @param {string} companyId
 * @param {string} conversationId
 * @param {number} [delta=1]
 */
async function incrementUnread(companyId, conversationId, delta = 1) {
  await dynamodb.update({
    TableName:                 table(),
    Key:                       { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
    UpdateExpression:          'SET unreadCount = if_not_exists(unreadCount, :zero) + :delta, lastActivityAt = :now',
    ExpressionAttributeValues: { ':delta': delta, ':zero': 0, ':now': new Date().toISOString() },
  }).promise();
}

/**
 * Update last-message display fields and lastActivityAt.
 * Best-effort, no version condition — safe for high-frequency message events.
 *
 * @param {string} companyId
 * @param {string} conversationId
 * @param {object} fields  { lastMessageAt, lastMessageText, lastActivityAt, updatedAt }
 */
async function updateLastMessage(companyId, conversationId, fields) {
  await dynamodb.update({
    TableName: table(),
    Key:       { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
    UpdateExpression:
      'SET lastMessageAt = :lat, lastMessageText = :txt, lastActivityAt = :laa, updatedAt = :ua',
    ExpressionAttributeValues: {
      ':lat': fields.lastMessageAt,
      ':txt': fields.lastMessageText,
      ':laa': fields.lastActivityAt,
      ':ua':  fields.updatedAt,
    },
  }).promise();
}

/**
 * Write an AI intent classification. Best-effort, no version condition — same
 * reasoning as updateLastMessage/incrementUnread: nothing else in the codebase
 * concurrently writes intent/confidence/classifiedAt, so there is no conflict
 * to guard against, and a fire-and-forget classification write shouldn't have
 * to retry just because an unrelated field (e.g. assignedTo) bumped the version
 * at the same moment.
 *
 * @param {string} companyId
 * @param {string} conversationId
 * @param {object} classification  { intent, confidence, classifiedAt }
 */
async function updateClassification(companyId, conversationId, classification) {
  await dynamodb.update({
    TableName: table(),
    Key:       { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
    UpdateExpression:          'SET intent = :i, confidence = :c, classifiedAt = :ca',
    ExpressionAttributeValues: {
      ':i':  classification.intent,
      ':c':  classification.confidence,
      ':ca': classification.classifiedAt,
    },
  }).promise();
}

/**
 * Write bot-conversation state — isBotActive/handoffState/aiTurnCount. Same
 * no-version-check pattern as incrementUnread/updateLastMessage/
 * updateClassification: this is driven exclusively by the inbound webhook
 * processing one message at a time (already serialized per invocation, gated
 * on isNewMsg), so there is no concurrent writer to race against, and a
 * per-message state update shouldn't have to retry just because an unrelated
 * field (e.g. an agent manually reassigning the conversation) bumped the
 * version at the same moment.
 *
 * @param {string} companyId
 * @param {string} conversationId
 * @param {object} fields  any of { isBotActive, handoffState, aiTurnCount }
 */
async function updateBotState(companyId, conversationId, fields) {
  const { expr, names, values } = buildUpdateExpression(fields);
  await dynamodb.update({
    TableName:                 table(),
    Key:                       { PK: conversationPK(companyId, conversationId), SK: conversationSK() },
    UpdateExpression:          expr,
    ExpressionAttributeNames:  names,
    ExpressionAttributeValues: values,
  }).promise();
}

module.exports = {
  getById,
  queryByContact,
  queryByCompany,
  putConversation,
  updateItem,
  incrementUnread,
  updateLastMessage,
  updateClassification,
  updateBotState,
};
