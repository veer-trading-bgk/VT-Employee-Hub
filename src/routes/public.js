'use strict';

/**
 * Public API — form-submission endpoint (spec §4, §8).
 * ═══════════════════════════════════════════════════════
 *
 * POST /api/public/form-submission
 *
 * The ONLY server-to-server, API-key-authenticated route in APForce. Mounted in
 * app.js with apiKeyAuth (NOT authMiddleware) — the caller is a machine (the
 * client's own landing-page backend), so there is no JWT and no user. companyId
 * comes solely from the verified key (req.company), never from the body, making
 * cross-tenant writes structurally impossible (spec §7).
 *
 * Protection layer (spec §4): per-key rate limit → payload guard → strict schema
 * → claim-first idempotency → phone validation → CIS resolve → fire the
 * 'form_submitted' automation trigger. Everything from CIS down is reused
 * unmodified (ADR-013 / ADR-012).
 */

const express  = require('express');
const { z }    = require('zod');
const dynamodb = require('../config/dynamodb');
const logger   = require('../config/logger');
const { apiKeyRateLimit } = require('../middleware/rateLimiter');
const CIS      = require('../services/CustomerIdentityService');
const { leadPK } = require('../core/entityKeys');
const { to10Digit } = require('../utils/phone');
const { logAudit } = require('../utils/audit');

const router = express.Router();
const TABLE  = () => process.env.DYNAMODB_TABLE_METRICS;

const IDEMP_TTL_SECONDS = 86_400;   // 24h auto-expire (spec §5.2)
const MAX_PAYLOAD_BYTES = 100_000;  // a real form payload is a few hundred bytes
const RATE_LIMIT        = 60;       // requests/min per key (spec §7)

// Public-route idempotency partition (spec §5.2) — distinct from CIS's own
// internal IDEM# hash lock. Here the caller's raw idempotencyKey IS the SK.
const idempKey = (companyId, idempotencyKey) => ({
  PK: `IDEMP#${companyId}`,
  SK: String(idempotencyKey),
});

