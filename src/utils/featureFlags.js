'use strict';

const dynamodb = require('../config/dynamodb');
const logger   = require('../config/logger');

function table() { return process.env.DYNAMODB_TABLE_METRICS; }

/**
 * Feature flag system for APForce V2.
 *
 * Flags are stored in DynamoDB at two levels:
 *   Global:  PK=CONFIG#FLAGS#global    / SK=FLAGS  — applies to all companies
 *   Company: PK=CONFIG#FLAGS#${companyId} / SK=FLAGS  — overrides global per company
 *
 * Precedence (highest wins): company > global > DEFAULTS
 *
 * Flags are cached in-process for 60 s to avoid a DDB round-trip on every
 * inbound request. Call _clearCache() in tests to reset between cases.
 *
 * To enable a flag for all companies (no redeploy needed):
 *   aws dynamodb put-item --table-name <TABLE> \
 *     --item '{"PK":{"S":"CONFIG#FLAGS#global"},"SK":{"S":"FLAGS"},
 *              "flags":{"M":{"contact_hub":{"BOOL":true}}}}'
 */

const DEFAULTS = Object.freeze({
  contact_hub:          false,  // Phase 2 — Contact 360 / unified timeline view
  ai_classification:    false,  // Phase 3 — AI intent & sentiment classification
  workflow_builder:     false,  // Phase 2 — Visual no-code workflow editor
  multi_pipeline:       false,  // Phase 2 — Multiple CRM pipelines per company
  broadcast_campaigns:  false,  // Phase 2 — WhatsApp broadcast campaign flows
  conversation_v2_ui:   false,  // Phase 2 — V2 conversation pane (CONV# entity)
  lead_timeline:        false,  // Phase 2 — Lead activity timeline sidebar
  bot_handoff:          false,  // Phase 3 — AI/bot handoff state machine UI
});

const _cache = new Map(); // companyId → { flags, expiresAt }
const CACHE_TTL_MS = 60_000;

async function getFlags(companyId) {
  const key = companyId ?? 'global';
  const now  = Date.now();
  const hit  = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.flags;

  try {
    const [globalRes, companyRes] = await Promise.all([
      dynamodb.get({ TableName: table(), Key: { PK: 'CONFIG#FLAGS#global', SK: 'FLAGS' } }).promise(),
      companyId
        ? dynamodb.get({ TableName: table(), Key: { PK: `CONFIG#FLAGS#${companyId}`, SK: 'FLAGS' } }).promise()
        : Promise.resolve({}),
    ]);

    const flags = {
      ...DEFAULTS,
      ...(globalRes.Item?.flags  ?? {}),
      ...(companyRes.Item?.flags ?? {}),
    };

    _cache.set(key, { flags, expiresAt: now + CACHE_TTL_MS });
    return flags;
  } catch (err) {
    logger.warn(`featureFlags.getFlags [${key}]: ${err.message}`);
    return { ...DEFAULTS };
  }
}

async function isEnabled(companyId, flagName) {
  const flags = await getFlags(companyId);
  return flags[flagName] ?? false;
}

function _clearCache() { _cache.clear(); }

module.exports = { getFlags, isEnabled, DEFAULTS, _clearCache };
