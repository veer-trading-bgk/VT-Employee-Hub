'use strict';

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const AIService = require('../services/AIService');
const WASendSvc = require('../services/WhatsAppSendService');
const ConversationService = require('../services/ConversationService');
const ContactService = require('../services/ContactService');
const CustomerIdentityService = require('../services/CustomerIdentityService');
const PipelineService = require('../services/PipelineService');
const { getAutoAssignConfig, pickNextEmployee } = require('../utils/autoAssign');
const { resolveForLead } = require('../utils/conversationResolver');
const { logAudit } = require('../utils/audit');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * ConversationalAgentService — autonomous, AI-initiated, multi-turn customer
 * conversation (2026-07-06, Era 22). Genuinely new infrastructure, not an
 * extension of Era 21's agent-click auto-reply: this initiates and carries a
 * freeform conversation with zero human action at any point, up to MAX_TURNS,
 * before a human ever sees it. See docs/bible/19_DECISION_LOG.md Era 22 for
 * the full design record and the explicit, informed risk acceptance behind it.
 *
 * Opt-in only, defaulting OFF (CONFIG#CONVAGENT#{companyId}) — deliberately a
 * SEPARATE gate from the generic AIService master/module toggle (which
 * defaults every useCase to enabled the moment it's registered). A capability
 * this consequential — talking to every new customer with zero human review —
 * should not go live for any company just because the code deployed; same
 * "opt-in, defaults false" precedent as CONFIG#AUTOASSIGN.
 *
 * Escalation is deterministic keyword matching on the customer's own message,
 * checked first, on every turn, independent of the model's own judgment — by
 * explicit design (not the model's call), and not optional: WhatsApp's own
 * Business Messaging Policy requires "prompt, clear, and direct escalation
 * paths" when using automation, a platform condition, not a SEBI-specific ask.
 */

const MAX_TURNS = 10;

const AI_ACTOR = { id: 'system', role: 'admin', name: 'AI Relationship Manager' };

const HANDOFF_MESSAGE =
  "Thank you for sharing all this — I'm connecting you with one of our senior relationship managers, "
  + 'who will follow up with you shortly to help you further.';

// Deterministic, always-on escalation trigger — never the model's own judgment
// call. Matched against the customer's raw inbound text, case-insensitive.
const ESCALATION_PATTERNS = [
  /\bagents?\b/i, /\bhuman\b/i, /\breal person\b/i,
  /\btalk to (a |someone|somebody)/i, /\bspeak to (a |someone|somebody|person)/i,
  /\bcall me\b/i, /\bcustomer (care|service)\b/i, /\brepresentative\b/i,
  /\bmanager\b/i, /\brelationship manager\b/i, /\bexecutive\b/i,
];

// Post-generation content filter — defense-in-depth BEYOND the system prompt,
// not a replacement for it. A prompt instruction alone is a soft control (an
// LLM doesn't reliably hold to it under adversarial/edge-case input); this is
// a second, independent, deterministic check before anything reaches the
// customer. Best-effort by design — regex cannot understand semantics, so
// this catches the most literal violations, not every possible phrasing.
// `.{0,20}` gaps (not a literal-phrase-only match) tolerate the intensifier
// words a model commonly inserts ("you should *definitely* apply") without
// trying to enumerate every possible one individually.
const GUARDRAIL_PATTERNS = [
  /\bguarantee(d|s)?\b/i,
  /\byou should\b.{0,20}\b(buy|sell|purchase)\b/i,
  /\bi recommend\b.{0,20}\b(buying|selling|you buy|you sell)\b/i,
  /\b(buy|sell)\b.{0,20}\bstock\b/i,
  /\byou should\b.{0,20}\bapply\b/i, /\bdon'?t apply\b/i, /\bskip this ipo\b/i, /\bavoid this ipo\b/i,
  /\bwill outperform\b/i, /\bwill definitely (grow|rise|increase)\b/i,
];

function isEscalationRequest(text) {
  return ESCALATION_PATTERNS.some((re) => re.test(text ?? ''));
}

function violatesGuardrail(replyText) {
  return GUARDRAIL_PATTERNS.some((re) => re.test(replyText ?? ''));
}

async function _getConfig(companyId) {
  const r = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#CONVAGENT#${companyId}`, SK: 'CURRENT' },
  }).promise();
  return r.Item ?? { enabled: false };
}

// Same non-text-type summary convention as whatsapp.js's own _messageSummary —
// kept as a small local copy rather than importing from a route file (a
// service must not depend backward on a route).
function _messageSummary(m) {
  if (!m.type || m.type === 'text') return m.content ?? '';
  return m.content || `[${m.type}]`;
}

async function _fetchConversationHistory(companyId, leadPK, limit = 20) {
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

async function _fetchTranscriptText(companyId, leadPK) {
  const history = await _fetchConversationHistory(companyId, leadPK, 40);
  return history.map((m) => `${m.role === 'user' ? 'Customer' : 'AI'}: ${m.content}`).join('\n');
}

async function _fetchPreferredLanguage(companyId, lead) {
  if (!lead?.contactId) return null;
  const profile = await ContactService.getContact(companyId, lead.contactId).catch(() => null);
  return profile?.preferredLanguage ?? null;
}

/**
 * Merge conversation-extracted signals onto the lead record. productInterest
 * is additive-union (same convention CIS itself uses); expectedValue/
 * closureDeadline are overwritten with the latest stated value — these
 * already feed LeadScoringService's existing _valuePoints()/_urgencyPoints()
 * unmodified, so no scoring-formula change was needed for these two signals.
 */
async function _applyExtractedSignals(companyId, leadPK, lead, data) {
  const sets = [];
  const values = {};

  if (Array.isArray(data.productInterest) && data.productInterest.length > 0) {
    const merged = Array.from(new Set([...(lead.productInterest ?? []), ...data.productInterest]));
    sets.push('productInterest = :pi');
    values[':pi'] = merged;
    lead.productInterest = merged; // keep the in-memory copy fresh for this same request's later steps
  }
  if (typeof data.budgetAmount === 'number' && data.budgetAmount > 0) {
    sets.push('expectedValue = :ev');
    values[':ev'] = data.budgetAmount;
  }
  if (typeof data.timelineDays === 'number' && data.timelineDays > 0) {
    sets.push('closureDeadline = :cd');
    values[':cd'] = new Date(Date.now() + data.timelineDays * 86_400_000).toISOString().slice(0, 10);
  }
  if (sets.length === 0) return;

  sets.push('updatedAt = :ua');
  values[':ua'] = new Date().toISOString();

  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: leadPK, SK: 'METADATA' },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeValues: values,
  }).promise();
}

