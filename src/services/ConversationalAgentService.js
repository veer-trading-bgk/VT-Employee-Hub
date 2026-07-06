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
const { aiAdminConversationSchema } = require('../utils/validation');

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
 * Assignment priority (fixed 2026-07-06, same-day follow-up after first live
 * test): a fresh WhatsApp contact's lead is ALWAYS created with
 * skipAutoAssign: true (see maybeStart()) — a company's own CONFIG#AUTOASSIGN
 * never claims it at creation time, regardless of whether that config is
 * enabled. Auto-assign still runs, deferred to _handoff() instead, so the AI
 * always gets first opportunity on every new conversation; a human is only
 * assigned once the conversation actually qualifies, escalates, or hits the
 * turn cap. Originally this raced CIS's own internal auto-assign and lost
 * whenever a company had it enabled — confirmed via a real live test.
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
  // --- v1 (Era 22): explicit directive phrasing ---
  /\bguarantee(d|s)?\b/i,
  /\byou should\b.{0,20}\b(buy|sell|purchase)\b/i,
  /\bi recommend\b.{0,20}\b(buying|selling|you buy|you sell)\b/i,
  // 2026-07-06: narrowed from /\b(buy|sell)\b.{0,20}\bstock\b/i — that loose
  // form false-tripped on genuine educational replies during live testing
  // ("you need one to buy or sell on the stock market" while explaining what
  // a Demat account is), forcing an unnecessary escalation on a safe reply.
  // Directive phrasing ("buy this/that/the stock") is what the rule actually
  // targets; generic buy/sell imperatives without "stock" are still caught
  // by the v2 casual-directive patterns below regardless of this narrowing.
  /\b(buy|sell) (this|that|the) stock\b/i,
  /\byou should\b.{0,20}\bapply\b/i, /\bdon'?t apply\b/i, /\bskip this ipo\b/i, /\bavoid this ipo\b/i,
  /\bwill outperform\b/i, /\bwill definitely (grow|rise|increase)\b/i,

  // --- v2 (2026-07-06, production-readiness pass): the same v1 categories,
  // but in the short imperative phrasing the concise WhatsApp style favours
  // ("Buy this now" instead of "You should buy this") — the v1 patterns
  // above require scaffolding words ("you should", "I recommend") that a
  // terser reply may simply drop, so re-verified and extended rather than
  // assumed to still catch these.
  /\b(buy|sell|grab) (this|it|that) now\b/i,
  /\bgo ahead and\b.{0,20}\b(buy|sell)\b/i,
  /\bi'?d (buy|sell|go with|choose|pick) (this|it|that)\b/i,
  /\btime to (buy|sell)\b/i,
  /\bapply (for|to) this ipo\b/i, /\bgrab this ipo\b/i, /\bipo\b.{0,20}\bapply now\b/i,
  /\bwill (double|triple|multiply)\b/i, /\bsure[- ]shot\b/i, /\bcan'?t go wrong\b/i,
  /\brisk[- ]?free\b/i, /\bno risk\b/i, /\bassured returns?\b/i, /\bfixed returns?\b/i,

  // --- v2 (2026-07-06): implicit endorsement of a SPECIFIC product. The
  // model doesn't have to say "I recommend X" to cross the compliance line —
  // praising one option as the best/right/safe choice is the same violation
  // in shorter clothing. Scoped to endorsement-adjective + product-noun (or
  // an explicit "recommend/choose this" phrase), not bare adjectives, so
  // approved rapport phrases like "Great 👍" or "Perfect." alone are not
  // swept in — those have no product noun immediately following.
  /\b(great|good|excellent|solid|perfect|best|safe) (fund|scheme|plan|policy|investment|option|choice|pick|bet)\b/i,
  /\byou'?ll (likely |definitely |probably )?benefit from (this|it|that)\b/i,
  /\bi recommend (this|it|that)\b/i,
  /\byou should (choose|pick|go with|select) (this|it|that)\b/i,
];

