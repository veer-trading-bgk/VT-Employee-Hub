'use strict';

/**
 * apiKeyAuth — authentication middleware for the public, server-to-server
 * form-submission endpoint (src/routes/public.js).
 *
 * Unlike every other APForce route, the caller here is a machine (the client's
 * own web server), not a logged-in human — there is no JWT cookie and no user.
 * This reads the X-API-Key header, verifies it via ApiKeyService (SHA-256 hash
 * lookup + timing-safe compare), and sets req.company (NOT req.user — there is
 * no user, no session). companyId is derived solely from the key, making
 * cross-tenant writes structurally impossible (spec §7).
 */

const ApiKeyService = require('../services/ApiKeyService');
const logger = require('../config/logger');

const apiKeyAuth = async (req, res, next) => {
  try {
    const rawKey = req.headers['x-api-key'];
    if (!rawKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const resolved = await ApiKeyService.verify(rawKey);
    if (!resolved) {
      logger.warn(`Invalid API key attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // No req.user — there is no session here. Downstream handlers read companyId
    // from req.company only, never from the request body.
    req.company  = { companyId: resolved.companyId };
    req.apiKeyId = resolved.keyId;   // used by the per-key rate limiter
    next();
  } catch (err) {
    // Fail closed — never let an auth error fall through to the handler.
    logger.error('API key auth error', err);
    return res.status(401).json({ error: 'Invalid API key' });
  }
};

module.exports = { apiKeyAuth };
