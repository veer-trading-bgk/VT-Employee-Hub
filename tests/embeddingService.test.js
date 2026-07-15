'use strict';

/**
 * EmbeddingService — ADR-017's single governed entry point for embedding
 * calls. Same { ok, ... } contract shape as AIService.generate(): never
 * throws for expected runtime conditions (provider error, timeout), always
 * returns a typed result so callers (KnowledgeService.js) can degrade
 * gracefully instead of crashing a turn.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.VOYAGE_API_KEY = 'test-voyage-key';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const { EMBEDDING_CONFIG } = require('../src/config/embeddingConfig');
const { embed } = require('../src/services/EmbeddingService');

const CID = 'comp_test';

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

function mockVoyageResponse(embeddings, tokens = 12) {
  axios.post.mockResolvedValue({
    data: {
      data: embeddings.map((embedding, index) => ({ object: 'embedding', embedding, index })),
      model: 'voyage-finance-2',
      usage: { total_tokens: tokens },
    },
  });
}

describe('EmbeddingService.embed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue(resolved({}));
  });

  test('throws synchronously when companyId is missing', () => {
    expect(() => embed({ texts: ['hi'], inputType: 'query' })).toThrow(/companyId is required/);
  });

  test('throws synchronously when inputType is missing or invalid', () => {
    expect(() => embed({ texts: ['hi'], companyId: CID })).toThrow(/inputType must be/);
    expect(() => embed({ texts: ['hi'], companyId: CID, inputType: 'bogus' })).toThrow(/inputType must be/);
  });

  test('empty texts array returns an empty result without calling the provider', async () => {
    const result = await embed({ texts: [], companyId: CID, inputType: 'query' });
    expect(result).toEqual({ ok: true, data: { embeddings: [] } });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('sends the correct request shape to Voyage', async () => {
    mockVoyageResponse([[0.1, 0.2, 0.3]]);
    await embed({ texts: ['What are your fees?'], companyId: CID, inputType: 'query' });

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      { input: ['What are your fees?'], model: 'voyage-finance-2', input_type: 'query' },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-voyage-key' }),
      }),
    );
  });

  test('returns embeddings sorted by index, not response array order', async () => {
    axios.post.mockResolvedValue({
      data: {
        data: [
          { embedding: [9, 9, 9], index: 1 },
          { embedding: [1, 1, 1], index: 0 },
        ],
        usage: { total_tokens: 20 },
      },
    });

    const result = await embed({ texts: ['a', 'b'], companyId: CID, inputType: 'document' });
    expect(result.ok).toBe(true);
    expect(result.data.embeddings).toEqual([[1, 1, 1], [9, 9, 9]]);
  });

  test('logs usage scoped to companyId and today\'s date', async () => {
    mockVoyageResponse([[0.1, 0.2]], 42);
    await embed({ texts: ['x'], companyId: CID, inputType: 'document' });

    const today = new Date().toISOString().slice(0, 10);
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `EMBEDUSAGE#${CID}#${today}`, companyId: CID, tokens: 42, inputType: 'document', textCount: 1,
        model: 'voyage-finance-2',
      }),
    }));
  });

  test('a provider error returns { ok: false, reason }, never throws', async () => {
    axios.post.mockRejectedValue({ response: { status: 429, data: { error: 'rate limit exceeded' } } });
    const result = await embed({ texts: ['x'], companyId: CID, inputType: 'query' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('embedding_failed');
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('uses the configured timeout from embeddingConfig, not a hardcoded value', async () => {
    mockVoyageResponse([[0.1, 0.2]]);
    await embed({ texts: ['x'], companyId: CID, inputType: 'query' });
    const [, , options] = axios.post.mock.calls[0];
    expect(options.timeout).toBe(EMBEDDING_CONFIG.timeoutMs);
    expect(EMBEDDING_CONFIG.timeoutMs).toBeLessThan(10_000); // the fix: down from the old 10s
  });

  // Error-CLASS routing (2026-07-15): a timeout is the recoverable, self-healing
  // case that was spamming the alert channel → warn (no page). A response-bearing
  // error (bad key, 4xx/5xx) is a real fault a human must act on → error (page),
  // on the FIRST occurrence. This replaced a volume tripwire that couldn't fire
  // at this service's real traffic.
  test('a timeout (no HTTP response) logs at warn, never error — so it does NOT page Telegram', async () => {
    axios.post.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 5000ms exceeded' });
    const result = await embed({ texts: ['x'], companyId: CID, inputType: 'query' });
    expect(result.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('degraded to keyword fallback'));
    expect(logger.error).not.toHaveBeenCalled(); // logger.error pages — must not fire on a recovered timeout
  });

  test('a response-bearing error (e.g. 401 bad key) logs at error — so it DOES page, on the first occurrence', async () => {
    axios.post.mockRejectedValue({ response: { status: 401, data: { detail: 'Provided API key is invalid.' } } });
    const result = await embed({ texts: ['x'], companyId: CID, inputType: 'query' });
    expect(result.ok).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 401'));
    expect(logger.warn).not.toHaveBeenCalled(); // a hard fault must not be silently downgraded to warn
  });

  test('a usage-log failure does not fail the embed call itself', async () => {
    mockVoyageResponse([[0.1, 0.2]]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(new Error('DynamoDB unavailable')) });
    const result = await embed({ texts: ['x'], companyId: CID, inputType: 'query' });
    expect(result.ok).toBe(true);
    expect(result.data.embeddings).toEqual([[0.1, 0.2]]);
  });

  // 2026-07-08 — cost-audit Part 5: entityType/entityId are pure additive
  // metadata on the EMBEDUSAGE# record. No migration — a caller that omits
  // them (every caller written before this change) must write a
  // byte-identical Item shape to what existed before.
  describe('usage-attribution fields (entityType/entityId)', () => {
    test('omitting entityType/entityId writes the same Item shape as before this change — no migration needed', async () => {
      mockVoyageResponse([[0.1, 0.2]]);
      await embed({ texts: ['x'], companyId: CID, inputType: 'query' });
      const item = dynamodb.put.mock.calls[0][0].Item;
      expect(item).not.toHaveProperty('entityType');
      expect(item).not.toHaveProperty('entityId');
    });

    test('entityType/entityId are written through untouched when a caller supplies them', async () => {
      mockVoyageResponse([[0.1, 0.2]]);
      await embed({
        texts: ['x'], companyId: CID, inputType: 'document',
        entityType: 'document', entityId: 'entry_1',
      });
      const item = dynamodb.put.mock.calls[0][0].Item;
      expect(item.entityType).toBe('document');
      expect(item.entityId).toBe('entry_1');
    });
  });
});
