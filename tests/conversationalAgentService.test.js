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

  test('maybeStart does not engage when the newly-created lead already has an assignee (auto-assign fired) — not genuinely unassigned', async () => {
    CustomerIdentityService.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_1', action: 'created',
      lead: { ...lead, assignedTo: 'emp_5', assignedToName: 'Existing Agent' },
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
});
