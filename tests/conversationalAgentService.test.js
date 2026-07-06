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

const dynamodb = require('../src/config/dynamodb');
const AIService = require('../src/services/AIService');
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

  // ─── Full 10-turn flow, end to end ──────────────────────────────────────────
  test('a full 10-turn conversation reaches handoff exactly at the cap when never qualified/escalated', async () => {
    mockTurn(); // turn 1, via maybeStart
    const started = await agent.maybeStart(CID, { phone10: PHONE, waName: 'Ravi', text: 'Hi', timestamp: 't1', waMessageId: 'wam1' });
    expect(started).toBe(true);
    expect(conv.aiTurnCount).toBe(1);
    expect(ConversationService.handoffToHuman).not.toHaveBeenCalled();

    for (let i = 2; i <= 9; i++) {
      mockTurn();
      const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: `message ${i}`, timestamp: `t${i}` });
      expect(handled).toBe(true);
    }
    expect(conv.aiTurnCount).toBe(9);
    expect(ConversationService.handoffToHuman).not.toHaveBeenCalled();

    // Turn 10 — the cap. Still not qualified, still no escalation.
    mockTurn({ qualified: false });
    const handledLast = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'message 10', timestamp: 't10' });
    expect(handledLast).toBe(true);
    expect(conv.aiTurnCount).toBe(10);
    expect(ConversationService.handoffToHuman).toHaveBeenCalledTimes(1);
    expect(WASendSvc.sendText).toHaveBeenLastCalledWith(CID, { leadPK: LEAD_PK }, expect.stringContaining('senior relationship manager'), expect.objectContaining({ id: 'system' }));

    // The conversation is now handed off — an 11th message must not be treated as a bot turn.
    const handledAfterCap = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'anything else?', timestamp: 't11' });
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

  test('a failed AIService.generate() call degrades gracefully — no send, no crash, no turn increment', async () => {
    mockTurnFailure('rate_limited', 'too many calls');
    const handled = await agent.continueTurn(CID, { leadPK: LEAD_PK, lead, phone10: PHONE, text: 'hello', timestamp: 't1' });
    expect(handled).toBe(true); // the turn was consumed/attempted, even though nothing was sent
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
});
