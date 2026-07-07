'use strict';

const dynamodb = require('../config/dynamodb');

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

// A live conversation turn only ever matches against activeTriggers/
// activeAnswer/activeQuestion — the last PUBLISHED, tested state — never the
// draft fields (unpublished work-in-progress never reaches a real customer,
// same rule PR 2's promptAddendum already established). Archived entries and
// never-published entries (activeVersion === 0) never match.
async function getMatchingEntries(companyId, latestMessage) {
  if (!latestMessage) return [];
  const lowerMsg = String(latestMessage).toLowerCase();

  const entries = await listEntries(companyId);
  const matched = entries.filter((e) => (
    !e.archived
    && (e.activeVersion ?? 0) > 0
    && (e.activeTriggers ?? []).some((t) => lowerMsg.includes(t))
  ));

  matched.sort((a, b) => (b.activePublishedAt ?? '').localeCompare(a.activePublishedAt ?? ''));
  return matched.slice(0, MAX_MATCHED_ENTRIES).map((e) => ({ question: e.activeQuestion, answer: e.activeAnswer }));
}

module.exports = { listEntries, getMatchingEntries, entryKey, versionKey, MAX_MATCHED_ENTRIES };
