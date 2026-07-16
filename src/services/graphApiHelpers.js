'use strict';

/**
 * graphApiHelpers — shared Meta Graph API config/URL helpers.
 *
 * Single home for logic that was previously duplicated between
 * WhatsAppSendService (_graphUrl/_getConfig) and routes/whatsapp.js
 * (getGraphUrl/getWabaConfig/detectInvalidWabaConfig). Pure extraction:
 * each caller keeps its original semantics —
 *   • getWabaConfig()       — always a fresh DynamoDB read (route semantics)
 *   • getCachedWabaConfig() — 10-min in-process cache (send-loop semantics;
 *                             prevents N uncached DDB reads in broadcast loops)
 * Both read the same CONFIG#WABA#{companyId}/CURRENT item.
 */

const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0'}`;

function resolveGraphUrl(cfg) {
  return cfg?.graphApiVersion
    ? `https://graph.facebook.com/${cfg.graphApiVersion}`
    : GRAPH;
}

async function getWabaConfig(companyId) {
  const result = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
  }).promise();
  return result.Item ?? null;
}

// In-process WABA config cache — null results are cached too (a company
// without config shouldn't trigger a DDB read per send attempt either).
// Invalidated on disconnect/reconnect via invalidateConfigCache().
const _cfgCache  = new Map(); // companyId → { data, ts }
const CFG_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getCachedWabaConfig(companyId) {
  const hit = _cfgCache.get(companyId);
  if (hit && Date.now() - hit.ts < CFG_TTL_MS) return hit.data;
  const data = await getWabaConfig(companyId);
  _cfgCache.set(companyId, { data, ts: Date.now() });
  return data;
}

/** Call when a company disconnects or reconnects WhatsApp so the cache is refreshed. */
function invalidateConfigCache(companyId) {
  _cfgCache.delete(companyId);
}

// Returns a human-readable issue string if the WABA config is structurally invalid, null if OK.
// Key sentinel: phoneNumberId === wabaId means manual-connect stored the wrong value as the WABA ID.
function detectInvalidWabaConfig(cfg) {
  if (!cfg) return null;
  if (!cfg.wabaId) return 'WABA ID is missing — reconnect via Settings → WhatsApp.';
  if (cfg.phoneNumberId && cfg.wabaId === cfg.phoneNumberId) {
    return 'WABA ID equals Phone Number ID — these must be different identifiers. Go to Settings → WhatsApp → Health Check and click "Repair Config" to auto-fix.';
  }
  return null;
}

module.exports = {
  GRAPH,
  resolveGraphUrl,
  getWabaConfig,
  getCachedWabaConfig,
  invalidateConfigCache,
  detectInvalidWabaConfig,
};
