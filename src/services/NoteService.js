'use strict';

// Single write path for internal team notes (LEAD# NOTE#<timestamp>) — shared
// by the human-authored route (whatsapp.js's POST /inbox/:leadId/note) and any
// AI-authored note (ConversationTagSummaryService, upcoming). Pure business
// logic — throws ValidationError for empty content, lets any other error
// (DynamoDB) propagate for the caller to handle. Same split as
// ContactBulkOpsService's NotFoundError convention.

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

class ValidationError extends Error {}

/**
 * Create an internal note on a LEAD# conversation.
 * @param {string} companyId
 * @param {string} leadId
 * @param {{content: string, authorId: string, authorName: string}} fields
 * @returns {Promise<{timestamp: string, note: object}>}
 */
async function createNote(companyId, leadId, { content, authorId, authorName }) {
  if (!content?.trim()) throw new ValidationError('content required');

  const PK = `LEAD#${companyId}#${leadId}`;
  const timestamp = new Date().toISOString();
  const mentionNames = [...content.matchAll(/@(\w+)/g)].map((m) => m[1]);
  // Built as its own variable (not inline in the put()) so the same object
  // that's persisted is also returned to the caller — Track A5 Fix 2: the
  // frontend needs the real note (real SK/authorName) to reconcile its
  // optimistic placeholder, not just a bare timestamp.
  const note = {
    PK, SK: `NOTE#${timestamp}`,
    content: content.trim(),
    authorId,
    authorName,
    type: 'note',
    timestamp,
    ...(mentionNames.length && { mentions: mentionNames }),
  };
  await dynamodb.put({ TableName: TABLE, Item: note }).promise();

  if (mentionNames.length > 0) {
    logger.alert(`📌 <b>${authorName}</b> mentioned ${mentionNames.map((n) => `@${n}`).join(', ')} in a note\nLead: <code>${leadId}</code>`);
  }

  return { timestamp, note };
}

module.exports = { createNote, ValidationError };
