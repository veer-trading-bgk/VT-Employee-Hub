'use strict';

const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * RAG PR B — chunk storage for Document Knowledge. Mirrors KnowledgeService.js's
 * shape for the storage side; PR C owns retrieval (ranking chunks against a
 * live query), not this file.
 *
 * `KNOWLEDGE_DOCUMENT_CHUNKS#{companyId}` / `CHUNK#{documentId}#{chunkIndex}`
 * (zero-padded) — one partition PER COMPANY, not per document, deliberately
 * mirroring KNOWLEDGE#{companyId}'s pattern so a future retrieval query can
 * fetch every chunk across every document for a company in one Query.
 *
 * Chunks are only ever written from the /publish route (knowledgeDocuments.js)
 * — a draft or archived document has zero chunk items, the same structural
 * (not runtime-filtered) guarantee PR A established for entries.
 */

function chunkKey(companyId, documentId, chunkIndex) {
  return {
    PK: `KNOWLEDGE_DOCUMENT_CHUNKS#${companyId}`,
    SK: `CHUNK#${documentId}#${String(chunkIndex).padStart(6, '0')}`,
  };
}

async function listChunksForDocument(companyId, documentId) {
  const { Items = [] } = await dynamodb.query({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
    ExpressionAttributeValues: {
      ':pk': `KNOWLEDGE_DOCUMENT_CHUNKS#${companyId}`,
      ':pfx': `CHUNK#${documentId}#`,
    },
  }).promise();
  return Items;
}

async function deleteChunksForDocument(companyId, documentId) {
  const existing = await listChunksForDocument(companyId, documentId);
  await Promise.all(existing.map((item) => dynamodb.delete({
    TableName: TABLE,
    Key: { PK: item.PK, SK: item.SK },
  }).promise()));
}

async function createChunks(companyId, documentId, chunkTexts, embeddings) {
  const now = new Date().toISOString();
  await Promise.all(chunkTexts.map((text, i) => dynamodb.put({
    TableName: TABLE,
    Item: {
      ...chunkKey(companyId, documentId, i),
      companyId, documentId, chunkIndex: i, text, embedding: embeddings[i],
      archived: false, createdAt: now,
    },
  }).promise()));
}

// Denormalized onto each chunk (not just the parent DOC# item) so a future
// retrieval query can filter a chunk correctly using only that chunk's own
// item — the same single-item-check shape entries already use — instead of
// cross-referencing a separately-fetched parent document list at query time.
async function setChunksArchived(companyId, documentId, archived) {
  const existing = await listChunksForDocument(companyId, documentId);
  await Promise.all(existing.map((item) => dynamodb.update({
    TableName: TABLE,
    Key: { PK: item.PK, SK: item.SK },
    UpdateExpression: 'SET archived = :a',
    ExpressionAttributeValues: { ':a': archived },
  }).promise()));
}

module.exports = {
  chunkKey, listChunksForDocument, deleteChunksForDocument, createChunks, setChunksArchived,
};
