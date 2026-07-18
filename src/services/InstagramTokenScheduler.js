'use strict';
// Refreshes every company's Instagram long-lived (60-day) access token
// before it expires — a requirement with no WhatsApp analog (Tech-Provider-
// issued WABA tokens don't carry this same rotation cadence). Invoked on
// every 5-minute EventBridge tick (src/handler.js) alongside
// runDueLeadScoring()/runStageMembershipSweep(), but self-throttles to once
// daily via a single global cursor record — deliberately reusing the
// existing rule rather than a second EventBridge rule, same reasoning as
// LeadScoringScheduler.js, so this needs zero new AWS provisioning.
const axios = require('axios');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { igConfigPK, igConfigSK } = require('../core/entityKeys');
const igGraphApiHelpers = require('./igGraphApiHelpers');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const CURSOR_KEY = { PK: 'CONFIG#IGTOKENREFRESH#GLOBAL', SK: 'CURRENT' };
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once daily — 60-day tokens give enormous safety margin
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // refresh anything expiring within 7 days
const IG_REFRESH_URL = 'https://graph.instagram.com/refresh_access_token';

async function _dueForSweep() {
  const cursor = await dynamodb.get({ TableName: TABLE, Key: CURSOR_KEY }).promise();
  const lastRunAt = cursor.Item?.lastRunAt;
  if (!lastRunAt) return true;
  return Date.now() - new Date(lastRunAt).getTime() >= SWEEP_INTERVAL_MS;
}

async function _setCursor() {
  await dynamodb.put({
    TableName: TABLE,
    Item: { ...CURSOR_KEY, lastRunAt: new Date().toISOString() },
  }).promise();
}

// Same interim-Scan philosophy ADR-014 already governs for the campaign
// due-sweep — narrow projection, this table's CONFIG#IG# item count is tiny
// (one per company with Instagram connected), revisit only if that changes
// at real scale.
async function _findExpiringConfigs() {
  const items = [];
  let lastKey;
  do {
    const scan = await dynamodb.scan({
      TableName: TABLE,
      ProjectionExpression: 'PK, SK, companyId, tokenExpiresAt',
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
      ExpressionAttributeValues: { ':prefix': 'CONFIG#IG#', ':sk': 'CURRENT' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(scan.Items ?? []));
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  const cutoff = Date.now() + REFRESH_WINDOW_MS;
  return items.filter((it) => it.tokenExpiresAt && new Date(it.tokenExpiresAt).getTime() <= cutoff);
}

async function _refreshOne(companyId) {
  const cfg = await igGraphApiHelpers.getIgConfig(companyId);
  if (!cfg?.accessToken) return { companyId, skipped: true };

  const res = await axios.get(IG_REFRESH_URL, {
    params: { grant_type: 'ig_refresh_token', access_token: cfg.accessToken },
  });
  const newToken = res.data?.access_token;
  const expiresInSeconds = res.data?.expires_in;
  if (!newToken) throw new Error('Instagram refresh_access_token returned no access_token');

  const tokenExpiresAt = new Date(Date.now() + (expiresInSeconds ?? 60 * 24 * 60 * 60) * 1000).toISOString();

  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: igConfigPK(companyId), SK: igConfigSK() },
    UpdateExpression: 'SET accessToken = :t, tokenExpiresAt = :e',
    ExpressionAttributeValues: { ':t': newToken, ':e': tokenExpiresAt },
  }).promise();
  igGraphApiHelpers.invalidateIgConfigCache(companyId);

  return { companyId, refreshed: true };
}

/**
 * Sweeps every company's Instagram token and refreshes any expiring within
 * 7 days. No-ops (returns { skipped: true }) unless ~24 hours have passed
 * since the last real sweep.
 */
async function runDueInstagramTokenRefresh() {
  if (!(await _dueForSweep())) {
    return { skipped: true };
  }

  const expiring = await _findExpiringConfigs();
  let refreshedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const item of expiring) {
    try {
      const r = await _refreshOne(item.companyId);
      // _refreshOne resolves (doesn't throw) for both a real refresh AND the
      // "config vanished between scan and refresh" case — only count the
      // former as refreshedCount, or a disconnected company would silently
      // inflate the success count.
      if (r.skipped) skippedCount++;
      else refreshedCount++;
    } catch (e) {
      failedCount++;
      // A failed refresh with days of runway left is not an emergency — logged,
      // not paged; it'll retry on tomorrow's sweep, same as a warn-level miss
      // anywhere else in the automation stack.
      logger.warn(`InstagramTokenScheduler: refresh failed for ${item.companyId}: ${e.message}`);
    }
  }

  await _setCursor();
  return { checked: expiring.length, refreshedCount, skippedCount, failedCount };
}

module.exports = { runDueInstagramTokenRefresh };
