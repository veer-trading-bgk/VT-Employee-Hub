'use strict';

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * Caches the last message on a LEAD# METADATA or INBOX# CONTACT record for
 * inbox listing, LeadScoringService's recency score, and the /my-work
 * urgentReplies / auto-assign eligibility gates — all of which read
 * lastMessageAt/lastInboundAt directly off this record rather than querying
 * MSG# items.
 *
 * Moved out of routes/whatsapp.js (2026-07-08) so it can also be called from
 * ConversationalAgentService — a service must not depend backward on a route
 * (see that file's own _messageSummary comment for the same rule applied
 * elsewhere), so this needed a shared home once a second caller appeared.
 *
 * Extended (Wave 1 audit fixes) with the isLead param so WhatsAppSendService's
 * outbound sends can call this directly instead of keeping their own private,
 * drifting copy — that copy covered both the LEAD# and INBOX# (isLead: false)
 * cases, so both are folded in here.
 */
async function updateLeadLastMessage(pk, content, direction, ts, isLead = true) {
  try {
    const preview = String(content).slice(0, 100);
    if (isLead) {
      let expr = 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir';
      const vals = { ':ts': ts, ':prev': preview, ':dir': direction };
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
    } else {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: pk, SK: 'CONTACT' },
        UpdateExpression: 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir',
        ExpressionAttributeValues: { ':ts': ts, ':prev': preview, ':dir': direction },
      }).promise();
    }
    // Bump company-level activity timestamp so /inbox/ping can detect new activity
    // in O(1) — both directions, so an outbound send from one agent's tab also
    // refreshes another agent's open inbox view, not just an inbound customer reply.
    const cid = pk.split('#')[1]; // LEAD#companyId#leadId or INBOX#companyId#phone
    if (cid) {
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
