'use strict';
// Sweeps every company's open leads and recomputes priorityScore/priorityTier.
// Invoked on every 5-minute EventBridge tick (src/handler.js) alongside
// runDueCampaigns(), but self-throttles to ~60 minutes via a single global
// cursor record — deliberately reusing the existing rule rather than a second
// EventBridge rule, so this needs zero new AWS provisioning.
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const PipelineService = require('./PipelineService');
const { computeScore, isClosedLead } = require('./LeadScoringService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const CURSOR_KEY = { PK: 'CONFIG#LEADSCORING#GLOBAL', SK: 'CURRENT' };
const RECOMPUTE_INTERVAL_MS = 60 * 60 * 1000;

// Bounds how many leads get scored+written concurrently in one sweep. Cheap
// single-item DynamoDB updates (unlike CampaignScheduler's fan-out sends), so
// this can run a larger batch than CampaignScheduler's own BATCH_SIZE=5.
const BATCH_SIZE = 25;

function _chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function _dueForRecompute() {
  const cursor = await dynamodb.get({ TableName: TABLE, Key: CURSOR_KEY }).promise();
  const lastRunAt = cursor.Item?.lastRunAt;
  if (!lastRunAt) return true;
  return Date.now() - new Date(lastRunAt).getTime() >= RECOMPUTE_INTERVAL_MS;
}

async function _setCursor() {
  await dynamodb.put({
    TableName: TABLE,
    Item: { ...CURSOR_KEY, lastRunAt: new Date().toISOString() },
  }).promise();
}

/**
 * Sweeps every company's open leads and recomputes priorityScore/priorityTier.
 * No-ops (returns { skipped: true }) unless ~60 minutes have passed since the
 * last real sweep — checked on every 5-minute EventBridge tick, so most
 * invocations are near-free no-ops and roughly one in twelve does real work.
 */
async function runDueLeadScoring() {
  if (!(await _dueForRecompute())) {
    return { skipped: true };
  }

  const startTime = Date.now();

  // TODO(ADR-014-style interim tradeoff): this Scan finds open leads across
  // all companies the same way CampaignScheduler.js's own Scan finds due
  // campaigns — migrate to a GSI-based Query when lead volume justifies it.
  // Keep the ProjectionExpression narrow — only what the scoring formula
  // needs, never full items.
  const items = [];
  let lastKey;
  do {
    const scan = await dynamodb.scan({
      TableName: TABLE,
      ProjectionExpression: 'PK, SK, companyId, #st, intent, confidence, lastInboundAt, lastMessageAt, closureDeadline, expectedValue, wonAt',
      FilterExpression: 'begins_with(PK, :lead) AND SK = :meta AND attribute_not_exists(deletedAt)',
      ExpressionAttributeNames: { '#st': 'stage' },
      ExpressionAttributeValues: { ':lead': 'LEAD#', ':meta': 'METADATA' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(scan.Items ?? []));
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  const scannedCount = items.length;
  const openLeads = items.filter((l) => !isClosedLead(l));
  const eligibleCount = openLeads.length;
  let scoredCount = 0;
  let failedCount = 0;

  // One pipeline fetch per company per sweep, never once per lead. Caches the
  // in-flight PROMISE itself (not its resolved value) — concurrent leads in
  // the same company's batch call this before the first fetch has resolved,
  // so caching only after awaiting would let every one of them race past the
  // `.has()` check and each fire its own redundant fetch.
  const stagesByCompany = new Map();
  function _stagesFor(companyId) {
    if (!stagesByCompany.has(companyId)) {
      stagesByCompany.set(companyId, PipelineService.getPipelineStages(companyId));
    }
    return stagesByCompany.get(companyId);
  }

  for (const batch of _chunk(openLeads, BATCH_SIZE)) {
    await Promise.allSettled(batch.map(async (lead) => {
      try {
        const stages = await _stagesFor(lead.companyId);
        const { priorityScore, priorityTier, priorityScoreBreakdown } = computeScore(lead, stages);
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: lead.PK, SK: lead.SK },
          UpdateExpression: 'SET priorityScore = :ps, priorityTier = :pt, priorityScoreBreakdown = :pb, priorityScoreUpdatedAt = :ua',
          ExpressionAttributeValues: {
            ':ps': priorityScore, ':pt': priorityTier, ':pb': priorityScoreBreakdown, ':ua': new Date().toISOString(),
          },
        }).promise();
        scoredCount++;
      } catch (e) {
        failedCount++;
        logger.error(`lead scoring failed for ${lead.PK}: ${e.message}`);
      }
    }));
  }

  await _setCursor();

  const executionTime = Date.now() - startTime;
  logger.info(
    `lead scoring sweep: scannedCount=${scannedCount} eligibleCount=${eligibleCount} scoredCount=${scoredCount} `
    + `failedCount=${failedCount} executionTime=${executionTime}ms`,
  );

  return { scannedCount, eligibleCount, scoredCount, failedCount, executionTime };
}

module.exports = { runDueLeadScoring };
