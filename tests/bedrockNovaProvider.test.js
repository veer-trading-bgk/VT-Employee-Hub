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
jest.mock('../src/config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const provider = require('../src/services/providers/BedrockNovaProvider');
const logger = require('../src/config/logger');

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

  // ── Multi-turn regression: Converse requires the array to START with user ──
  //
  // Reproduces the EXACT production shape that broke every turn-2+ conversation
  // on Nova (2026-07-14): the AI's own turn-1 reply is the first message stored
  // under a freshly-created lead, so from turn 2 the fetched history begins with
  // an assistant turn. Bedrock rejected the whole call with "A conversation must
  // start with a user message." AIService appends the rendered prompt as the
  // final user turn, hence the trailing [..., user, user] pair here.
  test('strips a leading assistant turn so the array starts with user ([assistant,user,assistant,user,user] shape)', async () => {
    mockConverse.mockResolvedValue(okResponse('ok'));

    await provider.generate(null, [
      { role: 'assistant', content: 'turn-1 AI reply' }, // first stored msg under the lead
      { role: 'user', content: 'turn-2 customer msg' },
      { role: 'assistant', content: 'turn-2 AI reply' },
      { role: 'user', content: 'turn-3 customer msg' },
      { role: 'user', content: 'rendered prompt (AIService-appended)' }, // trailing same-role
    ], { model: 'm', maxTokens: 10 });

    const params = mockConverse.mock.calls[0][0];
    // Leading assistant stripped; trailing two users coalesced; alternation intact.
    expect(params.messages).toEqual([
      { role: 'user', content: [{ text: 'turn-2 customer msg' }] },
      { role: 'assistant', content: [{ text: 'turn-2 AI reply' }] },
      { role: 'user', content: [{ text: 'turn-3 customer msg\nrendered prompt (AIService-appended)' }] },
    ]);
    expect(params.messages[0].role).toBe('user'); // the hard Converse requirement
  });

  test('turn-1 empty-history shape is unchanged by the strip (regression guard for the already-working path)', async () => {
    mockConverse.mockResolvedValue(okResponse('ok'));
    // Turn 1: no history, AIService passes just the appended user prompt.
    await provider.generate(null, [{ role: 'user', content: 'the rendered prompt' }], { model: 'm', maxTokens: 10 });
    const params = mockConverse.mock.calls[0][0];
    expect(params.messages).toEqual([{ role: 'user', content: [{ text: 'the rendered prompt' }] }]);
    expect(logger.warn).not.toHaveBeenCalled(); // no fallback path taken
  });

  test('all-assistant input (no user turn at all) falls back to a single user turn + warns, never sends an empty array', async () => {
    mockConverse.mockResolvedValue(okResponse('ok'));
    // Degenerate/misuse input — cannot arrive via AIService, which always appends
    // a user prompt. Must not crash or send [] (Converse rejects an empty array).
    const r = await provider.generate(null, [
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
    ], { model: 'm', maxTokens: 10 });

    const params = mockConverse.mock.calls[0][0];
    expect(params.messages).toEqual([{ role: 'user', content: [{ text: 'a1\na2' }] }]); // coalesced content, re-roled to user
    expect(params.messages[0].role).toBe('user');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(r.text).toBe('ok'); // still returns a normal result
  });
});
