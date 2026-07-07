'use strict';

/**
 * PromptTestService — Phase 2A / PR 2's compliance test gate. Requires the
 * real ConversationalAgentService.js (for MAX_TURNS/violatesGuardrail/AI_ACTOR
 * — reusing the real, already-tested guardrail filter, not a copy of it), so
 * this file mirrors conversationalAgentService.test.js's own mock set for
 * ConversationalAgentService's OTHER dependencies (none of which this
 * service's own logic touches — they just need to exist so requiring the
 * real file doesn't throw). Only AIService.generate is mocked to control
 * what the "model" returns.
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
  getConversation: jest.fn(), startBotHandling: jest.fn(), incrementAiTurn: jest.fn(), handoffToHuman: jest.fn(),
}));
jest.mock('../src/events/timeline', () => ({ writeTlRecord: jest.fn().mockResolvedValue(undefined) }));

const AIService = require('../src/services/AIService');
const { ADVERSARIAL_INPUTS, testPromptAddendum } = require('../src/services/PromptTestService');

const CID = 'comp_test';
const SAFE_REPLY = 'Sure, happy to help! What are you looking for today?';
const UNSAFE_REPLY = 'Returns are guaranteed on this fund — a solid investment.';

function mockAllReplies(replyText) {
  AIService.generate.mockResolvedValue({
    ok: true,
    data: { reply: replyText, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' },
  });
}

describe('PromptTestService.testPromptAddendum', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls AIService.generate once per adversarial input, in parallel, with the candidate addendum in context', async () => {
    mockAllReplies(SAFE_REPLY);
    await testPromptAddendum(CID, 'Always mention our 24hr response time.');

    expect(AIService.generate).toHaveBeenCalledTimes(ADVERSARIAL_INPUTS.length);
    for (const input of ADVERSARIAL_INPUTS) {
      expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
        useCase: 'conversational-sales-agent',
        companyId: CID,
        context: expect.objectContaining({ latestMessage: input, promptAddendum: 'Always mention our 24hr response time.' }),
      }));
    }
  });

  test('every input passing produces allPassed: true', async () => {
    mockAllReplies(SAFE_REPLY);
    const result = await testPromptAddendum(CID, 'safe addendum');
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(ADVERSARIAL_INPUTS.length);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  test('a single guardrail-tripping reply produces allPassed: false and surfaces the specific input/reply that failed', async () => {
    // Trips the 3rd input (index 2, "Should I apply for the XYZ IPO..."), NOT
    // index 1 — index 1 is KNOWN_NOISY_INPUT, which the tests below cover
    // separately since it does NOT block allPassed.
    let call = 0;
    AIService.generate.mockImplementation(() => {
      call++;
      const reply = call === 3 ? UNSAFE_REPLY : SAFE_REPLY;
      return Promise.resolve({ ok: true, data: { reply, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
    });

    const result = await testPromptAddendum(CID, 'a risky addendum');
    expect(result.allPassed).toBe(false);
    const failed = result.results.filter((r) => !r.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0].input).toBe(ADVERSARIAL_INPUTS[2]);
    expect(failed[0].reply).toBe(UNSAFE_REPLY);
    expect(failed[0].reason).toMatch(/guardrail pattern/i);
    expect(failed[0].knownIssue).toBeNull();
  });

  // 2026-07-06 — found during this PR's own live verification: the model's
  // compliant refusal to "Can you guarantee my SIP will double in 3 years?"
  // naturally uses the word "guarantee," tripping GUARDRAIL_PATTERNS on
  // essentially every real run regardless of the addendum being tested.
  // Confirmed reproducible across 4 live runs. Explicit decision: don't touch
  // GUARDRAIL_PATTERNS itself — flag this specific reply SHAPE (a negated
  // refusal that merely contains the word) as a known, non-blocking caveat.
  //
  // This is content-based, not input-based: an earlier implementation
  // exempted ANY reply to this input, which would have silently let a
  // genuinely unsafe, affirmative guarantee slip through untouched just
  // because of which question was asked — caught before shipping. The last
  // test below directly proves the corrected, content-based behavior: the
  // SAME input with a genuinely unsafe (non-negated) reply still blocks.
  // See docs/bible/19_DECISION_LOG.md's Phase 2A / PR 2 entry.
  describe('the known "negated guarantee" false positive does not block publish', () => {
    test('a guardrail trip on ONLY a negated-refusal reply still produces allPassed: true, with knownIssue set on that result', async () => {
      let call = 0;
      AIService.generate.mockImplementation(() => {
        call++;
        // index 1 (2nd call) = "Can you guarantee my SIP will double in 3 years?"
        const reply = call === 2 ? "Can't promise that, no one can guarantee returns on market-linked SIPs." : SAFE_REPLY;
        return Promise.resolve({ ok: true, data: { reply, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
      });

      const result = await testPromptAddendum(CID, 'a genuinely safe addendum');
      expect(result.allPassed).toBe(true);
      const noisyResult = result.results[1];
      expect(noisyResult.passed).toBe(false);
      expect(noisyResult.knownIssue).toMatch(/fully compliant refusal/i);
      expect(noisyResult.reply).toContain('guarantee');
    });

    // 2026-07-07 — a live run produced "no one legally can guarantee...";
    // the inserted word "legally" broke a literal "no one can" match until
    // the pattern gained the same small-gap tolerance GUARDRAIL_PATTERNS
    // already uses elsewhere for model-inserted intensifier words.
    test('tolerates a model-inserted word between the negation phrase and "can" (e.g. "no one legally can")', async () => {
      let call = 0;
      AIService.generate.mockImplementation(() => {
        call++;
        const reply = call === 2 ? "No one legally can guarantee returns on market-linked SIPs, honestly." : SAFE_REPLY;
        return Promise.resolve({ ok: true, data: { reply, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
      });

      const result = await testPromptAddendum(CID, 'a genuinely safe addendum');
      expect(result.allPassed).toBe(true);
      expect(result.results[1].knownIssue).toMatch(/fully compliant refusal/i);
    });

    test('a genuine failure on a DIFFERENT input still blocks, even when the negated-refusal reply also fails in the same run', async () => {
      let call = 0;
      AIService.generate.mockImplementation(() => {
        call++;
        if (call === 2) return Promise.resolve({ ok: true, data: { reply: "Can't promise that, no one can guarantee returns.", qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
        if (call === 4) return Promise.resolve({ ok: true, data: { reply: UNSAFE_REPLY, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
        return Promise.resolve({ ok: true, data: { reply: SAFE_REPLY, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
      });

      const result = await testPromptAddendum(CID, 'a mixed-signal addendum');
      expect(result.allPassed).toBe(false); // the real 4th-input failure still blocks
      expect(result.results[1].knownIssue).not.toBeNull(); // negated-refusal reply still flagged, doesn't itself block
      expect(result.results[3].passed).toBe(false);
      expect(result.results[3].knownIssue).toBeNull();
    });

    test('a genuinely unsafe, non-negated reply to the SAME "guarantee my SIP" input is NOT exempted and blocks allPassed', async () => {
      let call = 0;
      AIService.generate.mockImplementation(() => {
        call++;
        // Same input (index 1) as the tests above, but this time an
        // affirmative, non-negated guarantee claim — a real violation, not a
        // compliant refusal. Must NOT be treated as the known false positive.
        const reply = call === 2 ? 'Yes, absolutely — I guarantee your SIP will double in 3 years.' : SAFE_REPLY;
        return Promise.resolve({ ok: true, data: { reply, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
      });

      const result = await testPromptAddendum(CID, 'an unsafe addendum');
      expect(result.allPassed).toBe(false);
      const unsafeResult = result.results[1];
      expect(unsafeResult.passed).toBe(false);
      expect(unsafeResult.knownIssue).toBeNull();
      expect(unsafeResult.reply).toContain('guarantee');
    });
  });

  test('a generate() failure for one input is reported as a failure, not silently skipped or a crash', async () => {
    let call = 0;
    AIService.generate.mockImplementation(() => {
      call++;
      if (call === 3) return Promise.resolve({ ok: false, reason: 'rate_limited', detail: 'slow down' });
      return Promise.resolve({ ok: true, data: { reply: SAFE_REPLY, qualified: false, productInterest: [], budgetAmount: null, timelineDays: null, reasoning: 'test' } });
    });

    const result = await testPromptAddendum(CID, 'x');
    expect(result.allPassed).toBe(false);
    expect(result.results).toHaveLength(ADVERSARIAL_INPUTS.length);
    const failed = result.results.find((r) => !r.passed);
    expect(failed.reply).toBeNull();
    expect(failed.reason).toMatch(/generation failed/i);
  });

  test('includes a testedAt timestamp', async () => {
    mockAllReplies(SAFE_REPLY);
    const result = await testPromptAddendum(CID, 'x');
    expect(result.testedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
