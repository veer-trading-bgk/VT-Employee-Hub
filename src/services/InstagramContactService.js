'use strict';

/**
 * InstagramContactService — lightweight, non-CRM contact storage for
 * Instagram DM automation (the "lightweight, no CRM" decision, 2026-07-18 —
 * see docs/bible/19_DECISION_LOG.md Era 54). Deliberately NOT
 * CustomerIdentityService/ADR-013: an Instagram contact is never a LEAD#
 * record — no pipeline stage, no assignedTo, no CRM shape of any kind, and
 * this file has zero shared code with CIS.
 *
 * Simpler than CIS by construction: an IGSID is a single Meta-issued
 * canonical identity with no normalization ambiguity (unlike phone numbers'
 * many raw formats), so there is no idempotency-lock/TransactWrite machinery
 * here — just a conditional-put-if-absent (dedupPut) to absorb a concurrent
 * double-create race on simultaneous first messages, then a plain get on
 * every later hit.
 */

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { dedupPut } = require('../utils/dedupPut');
const { igContactPK, igContactSK, inboxMsgSK } = require('../core/entityKeys');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

async function get(companyId, igsid) {
  const { Item } = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: igContactPK(companyId, igsid), SK: igContactSK() },
  }).promise();
  return Item ?? null;
}

/**
 * Get-or-create. Returns { contact, created }. `displayName` (Meta's `name`
 * field — NOT a @username; Instagram's Messaging User Profile API doesn't
 * expose usernames for DM senders at all, see igGraphApiHelpers.fetchDisplayName)
 * refreshes an existing record via a targeted SET rather than blocking on the
 * create race below. Callers only have one when they've already fetched it
 * (conditionally, when the contact is new or name-less) — see instagram.js's
 * webhook handler and InstagramSendService.sendPrivateReply.
 */
async function resolveOrCreate(companyId, igsid, displayName) {
  if (!companyId) throw new Error('[InstagramContactService] companyId is required');
  if (!igsid)      throw new Error('[InstagramContactService] igsid is required');

  const existing = await get(companyId, igsid);
  if (existing) {
    if (displayName && displayName !== existing.displayName) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: igContactPK(companyId, igsid), SK: igContactSK() },
        UpdateExpression: 'SET displayName = :n, updatedAt = :ua',
        ExpressionAttributeValues: { ':n': displayName, ':ua': new Date().toISOString() },
      }).promise();
      return { contact: { ...existing, displayName }, created: false };
    }
    return { contact: existing, created: false };
  }

  const now = new Date().toISOString();
  const item = {
    PK: igContactPK(companyId, igsid),
    SK: igContactSK(),
    companyId,
    igsid,
    displayName: displayName ?? null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };

  const wasNew = await dedupPut(dynamodb, TABLE, item);
  if (wasNew) return { contact: item, created: true };

  // Lost the create race — a concurrent inbound message won. Read the
  // winner's record rather than returning our own unwritten draft.
  const winner = await get(companyId, igsid);
  return { contact: winner ?? item, created: false };
}

/**
 * Best-effort conversation-history write — never blocks the webhook handler
 * or a send on a write failure, same posture as PENDINGFLOW#/CAPILOG#
 * best-effort writes elsewhere in this codebase. `timestamp` is epoch
 * milliseconds (Meta's messaging webhook convention).
 */
async function recordMessage(companyId, igsid, { direction, content, timestamp, mid }) {
  try {
    const ts = timestamp ?? Date.now();
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: igContactPK(companyId, igsid),
        SK: inboxMsgSK(ts, mid ?? String(ts)),
        companyId, igsid, direction, content, timestamp: ts, type: 'text',
        ...(mid ? { igMid: mid } : {}),
      },
    }).promise();
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: igContactPK(companyId, igsid), SK: igContactSK() },
      UpdateExpression: 'SET lastMessageAt = :t',
      ExpressionAttributeValues: { ':t': new Date(ts).toISOString() },
    }).promise();
  } catch (e) {
    logger.warn(`InstagramContactService.recordMessage: write failed for ${companyId}/${igsid}: ${e.message}`);
  }
}

module.exports = { get, resolveOrCreate, recordMessage };
