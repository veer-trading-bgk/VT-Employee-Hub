'use strict';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const {
  chunkKey, listChunksForDocument, listChunksForCompany, deleteChunksForDocument, createChunks, setChunksArchived,
} = require('../src/services/DocumentChunkService');

const CID = 'comp_test';
const DOC_ID = 'doc-1';

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

describe('DocumentChunkService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('chunkKey produces one partition PER COMPANY (not per document), zero-padded chunk index', () => {
    expect(chunkKey(CID, DOC_ID, 3)).toEqual({
      PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`,
      SK: `CHUNK#${DOC_ID}#000003`,
    });
    // Same company, different document — same PK, confirming the
    // company-wide (not per-document) partition this design deliberately uses.
    expect(chunkKey(CID, 'doc-2', 0).PK).toBe(chunkKey(CID, DOC_ID, 0).PK);
  });

  test('a different company produces a structurally different partition key', () => {
    expect(chunkKey('other_company', DOC_ID, 0).PK).not.toBe(chunkKey(CID, DOC_ID, 0).PK);
  });

  test('listChunksForDocument queries scoped to both the company partition and the document prefix', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ chunkIndex: 0 }] }));
    const items = await listChunksForDocument(CID, DOC_ID);
    expect(items).toEqual([{ chunkIndex: 0 }]);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, ':pfx': `CHUNK#${DOC_ID}#` },
    }));
  });

  test('createChunks writes one item per chunk, each with its own text/embedding, archived: false', async () => {
    dynamodb.put.mockReturnValue(resolved({}));
    await createChunks(CID, DOC_ID, ['chunk one', 'chunk two'], [[0.1, 0.2], [0.3, 0.4]]);

    expect(dynamodb.put).toHaveBeenCalledTimes(2);
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        SK: `CHUNK#${DOC_ID}#000000`, companyId: CID, documentId: DOC_ID, chunkIndex: 0,
        text: 'chunk one', embedding: [0.1, 0.2], archived: false,
      }),
    }));
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ SK: `CHUNK#${DOC_ID}#000001`, chunkIndex: 1, text: 'chunk two', embedding: [0.3, 0.4] }),
    }));
  });

  test('deleteChunksForDocument removes every existing chunk for that document only', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [
        { PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#${DOC_ID}#000000` },
        { PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#${DOC_ID}#000001` },
      ],
    }));
    dynamodb.delete.mockReturnValue(resolved({}));
    await deleteChunksForDocument(CID, DOC_ID);
    expect(dynamodb.delete).toHaveBeenCalledTimes(2);
    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#${DOC_ID}#000000` },
    }));
  });

  test('setChunksArchived flips archived on every chunk for that document', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [{ PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#${DOC_ID}#000000` }],
    }));
    dynamodb.update.mockReturnValue(resolved({}));
    await setChunksArchived(CID, DOC_ID, true);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#${DOC_ID}#000000` },
      ExpressionAttributeValues: { ':a': true },
    }));
  });

  test('no existing chunks — deleteChunksForDocument and setChunksArchived are safe no-ops', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    await expect(deleteChunksForDocument(CID, DOC_ID)).resolves.toBeUndefined();
    await expect(setChunksArchived(CID, DOC_ID, true)).resolves.toBeUndefined();
    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  // RAG PR C
  test('listChunksForCompany queries the company partition only, no SK prefix condition', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [
        { PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#doc-a#000000` },
        { PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}`, SK: `CHUNK#doc-b#000000` },
      ],
    }));
    const items = await listChunksForCompany(CID);
    expect(items).toHaveLength(2);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE_DOCUMENT_CHUNKS#${CID}` },
    }));
  });

  test('listChunksForCompany returns archived items too — filtering is the caller\'s job, mirroring listEntries', async () => {
    dynamodb.query.mockReturnValue(resolved({
      Items: [{ SK: `CHUNK#doc-a#000000`, archived: true }, { SK: `CHUNK#doc-a#000001`, archived: false }],
    }));
    const items = await listChunksForCompany(CID);
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.archived)).toBe(true);
  });

  test('no chunks for a company — listChunksForCompany returns []', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    await expect(listChunksForCompany(CID)).resolves.toEqual([]);
  });
});