function isEscalationRequest(text) {
  return ESCALATION_PATTERNS.some((re) => re.test(text ?? ''));
}

function violatesGuardrail(replyText) {
  return GUARDRAIL_PATTERNS.some((re) => re.test(replyText ?? ''));
}

// Human-readable category labels for the AI Administration Compliance tab
// (Phase 2A, PR 1, read-only display) — deliberately NOT the raw regex
// patterns themselves (never expose enforcement internals over an API), and
// deliberately maintained here, next to the patterns they describe, rather
// than hand-duplicated in a route/frontend file that could silently drift
// from what's actually enforced (the same class of gap the 2026-07-05 audit
// found in AISection.tsx's MODULES array).
const GUARDRAIL_CATEGORIES = [
  'No guaranteed returns or promises of profit',
  'No buy/sell/hold directives on any specific stock, security, or F&O position',
  'No specific IPO application advice',
  'No claims that a specific product will outperform others',
  'No endorsement of one specific fund, scheme, or product as the best/right/safe choice',
];
const ESCALATION_CATEGORIES = [
  'Customer asks for a human, agent, or representative',
  'Customer asks to speak to or call a manager or relationship manager',
  'Customer asks for customer care/service',
];

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

// Phase 2A / PR 1 — Conversation tab (CONFIG#CONVPROMPT). Reuses
// aiAdminConversationSchema's own defaults (single source of truth — a
// company that never opens AI Administration gets exactly these values,
// which the prompt template treats as "say nothing extra, today's behavior").
async function _fetchConversationSettings(companyId) {
  const r = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#CONVPROMPT#${companyId}`, SK: 'CURRENT' },
  }).promise().catch(() => ({}));
  return aiAdminConversationSchema.parse(r.Item ?? {});
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

// 2026-07-06 same-day (post-deploy manual test): skipHandoffMessage lets a
// caller that already sent HANDOFF_MESSAGE as this turn's reply skip _handoff's
// own send. Without it, a guardrail-tripped turn sent the identical handoff
// text twice — confirmed live (two real outbound messages 758ms apart,
// verbatim-identical, LEAD#viir_trading#2d95bda8-bb47-4047-b79b-74ad4a59296f)
// and root-caused: _runTurn() reassigns replyText to HANDOFF_MESSAGE and sends
// it BEFORE calling _handoff(), which then unconditionally sent it again.
// cfg (the same CONFIG#CONVAGENT item every caller already fetched via
// _getConfig()) gates two Phase 2A / PR 1 toggles, both `!== false` so a
// pre-PR-1 config item (missing these fields entirely) keeps today's
// always-on behavior — see docs/bible/19_DECISION_LOG.md's Phase 2A entry.
async function _handoff(companyId, { leadPK, lead, conversationId, reason, turnCount, skipHandoffMessage = false, cfg = {} }) {
  if (!skipHandoffMessage) {
    await WASendSvc.sendText(companyId, { leadPK }, HANDOFF_MESSAGE, AI_ACTOR)
      .catch((e) => logger.warn(`ConversationalAgentService: handoff message send failed: ${e.message}`));
  }
  await ConversationService.handoffToHuman(companyId, conversationId);
  if (cfg.summaryEnabled !== false) {
    await _writeHandoffSummary(companyId, leadPK, lead, reason, turnCount);
  }
  if (cfg.crmAutoTransferEnabled !== false) {
    await _assignAtHandoff(companyId, leadPK);
    await _advanceStageAtHandoff(companyId, leadPK);
  }
}

/**
 * Runs one AI turn: escalation check, generate, guardrail filter, send,
 * audit log, extracted-signal merge, turn increment, and (if triggered)
 * handoff. Shared by both maybeStart() and continueTurn().
 */