// ── Request schema (spec §8.1) — .strict() rejects unknown fields outright ────
// Note: companyId is deliberately NOT accepted here — it comes only from the
// API key, so a companyId in the body can't be honored, it's simply rejected as
// an unknown field.
const submissionSchema = z.object({
  phone:          z.string().min(1),
  name:           z.string().trim().max(200).optional(),
  event:          z.literal('form_submitted').optional(), // documented; the only trigger type today
  tags:           z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  traits:         z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

// ── POST /api/public/form-submission ──────────────────────────────────────────
router.post('/form-submission', apiKeyRateLimit(RATE_LIMIT, 60_000), async (req, res, next) => {
  try {
    // Payload guard — reject oversized bodies before any work (same as the inbound webhook).
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (contentLength > MAX_PAYLOAD_BYTES) return res.status(413).json({ error: 'Payload too large' });

    // companyId is derived from the key ONLY (apiKeyAuth set req.company). Never the body.
    const companyId = req.company?.companyId;
    if (!companyId) return res.status(401).json({ error: 'Invalid API key' });

    const data = submissionSchema.parse(req.body); // ZodError → 400 via global handler

    // Phone: same to10Digit normalization CIS uses, plus a strict Indian-mobile
    // check so junk numbers never reach a WhatsApp send (spec §7 — a bad send
    // damages the shared Meta quality rating for the whole number).
    const cleanPhone = to10Digit(data.phone);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) return res.status(400).json({ error: 'Invalid phone number' });

    // ── Claim-first idempotency (spec §5.2) ──────────────────────────────────
    // Atomically claim the key BEFORE any processing — this is what actually
    // prevents a double-click / slow-network retry from firing the confirmation
    // template twice (a check-then-write-after-success would leave a race where
    // both near-simultaneous submits pass the check before either writes). On a
    // conflict we return 409. On a processing FAILURE below we release the claim
    // so a genuinely failed submission stays retryable with the same key.
    const key    = idempKey(companyId, data.idempotencyKey);
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      await dynamodb.put({
        TableName: TABLE(),
        Item: { ...key, status: 'processing', createdAt: new Date().toISOString(), ttl: nowSec + IDEMP_TTL_SECONDS },
        ConditionExpression: 'attribute_not_exists(PK)',
      }).promise();
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        return res.status(409).json({ error: 'Duplicate submission — already processed', code: 'DUPLICATE' });
      }
      throw err;
    }

    // ── Identity resolution (ADR-013 — CIS owns this, unmodified) ────────────
    let result;
    try {
      result = await CIS.resolveOrCreate(companyId, {
        phone:  cleanPhone,
        name:   data.name?.trim() || cleanPhone,
        source: 'api',
        tags:   data.tags ?? [],
        // Traits are recorded on the interaction/touch metadata for the admin's
        // visibility (CIS stays unmodified) and separately carried into the
        // automation context below so send_template can reference them.
        ...(data.traits && Object.keys(data.traits).length > 0 ? { metadata: { formTraits: data.traits } } : {}),
        // Belt-and-suspenders: CIS's own idempotency lock, in addition to the
        // route-level claim above.
        idempotencyKey: data.idempotencyKey,
      }, { createdBy: 'api' });
    } catch (cisErr) {
      // CIS failed → no lead side effect committed for THIS call. Release the
      // claim so the client can safely retry the same idempotencyKey.
      await dynamodb.delete({ TableName: TABLE(), Key: key }).promise().catch(() => {});
      throw cisErr;
    }

    // CIS committed. From here the claim is NEVER released — the lead update is
    // done, and a retry must not re-enrich or re-fire. Downstream failures are
    // logged, not fatal, and the request still reports success.
    const leadKey = { PK: leadPK(companyId, result.leadId), SK: 'METADATA' };
    let lead;
    try {
      lead = result.lead ?? (await dynamodb.get({ TableName: TABLE(), Key: leadKey }).promise()).Item;
    } catch (e) {
      logger.warn(`form-submission lead re-fetch failed: ${e.message}`);
      lead = null;
    }

    // ── Fire the form_submitted automation trigger (Commit 4) ────────────────
    // Same context-passing path every other trigger uses (see forms.js /
    // automations.js), with traits added so the flow's send_template step can
    // reference {{trait.<key>}}. Best-effort: a template failure never fails the
    // submission (the lead was already updated).
    let triggered = false;
    try {
      const { runAutomations } = require('./automations');
      await runAutomations(companyId, 'form_submitted', {
        leadId:     result.leadId,
        leadPK:     leadKey.PK,
        phone:      cleanPhone,
        name:       lead?.name ?? cleanPhone,
        source:     'api',
        stage:      lead?.stage,
        tags:       lead?.tags,
        assignedTo: lead?.assignedTo,
        traits:     data.traits ?? {},
      });
      triggered = true;
    } catch (e) {
      logger.warn(`form-submission automation error: ${e.message}`);
    }

    // Mark the claim completed (best-effort — the claim already did its job).
    await dynamodb.update({
      TableName: TABLE(), Key: key,
      UpdateExpression: 'SET #s = :done, leadId = :lid, completedAt = :ca',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: { ':done': 'completed', ':lid': result.leadId, ':ca': new Date().toISOString() },
    }).promise().catch((e) => logger.warn(`form-submission idempotency complete-mark failed: ${e.message}`));

    // Every call is audited via the existing logAudit() utility (spec §7).
    logAudit('api', 'public_form_submission', cleanPhone, 'success', req.ip, {
      leadId: result.leadId, keyId: req.apiKeyId, action: result.action, triggered,
    }, companyId).catch((e) => logger.error('Audit log failed for public_form_submission', e));

    return res.status(200).json({ success: true, leadId: result.leadId, triggered });
  } catch (err) {
    next(err); // ZodError → 400 (global handler); anything else → 500
  }
});

module.exports = router;
