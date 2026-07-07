'use strict';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/services/EmbeddingService', () => ({ embed: jest.fn() }));

const dynamodb = require('../src/config/dynamodb');
const EmbeddingService = require('../src/services/EmbeddingService');
const {
  getMatchingEntries, listEntries, entryKey, versionKey, MAX_MATCHED_ENTRIES, cosineSimilarity, hasSemanticEntry,
} = require('../src/services/KnowledgeService');

const CID = 'comp_test';

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

describe('KnowledgeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('entryKey/versionKey produce the documented PK/SK shape', () => {
    expect(entryKey(CID, 'e1')).toEqual({ PK: `KNOWLEDGE#${CID}`, SK: 'ENTRY#e1' });
    expect(versionKey(CID, 'e1', 3)).toEqual({ PK: `KNOWLEDGE_VERSIONS#${CID}#e1`, SK: 'VERSION#000003' });
  });

  test('listEntries queries the company partition and returns all items as-is', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ entryId: 'e1' }, { entryId: 'e2' }] }));
    const entries = await listEntries(CID);
    expect(entries).toHaveLength(2);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE#${CID}` },
    }));
  });

  describe('getMatchingEntries', () => {
    function entry(overrides) {
      return {
        entryId: 'e1', archived: false, activeVersion: 1, activePublishedAt: '2026-07-01T00:00:00.000Z',
        activeTriggers: ['fees'], activeQuestion: 'What are your fees?', activeAnswer: 'No account opening fee.',
        ...overrides,
      };
    }

    function embeddedEntry(overrides) {
      return entry({
        entryId: 'e-embedded', activeEmbedding: [1, 0, 0],
        activeQuestion: 'What are SIP options?', activeAnswer: 'We offer SIPs starting at ₹500/month.',
        activeTriggers: ['sip options'], // deliberately narrow — the point is semantic match works WITHOUT this
        ...overrides,
      });
    }

    test('matches case-insensitively via substring against the customer message', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [entry({ activeTriggers: ['account opening fee'] })] }));
      const matches = await getMatchingEntries(CID, 'What ACCOUNT OPENING FEE do you charge?');
      expect(matches).toEqual([{ question: 'What are your fees?', answer: 'No account opening fee.' }]);
    });

    test('no trigger matches → empty array', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [entry()] }));
      const matches = await getMatchingEntries(CID, 'completely unrelated message');
      expect(matches).toEqual([]);
    });

    test('archived entries never match even if a trigger hits', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [entry({ archived: true })] }));
      const matches = await getMatchingEntries(CID, 'what are your fees');
      expect(matches).toEqual([]);
    });

    test('never-published entries (activeVersion 0) never match', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [entry({ activeVersion: 0 })] }));
      const matches = await getMatchingEntries(CID, 'what are your fees');
      expect(matches).toEqual([]);
    });

    test('empty/absent latestMessage returns an empty array without querying triggers', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [entry()] }));
      expect(await getMatchingEntries(CID, '')).toEqual([]);
      expect(await getMatchingEntries(CID, null)).toEqual([]);
    });

    test('caps matches at MAX_MATCHED_ENTRIES, most-recently-published first', async () => {
      const items = Array.from({ length: MAX_MATCHED_ENTRIES + 2 }, (_, i) => entry({
        entryId: `e${i}`,
        activeTriggers: ['fees'],
        activeQuestion: `q${i}`,
        activePublishedAt: `2026-07-0${i + 1}T00:00:00.000Z`,
      }));
      dynamodb.query.mockReturnValue(resolved({ Items: items }));
      const matches = await getMatchingEntries(CID, 'what are your fees');
      expect(matches).toHaveLength(MAX_MATCHED_ENTRIES);
      // Most recently published (highest date suffix) first.
      expect(matches[0].question).toBe(`q${MAX_MATCHED_ENTRIES + 1}`);
    });

    describe('semantic retrieval (RAG PR A, ADR-017)', () => {
      test('an embedding-bearing entry matches semantically even with ZERO keyword overlap', async () => {
        dynamodb.query.mockReturnValue(resolved({ Items: [embeddedEntry()] }));
        EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[0.9, 0.1, 0]] } });

        // No word here overlaps with the entry's question/triggers at all.
        const matches = await getMatchingEntries(CID, 'Tell me about systematic investment plans');
        expect(matches).toEqual([{ question: 'What are SIP options?', answer: 'We offer SIPs starting at ₹500/month.' }]);
        expect(EmbeddingService.embed).toHaveBeenCalledWith({
          texts: ['Tell me about systematic investment plans'], companyId: CID, inputType: 'query',
        });
      });

      test('ranks embedded entries by cosine similarity, most similar first', async () => {
        const closeMatch = embeddedEntry({ entryId: 'close', activeEmbedding: [1, 0, 0], activeQuestion: 'close-match' });
        const farMatch = embeddedEntry({ entryId: 'far', activeEmbedding: [0, 1, 0], activeQuestion: 'far-match' });
        dynamodb.query.mockReturnValue(resolved({ Items: [farMatch, closeMatch] })); // deliberately out of expected order
        EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });

        const matches = await getMatchingEntries(CID, 'anything');
        expect(matches[0].question).toBe('close-match');
        expect(matches[1].question).toBe('far-match');
      });

      test('entries without an embedding are still reachable via keyword fallback, merged AFTER semantic matches', async () => {
        const semantic = embeddedEntry({ entryId: 'semantic', activeQuestion: 'semantic-hit' });
        const keywordOnly = entry({
          entryId: 'keyword-only', activeEmbedding: undefined,
          activeTriggers: ['fees'], activeQuestion: 'keyword-hit',
        });
        dynamodb.query.mockReturnValue(resolved({ Items: [semantic, keywordOnly] }));
        EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });

        const matches = await getMatchingEntries(CID, 'sip options and fees');
        expect(matches[0].question).toBe('semantic-hit');
        expect(matches[1].question).toBe('keyword-hit');
      });

      test('a failed query-embedding call falls back to full keyword matching across every eligible entry, not a crash', async () => {
        const semanticCapable = embeddedEntry({ activeTriggers: ['sip options'] });
        dynamodb.query.mockReturnValue(resolved({ Items: [semanticCapable] }));
        EmbeddingService.embed.mockResolvedValue({ ok: false, reason: 'embedding_failed' });

        const matches = await getMatchingEntries(CID, 'what are sip options');
        expect(matches).toEqual([{ question: 'What are SIP options?', answer: 'We offer SIPs starting at ₹500/month.' }]);
      });

      test('no entries have an embedding yet (pre-backfill) → skips the embed call entirely, pure keyword path', async () => {
        dynamodb.query.mockReturnValue(resolved({ Items: [entry()] }));
        const matches = await getMatchingEntries(CID, 'what are your fees');
        expect(EmbeddingService.embed).not.toHaveBeenCalled();
        expect(matches).toHaveLength(1);
      });

      test('merged semantic + keyword-fallback results still cap at MAX_MATCHED_ENTRIES', async () => {
        const semanticEntries = Array.from({ length: MAX_MATCHED_ENTRIES }, (_, i) => embeddedEntry({
          entryId: `sem${i}`, activeEmbedding: [1, 0, 0], activeQuestion: `sem-q${i}`,
        }));
        const keywordEntry = entry({ entryId: 'kw', activeEmbedding: undefined, activeTriggers: ['fees'], activeQuestion: 'kw-q' });
        dynamodb.query.mockReturnValue(resolved({ Items: [...semanticEntries, keywordEntry] }));
        EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });

        const matches = await getMatchingEntries(CID, 'sip options and fees');
        expect(matches).toHaveLength(MAX_MATCHED_ENTRIES);
        expect(matches.every((m) => m.question.startsWith('sem-q'))).toBe(true); // semantic fills the cap first
      });
    });

    describe('queryVector param (RAG PR C — shared embedding across entries + document chunks)', () => {
      test('a pre-computed queryVector is used directly, skipping embed entirely', async () => {
        const item = embeddedEntry();
        dynamodb.query.mockReturnValue(resolved({ Items: [item] }));

        const matches = await getMatchingEntries(CID, 'anything', { queryVector: [1, 0, 0] });
        expect(EmbeddingService.embed).not.toHaveBeenCalled();
        expect(matches).toEqual([{ question: item.activeQuestion, answer: item.activeAnswer }]);
      });

      test('queryVector: null skips embed and falls back to keyword matching, same as a failed embed call', async () => {
        const item = embeddedEntry({ activeTriggers: ['sip options'] });
        dynamodb.query.mockReturnValue(resolved({ Items: [item] }));

        const matches = await getMatchingEntries(CID, 'what are sip options', { queryVector: null });
        expect(EmbeddingService.embed).not.toHaveBeenCalled();
        expect(matches).toEqual([{ question: item.activeQuestion, answer: item.activeAnswer }]);
      });

      test('omitting the 3rd argument entirely still computes its own embedding exactly as before (no regression)', async () => {
        dynamodb.query.mockReturnValue(resolved({ Items: [embeddedEntry()] }));
        EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });

        await getMatchingEntries(CID, 'anything');
        expect(EmbeddingService.embed).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('hasSemanticEntry (RAG PR C)', () => {
    function entry(overrides) {
      return { archived: false, activeVersion: 1, ...overrides };
    }

    test('true when at least one eligible entry has an embedding', () => {
      expect(hasSemanticEntry([entry({ activeEmbedding: [1, 0] })])).toBe(true);
    });

    test('false for an empty list', () => {
      expect(hasSemanticEntry([])).toBe(false);
    });

    test('false when the only embedded entry is archived', () => {
      expect(hasSemanticEntry([entry({ activeEmbedding: [1, 0], archived: true })])).toBe(false);
    });

    test('false when the only embedded entry is never-published (activeVersion 0)', () => {
      expect(hasSemanticEntry([entry({ activeEmbedding: [1, 0], activeVersion: 0 })])).toBe(false);
    });

    test('false when entries exist but none has an embedding', () => {
      expect(hasSemanticEntry([entry(), entry()])).toBe(false);
    });
  });

  describe('cosineSimilarity', () => {
    test('identical vectors → 1', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    });
    test('orthogonal vectors → 0', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });
    test('opposite vectors → -1', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });
    test('a zero-magnitude vector → 0, not NaN or a crash', () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });
  });
});