async function _runTurn(companyId, { leadPK, lead, conversationId, text, turnCount, cfg }) {
  if (isEscalationRequest(text)) {
    await _handoff(companyId, { leadPK, lead, conversationId, reason: 'escalated', turnCount, cfg });
    return;
  }

  const [conversationHistory, preferredLanguage, conversationSettings] = await Promise.all([
    _fetchConversationHistory(companyId, leadPK),
    _fetchPreferredLanguage(companyId, lead),
    _fetchConversationSettings(companyId),
  ]);

  const result = await AIService.generate({
    useCase: 'conversational-sales-agent',
    companyId,
    context: {
      latestMessage: text, turnNumber: turnCount + 1, maxTurns: MAX_TURNS, preferredLanguage,
      ...conversationSettings,
    },
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

  if (!guardrailTripped && cfg.qualificationEnabled !== false) {
    await _applyExtractedSignals(companyId, leadPK, lead, result.data);
  }

  const newTurnCount = turnCount + 1;
  await ConversationService.incrementAiTurn(companyId, conversationId, turnCount);

  if (guardrailTripped || result.data.qualified || newTurnCount >= MAX_TURNS) {
    const reason = guardrailTripped ? 'escalated' : result.data.qualified ? 'qualified' : 'turn_limit_reached';
    // guardrailTripped turns already sent HANDOFF_MESSAGE as replyText above —
    // skip _handoff's own send so the customer doesn't get it twice.
    await _handoff(companyId, { leadPK, lead, conversationId, reason, turnCount: newTurnCount, skipHandoffMessage: guardrailTripped, cfg });
  }
}

/**
 * Called only from the webhook's unknown-contact (INBOX#) branch, on a
 * genuinely first-ever message (isFirstContact), never on any subsequent one.
 * Creates the real CRM lead via CIS right away (ADR-013 — the only path).
 *
 * 2026-07-06 update: passes skipAutoAssign: true, so a company's own
 * CONFIG#AUTOASSIGN (enabled or not) can never claim this lead at creation
 * time — the AI conversation agent always gets first opportunity on a fresh
 * WhatsApp contact. Auto-assign still runs, just deferred to _handoff()
 * (same pickNextEmployee()/config, only invoked later instead of by CIS
 * itself) — "assign only after qualification, escalation, or the turn cap"
 * is now the actual priority order, not something that could lose a race to
 * CIS's own internal auto-assign. context.actorId is still deliberately
 * omitted too, so CIS's actor-fallback (a second, independent assignment
 * path) also never fires here.
 *
 * The `!lead.assignedTo` check below now mainly guards a different case: an
 * "enriched" hit (CIS found this phone already belongs to a pre-existing,
 * already-human-assigned lead the webhook's own simpler GSI lookup missed) —
 * a real returning/claimed customer, correctly still not bot-eligible.
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
      skipAutoAssign: true,
      idempotencyKey: `convagent:${companyId}:${phone10}:${waMessageId}`,
    }, { createdBy: 'webhook' });

    let lead = result.lead;
    if (!lead) {
      const r = await dynamodb.get({ TableName: TABLE, Key: { PK: `LEAD#${companyId}#${result.leadId}`, SK: 'METADATA' } }).promise();
      lead = r.Item;
    }
    if (!lead || lead.assignedTo) return false; // pre-existing, already-claimed lead — not eligible

    const conv = await resolveForLead(companyId, lead.PK, phone10, { text, timestamp });
    if (!conv?.conversationId) return false;

    await ConversationService.startBotHandling(companyId, conv.conversationId);
    await _runTurn(companyId, { leadPK: lead.PK, lead, conversationId: conv.conversationId, text, turnCount: 0, cfg });
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

    await _runTurn(companyId, { leadPK, lead, conversationId: conv.conversationId, text, turnCount, cfg });
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
  HANDOFF_MESSAGE,
  GUARDRAIL_CATEGORIES,
  ESCALATION_CATEGORIES,
};