async function _writeHandoffSummary(companyId, leadPK, lead, reason, turnCount) {
  const transcript = await _fetchTranscriptText(companyId, leadPK);
  const result = await AIService.generate({
    useCase: 'conversation-handoff-summary',
    companyId,
    context: { transcript, handoffReason: reason },
    user: AI_ACTOR,
  });

  const now = new Date().toISOString();
  const summary = result.ok ? result.data : {
    summary: 'AI conversation handed off — summary generation failed, see raw transcript.',
    statedNeeds: '', productInterest: [], budgetMentioned: null, timelineMentioned: null, handoffReason: reason,
  };

  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: leadPK, SK: 'METADATA' },
    UpdateExpression: 'SET aiConversationSummary = :s, aiConversationTurns = :t, handoffAt = :ha, updatedAt = :ua',
    ExpressionAttributeValues: {
      ':s': { ...summary, generatedAt: now }, ':t': turnCount, ':ha': now, ':ua': now,
    },
  }).promise();

  let tl;
  try { tl = require('../events/timeline'); } catch { tl = null; }
  if (typeof tl?.writeTlRecord === 'function') {
    await tl.writeTlRecord(companyId, 'LEAD', lead.leadId, {
      eventType: 'ai_conversation_handoff',
      actorId: 'system', actorName: 'AI Relationship Manager',
      summary: `AI conversation handed off (${reason}): ${summary.summary}`,
      metadata: { reason, turnCount, ...summary },
    }).catch((e) => logger.warn(`ConversationalAgentService: timeline write failed: ${e.message}`));
  }
}

