'use strict';

/**
 * ConversationalAgentService — the autonomous, AI-initiated multi-turn
 * customer conversation (2026-07-06, Era 22). Exercises the two public entry
 * points (maybeStart/continueTurn) directly, the same direct-invocation
 * convention used throughout this codebase's other service tests.
 *
 * Conversation/lead state is simulated with small mutable in-memory objects
 * that the mocked ConversationService/dynamodb calls read and write, so a
 * test can drive several turns in sequence and see real state evolve exactly
 * as it would across several real webhook invocations.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AIService', () => ({ generate: jest.fn() }));
jest.mock('../src/services/WhatsAppSendService', () => ({ sendText: jest.fn() }));
jest.mock('../src/services/ContactService', () => ({ getContact: jest.fn() }));
jest.mock('../src/services/CustomerIdentityService', () => ({ resolveOrCreate: jest.fn() }));
jest.mock('../src/services/PipelineService', () => ({ isValidStage: jest.fn() }));
jest.mock('../src/utils/autoAssign', () => ({ getAutoAssignConfig: jest.fn(), pickNextEmployee: jest.fn() }));
jest.mock('../src/utils/conversationResolver', () => ({ resolveForLead: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../src/services/ConversationService', () => ({
  getConversation: jest.fn(),
  startBotHandling: jest.fn(),
  incrementAiTurn: jest.fn(),
  handoffToHuman: jest.fn(),
}));
jest.mock('../src/events/timeline', () => ({ writeTlRecord: jest.fn().mockResolvedValue(undefined) }));
// RAG PR C — KnowledgeService/DocumentChunkService/DocumentChunkRetrievalService
// are deliberately left real/unmocked (same as KnowledgeService already was);
// only the embedding provider boundary itself is mocked.
jest.mock('../src/services/EmbeddingService', () => ({ embed: jest.fn() }));

const dynamodb = require('../src/config/dynamodb');
const AIService = require('../src/services/AIService');
const EmbeddingService = require('../src/services/EmbeddingService');
const DocumentChunkRetrievalService = require('../src/services/DocumentChunkRetrievalService');
const WASendSvc = require('../src/services/WhatsAppSendService');
const CustomerIdentityService = require('../src/services/CustomerIdentityService');
const PipelineService = require('../src/services/PipelineService');
const { getAutoAssignConfig, pickNextEmployee } = require('../src/utils/autoAssign');
const { resolveForLead } = require('../src/utils/conversationResolver');
const { logAudit } = require('../src/utils/audit');
const ConversationService = require('../src/services/ConversationService');
const timeline = require('../src/events/timeline');
const agent = require('../src/services/ConversationalAgentService');

const CID = 'comp_test';
const PHONE = '9876543210';
const LEAD_PK = `LEAD#${CID}#lead_1`;

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

// A tiny in-memory conversation record the mocked ConversationService
// methods read/write, so turn state genuinely evolves across sequential
// calls in one test, the same way it would across real webhook invocations.
function makeConvState() {
  return { conversationId: 'conv_1', handoffState: 'ai', aiTurnCount: 0, isBotActive: true };
}

describe('ConversationalAgentService', () => {
  let lead;
  let conv;
  let turnQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

    lead = {
      PK: LEAD_PK, SK: 'METADATA', leadId: 'lead_1', companyId: CID,
      name: 'Ravi', phone: PHONE, assignedTo: null, stage: 'new_lead', productInterest: [],
    };
    conv = makeConvState();

    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
      if (params.Key.PK === LEAD_PK) return resolved({ Item: lead });
      return resolved({});
    });
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.query.mockReturnValue(resolved({ Items: [] })); // conversation history — empty by default

    resolveForLead.mockResolvedValue({ conversationId: conv.conversationId });
    ConversationService.getConversation.mockImplementation(() => Promise.resolve({ ...conv }));
    ConversationService.startBotHandling.mockImplementation(() => {
      conv.isBotActive = true; conv.handoffState = 'ai'; conv.aiTurnCount = 0;
      return Promise.resolve();
    });
    ConversationService.incrementAiTurn.mockImplementation((companyId, conversationId, currentTurnCount) => {
      conv.aiTurnCount = currentTurnCount + 1;
      return Promise.resolve();
    });
    ConversationService.handoffToHuman.mockImplementation(() => {
      conv.isBotActive = false; conv.handoffState = 'pending_human';
      return Promise.resolve();
    });

    CustomerIdentityService.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_1', action: 'created', interactionId: 'int_1', lead,
    });
    WASendSvc.sendText.mockImplementation(() => Promise.resolve({ waMessageId: `wamid_${Math.random()}` }));
    PipelineService.isValidStage.mockResolvedValue(true);
    getAutoAssignConfig.mockResolvedValue({ enabled: false });
    logAudit.mockResolvedValue(true);

    // AIService.generate is shared by both the per-turn useCase AND the
    // handoff-summary useCase (a real turn that triggers handoff makes BOTH
    // calls in sequence) — dispatch by useCase rather than a single response
    // queue, so a handoff-triggering turn never runs the queue dry on its own
    // follow-up summary call. turnQueue is FIFO, consumed only by
    // conversational-sales-agent calls; the summary useCase always has a
    // working default unless a test overrides it.
    turnQueue = [];
    AIService.generate.mockImplementation((params) => {
      if (params.useCase === 'conversation-handoff-summary') {
        return Promise.resolve({
          ok: true,
          data: {
            summary: 'Default test summary.', statedNeeds: '', productInterest: [],
            budgetMentioned: null, timelineMentioned: null, handoffReason: params.context.handoffReason,
          },
        });
      }
      return Promise.resolve(turnQueue.shift() ?? {
        ok: true,
        data: { reply: 'Sure, happy to help!', qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'default' },
      });
    });
  });

  function mockTurn({ reply = 'Sure, happy to help with that!', qualified = false, productInterest = [], budgetAmount = null, timelineDays = null } = {}) {
    turnQueue.push({
      ok: true,
      data: { reply, qualified, productInterest, budgetAmount, timelineDays, reasoning: 'test reasoning' },
    });
  }

  function mockTurnFailure(reason, detail) {
    turnQueue.push({ ok: false, reason, detail });
  }

  // ─── Full MAX_TURNS flow, end to end ────────────────────────────────────────
  // Cap-agnostic on purpose: drives off agent.MAX_TURNS so a future cost-trial
  // cap change (10 → 5 on 2026-07-14, and any later revert) never breaks this.
  test('a full-length conversation reaches handoff exactly at the cap (MAX_TURNS) when never qualified/escalated', async () => {
    const CAP = agent.MAX_TURNS;
    mockTurn(); // turn 1, via maybeStart
    const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });
    expect(started).toBe(true);
    expect(conv.aiTurnCount).toBe(1);
    expect(ConversationService.handoffToHuman).not.toHaveBeenCalled();

    // Turns 2 .. CAP-1: continue, no handoff yet.
    for (let i = 2; i <= CAP - 1; i++) {
      mockTurn();
      const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: `message ${i}`, timestamp: `t${i}` });
      expect(handled).toBe(true);
    }
    expect(conv.aiTurnCount).toBe(CAP - 1);
    expect(ConversationService.handoffToHuman).not.toHaveBeenCalled();

    // Turn CAP — the cap. Still not qualified, still no escalation.
    mockTurn({ qualified: false });
    const handledLast = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: `message ${CAP}`, timestamp: `t${CAP}` });
    expect(handledLast).toBe(true);
    expect(conv.aiTurnCount).toBe(CAP);
    expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
    expect(WASendSvc.sendText).toHaveBeenLastCalledWith(CID, { leadPK: LEAD_PK }, expect.stringContaining('senior relationship manager'), expect.objectContaining({ id: 'system' }));

    // The conversation is now handed off — the next message must not be treated as a bot turn.
    const handledAfterCap = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'anything else?', timestamp: `t${CAP + 1}` });
    expect(handledAfterCap).toBe(false);
  });

  // ─── Escalation keyword mid-conversation ────────────────────────────────────
  test('an escalation keyword at turn 4 interrupts immediately — does not wait for the turn cap', async () => {
    mockTurn();
    await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'tell me about SIPs', timestamp: 't2' });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'what about mutual funds', timestamp: 't3' });
    expect(conv.aiTurnCount).toBe(3);

    AIService.generate.mockClear();
    const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'I want to talk to a human agent please', timestamp: 't4' });

    expect(handled).toBe(true);
    // Escalation is checked BEFORE generation — no AI call for the escalated turn at all.
    expect(AIService.generate).not.toHaveBeenCalledWith(expect.objectContaining({ useCase: 'conversational-sales-agent' }));
    expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
    // Escalation never increments the turn count — _runTurn returns before that step.
    expect(conv.aiTurnCount).toBe(3);

    const summaryCall = AIService.generate.mock.calls.find((c) => c[0].useCase === 'conversation-handoff-summary');
    expect(summaryCall[0].context.handoffReason).toBe('escalated');
  });

  test('isEscalationRequest matches the required phrases and ignores ordinary conversation', () => {
    for (const phrase of ['agent', 'a human', 'talk to someone', 'call me please', 'speak to a person', 'can I speak to a representative']) {
      expect(agent.isEscalationRequest(phrase)).toBe(true);
    }
    for (const phrase of ['I want a demat account', 'what mutual funds do you have', 'tell me about SIPs']) {
      expect(agent.isEscalationRequest(phrase)).toBe(false);
    }
  });

  // ─── Compliance guardrail ────────────────────────────────────────────────────
  test('a reply guaranteeing returns is rejected — the raw model output never reaches the customer', async () => {
    mockTurn({ reply: 'I guarantee this stock will double in a year, you should buy it now.' });
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'what stock should I buy', timestamp: 't1' });

    expect(WASendSvc.sendText).toHaveBeenCalledWith(
      CID, { leadPK: LEAD_PK },
      expect.not.stringContaining('guarantee'),
      expect.anything(),
    );
    expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
  });

  // 2026-07-06 same-day: found live in production — a guardrail-tripped turn
  // sent the handoff message twice (replyText reassigned to HANDOFF_MESSAGE
  // and sent, then _handoff() sent the identical text again). Confirmed via
  // real DynamoDB records, two outbound messages 758ms apart, verbatim-identical.
  test('a guardrail-tripped turn sends the handoff message exactly ONCE, not twice', async () => {
    mockTurn({ reply: 'I guarantee this stock will double in a year, you should buy it now.' });
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'what stock should I buy', timestamp: 't1' });

    const handoffSends = WASendSvc.sendText.mock.calls.filter(
      (c) => c[2].includes("connecting you with one of our senior relationship managers"),
    );
    expect(handoffSends).toHaveLength(1);
    expect(WASendSvc.sendText).toHaveBeenCalledTimes(1); // the ONLY send this turn is the (replaced) handoff message
  });

  test('specific IPO application advice is rejected the same way', async () => {
    mockTurn({ reply: 'You should definitely apply for this IPO, it looks very promising.' });
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'should I apply for the XYZ IPO', timestamp: 't1' });

    const sentText = WASendSvc.sendText.mock.calls[0][2];
    expect(sentText).not.toMatch(/you should apply/i);
    expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
  });

  test('violatesGuardrail flags guarantees, buy/sell directives, and IPO advice; leaves normal replies alone', () => {
    expect(agent.violatesGuardrail('Returns are guaranteed on this fund')).toBe(true);
    expect(agent.violatesGuardrail('I recommend buying this stock right away')).toBe(true);
    expect(agent.violatesGuardrail('You should apply for this IPO')).toBe(true);
    expect(agent.violatesGuardrail('Mutual funds are a great way to start investing based on your goals')).toBe(false);
  });

  // ─── 2026-07-06 production-readiness pass: re-verify every guardrail
  // category against SHORT, casual phrasing — the new concise style drops
  // the "you should"/"I recommend" scaffolding the v1 patterns leaned on, so
  // this is not assumed to still work, it's tested. ────────────────────────
  describe('guardrail re-verification against shorter, casual phrasing (v2)', () => {
    test('casual buy/sell directives without "you should" scaffolding are still caught', () => {
      expect(agent.violatesGuardrail('Buy this now, great pick!')).toBe(true);
      expect(agent.violatesGuardrail('Sell it now before it drops.')).toBe(true);
      expect(agent.violatesGuardrail('Go ahead and buy, you won\'t regret it.')).toBe(true);
      expect(agent.violatesGuardrail("I'd buy this if I were you.")).toBe(true);
      expect(agent.violatesGuardrail('Time to buy, honestly.')).toBe(true);
    });

    test('casual IPO endorsements without "you should apply" scaffolding are still caught', () => {
      expect(agent.violatesGuardrail('Apply for this IPO, looks solid!')).toBe(true);
      expect(agent.violatesGuardrail('Grab this IPO while you can.')).toBe(true);
      expect(agent.violatesGuardrail('This IPO is hot, apply now!')).toBe(true);
    });

    test('casual guarantee-equivalents without the word "guaranteed" are still caught', () => {
      expect(agent.violatesGuardrail('This will double in a year, easy.')).toBe(true);
      expect(agent.violatesGuardrail("It's a sure shot, trust me.")).toBe(true);
      expect(agent.violatesGuardrail("Can't go wrong with this one.")).toBe(true);
      expect(agent.violatesGuardrail('Totally risk-free, no worries.')).toBe(true);
      expect(agent.violatesGuardrail('No risk at all with this plan.')).toBe(true);
      expect(agent.violatesGuardrail('Assured returns on this one.')).toBe(true);
      expect(agent.violatesGuardrail('Fixed returns, every month.')).toBe(true);
    });

    test('short implicit endorsements of a specific product are caught (the 9 required phrasings)', () => {
      expect(agent.violatesGuardrail("That's a great choice.")).toBe(true);
      expect(agent.violatesGuardrail('Excellent fund.')).toBe(true);
      expect(agent.violatesGuardrail('Solid investment.')).toBe(true);
      expect(agent.violatesGuardrail('Perfect fund.')).toBe(true);
      expect(agent.violatesGuardrail('Best option.')).toBe(true);
      expect(agent.violatesGuardrail("You'll likely benefit from this.")).toBe(true);
      expect(agent.violatesGuardrail('I recommend this.')).toBe(true);
      expect(agent.violatesGuardrail('You should choose this.')).toBe(true);
      expect(agent.violatesGuardrail('Safe investment.')).toBe(true);
    });

    test('other semantic-equivalent implicit endorsements are caught', () => {
      expect(agent.violatesGuardrail('Good scheme for you.')).toBe(true);
      expect(agent.violatesGuardrail("It's the best option for your goals.")).toBe(true);
      expect(agent.violatesGuardrail("You'll definitely benefit from that.")).toBe(true);
      expect(agent.violatesGuardrail("I'd go with this one.")).toBe(true);
      expect(agent.violatesGuardrail('You should go with this.')).toBe(true);
    });

    test('approved rapport-only phrases from the new concise style do NOT false-positive', () => {
      expect(agent.violatesGuardrail('Great 👍')).toBe(false);
      expect(agent.violatesGuardrail('Got it.')).toBe(false);
      expect(agent.violatesGuardrail('Perfect.')).toBe(false);
      expect(agent.violatesGuardrail('Makes sense.')).toBe(false);
      expect(agent.violatesGuardrail('Great, thanks!')).toBe(false);
      expect(agent.violatesGuardrail('Got it — what\'s your budget looking like?')).toBe(false);
    });

    test('short bulleted educational replies (category-level, not product-specific) do NOT false-positive', () => {
      expect(agent.violatesGuardrail(
        'Here are a few options:\n- Mutual Funds\n- SIP\n- Insurance\nWhich one interests you?',
      )).toBe(false);
      expect(agent.violatesGuardrail('A SIP just means investing a fixed amount every month — no lump sum needed.')).toBe(false);
    });

    // 2026-07-06: found via a live-model smoke test — the original v1
    // /\b(buy|sell)\b.{0,20}\bstock\b/i pattern was loose enough to trip on
    // genuine educational replies explaining what a Demat account is for.
    test('explaining what a Demat account is for (generic "buy or sell on the stock market") does NOT false-positive', () => {
      expect(agent.violatesGuardrail(
        "A Demat account is where your stocks/shares get stored electronically. You need one to buy or sell on the stock market.",
      )).toBe(false);
    });

    test('a genuine directive to buy/sell "this/that/the stock" is still caught after the narrowing', () => {
      expect(agent.violatesGuardrail('Buy this stock, it looks great.')).toBe(true);
      expect(agent.violatesGuardrail("Sell that stock before it's too late.")).toBe(true);
    });
  });

  // ─── Handoff summary + assignment ───────────────────────────────────────────
  test('handoff writes a usable, non-empty conversation summary onto the lead record', async () => {
    mockTurn({ reply: 'Great, thanks!', qualified: true, productInterest: ['mutual funds'], budgetAmount: 50000, timelineDays: 30 });
    // Override the default summary response for this test to assert on specific content.
    AIService.generate.mockImplementation((params) => {
      if (params.useCase === 'conversation-handoff-summary') {
        return Promise.resolve({
          ok: true,
          data: {
            summary: 'Customer Ravi is interested in starting a mutual fund SIP with a budget of around ₹50,000, looking to begin within a month.',
            statedNeeds: 'Wants to start a mutual fund SIP', productInterest: ['mutual funds'],
            budgetMentioned: '₹50,000', timelineMentioned: 'within a month', handoffReason: params.context.handoffReason,
          },
        });
      }
      return Promise.resolve(turnQueue.shift());
    });

    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'I want to start a SIP, maybe 50000 rupees, within a month', timestamp: 't1' });

    const summaryWriteCall = dynamodb.update.mock.calls.find((c) => c[0].UpdateExpression?.includes('aiConversationSummary'));
    expect(summaryWriteCall).toBeDefined();
    const written = summaryWriteCall[0].ExpressionAttributeValues[':s'];
    expect(written.summary.length).toBeGreaterThan(0);
    expect(written.productInterest).toEqual(['mutual funds']);

    expect(timeline.writeTlRecord).toHaveBeenCalledWith(CID, 'LEAD', 'lead_1', expect.objectContaining({ eventType: 'ai_conversation_handoff' }));
  });

  test('qualified:true triggers handoff early, before the turn cap', async () => {
    mockTurn({ qualified: true, productInterest: ['demat account'] });
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'I want to open a demat account', timestamp: 't1' });
    expect(conv.aiTurnCount).toBe(1);
    expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
  });

  test('assignment fires via pickNextEmployee() at handoff when auto-assign is enabled', async () => {
    getAutoAssignConfig.mockResolvedValue({ enabled: true, capacity: 5, overflow: 'assign' });
    pickNextEmployee.mockResolvedValue({ id: 'emp_9', name: 'Priya' });
    mockTurn({ qualified: true });

    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'ready to proceed', timestamp: 't1' });

    expect(pickNextEmployee).toHaveBeenCalledWith(CID, 'ai_conversation', expect.objectContaining({ enabled: true }));
    const assignCall = dynamodb.update.mock.calls.find((c) => c[0].ExpressionAttributeValues?.[':at'] === 'emp_9');
    expect(assignCall).toBeDefined();
  });

  test('no assignment call is made when auto-assign is disabled for the company', async () => {
    getAutoAssignConfig.mockResolvedValue({ enabled: false });
    mockTurn({ qualified: true });
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'ready to proceed', timestamp: 't1' });
    expect(pickNextEmployee).not.toHaveBeenCalled();
  });

  // ─── Eligibility / gating ────────────────────────────────────────────────────
  test('maybeStart does nothing when the company has not opted in (CONFIG#CONVAGENT disabled)', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: false } });
      return resolved({});
    });
    const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });
    expect(started).toBe(false);
    expect(CustomerIdentityService.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('maybeStart always passes skipAutoAssign: true to CIS — the company auto-assign config can never claim this lead before the bot gets it', async () => {
    await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });
    expect(CustomerIdentityService.resolveOrCreate).toHaveBeenCalledWith(
      CID, expect.objectContaining({ skipAutoAssign: true }), expect.anything(),
    );
  });

  test('maybeStart does not engage when CIS resolves to a pre-existing, already-human-assigned lead (a real returning/claimed customer)', async () => {
    // Fixed 2026-07-06: skipAutoAssign now prevents the company's own
    // auto-assign config from claiming a genuinely FRESH lead at creation, so
    // this scenario is no longer "auto-assign fired" — it's specifically an
    // "enriched" hit: CIS found this phone already belongs to a pre-existing
    // lead (possibly one the webhook's own simpler GSI lookup missed) that a
    // human already has. Still correctly not bot-eligible.
    CustomerIdentityService.resolveOrCreate.mockResolvedValue({
      existed: true, leadId: 'lead_1', action: 'enriched',
    });
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
      if (params.Key.PK === LEAD_PK) return resolved({ Item: { ...lead, assignedTo: 'emp_5', assignedToName: 'Existing Agent' } });
      return resolved({});
    });
    const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });
    expect(started).toBe(false);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  // ─── startForLead: workflow-originated AI hand-off (2026-07-14) ─────────────
  // Entry point for the Automation `start_ai_conversation` action. A free-text
  // contextHint seeds turn 0. leadPK is OPTIONAL: the keyword_message known-lead
  // path passes one; the whatsapp_conversation_started path fires for unknown
  // INBOX# contacts with NO leadPK, so startForLead resolve-or-creates the lead
  // itself (CIS, ADR-013) — covered in its own block below. Guard: no-op if
  // disabled / lead missing / human-owned (assignedTo) / already bot-engaged
  // ('ai') / handed off ('pending_human'). handoffState defaults to 'human' for a
  // never-engaged conversation, which is the only state that falls through.
  describe('startForLead (workflow hand-off)', () => {
    test('no-ops when the AI conversation agent is disabled', async () => {
      dynamodb.get.mockImplementation((params) => {
        if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: false } });
        return resolved({});
      });
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Open Demat' });
      expect(engaged).toBe(false);
      expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
      expect(AIService.generate).not.toHaveBeenCalled();
    });

    test('no-ops when the lead cannot be loaded', async () => {
      dynamodb.get.mockImplementation((params) => {
        if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
        return resolved({}); // LEAD_PK → no Item
      });
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Open Demat' });
      expect(engaged).toBe(false);
      expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
    });

    test('no-ops when the lead is already assigned to a human (never hijacks a human-owned lead)', async () => {
      dynamodb.get.mockImplementation((params) => {
        if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
        if (params.Key.PK === LEAD_PK) return resolved({ Item: { ...lead, assignedTo: 'emp_9' } });
        return resolved({});
      });
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Open Demat' });
      expect(engaged).toBe(false);
      expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
      expect(AIService.generate).not.toHaveBeenCalled();
    });

    test("no-ops when the conversation is already bot-engaged (handoffState 'ai')", async () => {
      conv.handoffState = 'ai';
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Open Demat' });
      expect(engaged).toBe(false);
      expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
      expect(AIService.generate).not.toHaveBeenCalled();
    });

    test("no-ops when the conversation was handed off to a human (handoffState 'pending_human')", async () => {
      conv.handoffState = 'pending_human';
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Open Demat' });
      expect(engaged).toBe(false);
      expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
      expect(AIService.generate).not.toHaveBeenCalled();
    });

    test('engages a never-engaged, unassigned lead and seeds turn 0 with the context hint', async () => {
      conv.handoffState = 'human'; // getConversation default for a never-engaged conversation
      mockTurn({ reply: 'Great — a Demat account is a solid first step!' });
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Open Demat' });
      expect(engaged).toBe(true);
      expect(ConversationService.startBotHandling).toHaveBeenCalledWith(CID, conv.conversationId);
      expect(conv.aiTurnCount).toBe(1);
      // the hint reached the AI as turn-0's latest message, so its first reply can reference it
      const saCall = AIService.generate.mock.calls.find(([p]) => p.useCase === 'conversational-sales-agent');
      expect(saCall[0].context.latestMessage).toBe('Open Demat');
      expect(WASendSvc.sendText).toHaveBeenCalled(); // a reply was actually sent
    });

    test('falls back to a neutral "Hi" seed when no context hint is given', async () => {
      conv.handoffState = 'human';
      mockTurn();
      const engaged = await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: '' });
      expect(engaged).toBe(true);
      const saCall = AIService.generate.mock.calls.find(([p]) => p.useCase === 'conversational-sales-agent');
      expect(saCall[0].context.latestMessage).toBe('Hi');
    });

    // ── startForLead WITHOUT a leadPK — the whatsapp_conversation_started fix ──
    // The whatsapp_conversation_started trigger fires for unknown INBOX# contacts
    // that have no lead yet, so the start_ai_conversation node hands off with
    // phone10 and NO leadPK. Before this fix the node threw "leadPK required" and
    // the AI never engaged (silent, no customer-visible error). startForLead now
    // resolve-or-creates a real CRM lead via CIS (ADR-013), exactly like maybeStart.
    describe('no leadPK (unknown contact — whatsapp_conversation_started)', () => {
      test('resolve-or-creates the lead via CIS (skipAutoAssign, source whatsapp) then engages', async () => {
        conv.handoffState = 'human';
        mockTurn({ reply: 'Great — let us open your Demat account.' });
        // Default CIS mock returns action:'created' with the `lead` fixture (assignedTo null).
        const engaged = await agent.startForLead(CID, { phone10: PHONE, name: 'Ravi', contextHint: 'Demat' });
        expect(engaged).toBe(true);
        expect(CustomerIdentityService.resolveOrCreate).toHaveBeenCalledWith(
          CID,
          expect.objectContaining({ phone: PHONE, name: 'Ravi', source: 'whatsapp', skipAutoAssign: true }),
          expect.objectContaining({ createdBy: 'webhook' }),
        );
        expect(ConversationService.startBotHandling).toHaveBeenCalledWith(CID, conv.conversationId);
        const saCall = AIService.generate.mock.calls.find(([p]) => p.useCase === 'conversational-sales-agent');
        expect(saCall[0].context.latestMessage).toBe('Demat'); // the tapped button's hint seeds turn 0
      });

      // Review-pass test-gap fix: pin the CREATED-branch leadPK derivation. On
      // action:'created', startForLead derives resolvedLeadPK = result.lead.PK and
      // threads it into resolveForLead + _runTurn + WASendSvc.sendText. Without
      // this assertion the created test would stay green even if resolvedLeadPK
      // regressed to the (undefined) leadPK param — routing the first AI reply to
      // the wrong/empty DynamoDB partition.
      test('threads the freshly-CREATED lead PK downstream (not a stale/undefined leadPK)', async () => {
        conv.handoffState = 'human';
        mockTurn({ reply: 'On it.' });
        // Default CIS mock: action:'created', result.lead.PK === LEAD_PK.
        await agent.startForLead(CID, { phone10: PHONE, name: 'Ravi', contextHint: 'Demat' });
        expect(resolveForLead).toHaveBeenCalledWith(CID, LEAD_PK, PHONE, expect.any(Object));
        expect(WASendSvc.sendText).toHaveBeenCalledWith(CID, { leadPK: LEAD_PK }, expect.any(String), expect.anything());
      });

      test('an ENRICHED CIS hit (no lead field on the result) reads the lead by leadId, then engages', async () => {
        conv.handoffState = 'human';
        // CIS's contract: result.lead is present ONLY on a fresh create. An enriched
        // (existing) or idempotent-replayed hit returns leadId only — must be read back.
        CustomerIdentityService.resolveOrCreate.mockResolvedValue({
          existed: true, leadId: 'lead_1', action: 'enriched', interactionId: 'int_2',
        });
        mockTurn();
        const engaged = await agent.startForLead(CID, { phone10: PHONE, name: 'Ravi', contextHint: 'Demat' });
        expect(engaged).toBe(true);
        expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({ Key: { PK: LEAD_PK, SK: 'METADATA' } }));
        expect(ConversationService.startBotHandling).toHaveBeenCalledWith(CID, conv.conversationId);
      });

      test('never creates a lead when the AI agent is disabled (cfg gate runs before CIS)', async () => {
        dynamodb.get.mockImplementation((params) => {
          if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: false } });
          return resolved({});
        });
        const engaged = await agent.startForLead(CID, { phone10: PHONE, name: 'Ravi', contextHint: 'Demat' });
        expect(engaged).toBe(false);
        expect(CustomerIdentityService.resolveOrCreate).not.toHaveBeenCalled();
      });

      test('does not hijack when CIS resolves to an already-human-assigned lead', async () => {
        conv.handoffState = 'human';
        CustomerIdentityService.resolveOrCreate.mockResolvedValue({
          existed: true, leadId: 'lead_1', action: 'enriched', interactionId: 'int_3',
        });
        dynamodb.get.mockImplementation((params) => {
          if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
          if (params.Key.PK === LEAD_PK) return resolved({ Item: { ...lead, assignedTo: 'emp_9' } });
          return resolved({});
        });
        const engaged = await agent.startForLead(CID, { phone10: PHONE, name: 'Ravi', contextHint: 'Demat' });
        expect(engaged).toBe(false);
        expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
        expect(AIService.generate).not.toHaveBeenCalled();
      });

      test('returns false without creating anything when there is neither leadPK nor phone10', async () => {
        const engaged = await agent.startForLead(CID, { name: 'Ravi', contextHint: 'Demat' });
        expect(engaged).toBe(false);
        expect(CustomerIdentityService.resolveOrCreate).not.toHaveBeenCalled();
        expect(ConversationService.startBotHandling).not.toHaveBeenCalled();
      });
    });
  });

  // ─── Re-anchor: known qualification state fed back into every turn ──────────
  // Extracted-but-not-recalled fix. _applyExtractedSignals persists
  // productInterest/expectedValue/closureDeadline onto the lead, but those fields
  // were write-only — never read back into the prompt — so the AI re-inferred
  // them from free text and inconsistently re-asked (e.g. a button-tap's "Demat"
  // lost by turn 4). _runTurn now passes _buildKnownState(lead) into the turn
  // context; aiConfig.js renders it as the PROVISIONAL "KNOWN SO FAR" block
  // (prompt-level framing/precedence covered in aiConfig.test.js).
  describe('known qualification state re-anchoring (extracted-but-not-recalled fix)', () => {
    const TS = '2026-07-15T02:00:00.000Z';
    function lastSalesContext() {
      const calls = AIService.generate.mock.calls.filter(([p]) => p.useCase === 'conversational-sales-agent');
      return calls[calls.length - 1][0].context;
    }

    test('(a) button-tap round-trip: contextHint seed → extracted+persisted → recalled as knownState the next turn', async () => {
      conv.handoffState = 'human'; // never-engaged, so startForLead actually engages
      mockTurn({ reply: 'Great, a Demat account it is. What is your name?', productInterest: ['demat account'] });
      await agent.startForLead(CID, { leadPK: LEAD_PK, phone10: PHONE, name: 'Ravi', contextHint: 'Demat' });
      // Turn 0 knew nothing yet (extraction happens AFTER generate)...
      expect(lastSalesContext().knownState).toBeNull();
      // ...and the seed-derived interest got persisted onto the lead.
      expect(lead.productInterest).toEqual(['demat account']);

      // A later real turn: the interest must now be recalled, so the AI won't re-ask it.
      mockTurn({ reply: 'Thanks Ravi! Which city are you in?' });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'Ravi', timestamp: TS });
      expect(lastSalesContext().knownState).toEqual({ productInterest: ['demat account'], expectedValue: null, closureDeadline: null });
    });

    test('(b) organic: interest volunteered mid-conversation (no button) is persisted then recalled a later turn', async () => {
      mockTurn({ reply: 'Mutual funds are a solid start. SIP or lumpsum?', productInterest: ['mutual funds'] });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'I want to invest in mutual funds', timestamp: TS });
      expect(lead.productInterest).toEqual(['mutual funds']);

      // Several messages later — still recalled.
      mockTurn({ reply: 'Got it.' });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'my city is Pune', timestamp: TS });
      expect(lastSalesContext().knownState.productInterest).toEqual(['mutual funds']);
    });

    test('(c) correction (req 5): stale knownState is passed ALONGSIDE — never instead of — the corrective latest message', async () => {
      const leadDemat = { ...lead, productInterest: ['demat account'] };
      mockTurn({ reply: 'Sure, mutual funds it is.', productInterest: ['mutual funds'] });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead: leadDemat, phone10: PHONE, text: 'actually, mutual funds instead', timestamp: TS });
      const ctx = lastSalesContext();
      // Both reach the model. The PROVISIONAL framing (asserted in aiConfig.test.js)
      // routes authority to the latest message, so the AI follows the correction
      // rather than anchoring to the stale "demat account".
      expect(ctx.knownState.productInterest).toEqual(['demat account']);
      expect(ctx.latestMessage).toBe('actually, mutual funds instead');
    });

    test('with no captured signals yet, knownState is null (no block — byte-identical baseline)', async () => {
      mockTurn();
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hello', timestamp: TS });
      expect(lastSalesContext().knownState).toBeNull();
    });
  });

  // ─── 2026-07-08 fix: lastMessageAt/lastInboundAt stamped on lead creation ──
  // Root cause of "1st message invisible in inbox" (docs/bible/19_DECISION_LOG.md):
  // _createCustomer()'s leadItem never set these fields, so a fresh lead was
  // silently excluded from every lastMessageAt-gated read (inbox list,
  // LeadScoringService recency score, /my-work urgentReplies, auto-assign
  // eligibility) until — if ever — a second message landed directly in the
  // lead's LEAD# partition. Fixed by stamping immediately after CIS creates
  // the lead, before resolveForLead/_runTurn even run.
  describe('lastMessageAt/lastInboundAt stamped immediately on lead creation (2026-07-08 fix)', () => {
    function findLeadStampCall() {
      return dynamodb.update.mock.calls.find((c) => c[0].Key?.PK === LEAD_PK
        && c[0].Key?.SK === 'METADATA'
        && c[0].UpdateExpression?.includes('lastMessageAt'));
    }

    test('a genuinely new lead (action: created) gets lastMessageAt/lastInboundAt stamped from the triggering message', async () => {
      mockTurn();
      await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hii', timestamp: 't1', waMessageId: 'wam1' });

      const stampCall = findLeadStampCall();
      expect(stampCall).toBeDefined();
      expect(stampCall[0].ExpressionAttributeValues[':ts']).toBe('t1');
      expect(stampCall[0].ExpressionAttributeValues[':prev']).toBe('Hii');
      expect(stampCall[0].ExpressionAttributeValues[':dir']).toBe('inbound');
      expect(stampCall[0].UpdateExpression).toContain('lastInboundAt');
    });

    // The "AI off" scenario: proves the stamp does not depend on the bot's own
    // turn succeeding — a real, non-hypothetical gap the pre-fix code left
    // open (WhatsAppSendService's self-heal only fires once sendText is
    // actually reached, which never happens if generate() itself fails).
    //
    // 2026-07-08: `started` corrected to false — this test previously asserted
    // the CONFIRMED BUG's exact symptom (maybeStart returning true even though
    // no reply was sent). See the "maybeStart/continueTurn signal failure
    // accurately" describe block below for the dedicated regression coverage;
    // this test's own job is only to confirm the lastMessageAt stamp stays
    // decoupled from that fix.
    test('the stamp happens even when AIService.generate() fails outright — decoupled from the AI turn succeeding', async () => {
      mockTurnFailure('rate_limited', 'too many calls');
      const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hii', timestamp: 't1', waMessageId: 'wam1' });

      expect(started).toBe(false); // no reply was sent — caller must fall back to welcome/automation
      expect(WASendSvc.sendText).not.toHaveBeenCalled(); // the bot's own reply never went out
      expect(findLeadStampCall()).toBeDefined(); // but the lead is still correctly stamped
    });

    test('the stamp is applied before resolveForLead/_runTurn run, not contingent on either succeeding', async () => {
      resolveForLead.mockResolvedValue(null); // conversation resolution fails -> maybeStart bails early
      const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hii', timestamp: 't1', waMessageId: 'wam1' });

      expect(started).toBe(false);
      expect(AIService.generate).not.toHaveBeenCalled();
      expect(findLeadStampCall()).toBeDefined(); // stamped regardless
    });

    test('an "enriched" hit (pre-existing lead, not a fresh creation) is NOT stamped by this fix', async () => {
      CustomerIdentityService.resolveOrCreate.mockResolvedValue({
        existed: true, leadId: 'lead_1', action: 'enriched',
      });
      dynamodb.get.mockImplementation((params) => {
        if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
        if (params.Key.PK === LEAD_PK) return resolved({ Item: { ...lead, assignedTo: 'emp_5' } });
        return resolved({});
      });
      await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hii', timestamp: 't1', waMessageId: 'wam1' });

      expect(findLeadStampCall()).toBeUndefined();
    });
  });

  // ─── 2026-07-08 fix: maybeStart/continueTurn signal failure accurately ─────
  // Confirmed live production bug (docs/bible/19_DECISION_LOG.md): maybeStart()
  // and continueTurn() both returned true unconditionally regardless of whether
  // _runTurn() actually sent a reply, because _runTurn()'s `if (!result.ok)
  // return;` branch returned void (a "success" as far as its own callers'
  // `await _runTurn(...); return true;` was concerned) instead of signaling
  // failure. Net effect for any company with the AI feature disabled (a normal,
  // supported state) or hitting rate limits/provider errors: every genuine
  // first-time contact silently got zero response at all — no AI reply
  // (correctly, since it's disabled/failed), no welcome message, and no
  // whatsapp_conversation_started trigger (both incorrectly suppressed by the
  // false-positive botEngaged=true). Fixed by having _runTurn() return an
  // honest boolean and both callers propagate it instead of hardcoding true.
  describe('maybeStart/continueTurn signal failure accurately (2026-07-08 fix)', () => {
    // Every result.ok:false reason AIService.generate() can return
    // (src/services/AIService.js) — all 5 previously fell into the identical
    // "return true regardless" bug; this proves the fix covers the whole
    // class, not just the disabled_usecase reason confirmed live in production.
    const FAILURE_REASONS = [
      ['disabled_master', 'AI is disabled for this company (master switch is off).'],
      ['disabled_usecase', 'The "conversational-sales-agent" AI feature is disabled for this company.'],
      ['rate_limited', 'AI rate limit exceeded for this feature — try again shortly.'],
      ['provider_error', 'upstream provider timeout'],
      ['invalid_output', 'Model did not return valid JSON matching the required schema after a retry.'],
    ];

    test.each(FAILURE_REASONS)('maybeStart returns false when generate() fails with %s — no reply was sent, caller must fall back', async (reason, detail) => {
      mockTurnFailure(reason, detail);
      const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hii', timestamp: 't1', waMessageId: 'wam1' });
      expect(started).toBe(false);
      expect(WASendSvc.sendText).not.toHaveBeenCalled();
    });

    test.each(FAILURE_REASONS)('continueTurn returns false when generate() fails with %s — no reply was sent, caller must fall back', async (reason, detail) => {
      mockTurnFailure(reason, detail);
      const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hello', timestamp: 't1' });
      expect(handled).toBe(false);
      expect(WASendSvc.sendText).not.toHaveBeenCalled();
    });

    // The success case must NOT change — a company where the bot actually
    // replies should still correctly suppress welcome/automation/OOO fallbacks.
    test('maybeStart still returns true when generate() succeeds — the existing correct behavior is untouched', async () => {
      mockTurn();
      const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hii', timestamp: 't1', waMessageId: 'wam1' });
      expect(started).toBe(true);
      expect(WASendSvc.sendText).toHaveBeenCalled();
    });

    test('continueTurn still returns true when generate() succeeds — the existing correct behavior is untouched', async () => {
      mockTurn();
      const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hello', timestamp: 't1' });
      expect(handled).toBe(true);
      expect(WASendSvc.sendText).toHaveBeenCalled();
    });

    // An escalation-triggered handoff never calls AIService.generate() at all
    // (checked first, in _runTurn) but DOES send a real reply (the handoff
    // message) — true is still the correct signal here, unaffected by this fix.
    test('an escalation-triggered handoff still returns true — a reply (the handoff message) was actually sent', async () => {
      const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'I want to talk to a human agent', timestamp: 't1' });
      expect(handled).toBe(true);
      expect(WASendSvc.sendText).toHaveBeenCalledWith(
        CID, { leadPK: LEAD_PK },
        expect.stringContaining('senior relationship managers'),
        expect.anything(),
      );
    });
  });

  test('continueTurn returns false for a lead whose conversation was never bot-started (handoffState stays human)', async () => {
    ConversationService.getConversation.mockResolvedValue({ conversationId: 'conv_2', handoffState: 'human', aiTurnCount: 0 });
    const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hello again', timestamp: 't1' });
    expect(handled).toBe(false);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('continueTurn returns false once already handed off (handoffState: pending_human)', async () => {
    ConversationService.getConversation.mockResolvedValue({ conversationId: 'conv_1', handoffState: 'pending_human', aiTurnCount: 8 });
    const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'still there?', timestamp: 't1' });
    expect(handled).toBe(false);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  // 2026-07-08: `handled` corrected to false — see the "maybeStart/continueTurn
  // signal failure accurately" describe block below for the confirmed-bug
  // regression coverage across all 5 generate() failure reasons.
  test('a failed AIService.generate() call degrades gracefully — no send, no crash, no turn increment', async () => {
    mockTurnFailure('rate_limited', 'too many calls');
    const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hello', timestamp: 't1' });
    expect(handled).toBe(false); // nothing was sent — caller must fall back to OOO/keyword_message
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
    expect(conv.aiTurnCount).toBe(0);
  });

  // ─── Extracted signals feed the existing lead record, not a parallel store ──
  test('stated budget/timeline/product interest are written onto the existing lead fields', async () => {
    mockTurn({ productInterest: ['insurance'], budgetAmount: 20000, timelineDays: 14 });
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'looking for insurance, budget 20000, within 2 weeks', timestamp: 't1' });

    const signalUpdate = dynamodb.update.mock.calls.find((c) => c[0].ExpressionAttributeValues?.[':ev'] === 20000);
    expect(signalUpdate).toBeDefined();
    expect(signalUpdate[0].ExpressionAttributeValues[':pi']).toEqual(['insurance']);
    expect(signalUpdate[0].ExpressionAttributeValues[':cd']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // ─── Phase 2A / PR 2 — Prompt Management addendum wiring ────────────────────
  test('the published CONFIG#PROMPTADDENDUM activeText is passed into AIService.generate as promptAddendum', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
      if (params.Key.PK === LEAD_PK) return resolved({ Item: lead });
      if (params.Key.PK === `CONFIG#PROMPTADDENDUM#${CID}`) return resolved({ Item: { activeText: 'Always mention our 24hr response time.', activeVersion: 3 } });
      return resolved({});
    });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hi', timestamp: 't1' });

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'conversational-sales-agent',
      context: expect.objectContaining({ promptAddendum: 'Always mention our 24hr response time.' }),
    }));
  });

  test('an unpublished draftText is never passed to AIService.generate — only activeText reaches a live conversation', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
      if (params.Key.PK === LEAD_PK) return resolved({ Item: lead });
      if (params.Key.PK === `CONFIG#PROMPTADDENDUM#${CID}`) return resolved({ Item: { activeText: 'published text', draftText: 'unpublished draft text', activeVersion: 1 } });
      return resolved({});
    });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hi', timestamp: 't1' });

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ promptAddendum: 'published text' }),
    }));
  });

  // ─── Phase 2A / PR 3 — Structured Knowledge Center wiring ──────────────────
  test('a matching published knowledge entry is passed into AIService.generate as knowledgeEntries', async () => {
    dynamodb.query.mockImplementation((params) => {
      if (params.ExpressionAttributeValues?.[':pk'] === `KNOWLEDGE#${CID}`) {
        return resolved({
          Items: [{
            entryId: 'e1', archived: false, activeVersion: 2, activePublishedAt: '2026-07-07T00:00:00.000Z',
            activeTriggers: ['fees', 'charges'], activeQuestion: 'What are your fees?',
            activeAnswer: 'No account opening fee; AMC is ₹0 for the first year.',
          }],
        });
      }
      return resolved({ Items: [] }); // conversation history default
    });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'What are the fees for opening an account?', timestamp: 't1' });

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        knowledgeEntries: [{ question: 'What are your fees?', answer: 'No account opening fee; AMC is ₹0 for the first year.' }],
      }),
    }));
  });

  test('an archived or never-published knowledge entry never reaches AIService.generate even if its trigger matches', async () => {
    dynamodb.query.mockImplementation((params) => {
      if (params.ExpressionAttributeValues?.[':pk'] === `KNOWLEDGE#${CID}`) {
        return resolved({
          Items: [
            { entryId: 'archived', archived: true, activeVersion: 1, activeTriggers: ['fees'], activeQuestion: 'q', activeAnswer: 'a' },
            { entryId: 'draft-only', archived: false, activeVersion: 0, activeTriggers: ['fees'], activeQuestion: 'q2', activeAnswer: 'a2' },
          ],
        });
      }
      return resolved({ Items: [] });
    });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'question about fees', timestamp: 't1' });

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ knowledgeEntries: [] }),
    }));
  });

  test('a non-matching message passes an empty knowledgeEntries array', async () => {
    dynamodb.query.mockImplementation((params) => {
      if (params.ExpressionAttributeValues?.[':pk'] === `KNOWLEDGE#${CID}`) {
        return resolved({ Items: [{ entryId: 'e1', archived: false, activeVersion: 1, activeTriggers: ['fees'], activeQuestion: 'q', activeAnswer: 'a' }] });
      }
      return resolved({ Items: [] });
    });
    mockTurn();
    await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'totally unrelated message', timestamp: 't1' });

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ knowledgeEntries: [] }),
    }));
  });

  // ─── Phase 2A / PR 1 — General tab toggles ──────────────────────────────────
  describe('AI Administration General-tab toggles', () => {
    function mockConvAgentConfig(overrides) {
      dynamodb.get.mockImplementation((params) => {
        if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true, ...overrides } });
        if (params.Key.PK === LEAD_PK) return resolved({ Item: lead });
        return resolved({});
      });
    }

    test('qualificationEnabled: false skips the extracted-signal merge even though the model returned signals', async () => {
      mockConvAgentConfig({ qualificationEnabled: false });
      mockTurn({ productInterest: ['insurance'], budgetAmount: 20000, timelineDays: 14 });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'insurance, 20000, 2 weeks', timestamp: 't1' });

      const signalUpdate = dynamodb.update.mock.calls.find((c) => c[0].ExpressionAttributeValues?.[':ev'] === 20000);
      expect(signalUpdate).toBeUndefined();
    });

    test('summaryEnabled: false skips writing aiConversationSummary at handoff', async () => {
      mockConvAgentConfig({ summaryEnabled: false });
      mockTurn({ qualified: true });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'ready to proceed', timestamp: 't1' });

      const summaryWrite = dynamodb.update.mock.calls.find((c) => c[0].UpdateExpression?.includes('aiConversationSummary'));
      expect(summaryWrite).toBeUndefined();
      expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1); // handoff itself still happens
    });

    test('crmAutoTransferEnabled: false skips both assignment and stage-advance at handoff', async () => {
      mockConvAgentConfig({ crmAutoTransferEnabled: false });
      getAutoAssignConfig.mockResolvedValue({ enabled: true, capacity: 5, overflow: 'assign' });
      mockTurn({ qualified: true });
      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'ready to proceed', timestamp: 't1' });

      expect(pickNextEmployee).not.toHaveBeenCalled();
      const stageUpdate = dynamodb.update.mock.calls.find((c) => c[0].ExpressionAttributeValues?.[':s'] === 'interested');
      expect(stageUpdate).toBeUndefined();
      expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1); // handoff itself still happens
    });

    // The single most important test in this block: today's real, currently-
    // shipped CONFIG#CONVAGENT shape is just {enabled: true} — missing all 3
    // new fields entirely. A company that never opens AI Administration must
    // get EXACTLY today's behavior out of every gate added in this PR.
    test('backward compatibility: {enabled: true} with no new fields (today\'s real shape) still runs qualification, summary, and CRM transfer exactly as before', async () => {
      mockConvAgentConfig({}); // {enabled: true} only — no qualificationEnabled/summaryEnabled/crmAutoTransferEnabled at all
      getAutoAssignConfig.mockResolvedValue({ enabled: true, capacity: 5, overflow: 'assign' });
      pickNextEmployee.mockResolvedValue({ id: 'emp_9', name: 'Priya' });
      mockTurn({ qualified: true, productInterest: ['mutual funds'], budgetAmount: 15000, timelineDays: 7 });

      await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'ready to proceed', timestamp: 't1' });

      const signalUpdate = dynamodb.update.mock.calls.find((c) => c[0].ExpressionAttributeValues?.[':ev'] === 15000);
      expect(signalUpdate).toBeDefined();
      const summaryWrite = dynamodb.update.mock.calls.find((c) => c[0].UpdateExpression?.includes('aiConversationSummary'));
      expect(summaryWrite).toBeDefined();
      expect(pickNextEmployee).toHaveBeenCalledWith(CID, 'ai_conversation', expect.objectContaining({ enabled: true }));
      const stageUpdate = dynamodb.update.mock.calls.find((c) => c[0].ExpressionAttributeValues?.[':s'] === 'interested');
      expect(stageUpdate).toBeDefined();
    });
  });

  // Production incident, 2026-07-07: _fetchConversationSettings passed the
  // RAW CONFIG#CONVPROMPT item straight into aiAdminConversationSchema's
  // .strict().parse() — the moment any company actually saved Conversation
  // tab settings (via aiAdmin.js's PUT /conversation, which stores
  // PK/SK/companyId/updatedAt/updatedBy alongside the real fields), every
  // subsequent live turn crashed with a Zod unrecognized_keys error. Every
  // pre-existing test in this file only ever exercised the empty-row default
  // (dynamodb.get's blanket beforeEach mock returns {} for anything not
  // explicitly special-cased) — this is the gap that let it ship. Fixed via
  // validation.js's stripStorageMetadata(); this test exercises a REAL saved
  // row, the exact shape that crashed in production.
  describe('conversation settings (AI Administration Conversation tab)', () => {
    test('a real saved CONFIG#CONVPROMPT row (with PK/SK/companyId/updatedAt/updatedBy) does not crash a live turn, and its settings reach the prompt', async () => {
      dynamodb.get.mockImplementation((params) => {
        if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) return resolved({ Item: { enabled: true } });
        if (params.Key.PK === LEAD_PK) return resolved({ Item: lead });
        if (params.Key.PK === `CONFIG#CONVPROMPT#${CID}`) {
          return resolved({
            Item: {
              PK: `CONFIG#CONVPROMPT#${CID}`, SK: 'CURRENT', companyId: CID,
              persona: 'friendly_advisor', tone: 'casual', languageRules: '', conversationStyle: 'concise', qualificationRules: '',
              updatedBy: 'emp_1', updatedAt: '2026-07-07T08:00:00.000Z',
            },
          });
        }
        return resolved({});
      });

      mockTurn();
      const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });

      expect(started).toBe(true);
      expect(WASendSvc.sendText).toHaveBeenCalled(); // did not crash before ever generating/sending a reply
      const generateCall = AIService.generate.mock.calls.find(([params]) => params.useCase === 'conversational-sales-agent');
      expect(generateCall[0].context).toEqual(expect.objectContaining({ persona: 'friendly_advisor', tone: 'casual' }));
    });
  });

  // RAG PR C — document chunk retrieval, unified with structured entries.
  // KnowledgeService/DocumentChunkService/DocumentChunkRetrievalService are
  // deliberately left REAL (unmocked) here, same as KnowledgeService already
  // was before this PR — only their own dependencies (dynamodb, EmbeddingService)
  // are mocked, so these tests exercise the actual merge/gating logic, not a
  // stand-in for it.
  describe('document chunk retrieval (RAG PR C)', () => {
    function mockKnowledgeQuery({ entries = [], chunks = [] } = {}) {
      dynamodb.query.mockImplementation((params) => {
        const pk = params.ExpressionAttributeValues?.[':pk'];
        if (pk === `KNOWLEDGE#${CID}`) return resolved({ Items: entries });
        if (pk === `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`) return resolved({ Items: chunks });
        return resolved({ Items: [] }); // conversation history and anything else — empty by default
      });
    }

    function activeChunk(overrides) {
      return {
        companyId: CID, documentId: 'doc-1', chunkIndex: 0, archived: false,
        text: 'AMC is waived for the first year only.', embedding: [1, 0, 0],
        ...overrides,
      };
    }

    function embeddedEntry(overrides) {
      return {
        entryId: 'e1', archived: false, activeVersion: 1, activePublishedAt: '2026-07-01T00:00:00.000Z',
        activeEmbedding: [1, 0, 0], activeQuestion: 'What are your fees?', activeAnswer: 'No account opening fee.',
        activeTriggers: [],
        ...overrides,
      };
    }

    function lastTurnContext() {
      const call = AIService.generate.mock.calls.find(([params]) => params.useCase === 'conversational-sales-agent');
      return call[0].context;
    }

    async function runTurn(text = 'anything') {
      mockTurn();
      return agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text, timestamp: 't1', waMessageId: 'wam1' });
    }

    test('a matching published chunk reaches AIService.generate as documentExcerpts', async () => {
      mockKnowledgeQuery({ chunks: [activeChunk()] });
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      await runTurn('Do you charge an AMC fee?');
      expect(lastTurnContext().documentExcerpts).toEqual([{ text: activeChunk().text }]);
    });

    test('an archived chunk never reaches documentExcerpts despite a strong match', async () => {
      mockKnowledgeQuery({ chunks: [activeChunk({ archived: true })] });
      await runTurn('Do you charge an AMC fee?');
      expect(lastTurnContext().documentExcerpts).toEqual([]);
      expect(EmbeddingService.embed).not.toHaveBeenCalled(); // no active chunk, no eligible entry -> nothing to embed for
    });

    test('a company with nothing published gets documentExcerpts: [] and zero embed calls (ADR-017 Rule 7 preserved)', async () => {
      mockKnowledgeQuery({ entries: [], chunks: [] });
      await runTurn('Hi');
      expect(lastTurnContext().documentExcerpts).toEqual([]);
      expect(lastTurnContext().knowledgeEntries).toEqual([]);
      expect(EmbeddingService.embed).not.toHaveBeenCalled();
    });

    test('cap enforcement: more than MAX_MATCHED_CHUNKS active chunks reach exactly MAX_MATCHED_CHUNKS, highest-scoring first', async () => {
      const items = [
        activeChunk({ chunkIndex: 0, text: 'best', embedding: [1, 0, 0] }),
        activeChunk({ chunkIndex: 1, text: 'mid', embedding: [0.9, 0.1, 0] }),
        activeChunk({ chunkIndex: 2, text: 'worst', embedding: [0, 1, 0] }),
      ];
      mockKnowledgeQuery({ chunks: items });
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      await runTurn();
      expect(lastTurnContext().documentExcerpts).toHaveLength(DocumentChunkRetrievalService.MAX_MATCHED_CHUNKS);
      expect(lastTurnContext().documentExcerpts[0]).toEqual({ text: 'best' });
    });

    test('entries render their normal result even when zero chunks exist', async () => {
      const entry = embeddedEntry();
      mockKnowledgeQuery({ entries: [entry], chunks: [] });
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      await runTurn('what are your fees');
      expect(lastTurnContext().knowledgeEntries).toEqual([{ question: entry.activeQuestion, answer: entry.activeAnswer }]);
    });

    test('entries-unaffected-by-chunks: the same entry produces the same knowledgeEntries result even with a strongly-matching chunk also present (additive, never displacing)', async () => {
      const entry = embeddedEntry();
      mockKnowledgeQuery({ entries: [entry], chunks: [activeChunk()] });
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      await runTurn('what are your fees');
      expect(lastTurnContext().knowledgeEntries).toEqual([{ question: entry.activeQuestion, answer: entry.activeAnswer }]);
      expect(lastTurnContext().documentExcerpts).toEqual([{ text: activeChunk().text }]); // both present, neither crowds out the other
    });

    test('single-embed-call-per-turn: an embedded entry AND an active chunk both present -> EmbeddingService.embed is called exactly once', async () => {
      mockKnowledgeQuery({ entries: [embeddedEntry()], chunks: [activeChunk()] });
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      await runTurn('what are your fees');
      expect(EmbeddingService.embed).toHaveBeenCalledTimes(1);
    });

    test('a failed query embed degrades documentExcerpts to [] while entries still fall back to keyword matching independently', async () => {
      const entry = embeddedEntry({ activeTriggers: ['fees'] });
      mockKnowledgeQuery({ entries: [entry], chunks: [activeChunk()] });
      EmbeddingService.embed.mockResolvedValue({ ok: false, reason: 'embedding_failed' });
      await runTurn('what are your fees');
      expect(lastTurnContext().documentExcerpts).toEqual([]);
      expect(lastTurnContext().knowledgeEntries).toEqual([{ question: entry.activeQuestion, answer: entry.activeAnswer }]);
    });

    test('a listChunksForCompany rejection degrades to documentExcerpts: [] — the turn still completes and sends a reply', async () => {
      dynamodb.query.mockImplementation((params) => {
        const pk = params.ExpressionAttributeValues?.[':pk'];
        if (pk === `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`) return { promise: () => Promise.reject(new Error('DynamoDB throttled')) };
        return resolved({ Items: [] });
      });
      const started = await runTurn('Hi');
      expect(started).toBe(true);
      expect(WASendSvc.sendText).toHaveBeenCalled();
      expect(lastTurnContext().documentExcerpts).toEqual([]);
    });

    // The actual safety net for the weaker-vetted content source: a document
    // chunk only ever gets PR B's non-blocking advisory scan at publish time
    // (violatesGuardrail() run once, non-blocking) — never PromptTestService's
    // live-generation test the way a published entry does. This proves the
    // EXISTING, unmodified output-side guardrail (violatesGuardrail() on the
    // generated reply, _runTurn lines ~426-431) still catches unsafe content
    // that reached the prompt via a chunk, exactly as it would from any other
    // source — the check is on the REPLY TEXT, content-blind to where the
    // model picked up the unsafe phrasing.
    test('a chunk containing guardrail-triggering language reaching the prompt does NOT bypass the existing output-side guardrail', async () => {
      const riskyChunk = activeChunk({ text: 'This mutual fund is a guaranteed 20% return investment with zero risk.' });
      mockKnowledgeQuery({ chunks: [riskyChunk] });
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      // Simulates the model echoing the risky chunk's own claim into its reply.
      mockTurn({ reply: 'Yes, this fund offers a guaranteed 20% return, so it is a very safe pick.' });

      await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Tell me about this fund', timestamp: 't1', waMessageId: 'wam1' });

      // Proof 1: the risky chunk really did reach the prompt context.
      expect(lastTurnContext().documentExcerpts).toEqual([{ text: riskyChunk.text }]);
      // Proof 2: the unsafe reply was never sent to the customer — replaced by the handoff message.
      expect(WASendSvc.sendText).toHaveBeenCalledWith(
        CID, { leadPK: LEAD_PK },
        expect.not.stringContaining('guaranteed'),
        expect.anything(),
      );
      // Proof 3: same forced-escalation path as any other guardrail trip (entries, or the model's own generation).
      expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
    });
  });

  // ─── ctwa_clid / CTWA ad-attribution capture (2026-07-18) ──────────────────
  // maybeStart() is the only place a fresh lead gets created from an unknown
  // WhatsApp contact — whatsapp.js threads Meta's messages[].referral block
  // through unmodified as the new `referral` param.
  describe('maybeStart — referral (Click-to-WhatsApp ad attribution)', () => {
    test('referral present: passes ctwaClid, source: "ctwa", and a campaign tag (referral.headline) into resolveOrCreate', async () => {
      mockTurn();
      await agent.maybeStart(CID, {
        phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1',
        referral: { source_id: '12345', source_type: 'ad', headline: '50% off Demat account opening', ctwa_clid: 'AR_click_abc' },
      });

      expect(CustomerIdentityService.resolveOrCreate).toHaveBeenCalledWith(
        CID,
        expect.objectContaining({
          source: 'ctwa',
          ctwaClid: 'AR_click_abc',
          tags: ['50% off Demat account opening'],
        }),
        expect.anything(),
      );
    });

    test('referral present but with no headline: falls back to source_id for the campaign tag', async () => {
      mockTurn();
      await agent.maybeStart(CID, {
        phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1',
        referral: { source_id: '98765', source_type: 'ad', ctwa_clid: 'AR_click_xyz' },
      });

      expect(CustomerIdentityService.resolveOrCreate).toHaveBeenCalledWith(
        CID,
        expect.objectContaining({ source: 'ctwa', ctwaClid: 'AR_click_xyz', tags: ['98765'] }),
        expect.anything(),
      );
    });

    test('referral ABSENT (the normal, non-ad case): source stays "whatsapp", no ctwaClid/tags key regression — existing behavior completely unchanged', async () => {
      mockTurn();
      await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });

      const [, data] = CustomerIdentityService.resolveOrCreate.mock.calls[0];
      expect(data.source).toBe('whatsapp');
      expect(data.ctwaClid).toBeNull();
      expect(data.tags).toBeUndefined(); // no tags key added at all when there's no campaign to tag
    });

    test('referral explicitly null behaves identically to referral omitted', async () => {
      mockTurn();
      await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1', referral: null });

      const [, data] = CustomerIdentityService.resolveOrCreate.mock.calls[0];
      expect(data.source).toBe('whatsapp');
      expect(data.ctwaClid).toBeNull();
      expect(data.tags).toBeUndefined();
    });
  });
});
