'use strict';

/**
 * Public Razorpay webhook — server-to-server only.
 * Mounted in app.js WITHOUT authMiddleware (like Meta/Journey public webhooks).
 * Signature: X-Razorpay-Signature over req.rawBody (RAZORPAY_WEBHOOK_SECRET).
 */

const express = require('express');
const { rateLimit } = require('../middleware/rateLimiter');
const { verifyRazorpayWebhookSignature } = require('../utils/verifyRazorpayWebhookSignature');
const { createPaymentService } = require('../services/PaymentService');
const logger = require('../config/logger');

const router = express.Router();
let paymentService = createPaymentService();

/**
 * POST /api/payments/razorpay/webhook
 * Always return JSON; use non-200 on signature failure so Razorpay retries
 * don't look like success. Business-level outcomes (duplicate, replay) → 200.
 */
async function handleRazorpayWebhook(req, res, next) {
  try {
    if (!verifyRazorpayWebhookSignature(req)) {
      logger.warn('Razorpay webhook: signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const event = body.event;
    // payment.captured is the money-confirmed event we act on.
    if (event !== 'payment.captured') {
      return res.status(200).json({ success: true, ignored: event || 'unknown' });
    }

    const entity = body.payload?.payment?.entity;
    if (!entity?.order_id) {
      return res.status(400).json({ error: 'Missing payment entity' });
    }

    const orderId = entity.order_id;
    const amountPaise = entity.amount;
    const gatewayPaymentId = entity.id;
    // Prefer Razorpay's event id header when present; else payment id + event.
    const headerEventId = req.headers['x-razorpay-event-id'];
    const eventKey = headerEventId
      ? String(headerEventId)
      : `${event}:${gatewayPaymentId || orderId}`;

    const result = await paymentService.confirmGatewayPayment({
      orderId,
      amountPaise,
      gatewayPaymentId,
      eventKey,
    });

    // Always 200 after signature OK — Razorpay should not retry forever on
    // business outcomes (duplicate, amount mismatch already alerted).
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

router.post('/razorpay/webhook', rateLimit(120, 60_000), handleRazorpayWebhook);

module.exports = router;
module.exports.handleRazorpayWebhook = handleRazorpayWebhook;
module.exports._setPaymentServiceForTests = (svc) => {
  paymentService = svc;
};
