'use strict';

/**
 * AIService — the single governed entry point for all AI calls (ADR-015). These
 * tests mock global.fetch directly (same pattern as tests/whatsAppSendServiceMedia.
 * test.js) since AIService calls Anthropic the same raw-fetch() way ai.js does
 * today — no new mocking infrastructure needed. Every OTHER caller of AIService
 * mocks AIService itself instead (see tests/ai.routes.test.js), the same way
 * AutomationEngine.test.js mocks WhatsAppSendService.
 *
 * No real useCase in src/config/aiConfig.js exercises every branch of
 * AIService's own orchestration logic on its own (json-mode, locale-aware,
 * allowFields redaction opt-out, etc. each live on different useCases). So
 * this file mocks aiConfig.js with synthetic test-only useCase entries built
 * specifically to exercise each branch directly, rather than relying on
 * incidental coverage from whichever real useCases happen to combine them.
 *
 * (Originally written when metrics-insights/team-metrics-insights were
 * AIService's only two real useCases and both were text-mode/non-locale —
 * both were later removed from AI_CONFIG, 2026-07-08, Era 33: deliberately
 * disconnected from AI, not deleted as files/routes. See
 * tests/aiRoutes.test.js for their current disabled-response behavior.)
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/middleware/rateLimiter', () => ({
  atomicIncrement: jest.fn(),
}));

const TEXT_USE_CASE = {
  model: 'test-model', maxTokens: 100, promptVersion: 'v1', outputMode: 'text',
  customerFacing: false, localeAware: false,
  rateLimit: { limit: 5, windowMs: 60_000 },
  promptTemplate: (ctx) => `PROMPT:${JSON.stringify(ctx)}`,
};

const LOCALE_USE_CASE = {
  model: 'test-model', maxTokens: 100, promptVersion: 'v1', outputMode: 'text',
  customerFacing: false, localeAware: true,
  rateLimit: { limit: 5, windowMs: 60_000 },
  promptTemplate: () => 'BASE PROMPT',
};

const ALLOWFIELDS_USE_CASE = {
  model: 'test-model', maxTokens: 100, promptVersion: 'v1', outputMode: 'text',
  customerFacing: false, localeAware: false,
  rateLimit: { limit: 5, windowMs: 60_000 },
  redaction: { allowFields: ['baseSalary'], justification: 'needed for payroll-insight generation' },
  promptTemplate: (ctx) => `PROMPT:${JSON.stringify(ctx)}`,
};

function fakeSchema(shouldPass) {
  return { safeParse: (x) => (shouldPass ? { success: true, data: x } : { success: false, error: 'bad shape' }) };
}

function jsonUseCase({ schemaPasses = true } = {}) {
  return {
    model: 'test-model', maxTokens: 100, promptVersion: 'v1', outputMode: 'json',
    schema: fakeSchema(schemaPasses),
    customerFacing: true, localeAware: false,
    rateLimit: { limit: 5, windowMs: 60_000 },
    promptTemplate: () => 'JSON PROMPT',
  };
}

let mockAIConfig;
jest.mock('../src/config/aiConfig', () => ({
  get AI_CONFIG() { return mockAIConfig; },
  PRICING: {
    models: { 'test-model': { inputPerMillion: 1, outputPerMillion: 2 } },
    marginMultiplier: 1,
    pointsPerUsd: 100,
    freeCallsPerMonth: 3,
  },
}));

const dynamodb        = require('../src/config/dynamodb');
const logger           = require('../src/config/logger');
const rateLimiter       = require('../src/middleware/rateLimiter');
const AIService         = require('../src/services/AIService');

const CID  = 'comp_test';
const USER = { id: 'emp_1', name: 'Test User', role: 'admin' };

function anthropicOk(text, { inputTokens = 10, outputTokens = 20 } = {}) {
  return { ok: true, json: () => Promise.resolve({ content: [{ type: 'text', text }], usage: { input_tokens: inputTokens, output_tokens: outputTokens } }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockAIConfig = { 'text-usecase': TEXT_USE_CASE };
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) }); // no CONFIG#AI# row → defaults enabled
  dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  rateLimiter.atomicIncrement.mockResolvedValue(1); // well under any limit by default
  global.fetch = jest.fn().mockResolvedValue(anthropicOk('Generated insight text.'));
});

afterEach(() => {
  delete global.fetch;
});

describe('generate — synchronous caller-bug validation', () => {
  test('throws synchronously (not a rejected promise) when companyId is missing', () => {
    expect(() => AIService.generate({ useCase: 'text-usecase', user: USER })).toThrow(/companyId/i);
  });

  test('throws synchronously when useCase is not a registered config entry', () => {
    expect(() => AIService.generate({ useCase: 'not-a-real-usecase', companyId: CID, user: USER })).toThrow(/useCase/i);
  });
});

describe('generate — master/module toggles (checked fresh, no cache)', () => {
  test('proceeds when no CONFIG#AI# row exists (default: enabled)', async () => {
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
  });

  test('blocked with disabled_master when masterEnabled is false', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { masterEnabled: false, moduleToggles: {} } }) });
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'disabled_master', detail: expect.any(String) });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('blocked with disabled_usecase when master is on but this useCase is toggled off', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { masterEnabled: true, moduleToggles: { 'text-usecase': false } } }) });
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'disabled_usecase', detail: expect.any(String) });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('master check reads CONFIG#AI#{companyId}/CURRENT fresh on every call — no caching', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(dynamodb.get).toHaveBeenCalledTimes(2);
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `CONFIG#AI#${CID}`, SK: 'CURRENT' },
    }));
  });
});

describe('generate — per-company/per-useCase rate limiting', () => {
  test('blocked with rate_limited when atomicIncrement reports over the configured limit', async () => {
    rateLimiter.atomicIncrement.mockResolvedValueOnce(6); // limit is 5
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'rate_limited', detail: expect.any(String) });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('keyed by companyId + useCase, windowed per the useCase config', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(rateLimiter.atomicIncrement).toHaveBeenCalledWith(
      `ai_ratelimit#${CID}#text-usecase`,
      expect.stringMatching(/^window#/),
      60_000,
    );
  });
});

describe('generate — monthly free-call quota (logs, never blocks in this phase)', () => {
  test('crossing the 300-free-calls threshold does not block the call', async () => {
    rateLimiter.atomicIncrement
      .mockResolvedValueOnce(1)   // rate-limit counter
      .mockResolvedValueOnce(301); // quota counter — over freeCallsPerMonth: 3 in this test's PRICING
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('logs (does not throw or gate) when the quota is crossed', async () => {
    rateLimiter.atomicIncrement.mockResolvedValueOnce(1).mockResolvedValueOnce(301);
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/quota/i));
  });

});

describe('generate — PII/sensitive-data redaction', () => {
  test('strips a denylisted field from context before it reaches the prompt template', async () => {
    const spy = jest.spyOn(TEXT_USE_CASE, 'promptTemplate');
    await AIService.generate({
      useCase: 'text-usecase', companyId: CID, user: USER,
      context: { name: 'Ravi', panNumber: 'ABCDE1234F' },
    });
    expect(spy).toHaveBeenCalledWith({ name: 'Ravi' });
    spy.mockRestore();
  });

  test('allowFields opt-out keeps a specific field AND logs the justification', async () => {
    mockAIConfig = { 'allow-usecase': ALLOWFIELDS_USE_CASE };
    const spy = jest.spyOn(ALLOWFIELDS_USE_CASE, 'promptTemplate');
    await AIService.generate({
      useCase: 'allow-usecase', companyId: CID, user: USER,
      context: { baseSalary: 50000, panNumber: 'ABCDE1234F' },
    });
    expect(spy).toHaveBeenCalledWith({ baseSalary: 50000 });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('needed for payroll-insight generation'));
    spy.mockRestore();
  });

  test('pattern-scrub catches a PAN/Aadhaar value embedded in free text the denylist would miss', async () => {
    mockAIConfig = {
      'notes-usecase': {
        ...TEXT_USE_CASE,
        promptTemplate: (ctx) => `Notes: ${ctx.notes}`,
      },
    };
    await AIService.generate({
      useCase: 'notes-usecase', companyId: CID, user: USER,
      context: { notes: 'Customer PAN is ABCDE1234F, confirmed.' },
    });
    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(JSON.stringify(body.messages)).not.toContain('ABCDE1234F');
    expect(JSON.stringify(body.messages)).toContain('[REDACTED]');
  });
});

describe('generate — text mode success + usage tracking', () => {
  test('calls Anthropic with the useCase\'s model/maxTokens and the assembled prompt', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER, context: { foo: 'bar' } });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
      }),
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(100);
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'PROMPT:{"foo":"bar"}' });
  });

  test('returns { ok: true, data, usage } with real token counts and computed cost', async () => {
    global.fetch.mockResolvedValue(anthropicOk('Here are your insights.', { inputTokens: 100, outputTokens: 200 }));
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
    expect(result.data).toBe('Here are your insights.');
    expect(result.usage).toEqual(expect.objectContaining({
      inputTokens: 100, outputTokens: 200, model: 'test-model', promptVersion: 'v1',
    }));
    expect(typeof result.usage.costUsd).toBe('number');
    expect(typeof result.usage.walletPoints).toBe('number');
  });

  test('writes an AIUSAGE# record with tokens/cost/useCase/promptVersion', async () => {
    global.fetch.mockResolvedValue(anthropicOk('insight', { inputTokens: 5, outputTokens: 7 }));
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        useCase: 'text-usecase', promptVersion: 'v1', inputTokens: 5, outputTokens: 7,
        companyId: CID, userId: USER.id,
      }),
    }));
    const item = dynamodb.put.mock.calls.find((c) => c[0].Item.useCase === 'text-usecase')[0].Item;
    expect(item.PK).toMatch(/^AIUSAGE#comp_test#\d{4}-\d{2}-\d{2}$/);
  });

});

describe('generate — provider error handling', () => {
  test('returns provider_error (never throws) when Anthropic responds non-ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('rate limited upstream') });
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'provider_error', detail: expect.any(String) });
  });

  test('does not write a usage record when the provider call failed', async () => {
    global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('error') });
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('returns provider_error without calling fetch when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'provider_error', detail: expect.any(String) });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('generate — structured output (JSON) mode', () => {
  test('valid JSON on the first try — returns the parsed+validated object, exactly one fetch call', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch.mockResolvedValue(anthropicOk(JSON.stringify({ reply: 'hi', confidence: 0.9 })));
    const result = await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ reply: 'hi', confidence: 0.9 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('invalid JSON on the first try, valid on retry — succeeds after exactly 2 fetch calls', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch
      .mockResolvedValueOnce(anthropicOk('not json at all'))
      .mockResolvedValueOnce(anthropicOk(JSON.stringify({ reply: 'hi', confidence: 0.9 })));
    const result = await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ reply: 'hi', confidence: 0.9 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('invalid JSON on both tries — returns invalid_output, never a raw/unvalidated blob, exactly 2 fetch calls', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch.mockResolvedValue(anthropicOk('still not json'));
    const result = await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'invalid_output', detail: expect.any(String) });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('schema-valid JSON but failing safeParse still triggers the retry-then-degrade path', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase({ schemaPasses: false }) };
    global.fetch.mockResolvedValue(anthropicOk(JSON.stringify({ reply: 'hi', confidence: 0.9 })));
    const result = await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'invalid_output', detail: expect.any(String) });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// 2026-07-06: found live, via a manual smoke-test harness for the
// conversational-sales-agent prompt against the real Anthropic API — some
// responses put a `thinking` content block ahead of the `text` block
// (model-decided, not a flag this codebase sets), which content[0]-indexing
// silently misread as empty text. Reproduces that exact shape.
describe('generate — Anthropic responses with a thinking block ahead of text', () => {
  function anthropicWithThinking(text, { inputTokens = 10, outputTokens = 20 } = {}) {
    return {
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }),
    };
  }

  test('text mode still extracts the real text when a thinking block comes first', async () => {
    global.fetch.mockResolvedValue(anthropicWithThinking('Here are your insights.'));
    const result = await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
    expect(result.data).toBe('Here are your insights.');
  });

  test('json mode still parses valid JSON when a thinking block comes first — no wasted retry', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch.mockResolvedValue(anthropicWithThinking(JSON.stringify({ reply: 'hi', confidence: 0.9 })));
    const result = await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ reply: 'hi', confidence: 0.9 });
    expect(global.fetch).toHaveBeenCalledTimes(1); // real text was found first try, no retry needed
  });

  test('a response with ONLY a thinking block (no text block at all) degrades to invalid_output, not a crash', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    const result = await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(result).toEqual({ ok: false, reason: 'invalid_output', detail: expect.any(String) });
  });
});

describe('generate — locale-aware prompting', () => {
  test('appends a language instruction when localeAware is true and preferredLanguage is present', async () => {
    mockAIConfig = { 'locale-usecase': LOCALE_USE_CASE };
    await AIService.generate({ useCase: 'locale-usecase', companyId: CID, user: USER, context: { preferredLanguage: 'hi' } });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[body.messages.length - 1].content).toContain('hi');
  });

  test('no language instruction when preferredLanguage is absent, even if localeAware is true', async () => {
    mockAIConfig = { 'locale-usecase': LOCALE_USE_CASE };
    await AIService.generate({ useCase: 'locale-usecase', companyId: CID, user: USER });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[body.messages.length - 1].content).toBe('BASE PROMPT');
  });

  test('no language instruction when localeAware is false, even if preferredLanguage is present', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER, context: { preferredLanguage: 'hi' } });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[body.messages.length - 1].content).not.toMatch(/respond in/i);
  });
});

describe('generate — multi-turn conversation history', () => {
  test('conversationHistory is passed through ahead of the current turn', async () => {
    const history = [{ role: 'user', content: 'earlier question' }, { role: 'assistant', content: 'earlier answer' }];
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER, conversationHistory: history });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'earlier question' });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'earlier answer' });
    expect(body.messages).toHaveLength(3);
  });

  test('defaults to an empty history when omitted', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(1);
  });
});

// 2026-07-08 — cost-audit Part 5: entityType/entityId/source/attempts are
// pure additive metadata on the AIUSAGE# record. No migration, no schema
// change to existing records — a caller that doesn't pass them (i.e. every
// caller written before this change) must write a byte-identical Item shape
// to what existed before, proving old records stay readable/valid with no
// backfill required.
describe('generate — usage-attribution fields (entityType/entityId/source/attempts)', () => {
  test('omitting entityType/entityId writes the same Item shape as before this change — no migration needed', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item).not.toHaveProperty('entityType');
    expect(item).not.toHaveProperty('entityId');
    // source and attempts are always written (not conditional) — source
    // defaults to 'production', attempts is a real observed value, never
    // inferred after the fact.
    expect(item.source).toBe('production');
    expect(item.attempts).toBe(1);
  });

  test('entityType/entityId are written through untouched when a caller supplies them', async () => {
    await AIService.generate({
      useCase: 'text-usecase', companyId: CID, user: USER,
      entityType: 'conversation', entityId: 'conv_123',
    });
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.entityType).toBe('conversation');
    expect(item.entityId).toBe('conv_123');
  });

  test('source defaults to "production" when not passed, and passes through "admin_test" when a caller does', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(dynamodb.put.mock.calls[0][0].Item.source).toBe('production');

    dynamodb.put.mockClear();
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER, source: 'admin_test' });
    expect(dynamodb.put.mock.calls[0][0].Item.source).toBe('admin_test');
  });

  test('attempts is 1 for text mode (no retry loop exists for it)', async () => {
    await AIService.generate({ useCase: 'text-usecase', companyId: CID, user: USER });
    expect(dynamodb.put.mock.calls[0][0].Item.attempts).toBe(1);
  });

  test('attempts is 1 for json mode when the first try is already valid', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch.mockResolvedValue(anthropicOk(JSON.stringify({ reply: 'hi', confidence: 0.9 })));
    await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(dynamodb.put.mock.calls[0][0].Item.attempts).toBe(1);
  });

  test('attempts is 2 for json mode when the corrective retry was needed — the real observed outcome, not inferred from token counts', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch
      .mockResolvedValueOnce(anthropicOk('not json at all'))
      .mockResolvedValueOnce(anthropicOk(JSON.stringify({ reply: 'hi', confidence: 0.9 })));
    await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(dynamodb.put.mock.calls[0][0].Item.attempts).toBe(2);
  });

  test('attempts is 2 when both json retries are exhausted (invalid_output)', async () => {
    mockAIConfig = { 'json-usecase': jsonUseCase() };
    global.fetch.mockResolvedValue(anthropicOk('still not json'));
    await AIService.generate({ useCase: 'json-usecase', companyId: CID, user: USER });
    expect(dynamodb.put.mock.calls[0][0].Item.attempts).toBe(2);
  });
});

describe('generate — no send capability (hard boundary)', () => {
  test('AIService.js has no require() dependency on WhatsAppSendService', () => {
    const src = require('fs').readFileSync(`${__dirname}/../src/services/AIService.js`, 'utf8');
    expect(src).not.toMatch(/require\(['"][^'"]*WhatsAppSendService['"]\)/);
  });

  test('AIService.js has no require() dependency on WalletService (not wired to deduct in this phase)', () => {
    const src = require('fs').readFileSync(`${__dirname}/../src/services/AIService.js`, 'utf8');
    expect(src).not.toMatch(/require\(['"][^'"]*WalletService['"]\)/);
  });
});
