'use strict';

/**
 * BedrockNovaProvider — Converse request shaping + normalized response.
 * Mocks aws-sdk's BedrockRuntime so no real Bedrock call is made.
 */

const mockConverse = jest.fn();
jest.mock('aws-sdk', () => ({
  BedrockRuntime: jest.fn().mockImplementation(() => ({
    converse: (...args) => ({ promise: () => mockConverse(...args) }),
  })),
}));

const provider = require('../src/services/providers/BedrockNovaProvider');

function okResponse(text, inputTokens = 100, outputTokens = 20) {
  return {
    output: { message: { role: 'assistant', content: [{ text }] } },
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    stopReason: 'end_turn',
  };
}

beforeEach(() => jest.clearAllMocks());

describe('BedrockNovaProvider.generate', () => {
  test('converts AIService messages to Converse content-block shape and returns normalized text + usage', async () => {
    mockConverse.mockResolvedValue(okResponse('{"reply":"hi"}', 123, 45));

    const r = await provider.generate(null, [{ role: 'user', content: 'hello' }], { model: 'apac.amazon.nova-lite-v1:0', maxTokens: 700 });

    expect(r).toEqual({ text: '{"reply":"hi"}', usage: { inputTokens: 123, outputTokens: 45 } });
    const params = mockConverse.mock.calls[0][0];
    expect(params.modelId).toBe('apac.amazon.nova-lite-v1:0');
    expect(params.inferenceConfig).toEqual({ maxTokens: 700 });
    expect(params.messages).toEqual([{ role: 'user', content: [{ text: 'hello' }] }]);
    expect(params).not.toHaveProperty('system'); // null systemPrompt → omitted
  });

  test('real token counts come from resp.usage.inputTokens/outputTokens (the whole point of the migration)', async () => {
    mockConverse.mockResolvedValue(okResponse('ok', 2005, 97));
    const r = await provider.generate(null, [{ role: 'user', content: 'x' }], { model: 'm', maxTokens: 10 });
    expect(r.usage.inputTokens).toBe(2005);
    expect(r.usage.outputTokens).toBe(97);
  });

  test('coalesces adjacent same-role turns (Bedrock requires strict alternation; Anthropic did not)', async () => {
    mockConverse.mockResolvedValue(okResponse('ok'));

    await provider.generate(null, [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },   // two users in a row
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'third' },
    ], { model: 'm', maxTokens: 10 });

    const params = mockConverse.mock.calls[0][0];
    expect(params.messages).toEqual([
      { role: 'user', content: [{ text: 'first\nsecond' }] },
      { role: 'assistant', content: [{ text: 'reply' }] },
      { role: 'user', content: [{ text: 'third' }] },
    ]);
  });

  test('a non-null systemPrompt is passed through as Converse system block', async () => {
    mockConverse.mockResolvedValue(okResponse('ok'));
    await provider.generate('be concise', [{ role: 'user', content: 'x' }], { model: 'm', maxTokens: 10 });
    expect(mockConverse.mock.calls[0][0].system).toEqual([{ text: 'be concise' }]);
  });

  test('missing usage fields degrade to 0, never undefined (cost logging must not break)', async () => {
    mockConverse.mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } } });
    const r = await provider.generate(null, [{ role: 'user', content: 'x' }], { model: 'm', maxTokens: 10 });
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
