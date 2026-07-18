'use strict';
const crypto = require('crypto');

/**
 * Verifies Meta's X-Hub-Signature-256 header against an HMAC-SHA256 of the RAW request
 * body bytes (req.rawBody, captured by the express.json() `verify` hook in app.js) —
 * never against JSON.stringify(req.body), which is not guaranteed byte-identical to what
 * Meta actually sent (key order, escaping) and can produce false negatives/positives.
 *
 * Shared by every Meta webhook consumer in this codebase, but the signing secret is
 * per-APP, not global: Meta signs each webhook with the app secret of the app the webhook
 * is registered on. The `secret` param defaults to META_APP_SECRET (the Facebook/WhatsApp
 * Tech Provider app) — the WhatsApp messages webhook and the Meta Lead Ads webhook both
 * ride that default. A consumer registered on a DIFFERENT Meta app MUST pass that app's
 * secret explicitly: the Instagram DM webhook is a separate "Instagram Login" app and
 * passes INSTAGRAM_APP_SECRET. Verifying an Instagram-signed payload against META_APP_SECRET
 * rejects every real delivery with 401 — the 2026-07-18 production incident this param
 * fixes (docs/bible/19_DECISION_LOG.md Era 54).
 *
 * Fails closed: returns false whenever `secret` is configured and the signature is missing,
 * malformed, or doesn't match. Skips verification (returns true) ONLY when `secret` itself
 * is falsy (local/dev — production absence of these secrets is a deploy-time concern; the
 * Tech Provider secret is warned at cold start by config/secrets.js).
 */
function verifyMetaWebhookSignature(req, secret = process.env.META_APP_SECRET) {
  if (!secret) return true;

  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !req.rawBody) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { verifyMetaWebhookSignature };
