'use strict';

const AIService = require('./AIService');
const ConversationService = require('./ConversationService');
const TagService = require('./TagService');
const ContactBulkOpsService = require('./ContactBulkOpsService');
const NoteService = require('./NoteService');
const { fetchTranscriptText } = require('../utils/conversationTranscript');
const logger = require('../config/logger');

// System actor for AI-authored notes and usage-attribution — mirrors
// whatsapp.js's own local AI_ACTOR (the inbox-template-suggestion unreviewed-
// send path), same rationale: a dedicated actor so the note honestly
// reflects the AI wrote it, not the logged-in employee.
const AI_ACTOR = { id: 'system', role: 'admin', name: 'AI Assistant' };

/**
 * ConversationTagSummaryService — tags a conversation from the company's
 * aiAssignable-flagged catalog and, for known leads, saves a short summary as
 * an internal note. Fire-and-forget, never-throws convention (mirrors
 * IntentDetectionService.js) — callers chain this off resolveForLead()/
 * resolveForInbox()'s returned { conversationId } via .then(), never await it
 * directly on the webhook's response path.
 *
 * Gated by its own one-shot tagSummaryAt flag on the CONV# record —
 * independent of IntentDetectionService's classifiedAt, since these are
 * separate useCases with separate lifecycles. No re-analysis in this pass:
 * exactly one run per conversation, ever, until/unless a re-trigger
 * mechanism is added later.
 *
 * LEAD# conversations get tags + a note. INBOX# (unknown contacts) get tags
 * only — the model still generates a summary (tags+summary come from one AI
 * call), but it's discarded because there's no note target for an unknown
 * contact today. Known gap, tracked in docs/phase3/TECHNICAL_DEBT.md.
 */

async function _buildTagList(companyId) {
  const catalog = await TagService.getCatalog(companyId);
  const assignable = catalog.filter((t) => t.aiAssignable === true);
  if (assignable.length === 0) {
    return { tagList: '(no tags configured — do not return any tagIds)', validIds: new Set() };
  }
  const tagList = assignable.map((t) => `- ${t.id}: ${t.label}`).join('\n');
  return { tagList, validIds: new Set(assignable.map((t) => t.id)) };
}

async function _analyze(companyId, conversationId, pk) {
  const conv = await ConversationService.getConversation(companyId, conversationId);
  if (!conv || conv.tagSummaryAt) return null;

  const [{ tagList, validIds }, transcript] = await Promise.all([
    _buildTagList(companyId),
    fetchTranscriptText(companyId, pk),
  ]);

  const result = await AIService.generate({
    useCase: 'conversation-tag-summary',
    companyId,
    context: { tagList, transcript },
    user: AI_ACTOR,
    entityType: 'conversation',
    entityId: conversationId,
  });
  if (!result.ok) return null; // disabled/rate-limited/provider error — silently skip

  await ConversationService.markTagSummaryGenerated(companyId, conversationId);

  // Server-side re-validation against the same aiAssignable-filtered set the
  // prompt offered — never trust a model-returned id blind. Anything not in
  // that set (hallucinated, or a tag toggled off between prompt build and
  // response) is silently dropped.
  const tagIds = (result.data.tagIds ?? []).filter((id) => validIds.has(id));
  return { tagIds, summary: result.data.summary };
}

/**
 * Analyze a known-lead conversation: apply tags from the aiAssignable
 * catalog and save the summary as an internal note.
 * @returns {Promise<void>} — never throws
 */
async function analyzeIfNeededForLead(companyId, conversationId, leadPK, leadId) {
  try {
    const analysis = await _analyze(companyId, conversationId, leadPK);
    if (!analysis) return;

    if (analysis.tagIds.length > 0) {
      await ContactBulkOpsService.updateTags(companyId, { leadId }, { add: analysis.tagIds });
    }
    await NoteService.createNote(companyId, leadId, {
      content: `${analysis.summary}\n\n— Summarized by AI`,
      authorId: AI_ACTOR.id,
      authorName: AI_ACTOR.name,
    });
  } catch (err) {
    logger.warn(`ConversationTagSummaryService.analyzeIfNeededForLead failed [${leadPK}]: ${err.message}`);
  }
}

/**
 * Analyze an unknown-contact (INBOX#) conversation: apply tags only. The
 * summary is generated (tags+summary share one AI call) but discarded — no
 * note target exists for an unknown contact.
 * @returns {Promise<void>} — never throws
 */
async function analyzeIfNeededForInbox(companyId, conversationId, inboxPK, phone) {
  try {
    const analysis = await _analyze(companyId, conversationId, inboxPK);
    if (!analysis || analysis.tagIds.length === 0) return;

    await ContactBulkOpsService.updateTags(companyId, { phone }, { add: analysis.tagIds });
  } catch (err) {
    logger.warn(`ConversationTagSummaryService.analyzeIfNeededForInbox failed [${inboxPK}]: ${err.message}`);
  }
}

module.exports = { analyzeIfNeededForLead, analyzeIfNeededForInbox };
