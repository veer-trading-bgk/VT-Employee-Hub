'use strict';

/**
 * CustomerIdentityService — Core Platform Service
 * ═══════════════════════════════════════════════
 *
 * THE ONLY authorised path for customer identity operations in APForce.
 *
 * Responsibilities:
 *   1. Identity resolution     — phoneNorm lookup via company-phone-index GSI
 *   2. Atomic phone uniqueness — LEAD_PHONE# lock prevents concurrent duplicates
 *   3. Customer creation       — writes LEAD# METADATA + phone lock atomically
 *   4. Customer enrichment     — smart-update rules; immutability contract enforced
 *   5. Interaction recording   — fire-and-forget TL# touch_received event per call
 *   6. Idempotency             — same delivery twice → same result, no duplicate records
 *   7. Transaction safety      — DynamoDB TransactWrite; no partial state on failure
 *
 * PROHIBITED — no route, webhook, import, automation, or API may implement:
 *   duplicate detection / phone lookup / phoneNorm lookup / customer enrichment
 *   / interaction creation / touchpoint recording outside this service.
 *
 * See: docs/phase2/CUSTOMER_JOURNEY_ARCHITECTURE.md
 */

const { v4: uuidv4 }  = require('uuid');
const crypto           = require('crypto');
const dynamodb         = require('../config/dynamodb');
const logger           = require('../config/logger');
const { publishEvent } = require('../events/publisher');
const { E, ENTITY }   = require('../events/catalog');
const { to10Digit }   = require('../utils/phone');
const {
  leadPK,
  idemPK, idemSK,
  leadPhoneLockPK, leadPhoneLockSK,
  GSI,
} = require('../core/entityKeys');
const { getAutoAssignConfig, pickNextEmployee } = require('../utils/autoAssign');

// ── Private constants ─────────────────────────────────────────────────────────

const TABLE              = () => process.env.DYNAMODB_TABLE_METRICS;
const IDEM_TTL_SECONDS   = 86_400;   // 24 h — idempotency window after which locks expire
const SOURCE_HISTORY_CAP = 10;       // rolling window for leadSourceHistory on METADATA

// ── Phone normalisation ───────────────────────────────────────────────────────

function _normPhone(raw) {
  const clean = String(raw ?? '').replace(/\D/g, '');
  const norm  = to10Digit(clean);
  return { cleanPhone: clean, phoneNorm: norm };
}

// ── Interaction ID ─────────────────────────────────────────────────────────────

function _genInteractionId() {
  return `int_${uuidv4().replace(/-/g, '')}`;
}

// ── Idempotency ────────────────────────────────────────────────────────────────

/**
 * Derive a deterministic idempotency key.
 *
 * Priority:
 *   1. Caller-provided (data.idempotencyKey) — use webhook event IDs here.
 *   2. Auto-derived: SHA-256 of companyId + phoneNorm + source + campaign +
 *      a 5-minute time window. Absorbs webhook retry storms (same payload
 *      retried within 5 minutes is deduplicated without any caller effort).
 */
function _deriveIdemKey(companyId, phoneNorm, data) {
  const raw = data.idempotencyKey
    ? `explicit:${data.idempotencyKey}`
    : `auto:${companyId}|${phoneNorm}|${data.source ?? ''}|${data.campaign ?? ''}|${Math.floor(Date.now() / 300_000)}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function _buildIdemItem(companyId, idemKey, leadId, action, interactionId) {
  return {
    PK:           idemPK(companyId, idemKey),
    SK:           idemSK(),
    leadId,
    action,
    interactionId,
    resolvedAt:   new Date().toISOString(),
    ttl:          Math.floor(Date.now() / 1000) + IDEM_TTL_SECONDS,
  };
}

async function _checkIdem(companyId, idemKey) {
  const r = await dynamodb.get({
    TableName: TABLE(),
    Key: { PK: idemPK(companyId, idemKey), SK: idemSK() },
  }).promise();
  return r.Item ?? null;
}

function _toIdemResult(item) {
  return {
    existed:       item.action !== 'created',
    leadId:        item.leadId,
    action:        item.action,
    interactionId: item.interactionId,
    idempotent:    true,
  };
}

// ── Phone lookup ──────────────────────────────────────────────────────────────

async function _findByPhone(companyId, phoneNorm) {
  const r = await dynamodb.query({
    TableName:                 TABLE(),
    IndexName:                 GSI.LEAD_BY_PHONE,
    KeyConditionExpression:    'companyId = :cid AND phoneNorm = :norm',
    FilterExpression:          'SK = :meta AND attribute_not_exists(deletedAt)',
    ExpressionAttributeValues: { ':cid': companyId, ':norm': phoneNorm, ':meta': 'METADATA' },
    Limit: 1,
  }).promise();
  return r.Items?.[0] ?? null;
}

// ── Pipeline stage helper ─────────────────────────────────────────────────────

async function _getPipelineStages(companyId) {
  try {
    const r = await dynamodb.get({
      TableName: TABLE(),
      Key: { PK: `CONFIG#CRM#${companyId}`, SK: 'PIPELINE' },
    }).promise();
    return r.Item?.stages ?? [];
  } catch { return []; }
}

