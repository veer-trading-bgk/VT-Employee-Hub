'use strict';

/**
 * Superadmin-only AI cost reporting — aggregates AIUSAGE#/EMBEDUSAGE# records
 * for the Platform module's AI Costs tab (docs/bible/19_DECISION_LOG.md Era 38).
 *
 * Scan-with-filter, not a GSI: at audit time (2026-07-08) AIUSAGE# was 345
 * items and EMBEDUSAGE# was 85, out of 1,756 total items in
 * DYNAMODB_TABLE_METRICS. This is an on-demand admin page view, not a cron
 * (lower query pressure than ADR-014's 5-min sweep or ADR-018's per-message
 * scan). Same reasoning as ADR-014/ADR-018 applies; see the decision log for
 * the migration trigger.
 *
 * Cost figures are never blended across `source` — production/admin_test/
 * untagged are always three separate buckets in the response. This is a
 * structural choice, not just a default: Era 36 found nearly all data to date
 * is admin_test, so there is no filter path that can accidentally recombine
 * them into one misleading total.
 */

const dynamodb = require('../config/dynamodb');

function table() { return process.env.DYNAMODB_TABLE_METRICS; }

// Display-only USD→INR conversion for this report. Never written to DynamoDB,
// never affects wallet/billing math (that stays entirely in USD via
// AIService._computeCost / PRICING.marginMultiplier). Verified 2026-07-08 via
// a live rate lookup (open.er-api.com) — a static snapshot, not auto-refreshed.
// Revisit if this drifts materially from the real rate.
const USD_TO_INR_RATE = 95.05;

// EmbeddingService never logs a costUsd per call (confirmed by reading
// src/services/EmbeddingService.js — only token counts are stored). This rate
// (voyage-finance-2 list price, $0.12/MTok) is applied here at READ time only,
// for reporting — it is an ESTIMATE, never a stored or billed figure.
const VOYAGE_EMBED_USD_PER_MILLION_TOKENS = 0.12;

const DEFAULT_RANGE_DAYS = 30;

