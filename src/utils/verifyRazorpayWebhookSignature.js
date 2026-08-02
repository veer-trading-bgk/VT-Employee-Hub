'use strict';
const crypto = require('crypto');

/**
 * Verifies Razorpay's X-Razorpay-Signature header against HMAC-SHA256 of the
 * RAW request body (req.rawBody from express.json verify in app.js) — same
 * structure as verifyMetaWebhookSignature.js (timingSafeEqual, raw bytes,
 * length guard before equal).
 *
 * Secret: RAZORPAY_WEBHOOK_SECRET (dashboard webhook secret — distinct from
 * RAZORPAY_KEY_SECRET).
 *
 * FAIL CLOSED: a missing/falsy secret always returns false (reject). Never
 * treat an unset secret as "verified" — that would accept forged payment
 * webhooks. Local/dev must set RAZORPAY_WEBHOOK_SECRET explicitly (even a
 * test value); there is no bare "secret missing → allow" branch.
 *
 * @param {import('express').Request} req
 * @param {string} [secret]
 * @returns {boolean}
 */
function verifyRazorpayWebhookSignature(req, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
  if (!secret) return false;

  const signature = req.headers['x-razorpay-signature'];
  if (!signature || !req.rawBody) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(String(signature));
  // Length guard before timingSafeEqual — unequal lengths throw RangeError.
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { verifyRazorpayWebhookSignature };