// ── Interaction recording ─────────────────────────────────────────────────────

function _buildSummary(data, isFirstTouch) {
  if (isFirstTouch) {
    const via  = data.campaign ? ` via ${data.campaign}` : '';
    const from = data.source   ? ` (${data.source.replace(/_/g, ' ')})` : '';
    return `First contact${via}${from}`.trim();
  }
  if (data.campaign) return `Returned via ${data.campaign}`;
  if (data.source)   return `Returned from ${data.source.replace(/_/g, ' ')}`;
  return 'Returned';
}

// Fires TL# write via publishEvent — non-blocking, fire-and-forget, never throws.
function _recordInteraction(companyId, leadId, data, context, isFirstTouch, touchNumber, interactionId) {
  publishEvent(E.TOUCH_RECEIVED, {
    companyId,
    entityType: ENTITY.LEAD,
    entityId:   leadId,
    actorId:    context.actorId   ?? null,
    actorName:  context.actorName ?? null,
    channel:    data.source       ?? null,
    summary:    _buildSummary(data, isFirstTouch),
    metadata: {
      interactionId,
      source:         data.source          ?? null,
      campaign:       data.campaign        ?? null,
      medium:         data.medium          ?? null,
      landingPage:    data.landingPage     ?? null,
      product:        data.product         ?? null,
      tagsAdded:      data.tags            ?? [],
      interestsAdded: data.productInterest ?? [],
      createdBy:      context.createdBy    ?? null,
      isFirstTouch,
      touchNumber,
      formId:         data.formId          ?? null,
      ...(data.metadata != null && typeof data.metadata === 'object' ? data.metadata : {}),
    },
  });
}

// ── computeDelta — exported for CSV import (Phase E) and unit tests ───────────

/**
 * Compute the minimum field delta to apply to an existing customer.
 *
 * Immutability contract:
 *   Protected (never in delta): assignedTo, stage, notes, closureDeadline, tags removal
 *   Smart-update:  name (placeholder only), email (null only), company (null only)
 *   Additive:      tags, productInterest — union only, never removed
 *   Always-update: lastInteractionAt, lastInteractionSource, updatedAt, leadSourceHistory
 *
 * @param {object} existing  Current LEAD# METADATA item from DynamoDB
 * @param {object} incoming  Caller data (phone already normalised, tags pre-resolved)
 * @returns {object}         Delta — only fields that need to change
 */