async function _assignAtHandoff(companyId, leadPK) {
  const cfg = await getAutoAssignConfig(companyId);
  if (!cfg?.enabled) return;
  const picked = await pickNextEmployee(companyId, 'ai_conversation', cfg);
  if (!picked) return;
  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: leadPK, SK: 'METADATA' },
    UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
    ExpressionAttributeValues: {
      ':at': picked.id, ':atn': picked.name ?? null, ':cs': 'open', ':ua': new Date().toISOString(),
    },
  }).promise();
}

async function _advanceStageAtHandoff(companyId, leadPK) {
  const target = 'interested';
  if (!(await PipelineService.isValidStage(companyId, target))) return; // company's pipeline doesn't have this stage — leave as-is, don't force an invalid one
  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: leadPK, SK: 'METADATA' },
    UpdateExpression: 'SET #s = :s, updatedAt = :ua',
    ExpressionAttributeNames: { '#s': 'stage' },
    ExpressionAttributeValues: { ':s': target, ':ua': new Date().toISOString() },
  }).promise().catch((e) => logger.warn(`ConversationalAgentService: stage advance failed: ${e.message}`));
}

async function _handoff(companyId, { leadPK, lead, conversationId, reason, turnCount }) {
  await WASendSvc.sendText(companyId, { leadPK }, HANDOFF_MESSAGE, AI_ACTOR)
    .catch((e) => logger.warn(`ConversationalAgentService: handoff message send failed: ${e.message}`));
  await ConversationService.handoffToHuman(companyId, conversationId);
  await _writeHandoffSummary(companyId, leadPK, lead, reason, turnCount);
  await _assignAtHandoff(companyId, leadPK);
  await _advanceStageAtHandoff(companyId, leadPK);
}

/**
 * Runs one AI turn: escalation check, generate, guardrail filter, send,
 * audit log, extracted-signal merge, turn increment, and (if triggered)
 * handoff. Shared by both maybeStart() and continueTurn().
 */
async function _runTurn(companyId, { leadPK, lead, conversationId, text, turnCount }) {
  if (isEscalationRequest(text)) {
    await _handoff(companyId, { leadPK, lead, conversationId, reason: 'escalated', turnCount });
    return;
  }

  const [conversationHistory, preferredLanguage] = await Promise.all([
    _fetchConversationHistory(companyId, leadPK),
    _fetchPreferredLanguage(companyId, lead),
  ]);

  const result = await AIService.generate({
    useCase: 'conversational-sales-agent',
    companyId,
    context: { latestMessage: text, turnNumber: turnCount + 1, maxTurns: MAX_TURNS, preferredLanguage },
    conversationHistory,
    user: AI_ACTOR,
    assigneeId: lead.assignedTo ?? undefined,
  });

  if (!result.ok) {
    logger.warn(`ConversationalAgentService: generate failed for ${leadPK}: ${result.reason} — ${result.detail}`);
    return;
  }

  let replyText = result.data.reply;
  const guardrailTripped = violatesGuardrail(replyText);
  if (guardrailTripped) {
    logger.warn(`ConversationalAgentService: guardrail tripped for ${leadPK}, turn ${turnCount + 1} — reply replaced, forcing handoff. Model reasoning (audit only, never sent): ${result.data.reasoning}`);
    replyText = HANDOFF_MESSAGE;
  }

  const sendResult = await WASendSvc.sendText(companyId, { leadPK }, replyText, AI_ACTOR);

  try {
    await logAudit('system', 'ai_conversation_turn', leadPK, 'success', null, {
      aiGenerated: true, useCase: 'conversational-sales-agent', conversationId,
      turnNumber: turnCount + 1, guardrailTripped, qualified: result.data.qualified,
      reasoning: result.data.reasoning, wamid: sendResult.waMessageId,
    }, companyId);
  } catch (auditErr) {
    logger.error(`ConversationalAgentService: audit log FAILED for turn ${turnCount + 1} on ${leadPK} — message was sent, no audit record exists: ${auditErr.message}`);
  }

  if (!guardrailTripped) {
    await _applyExtractedSignals(companyId, leadPK, lead, result.data);
  }

  const newTurnCount = turnCount + 1;
  await ConversationService.incrementAiTurn(companyId, conversationId, turnCount);

  if (guardrailTripped || result.data.qualified || newTurnCount >= MAX_TURNS) {
    const reason = guardrailTripped ? 'escalated' : result.data.qualified ? 'qualified' : 'turn_limit_reached';
    await _handoff(companyId, { leadPK, lead, conversationId, reason, turnCount: newTurnCount });
  }
}

