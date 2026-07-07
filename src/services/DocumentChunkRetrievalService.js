'use strict';

const EmbeddingService = require('./EmbeddingService');
const DocumentChunkService = require('./DocumentChunkService');
const { cosineSimilarity } = require('./KnowledgeService');

/**
 * RAG PR C — ranks document chunks against a live customer message. The
 * capability DocumentChunkService.js's own docstring pointed at ("PR C owns
 * retrieval, not this file") — kept in its own file rather than folded into
 * DocumentChunkService.js (storage-only by design) or ConversationalAgentService.js.
 *
 * Additive to structured entries, never displacing them (locked decision):
 * entries keep their own unrelated top-3 behavior in KnowledgeService.js
 * regardless of what this returns. Unlike entries, a stored chunk can never
 * be missing an embedding — /publish (knowledgeDocuments.js) blocks with a
 * 422 if EmbeddingService.embed() fails — so there is no keyword-fallback
 * branch here: without a usable query vector there is nothing to rank
 * against, and this returns [] rather than approximating with substring
 * matching.
 */

// Deliberately smaller than KnowledgeService.MAX_MATCHED_ENTRIES (3): chunks
// run up to ~1000 chars (TARGET_CHUNK_SIZE, chunking.js) vs. a short
// admin-authored entry, and there is no token/character budget anywhere in
// aiConfig.js's prompt builder — this cap is what keeps the section additive
// rather than dominating the prompt.
const MAX_MATCHED_CHUNKS = 2;

function toPromptShape(chunks) {
  return chunks.map((c) => ({ text: c.text }));
}

// queryVector: undefined -> embed the message ourselves (standalone-caller
// behavior); a real vector -> reused, no embed call (the caller already
// embedded it, e.g. alongside KnowledgeService.getMatchingEntries in the
// same turn); null -> caller already tried and it failed, skip straight to [].
async function getMatchingChunks(companyId, latestMessage, { queryVector } = {}) {
  if (!latestMessage) return [];

  const chunks = await DocumentChunkService.listChunksForCompany(companyId);
  const active = chunks.filter((c) => !c.archived);
  if (active.length === 0) return [];

  let vector = queryVector;
  if (vector === undefined) {
    const embedResult = await EmbeddingService.embed({ texts: [latestMessage], companyId, inputType: 'query' });
    vector = embedResult.ok ? embedResult.data.embeddings[0] : null;
  }
  if (!vector) return [];

  const ranked = active
    .map((c) => ({ chunk: c, score: cosineSimilarity(vector, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHED_CHUNKS)
    .map((s) => s.chunk);

  return toPromptShape(ranked);
}

module.exports = { getMatchingChunks, MAX_MATCHED_CHUNKS };
