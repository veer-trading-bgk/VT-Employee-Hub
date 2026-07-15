'use strict';

/**
 * Shared conversation-history/transcript helpers. Extracted out of
 * ConversationalAgentService.js (2026-07-15) once a second caller
 * (ConversationTagSummaryService) needed the same transcript-fetch logic — a
 * service must not depend on another service's private internals, so this
 * needed a shared home, same precedent as updateLeadLastMessage.js's own
 * move out of routes/whatsapp.js for the identical reason.
 */

const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// Same non-text-type summary convention as whatsapp.js's own local
// _messageSummary — kept as its own copy here rather than importing from a
// route file (a service/util must not depend backward on a route).
function _messageSummary(m) {
  if (!m.type || m.type === 'text') return m.content ?? '';
  return m.content || `[${m.type}]`;
}

/**
 * Fetch the most recent messages under a conversation's PK, oldest-first.
 * @param {string} companyId  unused inside the query itself (leadPK already embeds it) — kept for call-site clarity
 * @param {string} leadPK  the LEAD#/INBOX# partition key to query MSG# under
 * @param {number} [limit=20]
 * @returns {Promise<Array<{role: 'user'|'assistant', content: string}>>}
 */
async function fetchConversationHistory(companyId, leadPK, limit = 20) {
  const { Items = [] } = await dynamodb.query({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: { ':pk': leadPK, ':pfx': 'MSG#' },
    ScanIndexForward: false,
    Limit: limit,
  }).promise();
  return Items.slice().reverse().map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: _messageSummary(m),
  }));
}

/**
 * Render the last 40 messages as a plain-text transcript, one line per
 * message: "Customer: ..." / "AI: ...".
 * @param {string} companyId
 * @param {string} leadPK
 * @returns {Promise<string>}
 */
async function fetchTranscriptText(companyId, leadPK) {
  const history = await fetchConversationHistory(companyId, leadPK, 40);
  return history.map((m) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`).join('\n');
}

module.exports = { fetchConversationHistory, fetchTranscriptText };
