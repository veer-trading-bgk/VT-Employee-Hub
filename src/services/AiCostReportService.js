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
 *
 * Registered-vs-unregistered (Era 39): `source` tagging alone is NOT a
 * reliable real-vs-test signal — some earlier live-verification scripts
 * tagged their scratch companyIds `source: 'production'` directly instead of
 * `admin_test`. The authoritative signal is whether the companyId has a real
 * COMPANY_PROFILE record (EMPLOYEES table) — a scratch identity used ad hoc
 * during testing never goes through real onboarding, so it structurally
 * cannot appear there, regardless of what a future test script names it or
 * how it tags `source`. Every bucket below is additionally split into
 * registered/unregistered on this basis, same "never silently blend"
 * principle as the source split.
 *
 * Historical-cost recompute fallback (Era 40): every `AIUSAGE#` record's
 * cost is read via effectiveCost(), never `item.costUsd` directly. Before
 * 2026-07-08, `PRICING.models` had no `claude-sonnet-5` entry, so every
 * `conversational-sales-agent` call made on Sonnet logged `costUsd: 0` —
 * confirmed a real ~21x undercount for date ranges spanning that gap.
 * effectiveCost() prefers a real logged cost, then a rate snapshotted onto
 * the record itself at write time (`inputRatePerMillion`/
 * `outputRatePerMillion`, added the same day), and only falls back to
 * *current* `PRICING.models` for records old enough to predate the snapshot
 * field entirely — so this fallback is a one-time historical-gap patch, not
 * an ongoing mechanism that could silently reprice a record after a future
 * rate change (e.g. Sonnet 5's intro pricing expiring 2026-08-31).
 */

const dynamodb = require('../config/dynamodb');
const { PRICING } = require('../config/aiConfig');

function table() { return process.env.DYNAMODB_TABLE_METRICS; }
function empTable() { return process.env.DYNAMODB_TABLE_EMPLOYEES; }

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

/**
 * Every companyId with a real COMPANY_PROFILE record — the same query
 * GET /api/platform/companies already runs. Anything not in this set is a
 * scratch/test identity from a live-verification session, never a real
 * onboarded company, regardless of naming convention or source tag.
 */
async function getRegisteredCompanyIds() {
  const items = await scanAll({
    TableName: empTable(),
    FilterExpression: '#type = :t',
    ExpressionAttributeNames: { '#type': 'type' },
    ExpressionAttributeValues: { ':t': 'COMPANY_PROFILE' },
    ProjectionExpression: 'companyId',
  });
  return new Set(items.map((it) => it.companyId));
}

/**
 * The cost to attribute to one AIUSAGE# record. Never read item.costUsd
 * directly elsewhere in this file — always go through this function.
 *
 * Precedence:
 *   1. A real logged costUsd always wins — never recomputed over.
 *   2. A rate snapshotted on the record itself at write time
 *      (inputRatePerMillion/outputRatePerMillion, Era 40) — preferred over
 *      current PRICING.models specifically so a record's own historical
 *      rate can never drift just because pricing changed since it was
 *      logged (e.g. an intro rate expiring).
 *   3. Current PRICING.models, only reached by records old enough to
 *      predate the rate-snapshot field entirely — the exact pre-2026-07-08
 *      claude-sonnet-5 gap this fallback exists for.
 *   4. Nothing computable (no snapshot, model not in current PRICING, or no
 *      token counts) — falls back to whatever costUsd is stored (0), never
 *      throws.
 */
function effectiveCost(item) {
  if (item.costUsd) return item.costUsd;

  if (item.inputRatePerMillion != null && item.outputRatePerMillion != null) {
    return _recompute(item, item.inputRatePerMillion, item.outputRatePerMillion);
  }

  const rates = PRICING.models[item.model];
  if (!rates) return item.costUsd || 0;
  return _recompute(item, rates.inputPerMillion, rates.outputPerMillion);
}

function _recompute(item, inputRatePerMillion, outputRatePerMillion) {
  const raw = ((item.inputTokens || 0) / 1e6) * inputRatePerMillion + ((item.outputTokens || 0) / 1e6) * outputRatePerMillion;
  return raw * PRICING.marginMultiplier;
}

function bucketKey(item) {
  if (item.source === 'production') return 'production';
  if (item.source === 'admin_test') return 'admin_test';
  return 'untagged'; // pre-dates the source field entirely (Part A cost-audit tagging, shipped 2026-07-08)
}

function emptyAiBucket() {
  return {
    totalCostUsd: 0, calls: 0,
    registeredCostUsd: 0, registeredCalls: 0,
    unregisteredCostUsd: 0, unregisteredCalls: 0,
    unregisteredCompanies: new Set(),
    byCompany: {}, byUseCase: {},
  };
}

function addToAiBucket(bucket, item, isRegistered) {
  const cost = effectiveCost(item);
  bucket.totalCostUsd += cost;
  bucket.calls += 1;

  if (isRegistered) {
    bucket.registeredCostUsd += cost;
    bucket.registeredCalls += 1;
  } else {
    bucket.unregisteredCostUsd += cost;
    bucket.unregisteredCalls += 1;
    bucket.unregisteredCompanies.add(item.companyId || '(unknown)');
  }

  const company = item.companyId || '(unknown)';
  bucket.byCompany[company] = bucket.byCompany[company] || { costUsd: 0, calls: 0, registered: isRegistered };
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
  const registeredCostUsd = round(bucket.registeredCostUsd);
  const unregisteredCostUsd = round(bucket.unregisteredCostUsd);
  return {
    // Headline number — registered companies only. See getAiCostReport doc
    // comment / Era 39: source tagging alone isn't a reliable real-vs-test
    // signal, registry membership is.
    totalCostUsd, totalCostInr: toInr(totalCostUsd), calls: bucket.calls,
    registeredCostUsd, registeredCostInr: toInr(registeredCostUsd), registeredCalls: bucket.registeredCalls,
    unregisteredCostUsd, unregisteredCostInr: toInr(unregisteredCostUsd), unregisteredCalls: bucket.unregisteredCalls,
    unregisteredCompanyCount: bucket.unregisteredCompanies.size,
    byCompany: Object.entries(bucket.byCompany)
      .map(([companyId, v]) => {
        const costUsd = round(v.costUsd);
        return { companyId, calls: v.calls, costUsd, costInr: toInr(costUsd), registered: v.registered };
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
  return {
    totalTokens: 0, calls: 0,
    registeredTokens: 0, registeredCalls: 0,
    unregisteredTokens: 0, unregisteredCalls: 0,
    unregisteredCompanies: new Set(),
    byCompany: {}, byInputType: {},
  };
}

function addToEmbedBucket(bucket, item, isRegistered) {
  const tokens = item.tokens || 0;
  bucket.totalTokens += tokens;
  bucket.calls += 1;

  if (isRegistered) {
    bucket.registeredTokens += tokens;
    bucket.registeredCalls += 1;
  } else {
    bucket.unregisteredTokens += tokens;
    bucket.unregisteredCalls += 1;
    bucket.unregisteredCompanies.add(item.companyId || '(unknown)');
  }

  const company = item.companyId || '(unknown)';
  bucket.byCompany[company] = bucket.byCompany[company] || { tokens: 0, calls: 0, registered: isRegistered };
  bucket.byCompany[company].tokens += tokens;
  bucket.byCompany[company].calls += 1;

  const inputType = item.inputType || '(unknown)'; // closest analog to "useCase" this entity has
  bucket.byInputType[inputType] = bucket.byInputType[inputType] || { tokens: 0, calls: 0 };
  bucket.byInputType[inputType].tokens += tokens;
  bucket.byInputType[inputType].calls += 1;
}

function finalizeEmbedBucket(bucket) {
  const estimatedCostUsd = round((bucket.totalTokens / 1e6) * VOYAGE_EMBED_USD_PER_MILLION_TOKENS);
  const registeredEstimatedCostUsd = round((bucket.registeredTokens / 1e6) * VOYAGE_EMBED_USD_PER_MILLION_TOKENS);
  const unregisteredEstimatedCostUsd = round((bucket.unregisteredTokens / 1e6) * VOYAGE_EMBED_USD_PER_MILLION_TOKENS);
  return {
    totalTokens: bucket.totalTokens,
    estimatedCostUsd,
    estimatedCostInr: toInr(estimatedCostUsd),
    calls: bucket.calls,
    registeredTokens: bucket.registeredTokens,
    registeredEstimatedCostUsd, registeredEstimatedCostInr: toInr(registeredEstimatedCostUsd), registeredCalls: bucket.registeredCalls,
    unregisteredTokens: bucket.unregisteredTokens,
    unregisteredEstimatedCostUsd, unregisteredEstimatedCostInr: toInr(unregisteredEstimatedCostUsd), unregisteredCalls: bucket.unregisteredCalls,
    unregisteredCompanyCount: bucket.unregisteredCompanies.size,
    byCompany: Object.entries(bucket.byCompany)
      .map(([companyId, v]) => ({ companyId, tokens: v.tokens, calls: v.calls, registered: v.registered }))
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

  const registeredCompanyIds = await getRegisteredCompanyIds();

  const aiBuckets = { production: emptyAiBucket(), admin_test: emptyAiBucket(), untagged: emptyAiBucket() };
  for (const item of aiItems) {
    addToAiBucket(aiBuckets[bucketKey(item)], item, registeredCompanyIds.has(item.companyId));
  }

  const embedBucket = emptyEmbedBucket();
  for (const item of embedItems) {
    addToEmbedBucket(embedBucket, item, registeredCompanyIds.has(item.companyId));
  }

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
  const totalAiCostUsd = round(aiItems.reduce((sum, it) => sum + effectiveCost(it), 0));
  const totalEmbedTokens = embedItems.reduce((sum, it) => sum + (it.tokens || 0), 0);
  const estimatedEmbedCostUsd = round((totalEmbedTokens / 1e6) * VOYAGE_EMBED_USD_PER_MILLION_TOKENS);

  return {
    entityId,
    usdToInrRate: USD_TO_INR_RATE,
    aiUsage: sortedAi.map((it) => {
      const costUsd = round(effectiveCost(it));
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
  effectiveCost,
  USD_TO_INR_RATE,
  VOYAGE_EMBED_USD_PER_MILLION_TOKENS,
};
