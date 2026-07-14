'use strict';

/**
 * ApiKeyService — Public API key lifecycle
 * ═══════════════════════════════════════════════
 *
 * Owns generation, verification, listing and revocation of the long-lived,
 * server-to-server API keys that authenticate the public form-submission
 * endpoint (src/routes/public.js). See docs/PUBLIC_API.md and the
 * APForce_Public_API_Spec (sections 5.1, 7).
 *
 * Security contract (spec §7):
 *   - The full raw key is returned exactly ONCE, at generation. Only its
 *     SHA-256 hash is ever stored. The raw key is never persisted or logged.
 *   - Verification is timing-safe (crypto.timingSafeEqual over fixed-length
 *     SHA-256 buffers), never a plain === on the secret.
 *   - companyId is derived from the key record, never from any caller input —
 *     the middleware (apiKeyAuth.js) sets req.company from verify()'s result.
 *
 * Data model (spec §5.1, all on the shared METRICS table):
 *   Main record  PK: CONFIG#APIKEY#{companyId}          SK: KEY#{keyId}
 *   Lookup item  PK: CONFIG#APIKEY#LOOKUP#{keyHash}     SK: LOOKUP
 *
 * The lookup item is a poor-man's index: verify() knows only the raw key, not
 * the companyId, so it hashes the key and does an O(1) GetItem on the lookup
 * partition to resolve {companyId, keyId} — avoiding a full-table Scan of the
 * shared METRICS table on every public request (which holds every lead,
 * conversation and timeline item). Both records are written atomically via
 * TransactWrite so a key can never exist in one without the other.
 */

const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');
const dynamodb = require('../config/dynamodb');
const logger   = require('../config/logger');

const TABLE     = () => process.env.DYNAMODB_TABLE_METRICS;
const KEY_PREFIX = 'apf_live_';
const KEY_BYTES  = 32;              // spec §Commit 1: "random 32-byte key"
const PREFIX_LEN = KEY_PREFIX.length + 4; // "apf_live_" + 4 chars, e.g. "apf_live_Xy3k"

// ── Key builders (kept local, same convention as automations.js's autoPK/autoSK) ──
const mainPK   = (companyId) => `CONFIG#APIKEY#${companyId}`;
const keySK    = (keyId)     => `KEY#${keyId}`;
const lookupPK = (keyHash)   => `CONFIG#APIKEY#LOOKUP#${keyHash}`;
const LOOKUP_SK = 'LOOKUP';