/**
 * Called only from the webhook's unknown-contact (INBOX#) branch, on a
 * genuinely first-ever message (isFirstContact), never on any subsequent one.
 * Creates the real CRM lead via CIS right away (ADR-013 — the only path) —
 * deliberately WITHOUT context.actorId, so CIS's own auto-assign-fallback
 * (which only fires when actorId is present and auto-assign itself found no
 * candidate) never claims this lead on our behalf; if the company's own
 * auto-assign config is enabled and DOES pick someone, that's a genuine human
 * claim and the bot correctly does not engage (see the assignedTo check
 * below) — "new/unassigned" is evaluated against the real post-creation
 * state, not assumed.
 *
 * @returns {Promise<boolean>} true if the bot engaged (sent the first reply)
 */
async function maybeStart(companyId, { phone10, waName, text, timestamp, waMessageId }) {
  try {
    const cfg = await _getConfig(companyId);
    if (!cfg.enabled) return false;

    const result = await CustomerIdentityService.resolveOrCreate(companyId, {
      phone: phone10,
      name: waName || undefined,
      source: 'whatsapp',
      idempotencyKey: `convagent:${companyId}:${phone10}:${waMessageId}`,
    }, { createdBy: 'webhook' });

    let lead = result.lead;
    if (!lead) {
      const r = await dynamodb.get({ TableName: TABLE, Key: { PK: `LEAD#${companyId}#${result.leadId}`, SK: 'METADATA' } }).promise();
      lead = r.Item;
    }
    if (!lead || lead.assignedTo) return false; // already claimed by a human — not eligible

    const conv = await resolveForLead(companyId, lead.PK, phone10, { text, timestamp });
    if (!conv?.conversationId) return false;

    await ConversationService.startBotHandling(companyId, conv.conversationId);
    await _runTurn(companyId, { leadPK: lead.PK, lead, conversationId: conv.conversationId, text, turnCount: 0 });
    return true;
  } catch (err) {
    logger.error(`ConversationalAgentService.maybeStart failed [${companyId}/${phone10}]: ${err.message}`);
    return false;
  }
}

/**
 * Called from the webhook's known-lead branch on every inbound text message.
 * No-ops (returns false) for any lead whose conversation isn't an actively
 * bot-handled one — including leads that were always human-handled, and ones
 * already handed off.
 *
 * @returns {Promise<boolean>} true if this message was consumed as a bot turn
 */
async function continueTurn(companyId, { leadPK, lead, phone10, text, timestamp }) {
  try {
    const cfg = await _getConfig(companyId);
    if (!cfg.enabled) return false;

    const conv = await resolveForLead(companyId, leadPK, phone10, { text, timestamp });
    if (!conv?.conversationId) return false;

    const conversation = await ConversationService.getConversation(companyId, conv.conversationId);
    if (!conversation || conversation.handoffState !== 'ai') return false;

    const turnCount = conversation.aiTurnCount ?? 0;
    if (turnCount >= MAX_TURNS) return false; // defensive — should already be handed off by now

    await _runTurn(companyId, { leadPK, lead, conversationId: conv.conversationId, text, turnCount });
    return true;
  } catch (err) {
    logger.error(`ConversationalAgentService.continueTurn failed [${leadPK}]: ${err.message}`);
    return false;
  }
}

module.exports = {
  MAX_TURNS,
  isEscalationRequest,
  violatesGuardrail,
  maybeStart,
  continueTurn,
};
