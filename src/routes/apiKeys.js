'use strict';

/**
 * Admin management of Public API keys (spec §6.1 / §Commit 2).
 *
 * Session-authenticated (mounted behind authMiddleware in app.js) — this is the
 * in-dashboard route the company admin uses to generate/list/revoke the keys
 * that the PUBLIC form-submission endpoint (routes/public.js) then authenticates
 * with. Every route is admin-only (checkRole(['admin'])).
 */

const express = require('express');
const { z }   = require('zod');
const { checkRole } = require('../middleware/auth');
const ApiKeyService = require('../services/ApiKeyService');
const { logAudit } = require('../utils/audit');
const logger = require('../config/logger');

const router = express.Router();

const generateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
}).strict();

// ── POST /api/api-keys/generate ───────────────────────────────────────────────
// Returns the FULL raw key exactly once — the UI shows it a single time with a
// "you won't see this again" warning. It is never retrievable afterward.
router.post('/generate', checkRole(['admin']), async (req, res, next) => {
  try {
    const { name } = generateSchema.parse(req.body);
    const created = await ApiKeyService.generate(req.user.companyId, name, req.user.id);

    logAudit(req.user.id, 'api_key_generated', name, 'success', req.ip, {
      keyId: created.keyId, keyPrefix: created.keyPrefix,
    }, req.user.companyId).catch((e) => logger.error('Audit log failed for api_key_generated', e));

    // `key` is the one-time full value; keyPrefix/keyId are the persisted, listable parts.
    res.status(201).json({
      success:   true,
      key:       created.rawKey,
      keyId:     created.keyId,
      keyPrefix: created.keyPrefix,
      name:      created.name,
      createdAt: created.createdAt,
    });
  } catch (err) { next(err); }
});

// ── GET /api/api-keys ─────────────────────────────────────────────────────────
router.get('/', checkRole(['admin']), async (req, res, next) => {
  try {
    const keys = await ApiKeyService.list(req.user.companyId);
    res.json({ success: true, keys });
  } catch (err) { next(err); }
});

// ── DELETE /api/api-keys/:keyId ───────────────────────────────────────────────
router.delete('/:keyId', checkRole(['admin']), async (req, res, next) => {
  try {
    const revoked = await ApiKeyService.revoke(req.user.companyId, req.params.keyId);
    if (!revoked) return res.status(404).json({ error: 'API key not found' });

    logAudit(req.user.id, 'api_key_revoked', req.params.keyId, 'success', req.ip, {
      keyId: req.params.keyId,
    }, req.user.companyId).catch((e) => logger.error('Audit log failed for api_key_revoked', e));

    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