function _hash(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// ── Generate ────────────────────────────────────────────────────────────────
/**
 * Create a new API key for a company. Returns the FULL raw key exactly once —
 * the caller (routes/apiKeys.js) surfaces it to the admin a single time and it
 * can never be retrieved again.
 *
 * @param {string} companyId
 * @param {string} name       admin-supplied label, e.g. "Landing page — Insta funnel"
 * @param {string} createdBy  admin's employee id
 * @returns {Promise<{ rawKey, keyId, keyPrefix, name, createdAt }>}
 */
async function generate(companyId, name, createdBy) {
  if (!companyId) throw new Error('[ApiKeyService] companyId is required');
  const rawKey    = KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString('hex');
  const keyHash   = _hash(rawKey);
  const keyId     = uuidv4();
  const keyPrefix = rawKey.slice(0, PREFIX_LEN);
  const createdAt = new Date().toISOString();

  const mainItem = {
    PK: mainPK(companyId), SK: keySK(keyId),
    keyId, companyId,
    keyHash, keyPrefix,
    name:       String(name ?? '').trim() || 'Untitled key',
    createdBy:  createdBy ?? null,
    createdAt,
    lastUsedAt: null,
    status:     'active',
  };
  const lookupItem = {
    PK: lookupPK(keyHash), SK: LOOKUP_SK,
    keyId, companyId, status: 'active',
  };

  await dynamodb.transactWrite({
    TransactItems: [
      { Put: { TableName: TABLE(), Item: mainItem,   ConditionExpression: 'attribute_not_exists(PK)' } },
      { Put: { TableName: TABLE(), Item: lookupItem, ConditionExpression: 'attribute_not_exists(PK)' } },
    ],
  }).promise();

  logger.info(`[ApiKeyService] generated key ${keyPrefix}… (keyId=${keyId}) for company ${companyId}`);
  // rawKey is returned but NEVER logged.
  return { rawKey, keyId, keyPrefix, name: mainItem.name, createdAt };
}

// ── Verify ──────────────────────────────────────────────────────────────────
/**
 * Resolve a raw key to its owning company, or null if the key is
 * missing/malformed/unknown/revoked.
 *
 * @param {string} rawKey  value of the X-API-Key header
 * @returns {Promise<{ companyId, keyId } | null>}
 */
async function verify(rawKey) {
  try {
    if (typeof rawKey !== 'string' || !rawKey.startsWith(KEY_PREFIX)) return null;

    const keyHash = _hash(rawKey);

    // O(1) lookup by hash — no companyId needed, no Scan.
    const lookup = await dynamodb.get({
      TableName: TABLE(), Key: { PK: lookupPK(keyHash), SK: LOOKUP_SK },
    }).promise();
    if (!lookup.Item || lookup.Item.status !== 'active') return null;

    const { companyId, keyId } = lookup.Item;
    const rec = await dynamodb.get({
      TableName: TABLE(), Key: { PK: mainPK(companyId), SK: keySK(keyId) },
    }).promise();
    if (!rec.Item || rec.Item.status !== 'active') return null;

    // Timing-safe comparison (spec §7) — never a plain === on the secret's hash.
    // The lookup already matched by hash, but this is the explicit, constant-time
    // compare the security contract requires; both sides are fixed-length SHA-256
    // hex (32 bytes), so timingSafeEqual's equal-length precondition always holds.
    const computed = Buffer.from(keyHash, 'hex');
    const stored   = Buffer.from(String(rec.Item.keyHash ?? ''), 'hex');
    if (computed.length !== stored.length || !crypto.timingSafeEqual(computed, stored)) return null;

    // lastUsedAt is best-effort, for the admin's own visibility — never blocks auth.
    _touchLastUsed(companyId, keyId).catch((e) =>
      logger.warn(`[ApiKeyService] lastUsedAt update failed for ${keyId}: ${e.message}`));

    return { companyId, keyId };
  } catch (err) {
    // Fail closed — a lookup error must never authenticate a request.
    logger.error('[ApiKeyService] verify error', err);
    return null;
  }
}

async function _touchLastUsed(companyId, keyId) {
  await dynamodb.update({
    TableName: TABLE(),
    Key: { PK: mainPK(companyId), SK: keySK(keyId) },
    UpdateExpression: 'SET lastUsedAt = :now',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  }).promise();
}

// ── List ──────────────────────────────────────────────────────────────────
/**
 * List a company's keys for the admin UI. Never returns keyHash — only the
 * prefix, name, timestamps and status.
 */
async function list(companyId) {
  const r = await dynamodb.query({
    TableName: TABLE(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': mainPK(companyId), ':sk': 'KEY#' },
  }).promise();
  return (r.Items ?? [])
    .map((it) => ({
      keyId:      it.keyId,
      keyPrefix:  it.keyPrefix,
      name:       it.name,
      createdBy:  it.createdBy ?? null,
      createdAt:  it.createdAt,
      lastUsedAt: it.lastUsedAt ?? null,
      status:     it.status,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ── Revoke ──────────────────────────────────────────────────────────────────
/**
 * Revoke a key: flips status to 'revoked' on BOTH the main record and its
 * lookup item, atomically, so verify() fails immediately. Idempotent — a
 * second revoke of an already-revoked/missing key returns false without error.
 *
 * @returns {Promise<boolean>} true if a key was revoked, false if not found
 */
async function revoke(companyId, keyId) {
  const rec = await dynamodb.get({
    TableName: TABLE(), Key: { PK: mainPK(companyId), SK: keySK(keyId) },
  }).promise();
  if (!rec.Item) return false;

  const now = new Date().toISOString();
  await dynamodb.transactWrite({
    TransactItems: [
      {
        Update: {
          TableName: TABLE(), Key: { PK: mainPK(companyId), SK: keySK(keyId) },
          UpdateExpression: 'SET #s = :revoked, revokedAt = :now',
          ExpressionAttributeNames:  { '#s': 'status' },
          ExpressionAttributeValues: { ':revoked': 'revoked', ':now': now },
        },
      },
      {
        Update: {
          TableName: TABLE(), Key: { PK: lookupPK(rec.Item.keyHash), SK: LOOKUP_SK },
          UpdateExpression: 'SET #s = :revoked',
          ExpressionAttributeNames:  { '#s': 'status' },
          ExpressionAttributeValues: { ':revoked': 'revoked' },
        },
      },
    ],
  }).promise();

  logger.info(`[ApiKeyService] revoked keyId=${keyId} for company ${companyId}`);
  return true;
}

module.exports = { generate, verify, list, revoke };