function computeDelta(existing, incoming) {
  const delta = {};
  const now   = new Date().toISOString();

  // ── Smart update: name ───────────────────────────────────────────────────
  // Replace only if the current name is a phone-number placeholder or empty.
  const existingName  = (existing.name ?? '').trim();
  const isPlaceholder = !existingName
    || existingName === existing.phone
    || existingName === existing.phoneNorm;
  if (isPlaceholder && incoming.name?.trim()) {
    delta.name = incoming.name.trim();
  }

  // ── Smart update: email — first real value wins ──────────────────────────
  if (!existing.email && incoming.email?.trim()) {
    delta.email = incoming.email.trim();
  }

  // ── Smart update: company — first real value wins ────────────────────────
  if (!existing.company && incoming.company?.trim()) {
    delta.company = incoming.company.trim();
  }

  // ── Additive: tags — union only, never remove ────────────────────────────
  const existingTags = new Set(existing.tags ?? []);
  const newTags      = (incoming.tags ?? []).filter((t) => t && !existingTags.has(t));
  if (newTags.length > 0) {
    delta.tags = [...(existing.tags ?? []), ...newTags];
  }

  // ── Additive: productInterest — union only ────────────────────────────────
  const existingInterests = new Set(existing.productInterest ?? []);
  const newInterests      = (incoming.productInterest ?? []).filter((i) => i && !existingInterests.has(i));
  if (newInterests.length > 0) {
    delta.productInterest = [...(existing.productInterest ?? []), ...newInterests];
  }

  // ── Append to leadSourceHistory — compact, rolling window ─────────────────
  delta.leadSourceHistory = [
    ...(existing.leadSourceHistory ?? []),
    {
      source:       incoming.source    ?? 'unknown',
      campaign:     incoming.campaign  ?? null,
      medium:       incoming.medium    ?? null,
      touchedAt:    now,
      isFirstTouch: false,
    },
  ].slice(-SOURCE_HISTORY_CAP);

  // ── Always-update fields ──────────────────────────────────────────────────
  delta.lastInteractionAt     = now;
  delta.lastInteractionSource = incoming.source ?? null;
  delta.updatedAt             = now;

  return delta;
}

// ── Customer enrichment ───────────────────────────────────────────────────────

