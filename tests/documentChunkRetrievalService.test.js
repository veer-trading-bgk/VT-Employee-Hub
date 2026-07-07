'use strict';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/services/EmbeddingService', () => ({ embed: jest.fn() }));

const dynamodb = require('../src/config/dynamodb');
const EmbeddingService = require('../src/services/EmbeddingService');
const { getMatchingChunks, MAX_MATCHED_CHUNKS } = require('../src/services/DocumentChunkRetrievalService');

const CID = 'comp_test';

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

function chunk(overrides) {
  return {
    companyId: CID, documentId: 'doc-1', chunkIndex: 0, archived: false,
    text: 'No account opening fee, AMC waived for the first year.', embedding: [1, 0, 0],
    ...overrides,
  };
}

describe('DocumentChunkRetrievalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('empty/absent latestMessage returns [] without listing chunks', async () => {
    expect(await getMatchingChunks(CID, '')).toEqual([]);
    expect(await getMatchingChunks(CID, null)).toEqual([]);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });

  test('zero chunks for the company → [] without ever calling embed', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    const matches = await getMatchingChunks(CID, 'what are your fees');
    expect(matches).toEqual([]);
    expect(EmbeddingService.embed).not.toHaveBeenCalled();
  });

  test('archived chunks are excluded even with a strong match', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [chunk({ archived: true })] }));
    EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
    const matches = await getMatchingChunks(CID, 'account opening fees');
    expect(matches).toEqual([]);
    // No active chunks at all -> never even reaches the embed call.
    expect(EmbeddingService.embed).not.toHaveBeenCalled();
  });

  test('ranks active chunks by cosine similarity, most similar first', async () => {
    const close = chunk({ chunkIndex: 0, text: 'close match', embedding: [1, 0, 0] });
    const far = chunk({ chunkIndex: 1, text: 'far match', embedding: [0, 1, 0] });
    dynamodb.query.mockReturnValue(resolved({ Items: [far, close] })); // deliberately out of expected order
    EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });

    const matches = await getMatchingChunks(CID, 'anything');
    expect(matches).toEqual([{ text: 'close match' }, { text: 'far match' }]);
  });

  test('caps results at MAX_MATCHED_CHUNKS', async () => {
    const items = Array.from({ length: MAX_MATCHED_CHUNKS + 3 }, (_, i) => chunk({
      chunkIndex: i, text: `chunk-${i}`, embedding: [1, 0, 0],
    }));
    dynamodb.query.mockReturnValue(resolved({ Items: items }));
    EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });

    const matches = await getMatchingChunks(CID, 'anything');
    expect(matches).toHaveLength(MAX_MATCHED_CHUNKS);
  });

  test('output shape is {text} only — no chunkIndex, embedding, or metadata leaks into the prompt shape', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [chunk()] }));
    EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
    const matches = await getMatchingChunks(CID, 'fees');
    expect(matches).toEqual([{ text: chunk().text }]);
  });

  describe('queryVector param (RAG PR C — shared embedding across entries + document chunks)', () => {
    test('a pre-computed queryVector is used directly, embed is never called', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [chunk()] }));
      const matches = await getMatchingChunks(CID, 'anything', { queryVector: [1, 0, 0] });
      expect(EmbeddingService.embed).not.toHaveBeenCalled();
      expect(matches).toEqual([{ text: chunk().text }]);
    });

    test('queryVector: null skips embed and returns [] — no keyword fallback exists for chunks', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [chunk()] }));
      const matches = await getMatchingChunks(CID, 'anything', { queryVector: null });
      expect(EmbeddingService.embed).not.toHaveBeenCalled();
      expect(matches).toEqual([]);
    });

    test('omitting the 3rd argument entirely still computes its own embedding (standalone-caller behavior)', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [chunk()] }));
      EmbeddingService.embed.mockResolvedValue({ ok: true, data: { embeddings: [[1, 0, 0]] } });
      await getMatchingChunks(CID, 'anything');
      expect(EmbeddingService.embed).toHaveBeenCalledTimes(1);
      expect(EmbeddingService.embed).toHaveBeenCalledWith({ texts: ['anything'], companyId: CID, inputType: 'query' });
    });

    test('a failed self-computed embed degrades to [], not a crash', async () => {
      dynamodb.query.mockReturnValue(resolved({ Items: [chunk()] }));
      EmbeddingService.embed.mockResolvedValue({ ok: false, reason: 'embedding_failed' });
      await expect(getMatchingChunks(CID, 'anything')).resolves.toEqual([]);
    });
  });
});