function round(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function scanAll(params) {
  const items = [];
  let lastKey;
  do {
    const r = await dynamodb.scan({
      ...params,
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(r.Items ?? []));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

function bucketKey(item) {
  if (item.source === 'production') return 'production';
  if (item.source === 'admin_test') return 'admin_test';
  return 'untagged'; // pre-dates the source field entirely (Part A cost-audit tagging, shipped 2026-07-08)
}

function emptyAiBucket() {
  return { totalCostUsd: 0, calls: 0, byCompany: {}, byUseCase: {} };
}

function addToAiBucket(bucket, item) {
  const cost = item.costUsd || 0;
  bucket.totalCostUsd += cost;
  bucket.calls += 1;

  const company = item.companyId || '(unknown)';
  bucket.byCompany[company] = bucket.byCompany[company] || { costUsd: 0, calls: 0 };
  bucket.byCompany[company].costUsd += cost;
  bucket.byCompany[company].calls += 1;

  const useCase = item.useCase || '(unknown)';
  bucket.byUseCase[useCase] = bucket.byUseCase[useCase] || { costUsd: 0, calls: 0 };
  bucket.byUseCase[useCase].costUsd += cost;
  bucket.byUseCase[useCase].calls += 1;
}

// costInr is deliberately derived from the ROUNDED costUsd, not the raw
// unrounded accumulator — a superadmin sanity-checking this report with a
// calculator (costUsd * rate) must get exactly the displayed costInr, not a
// figure off by a few millionths from rounding at two different precisions
// off the same raw sum. Caught by scripts/_tmp_validate_ai_cost_dashboard.js
// during the Era 38 real-data validation pass.
function toInr(usd) {
  return round(usd * USD_TO_INR_RATE);
}

function finalizeAiBucket(bucket) {
  const totalCostUsd = round(bucket.totalCostUsd);
  return {
    totalCostUsd,
    totalCostInr: toInr(totalCostUsd),
    calls: bucket.calls,
    byCompany: Object.entries(bucket.byCompany)
      .map(([companyId, v]) => {
        const costUsd = round(v.costUsd);
        return { companyId, calls: v.calls, costUsd, costInr: toInr(costUsd) };
      })
      .sort((a, b) => b.costUsd - a.costUsd),
    byUseCase: Object.entries(bucket.byUseCase)
      .map(([useCase, v]) => {
        const costUsd = round(v.costUsd);
        return { useCase, calls: v.calls, costUsd, costInr: toInr(costUsd) };
      })
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

function emptyEmbedBucket() {
  return { totalTokens: 0, calls: 0, byCompany: {}, byInputType: {} };
}

function addToEmbedBucket(bucket, item) {
  const tokens = item.tokens || 0;
  bucket.totalTokens += tokens;
  bucket.calls += 1;

  const company = item.companyId || '(unknown)';
  bucket.byCompany[company] = bucket.byCompany[company] || { tokens: 0, calls: 0 };
  bucket.byCompany[company].tokens += tokens;
  bucket.byCompany[company].calls += 1;

  const inputType = item.inputType || '(unknown)'; // closest analog to "useCase" this entity has
  bucket.byInputType[inputType] = bucket.byInputType[inputType] || { tokens: 0, calls: 0 };
  bucket.byInputType[inputType].tokens += tokens;
  bucket.byInputType[inputType].calls += 1;
}

function finalizeEmbedBucket(bucket) {
  const estimatedCostUsd = round((bucket.totalTokens / 1e6) * VOYAGE_EMBED_USD_PER_MILLION_TOKENS);
  return {
    totalTokens: bucket.totalTokens,
    estimatedCostUsd,
    estimatedCostInr: toInr(estimatedCostUsd),
    calls: bucket.calls,
    byCompany: Object.entries(bucket.byCompany)
      .map(([companyId, v]) => ({ companyId, tokens: v.tokens, calls: v.calls }))
      .sort((a, b) => b.tokens - a.tokens),
    byInputType: Object.entries(bucket.byInputType)
      .map(([inputType, v]) => ({ inputType, tokens: v.tokens, calls: v.calls }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

/**
 * Cross-tenant AI cost report for the Platform module.
 * @param {object} opts
 *   @param {string} [opts.from] ISO timestamp, inclusive. Default: 30 days ago.
 *   @param {string} [opts.to]   ISO timestamp, inclusive. Default: now.
 */
async function getAiCostReport({ from, to } = {}) {
  const fallback = defaultRange();
  const range = { from: from || fallback.from, to: to || fallback.to };
  const fromDate = range.from.slice(0, 10);
  const toDate = range.to.slice(0, 10);

  const aiItems = await scanAll({
    TableName: table(),
    FilterExpression: 'begins_with(PK, :p) AND createdAt BETWEEN :from AND :to',
    ExpressionAttributeValues: { ':p': 'AIUSAGE#', ':from': range.from, ':to': range.to },
  });

  const embedItems = await scanAll({
    TableName: table(),
    FilterExpression: 'begins_with(PK, :p) AND #d BETWEEN :fromD AND :toD',
    ExpressionAttributeNames: { '#d': 'date' },
    ExpressionAttributeValues: { ':p': 'EMBEDUSAGE#', ':fromD': fromDate, ':toD': toDate },
  });

  const aiBuckets = { production: emptyAiBucket(), admin_test: emptyAiBucket(), untagged: emptyAiBucket() };
  for (const item of aiItems) addToAiBucket(aiBuckets[bucketKey(item)], item);

  const embedBucket = emptyEmbedBucket();
  for (const item of embedItems) addToEmbedBucket(embedBucket, item);

  const taggedAiItems = aiItems.filter((it) => it.entityType || it.entityId || it.source);
  const taggedDates = [...new Set(taggedAiItems.map((it) => (it.createdAt || '').slice(0, 10)).filter(Boolean))].sort();

  return {
    range,
    usdToInrRate: USD_TO_INR_RATE,
    meta: {
      totalAiUsageRecordsInRange: aiItems.length,
      taggedAiUsageRecordsInRange: taggedAiItems.length,
      taggedDataDates: taggedDates,
      daysOfTaggedData: taggedDates.length,
    },
    bySource: {
      production: finalizeAiBucket(aiBuckets.production),
      admin_test: finalizeAiBucket(aiBuckets.admin_test),
      untagged: finalizeAiBucket(aiBuckets.untagged),
    },
    embeddings: {
      note: 'EmbeddingService does not log a cost per call — this section is an ESTIMATE using a static Voyage list-price rate, not a stored/billed figure.',
      ...finalizeEmbedBucket(embedBucket),
    },
  };
}

/**
 * Drill-down: every AI/embedding record tied to one entity (e.g. a
 * conversationId), across all companies and all time — the caller supplies
 * the entityId knowing what they're looking for, so no date range is applied.
 */
async function getEntityCostDetail(entityId) {
  if (!entityId) throw new Error('entityId is required');

  const [aiItems, embedItems] = await Promise.all([
    scanAll({
      TableName: table(),
      FilterExpression: 'begins_with(PK, :p) AND entityId = :eid',
      ExpressionAttributeValues: { ':p': 'AIUSAGE#', ':eid': entityId },
    }),
    scanAll({
      TableName: table(),
      FilterExpression: 'begins_with(PK, :p) AND entityId = :eid',
      ExpressionAttributeValues: { ':p': 'EMBEDUSAGE#', ':eid': entityId },
    }),
  ]);

  const sortedAi = [...aiItems].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const totalAiCostUsd = round(aiItems.reduce((sum, it) => sum + (it.costUsd || 0), 0));
  const totalEmbedTokens = embedItems.reduce((sum, it) => sum + (it.tokens || 0), 0);
  const estimatedEmbedCostUsd = round((totalEmbedTokens / 1e6) * VOYAGE_EMBED_USD_PER_MILLION_TOKENS);

  return {
    entityId,
    usdToInrRate: USD_TO_INR_RATE,
    aiUsage: sortedAi.map((it) => {
      const costUsd = round(it.costUsd || 0);
      return {
        useCase: it.useCase ?? null,
        model: it.model ?? null,
        source: it.source ?? null, // null = untagged (pre-dates Part A tagging)
        companyId: it.companyId ?? null,
        costUsd,
        costInr: toInr(costUsd),
        inputTokens: it.inputTokens ?? null,
        outputTokens: it.outputTokens ?? null,
        attempts: it.attempts ?? null,
        createdAt: it.createdAt ?? null,
      };
    }),
    embedUsage: embedItems.map((it) => ({
      model: it.model ?? null,
      inputType: it.inputType ?? null,
      companyId: it.companyId ?? null,
      tokens: it.tokens ?? 0,
      timestamp: it.SK ?? null,
    })),
    totals: {
      aiCalls: aiItems.length,
      aiCostUsd: totalAiCostUsd,
      aiCostInr: toInr(totalAiCostUsd),
      embedCalls: embedItems.length,
      embedTokens: totalEmbedTokens,
      embedEstimatedCostUsd: estimatedEmbedCostUsd,
      embedEstimatedCostInr: toInr(estimatedEmbedCostUsd),
    },
  };
}

module.exports = {
  getAiCostReport,
  getEntityCostDetail,
  USD_TO_INR_RATE,
  VOYAGE_EMBED_USD_PER_MILLION_TOKENS,
};
