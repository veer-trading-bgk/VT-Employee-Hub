'use strict';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const { getMatchingEntries, listEntries, entryKey, versionKey, MAX_MATCHED_ENTRIES } = require('../src/services/KnowledgeService');

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
  });
});
