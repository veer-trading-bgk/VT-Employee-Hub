'use strict';

/**
 * igGraphApiHelpers — Instagram-scoped sibling to graphApiHelpers.js (which
 * owns CONFIG#WABA#). A deliberately separate file, not a parameterized
 * extension of graphApiHelpers — same "sibling, not extension" doctrine used
 * throughout this session (FlowManagementService, CapiService): a different
 * config item, a different Graph API host (graph.instagram.com, not
 * graph.facebook.com), and a different credential lifecycle — Instagram
 * Login tokens are long-lived (60 days) and refreshable, unlike WhatsApp's
 * Tech-Provider-issued tokens, so a scheduled refresh sweep
 * (InstagramTokenScheduler.js) is a real requirement here with no WhatsApp
 * analog. See ADR-020.
 */

const dynamodb = require('../config/dynamodb');
const { igConfigPK, igConfigSK, igIdConfigPK, igIdConfigSK } = require('../core/entityKeys');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const IG_GRAPH = `https://graph.instagram.com/${process.env.INSTAGRAM_GRAPH_VERSION ?? 'v24.0'}`;

function resolveIgGraphUrl() {
  return IG_GRAPH;
}

async function getIgConfig(companyId) {
  const result = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: igConfigPK(companyId), SK: igConfigSK() },
  }).promise();
  return result.Item ?? null;
}

// In-process config cache — same 10-min TTL / null-cached idiom as graphApiHelpers.js.
const _cfgCache  = new Map(); // companyId → { data, ts }
const CFG_TTL_MS = 10 * 60 * 1000;

async function getCachedIgConfig(companyId) {
  const hit = _cfgCache.get(companyId);
  if (hit && Date.now() - hit.ts < CFG_TTL_MS) return hit.data;
  const data = await getIgConfig(companyId);
  _cfgCache.set(companyId, { data, ts: Date.now() });
  return data;
}

/** Call after any write to CONFIG#IG#{companyId} (connect/disconnect/token refresh). */
function invalidateIgConfigCache(companyId) {
  _cfgCache.delete(companyId);
}

// igBusinessAccountId → companyId reverse index — same 10-min in-process
// cache idiom as whatsapp.js's _phoneIdCache, for the webhook's per-request
// company resolution.
const _igIdCache = new Map(); // igBusinessAccountId → { companyId, ts }
const IGID_CACHE_TTL_MS = 10 * 60 * 1000;

async function getCompanyByIgBusinessId(igBusinessAccountId) {
  const hit = _igIdCache.get(igBusinessAccountId);
  if (hit && Date.now() - hit.ts < IGID_CACHE_TTL_MS) return hit.companyId;
  const { Item } = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: igIdConfigPK(igBusinessAccountId), SK: igIdConfigSK() },
  }).promise();
  const companyId = Item?.companyId ?? null;
  _igIdCache.set(igBusinessAccountId, { companyId, ts: Date.now() });
  return companyId;
}

module.exports = {
  IG_GRAPH,
  resolveIgGraphUrl,
  getIgConfig,
  getCachedIgConfig,
  invalidateIgConfigCache,
  getCompanyByIgBusinessId,
};
