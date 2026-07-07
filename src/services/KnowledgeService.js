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
//
// RAG PR C — optional 3rd param {queryVector} lets a caller that's ALSO
// ranking document chunks this same turn (ConversationalAgentService.js)
// embed the customer's message once and reuse the vector here, instead of
// this function embedding it again — Voyage is rate-limited (see Era 29's
// pre-launch blocker), so a redundant embed call per turn is a real, not
// theoretical, cost. undefined (the default, every pre-existing caller) ->
// unchanged behavior, computes its own embedding exactly as before. A real
// vector -> reused, no embed call. null -> caller already tried and failed,
// skip straight to keyword fallback rather than trying again.
async function getMatchingEntries(companyId, latestMessage, { queryVector } = {}) {
  if (!latestMessage) return [];
  const lowerMsg = String(latestMessage).toLowerCase();

  const entries = await listEntries(companyId);
  const eligible = entries.filter((e) => !e.archived && (e.activeVersion ?? 0) > 0);

  const withEmbedding = eligible.filter(hasEmbedding);
  const withoutEmbedding = eligible.filter((e) => !hasEmbedding(e));

  if (withEmbedding.length === 0) {
    return toPromptShape(newestFirst(keywordMatch(eligible, lowerMsg)).slice(0, MAX_MATCHED_ENTRIES));
  }

  let vector = queryVector;
  if (vector === undefined) {
    const queryResult = await EmbeddingService.embed({ texts: [latestMessage], companyId, inputType: 'query' });
    vector = queryResult.ok ? queryResult.data.embeddings[0] : null;
  }
  if (!vector) {
    return toPromptShape(newestFirst(keywordMatch(eligible, lowerMsg)).slice(0, MAX_MATCHED_ENTRIES));
  }

  const semanticMatches = withEmbedding
    .map((e) => ({ entry: e, score: cosineSimilarity(vector, e.activeEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);

  const keywordMatchesForUnembedded = newestFirst(keywordMatch(withoutEmbedding, lowerMsg));

  const merged = [...semanticMatches, ...keywordMatchesForUnembedded].slice(0, MAX_MATCHED_ENTRIES);
  return toPromptShape(merged);
}

// RAG PR C — lets a caller decide up front (without a Voyage call) whether
// embedding the customer's message is worth attempting at all, i.e. whether
// ANY eligible entry could actually use it. Reuses the exact same
// eligibility+embedding check getMatchingEntries applies inline, so the two
// can never drift out of sync with each other.
function hasSemanticEntry(entries) {
  return entries.some((e) => !e.archived && (e.activeVersion ?? 0) > 0 && hasEmbedding(e));
}

module.exports = {
  listEntries, getMatchingEntries, entryKey, versionKey, MAX_MATCHED_ENTRIES, cosineSimilarity, hasSemanticEntry,
};