async function _enrichCustomer(companyId, existing, data, context, idemKey, interactionId) {
  const lid     = existing.leadId;
  const PK      = leadPK(companyId, lid);
  const delta   = computeDelta(existing, data);
  const iemItem = _buildIdemItem(companyId, idemKey, lid, 'enriched', interactionId);

  // Build UpdateExpression from delta. touchCount atomically incremented via ADD.
  const setKeys   = Object.keys(delta);
  const setClause = `SET ${setKeys.map((k) => `#${k} = :${k}`).join(', ')}`;
  const addClause = 'ADD touchCount :one';

  const attrNames  = Object.fromEntries(setKeys.map((k) => [`#${k}`, k]));
  const attrValues = {
    ...Object.fromEntries(Object.entries(delta).map(([k, v]) => [`:${k}`, v])),
    ':one': 1,
  };

  try {
    await dynamodb.transactWrite({
      TransactItems: [
        {
          // Slot 0 — update customer; guard against concurrent soft-delete
          Update: {
            TableName:                 TABLE(),
            Key:                       { PK, SK: 'METADATA' },
            UpdateExpression:          `${setClause} ${addClause}`,
            ConditionExpression:       'attribute_exists(PK) AND attribute_not_exists(deletedAt)',
            ExpressionAttributeNames:  attrNames,
            ExpressionAttributeValues: attrValues,
          },
        },
        {
          // Slot 1 — write idempotency lock; fails if duplicate delivery already landed
          Put: {
            TableName:           TABLE(),
            Item:                iemItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }).promise();
  } catch (err) {
    if (err.code === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons ?? [];

      // Slot 1: idem lock already exists → duplicate delivery, return cached result
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        const cached = await _checkIdem(companyId, idemKey);
        if (cached) {
          logger.info(`[CIS] idempotent enrich leadId=${lid}`);
          return _toIdemResult(cached);
        }
      }

      // Slot 0: customer deleted concurrently between GSI lookup and TransactWrite
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        throw Object.assign(
          new Error(`[CIS] customer ${lid} was deleted during enrichment`),
          { code: 'CUSTOMER_DELETED' },
        );
      }
    }
    throw err;
  }

  // touchNumber is approximate (existing value +1); actual value is in the ADD result
  const touchNumber = (existing.touchCount ?? 1) + 1;
  _recordInteraction(companyId, lid, data, context, false, touchNumber, interactionId);

  logger.info(`[CIS] enriched leadId=${lid} source=${data.source ?? '?'}`);
  return { existed: true, leadId: lid, action: 'enriched', interactionId };
}

// ── Customer creation ─────────────────────────────────────────────────────────

async function _createCustomer(companyId, phoneNorm, data, context, idemKey, interactionId) {
  const lid = uuidv4();
  const PK  = leadPK(companyId, lid);
  const now = new Date().toISOString();

  const stages       = await _getPipelineStages(companyId);
  const defaultStage = data.stage ?? stages[0]?.key ?? 'new_lead';

  // Auto-assign if no explicit assignee provided by caller
  let assignedTo      = data.assignedTo    ?? null;
  let assignedName    = data.assignedToName ?? null;
  let wasAutoAssigned = false;
  if (!assignedTo) {
    try {
      const cfg = await getAutoAssignConfig(companyId);
      if (cfg?.enabled) {
        const picked = await pickNextEmployee(companyId, data.source ?? 'crm', cfg);
        if (picked) { assignedTo = picked.id; assignedName = picked.name ?? null; wasAutoAssigned = true; }
      }
    } catch (e) { logger.warn(`[CIS] auto-assign error: ${e.message}`); }
    // Final fallback: assign to the triggering actor
    if (!assignedTo && context.actorId) {
      assignedTo   = context.actorId;
      assignedName = context.actorName ?? null;
    }
  }

  const name = data.name?.trim() || data.phone || phoneNorm;

  const leadItem = {
    PK, SK: 'METADATA',
    leadId: lid, companyId,
    name, phone: data.phone, phoneNorm,
    email:                 data.email?.trim()      ?? null,
    company:               data.company?.trim()    ?? null,
    productInterest:       data.productInterest    ?? [],
    source:                data.source             ?? 'unknown',
    notes:                 data.notes?.trim()      ?? '',
    stage:                 defaultStage,
    tags:                  data.tags               ?? [],
    closureDeadline:       null,
    assignedTo,
    assignedToName:        assignedName,
    autoAssigned:          wasAutoAssigned,
    createdBy:             context.createdBy       ?? null,
    createdAt:             now,
    updatedAt:             now,
    convertedAt:           null,
    formId:                data.formId             ?? null,
    // Customer journey fields
    touchCount:            1,
    lastInteractionAt:     now,
    lastInteractionSource: data.source             ?? null,
    leadSourceHistory: [{
      source:       data.source    ?? 'unknown',
      campaign:     data.campaign  ?? null,
      medium:       data.medium    ?? null,
      touchedAt:    now,
      isFirstTouch: true,
    }],
    // Reserved for future phases — set null now for predictable item shape
    contactId:             null,
    primaryConversationId: null,
    pipelineId:            null,
    productId:             null,
    expectedValue:         null,
    probability:           null,
    wonAt:                 null,
    lostReason:            null,
    customerJourney:       null,
    ownerHistory:          [],
  };

  const phoneLockItem = {
    PK:        leadPhoneLockPK(companyId, phoneNorm),
    SK:        leadPhoneLockSK(),
    leadId:    lid,
    companyId,
    createdAt: now,
  };

  const iemItem = _buildIdemItem(companyId, idemKey, lid, 'created', interactionId);

  try {
    await dynamodb.transactWrite({
      TransactItems: [
        {
          // Slot 0 — write customer record (UUID PK is unique by construction)
          Put: {
            TableName:           TABLE(),
            Item:                leadItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          // Slot 1 — atomic phone uniqueness lock; fails if another concurrent create won
          Put: {
            TableName:           TABLE(),
            Item:                phoneLockItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          // Slot 2 — idempotency lock; fails if duplicate delivery already landed
          Put: {
            TableName:           TABLE(),
            Item:                iemItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }).promise();
  } catch (err) {
    if (err.code === 'TransactionCanceledException') {
      const reasons = err.CancellationReasons ?? [];

      // Slot 2: duplicate delivery → return cached result, no side effects
      if (reasons[2]?.Code === 'ConditionalCheckFailed') {
        const cached = await _checkIdem(companyId, idemKey);
        if (cached) {
          logger.info(`[CIS] idempotent create phoneNorm=${phoneNorm}`);
          return _toIdemResult(cached);
        }
      }

      // Slot 1: phone lock claimed by a concurrent create that won the race.
      // Re-resolve: find the winner and enrich with our data instead.
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        logger.warn(`[CIS] concurrent create race phoneNorm=${phoneNorm} — re-resolving as enrich`);
        const winner = await _findByPhone(companyId, phoneNorm);
        if (winner) return _enrichCustomer(companyId, winner, data, context, idemKey, interactionId);
      }
    }
    throw err;
  }

  _recordInteraction(companyId, lid, data, context, true, 1, interactionId);

  logger.info(`[CIS] created leadId=${lid} phoneNorm=${phoneNorm} source=${data.source ?? '?'}`);
  return { existed: false, leadId: lid, action: 'created', interactionId, lead: leadItem };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * resolveOrCreate — THE entry point for all customer identity operations.
 *
 * @param {string} companyId     required
 * @param {object} data
 *   phone            {string}   required — any format; normalised internally via to10Digit()
 *   name             {string}   smart-update if existing name is a placeholder
 *   email            {string}   set if null on existing customer
 *   company          {string}   set if null on existing customer
 *   source           {string}   channel: web_form | meta_lead_ads | whatsapp | csv | manual | api
 *   campaign         {string}   UTM campaign / ad set name
 *   medium           {string}   UTM medium: organic | paid_social | email | whatsapp | referral
 *   landingPage      {string}   referring URL
 *   product          {string}   primary product interest (stored on interaction)
 *   tags             {string[]} pre-resolved tag IDs — additive union; resolve before calling
 *   productInterest  {string[]} product interest IDs — additive union
 *   notes            {string}   for new customers only; ignored on enrichment
 *   stage            {string}   for new customers only; ignored on enrichment
 *   assignedTo       {string}   for new customers only; ignored on enrichment
 *   assignedToName   {string}   for new customers only; ignored on enrichment
 *   formId           {string}   stored on interaction metadata
 *   idempotencyKey   {string}   caller-provided key; use webhook event IDs here
 *   metadata         {object}   arbitrary KV merged into interaction metadata
 * @param {object} context
 *   createdBy        {string}   required — actor: userId | 'form_submit' | 'webhook' | 'csv'
 *   actorId          {string}   userId for timeline attribution
 *   actorName        {string}   display name for timeline
 *
 * @returns {Promise<{
 *   existed:       boolean,             true if an existing customer was found
 *   leadId:        string,              system identity (leadId)
 *   action:        'created'|'enriched',
 *   interactionId: string,              unique ID for this touch (int_<uuid>)
 *   idempotent?:   true,               present only on idempotent re-delivery
 *   lead?:         object,             present only when action === 'created'
 * }>}
 */
async function resolveOrCreate(companyId, data, context) {
  if (!companyId)          throw new Error('[CIS] companyId is required');
  if (!data?.phone)        throw new Error('[CIS] data.phone is required');
  if (!context?.createdBy) throw new Error('[CIS] context.createdBy is required');

  const { cleanPhone, phoneNorm } = _normPhone(data.phone);
  if (!phoneNorm) throw new Error('[CIS] phone could not be normalised to a valid 10-digit number');

  const idemKey       = _deriveIdemKey(companyId, phoneNorm, data);
  const interactionId = _genInteractionId();

  // ── Fast path: idempotency check ──────────────────────────────────────────
  const cached = await _checkIdem(companyId, idemKey);
  if (cached) {
    logger.info(`[CIS] idempotent hit idemKey=${idemKey.slice(0, 8)}…`);
    return _toIdemResult(cached);
  }

  // ── Identity resolution ───────────────────────────────────────────────────
  const normalized = { ...data, phone: cleanPhone };
  const existing   = await _findByPhone(companyId, phoneNorm);

  if (existing) {
    return _enrichCustomer(companyId, existing, normalized, context, idemKey, interactionId);
  }
  return _createCustomer(companyId, phoneNorm, normalized, context, idemKey, interactionId);
}

module.exports = {
  resolveOrCreate,
  computeDelta,   // exported for CSV enrich mode (Phase E) and unit tests
};
