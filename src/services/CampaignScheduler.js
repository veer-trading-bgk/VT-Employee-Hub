'use strict';
// Sweeps for campaigns whose scheduledAt has passed and launches them.
// Invoked by an EventBridge scheduled rule via src/handler.js — never reachable over HTTP.
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const campaignsRouter = require('../routes/campaigns');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// Bounds how many campaigns launch concurrently in one sweep. Each launched campaign
// already parallelizes its own sends (up to 1,000 recipients) internally, so this keeps
// a single sweep from stacking many of those fan-outs on top of each other at once.
const BATCH_SIZE = 5;

function _chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function runDueCampaigns() {
  const startTime = Date.now();
  const now = new Date().toISOString();

  // TODO(ADR-014): this Scan is an accepted interim approach for finding due campaigns
  // across all companies — migrate to a GSI-based Query when campaign volume justifies
  // it. See docs/adr/ADR-014-campaign-scheduler-scan.md for the migration trigger.
  // Do not widen this Scan's FilterExpression or drop the ProjectionExpression.
  const scan = await dynamodb.scan({
    TableName: TABLE,
    ProjectionExpression: 'PK, SK, id, companyId, createdBy, createdByName, #st, scheduledAt',
    FilterExpression: 'begins_with(SK, :sk) AND #st = :scheduled AND scheduledAt <= :now',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':sk': 'CAMP#', ':scheduled': 'scheduled', ':now': now },
  }).promise();

  const due = scan.Items ?? [];
  const scannedCount = due.length;
  let launchedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const batch of _chunk(due, BATCH_SIZE)) {
    await Promise.allSettled(batch.map(async (campaign) => {
      try {
        // launchCampaign() itself performs an atomic Scheduled/Draft -> Launching
        // conditional claim before doing any real work — that claim, not this sweep,
        // is what makes two overlapping EventBridge invocations idempotent.
        await campaignsRouter.launchCampaign(campaign.companyId, campaign.id, {
          actor: { id: campaign.createdBy ?? 'system', name: campaign.createdByName ?? 'Scheduler', role: 'admin' },
        });
        launchedCount++;
      } catch (e) {
        if (e instanceof campaignsRouter.CampaignLaunchError && e.body?.error === 'ALREADY_LAUNCHING') {
          // Another invocation (or a manual "Launch Now" click) already claimed this
          // campaign between our scan and our launch attempt — exit gracefully.
          skippedCount++;
          logger.info(`campaign ${campaign.id} already claimed by another process — skipped`);
        } else {
          failedCount++;
          logger.error(`scheduled campaign ${campaign.id} launch failed: ${e.message}`);
        }
      }
    }));
  }

  const executionTime = Date.now() - startTime;
  logger.info(
    `campaign scheduler sweep: scannedCount=${scannedCount} launchedCount=${launchedCount} `
    + `skippedCount=${skippedCount} failedCount=${failedCount} executionTime=${executionTime}ms`,
  );

  return { scannedCount, launchedCount, skippedCount, failedCount, executionTime };
}

module.exports = { runDueCampaigns };
