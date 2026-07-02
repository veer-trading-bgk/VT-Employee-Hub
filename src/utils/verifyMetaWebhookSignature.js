'use strict';
const crypto = require('crypto');

/**
 * Verifies Meta's X-Hub-Signature-256 header against an HMAC-SHA256 of the RAW request
 * body bytes (req.rawBody, captured by the express.json() `verify` hook in app.js) —
 * never against JSON.stringify(req.body), which is not guaranteed byte-identical to what
 * Meta actually sent (key order, escaping) and can produce false negatives/positives.
 *
 * Shared by both Meta webhook consumers in this codebase (WhatsApp messages webhook,
 * Meta Lead Ads webhook) so there is exactly one verification implementation to audit.
 *
 * Fails closed: returns false whenever META_APP_SECRET is configured and the signature
 * is missing, malformed, or doesn't match. Skips verification only when META_APP_SECRET
 * itself isn't set (local/dev only — production absence is warned at cold start by
 * config/secrets.js).
 */
function verifyMetaWebhookSignature(req) {
  const secret = process.env.META_APP_SECRET;
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
