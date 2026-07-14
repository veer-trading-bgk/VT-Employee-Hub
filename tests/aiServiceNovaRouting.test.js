'use strict';

/**
 * AIService — provider dispatch to Amazon Nova (Bedrock). Verifies every useCase
 * with `provider: 'bedrock-nova'` routes to BedrockNovaProvider (not Anthropic),
 * that cost logging produces the same AIUSAGE# record shape with the REAL Nova
 * token counts + Nova rate snapshot, that the JSON-schema path still parses from
 * Nova's response, and that the default (no provider) still uses Anthropic.
 */

jest.mock('../src/config/dynamodb', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn() }));
jest.mock('../src/middleware/rateLimiter', () => ({ atomicIncrement: jest.fn() }));
jest.mock('../src/services/providers/BedrockNovaProvider', () => ({ generate: jest.fn() }));

const NOVA_MODEL = 'apac.amazon.nova-lite-v1:0';
let mockAIConfig;
jest.mock('../src/config/aiConfig', () => ({
  get AI_CONFIG() { return mockAIConfig; },
  PRICING: {
    models: {
      'test-model': { inputPerMillion: 1, outputPerMillion: 2 },
      'apac.amazon.nova-lite-v1:0': { inputPerMillion: 0.071, outputPerMillion: 0.284 },
    },
    marginMultiplier: 1.5,
    pointsPerUsd: 100,
    freeCallsPerMonth: 300,
  },
}));

const dynamodb = require('../src/config/dynamodb');
const rateLimiter = require('../src/middleware/rateLimiter');
const Nova = require('../src/services/providers/BedrockNovaProvider');
const AIService = require('../src/services/AIService');

const CID = 'comp_test';
const USER = { id: 'emp_1', name: 'Test User', role: 'admin' };

const novaTextUseCase = {
  provider: 'bedrock-nova', model: NOVA_MODEL, maxTokens: 100, promptVersion: 'v8', outputMode: 'text',
  customerFacing: true, localeAware: false, rateLimit: { limit: 60, windowMs: 60_000 },
  promptTemplate: () => 'PROMPT',
};
function novaJsonUseCase(schemaPasses = true) {
  return {
    provider: 'bedrock-nova', model: NOVA_MODEL, maxTokens: 100, promptVersion: 'v8', outputMode: 'json',
    schema: { safeParse: (x) => (schemaPasses ? { success: true, data: x } : { success: false, error: 'bad' }) },
    customerFacing: true, localeAware: false, rateLimit: { limit: 60, windowMs: 60_000 },
    promptTemplate: () => 'JSON PROMPT',
  };
}
const anthropicDefaultUseCase = {
  model: 'test-model', maxTokens: 100, promptVersion: 'v1', outputMode: 'text',
  customerFacing: false, localeAware: false, rateLimit: { limit: 60, windowMs: 60_000 },
  promptTemplate: () => 'PROMPT',
}; // no `provider` → should stay on Anthropic

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
  dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  rateLimiter.atomicIncrement.mockResolvedValue(1);
  global.fetch = jest.fn();
});
afterEach(() => { delete global.fetch; });

describe('AIService — Nova provider dispatch', () => {
  test('a bedrock-nova useCase routes to BedrockNovaProvider, never to Anthropic fetch', async () => {
    mockAIConfig = { 'nova-text': novaTextUseCase };
    Nova.generate.mockResolvedValue({ text: 'Nova says hi', usage: { inputTokens: 2005, outputTokens: 97 } });

    const r = await AIService.generate({ useCase: 'nova-text', companyId: CID, user: USER });

    expect(r.ok).toBe(true);
    expect(r.data).toBe('Nova says hi');
    expect(Nova.generate).toHaveBeenCalledTimes(1);
    // AIService keeps the prompt in the user message; systemPrompt is null.
    expect(Nova.generate).toHaveBeenCalledWith(null, expect.arrayContaining([{ role: 'user', content: expect.any(String) }]), { model: NOVA_MODEL, maxTokens: 100 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('cost logging: AIUSAGE# record carries the Nova model, REAL token counts, and the Nova rate snapshot', async () => {
    mockAIConfig = { 'nova-text': novaTextUseCase };
    Nova.generate.mockResolvedValue({ text: 'ok', usage: { inputTokens: 2005, outputTokens: 97 } });

    await AIService.generate({ useCase: 'nova-text', companyId: CID, user: USER });

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.model).toBe(NOVA_MODEL);
    expect(item.inputTokens).toBe(2005);
    expect(item.outputTokens).toBe(97);
    expect(item.inputRatePerMillion).toBe(0.071);
    expect(item.outputRatePerMillion).toBe(0.284);
    // costUsd = (2005/1e6*0.071 + 97/1e6*0.284) * 1.5 margin
    const expected = (2005 / 1e6 * 0.071 + 97 / 1e6 * 0.284) * 1.5;
    expect(item.costUsd).toBeCloseTo(expected, 8);
    expect(item.PK).toBe(`AIUSAGE#${CID}#${new Date().toISOString().slice(0, 10)}`);
  });

  test('JSON-schema output path parses from Nova response (qualified/reply extraction still works)', async () => {
    mockAIConfig = { 'nova-json': novaJsonUseCase(true) };
    Nova.generate.mockResolvedValue({
      text: '{"reply":"Can\'t recommend a specific stock.","qualified":false,"productInterest":[],"budgetAmount":null,"timelineDays":null,"reasoning":"declined stock pick"}',
      usage: { inputTokens: 2100, outputTokens: 44 },
    });

    const r = await AIService.generate({ useCase: 'nova-json', companyId: CID, user: USER });

    expect(r.ok).toBe(true);
    expect(r.data.qualified).toBe(false);
    expect(r.data.reply).toMatch(/specific stock/);
    expect(Nova.generate).toHaveBeenCalledTimes(1); // parsed first try, no retry
  });

  test('a bedrock-nova JSON call retries via Nova (not Anthropic) on a first bad-JSON response', async () => {
    mockAIConfig = { 'nova-json': novaJsonUseCase(true) };
    Nova.generate
      .mockResolvedValueOnce({ text: 'not json at all', usage: { inputTokens: 100, outputTokens: 5 } })
      .mockResolvedValueOnce({ text: '{"reply":"ok","qualified":true}', usage: { inputTokens: 120, outputTokens: 8 } });

    const r = await AIService.generate({ useCase: 'nova-json', companyId: CID, user: USER });

    expect(r.ok).toBe(true);
    expect(Nova.generate).toHaveBeenCalledTimes(2);       // retried on Nova, not Anthropic
    expect(global.fetch).not.toHaveBeenCalled();
    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.inputTokens).toBe(220);                    // cumulative across both attempts
    expect(item.attempts).toBe(2);
  });

  test('a useCase with NO provider field still uses Anthropic (behavior-neutral default)', async () => {
    mockAIConfig = { 'legacy': anthropicDefaultUseCase };
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ content: [{ type: 'text', text: 'claude reply' }], usage: { input_tokens: 10, output_tokens: 5 } }) });

    const r = await AIService.generate({ useCase: 'legacy', companyId: CID, user: USER });

    expect(r.ok).toBe(true);
    expect(r.data).toBe('claude reply');
    expect(global.fetch).toHaveBeenCalledTimes(1);   // Anthropic
    expect(Nova.generate).not.toHaveBeenCalled();
  });
});
