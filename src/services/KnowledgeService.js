'use strict';

const dynamodb = require('../config/dynamodb');
const EmbeddingService = require('./EmbeddingService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// Phase 2A / PR 3 — Structured Knowledge Center. Bounds how many entries can
// ever reach a single prompt turn regardless of how many the company has
// published — same "deterministic filter, bounded size" philosophy as the
// guardrail itself, not an LLM judgment call over which entries matter.
const MAX_MATCHED_ENTRIES = 3;

function entryKey(companyId, entryId) {
  return { PK: `KNOWLEDGE#${companyId}`, SK: `ENTRY#${entryId}` };
}

function versionKey(companyId, entryId, version) {
  return { PK: `KNOWLEDGE_VERSIONS#${companyId}#${entryId}`, SK: `VERSION#${String(version).padStart(6, '0')}` };
}

async function listEntries(companyId) {
  const { Items = [] } = await dynamodb.query({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `KNOWLEDGE#${companyId}` },
  }).promise();
  return Items;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hasEmbedding(entry) {
  return Array.isArray(entry.activeEmbedding) && entry.activeEmbedding.length > 0;
}

function keywordMatch(entries, lowerMsg) {
  return entries.filter((e) => (e.activeTriggers ?? []).some((t) => lowerMsg.includes(t)));
}

function toPromptShape(entries) {
  return entries.map((e) => ({ question: e.activeQuestion, answer: e.activeAnswer }));
}

function newestFirst(entries) {
  return [...entries].sort((a, b) => (b.activePublishedAt ?? '').localeCompare(a.activePublishedAt ?? ''));
}

// RAG PR A — semantic retrieval (ADR-017), keyword matching kept only as a
// fallback, never the primary path once an entry has an embedding:
//  1. Entries missing activeEmbedding (not yet backfilled, or a past publish
//     whose embed call failed — see knowledgeCenter.js's /publish) are always
//     reachable via the old keyword-substring check, so they're never
//     silently invisible.
//  2. Entries WITH an embedding are ranked by cosine similarity against the
//     live customer message's own embedding, computed fresh every turn.
//  3. If embedding the query itself fails (provider error/timeout), the
//     whole turn falls back to keyword matching across every eligible
//     entry — graceful degradation, not a failed turn, same resilience
//     stance as _fetchPromptAddendum's empty-object fallback.
// A live conversation turn only ever matches against activeTriggers/
// activeEmbedding/activeAnswer/activeQuestion — the last PUBLISHED, tested
// state — never the draft fields. Archived entries and never-published
// entries (activeVersion === 0) never match, and never get an embedding
// computed in the first place (see knowledgeCenter.js) — the searchable set
// cannot contain draft content by construction, not by a runtime filter.
async function getMatchingEntries(companyId, latestMessage) {
  if (!latestMessage) return [];
  const lowerMsg = String(latestMessage).toLowerCase();

  const entries = await listEntries(companyId);
  const eligible = entries.filter((e) => !e.archived && (e.activeVersion ?? 0) > 0);

  const withEmbedding = eligible.filter(hasEmbedding);
  const withoutEmbedding = eligible.filter((e) => !hasEmbedding(e));

  if (withEmbedding.length === 0) {
    return toPromptShape(newestFirst(keywordMatch(eligible, lowerMsg)).slice(0, MAX_MATCHED_ENTRIES));
  }

  const queryResult = await EmbeddingService.embed({ texts: [latestMessage], companyId, inputType: 'query' });
  if (!queryResult.ok) {
    return toPromptShape(newestFirst(keywordMatch(eligible, lowerMsg)).slice(0, MAX_MATCHED_ENTRIES));
  }

  const [queryVector] = queryResult.data.embeddings;
  const semanticMatches = withEmbedding
    .map((e) => ({ entry: e, score: cosineSimilarity(queryVector, e.activeEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);

  const keywordMatchesForUnembedded = newestFirst(keywordMatch(withoutEmbedding, lowerMsg));

  const merged = [...semanticMatches, ...keywordMatchesForUnembedded].slice(0, MAX_MATCHED_ENTRIES);
  return toPromptShape(merged);
}

module.exports = {
  listEntries, getMatchingEntries, entryKey, versionKey, MAX_MATCHED_ENTRIES, cosineSimilarity,
};
