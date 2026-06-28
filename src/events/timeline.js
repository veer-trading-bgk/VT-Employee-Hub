'use strict';

/**
 * Timeline writer — private to the events/ module.
 * Only publisher.js calls these functions directly.
 *
 * Timeline records are IMMUTABLE. They are written once and never updated.
 * Every write uses attribute_not_exists(SK) so an idempotent re-delivery
 * of the same eventId is silently ignored (same guarantee as dedupPut).
 *
 * Failures are logged as warnings and swallowed. A TL# write failure
 * must never affect the primary operation that triggered the event.
 */

const dynamodb = require('../config/dynamodb');
const logger   = require('../config/logger');
const { tlPK, tlSK } = require('../core/entityKeys');

/**
 * Write a single TL# item to DynamoDB.
 *
 * @param {string} companyId
 * @param {string} entityType  - from ENTITY constants
 * @param {string} entityId    - the entity this timeline belongs to
 * @param {object} event       - canonical event object from publisher
 */
async function writeTlRecord(companyId, entityType, entityId, event) {
  // Read at call time so tests can set/unset the env var without module reloads.
  const table = process.env.DYNAMODB_TABLE_METRICS;
  if (!table) {
    logger.warn('[timeline] DYNAMODB_TABLE_METRICS not set — TL# write skipped');
    return;
  }

  const pk = tlPK(companyId, entityType, entityId);
  const sk = tlSK(event.timestamp, event.eventType, event.eventId);

  try {
    await dynamodb.put({
      TableName: table,
      Item: {
        PK:         pk,
        SK:         sk,
        eventId:    event.eventId,
        eventType:  event.eventType,
        companyId:  event.companyId,
        entityType,
        entityId,
        contactId:  event.contactId  ?? null,
        actorId:    event.actorId    ?? null,
        actorName:  event.actorName  ?? null,
        channel:    event.channel    ?? null,
        summary:    event.summary,
        metadata:   event.metadata   ?? {},
        timestamp:  event.timestamp,
      },
      // Immutability guard: reject if this exact PK+SK already exists.
      // Handles idempotent re-delivery (same eventId arriving twice).
      ConditionExpression: 'attribute_not_exists(SK)',
    }).promise();
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') return; // duplicate — ignore
    logger.warn(`[timeline] write failed pk=${pk} sk=${sk}: ${err.message}`);
  }
}

/**
 * Write the same event to multiple entity timelines in parallel.
 *
 * E.g. a stage_changed event fans out to:
 *   TL#cid#LEAD#leadId      (lead audit trail)
 *   TL#cid#CONTACT#contactId  (contact 360 view)
 *
 * Uses Promise.allSettled so one partition failure never blocks the others.
 *
 * @param {object}   event   - canonical event object from publisher
 * @param {Array}    targets - [{entityType, entityId}]
 */
async function writeTlRecords(event, targets) {
  if (!targets || targets.length === 0) return;

  await Promise.allSettled(
    targets.map(({ entityType, entityId }) =>
      writeTlRecord(event.companyId, entityType, entityId, event)
    )
  );
}

module.exports = { writeTlRecord, writeTlRecords, tlPK, tlSK };
