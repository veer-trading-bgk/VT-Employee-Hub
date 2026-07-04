'use strict';

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const AIService = require('./AIService');
const ConversationService = require('./ConversationService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// System actor for a background AI-triggered write — same convention already
// used for other system-initiated actions in this codebase (e.g. whatsapp.js's
// fireButtonFollowUp calls with { id: 'system', role: 'admin', name: 'System' }).
const SYSTEM_USER = { id: 'system', role: 'admin', name: 'AI Classifier' };

/**
 * IntentDetectionService — the first real feature built on AIService.js.
 *
 * Fire-and-forget, never-throws convention (mirrors conversationResolver.js's
 * own contract) — callers chain this off resolveForLead()/resolveForInbox()'s
 * returned { conversationId } via .then(), never await it directly on the
 * webhook's response path.
 *
 * customerFacing: false (see aiConfig.js) — this only labels the conversation
 * internally, so AIService's approval gate never engages for it.
 *
 * Triggered once per conversation, not on every message: classifyIfNeeded*
 * no-ops if the conversation is already classified (classifiedAt set), or if
 * it can't be found. Callers are also expected to only invoke this for plain
 * 'text' messages (media/button-reply/flow-response carry no meaningful free
 * text to classify, or already carry unambiguous structured intent) — that
 * gate lives at the call site (whatsapp.js's webhook), not here.
 */

async function _classify(companyId, conversationId, text) {
  const conv = await ConversationService.getConversation(companyId, conversationId);
  if (!conv || conv.classifiedAt) return null;

  const result = await AIService.generate({
    useCase: 'inbox-intent-detection',
    companyId,
    context: { message: text },
    user: SYSTEM_USER,
  });
  if (!result.ok) return null; // disabled/rate-limited/provider error — silently skip

  const { intent, confidence } = result.data;
  return ConversationService.classifyIntent(companyId, conversationId, { intent, confidence });
}

/**
 * Classify a known-lead conversation's intent, if not already classified.
 * Mirrors the result onto LEAD# METADATA (read-optimised denormalisation, same
 * pattern lastMessageAt/lastMessagePreview already use) so Contact 360's
 * existing GET /api/crm/leads/:id response carries intent/confidence with zero
 * new routes or Customer360Context changes.
 *
 * @returns {Promise<void>} — never throws
 */
async function classifyIfNeededForLead(companyId, conversationId, leadPK, text) {
  try {
    const classification = await _classify(companyId, conversationId, text);
    if (!classification) return;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: leadPK, SK: 'METADATA' },
      UpdateExpression: 'SET intent = :i, confidence = :c, classifiedAt = :ca',
      ExpressionAttributeValues: {
        ':i': classification.intent, ':c': classification.confidence, ':ca': classification.classifiedAt,
      },
    }).promise();
  } catch (err) {
    logger.warn(`IntentDetectionService.classifyIfNeededForLead failed [${leadPK}]: ${err.message}`);
  }
}

/** Same as classifyIfNeededForLead, for an INBOX# (unknown-contact) conversation. */
async function classifyIfNeededForInbox(companyId, conversationId, inboxPK, text) {
  try {
    const classification = await _classify(companyId, conversationId, text);
    if (!classification) return;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: inboxPK, SK: 'CONTACT' },
      UpdateExpression: 'SET intent = :i, confidence = :c, classifiedAt = :ca',
      ExpressionAttributeValues: {
        ':i': classification.intent, ':c': classification.confidence, ':ca': classification.classifiedAt,
      },
    }).promise();
  } catch (err) {
    logger.warn(`IntentDetectionService.classifyIfNeededForInbox failed [${inboxPK}]: ${err.message}`);
  }
}

module.exports = { classifyIfNeededForLead, classifyIfNeededForInbox };
