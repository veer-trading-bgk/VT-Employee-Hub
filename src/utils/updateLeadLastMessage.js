'use strict';

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * Caches the last message on a LEAD# METADATA record for inbox listing,
 * LeadScoringService's recency score, and the /my-work urgentReplies /
 * auto-assign eligibility gates — all of which read lastMessageAt/
 * lastInboundAt directly off this record rather than querying MSG# items.
 *
 * Moved out of routes/whatsapp.js (2026-07-08) so it can also be called from
 * ConversationalAgentService — a service must not depend backward on a route
 * (see that file's own _messageSummary comment for the same rule applied
 * elsewhere), so this needed a shared home once a second caller appeared.
 */
async function updateLeadLastMessage(pk, content, direction, ts) {
  try {
    let expr = 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir';
    const vals = { ':ts': ts, ':prev': String(content).slice(0, 100), ':dir': direction };
    if (direction === 'inbound') {
      expr += ', lastInboundAt = :ts';
      // Increment unread counter — cleared when agent opens the conversation
      expr += ', unreadCount = if_not_exists(unreadCount, :zero) + :one';
      vals[':zero'] = 0;
      vals[':one'] = 1;
    }
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: pk, SK: 'METADATA' },
      UpdateExpression: expr,
      ExpressionAttributeValues: vals,
    }).promise();
    // Bump company-level activity timestamp so /inbox/ping can detect new messages in O(1)
    const cid = pk.split('#')[1]; // LEAD#companyId#leadId
    if (cid && direction === 'inbound') {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `ACTIVITY#${cid}`, SK: 'WA' },
        UpdateExpression: 'SET lastActivityAt = :ts',
        ExpressionAttributeValues: { ':ts': ts },
      }).promise().catch(() => {});
    }
  } catch (e) {
    logger.warn('updateLeadLastMessage failed', e.message);
  }
}

module.exports = { updateLeadLastMessage };
