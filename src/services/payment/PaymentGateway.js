'use strict';

/**
 * PaymentGateway — narrow adapter surface for Journey Platform checkout.
 * Razorpay-specific types must stay inside RazorpayGateway.js only.
 *
 * Methods:
 *   createOrder(amountPaise, currency, receipt) → { orderId }
 *   verifyWebhook(rawBody, signature) → boolean   (wired in PR 2)
 *   fetchPayment(gatewayPaymentId) → { status, amountPaise?, ... }  (PR 2+)
 *   getPublicKeyId() → string | null   (safe for Checkout.js — never secret)
 */

/**
 * @typedef {object} PaymentGateway
 * @property {(amountPaise: number, currency: string, receipt: string) => Promise<{ orderId: string }>} createOrder
 * @property {(rawBody: string|Buffer, signature: string) => boolean} verifyWebhook
 * @property {(gatewayPaymentId: string) => Promise<object>} fetchPayment
 * @property {() => string|null} getPublicKeyId
 */

/**
 * @param {PaymentGateway} [override] inject mock in tests
 * @returns {PaymentGateway}
 */
function createPaymentGateway(override) {
  if (override) return override;
  const provider = (process.env.PAYMENT_GATEWAY || 'razorpay').toLowerCase();
  if (provider === 'razorpay') {
    // Lazy require — keeps razorpay SDK out of PaymentService require graph
    // until a real (non-mocked) gateway is constructed.
    const RazorpayGateway = require('./RazorpayGateway');
    return new RazorpayGateway();
  }
  throw new Error(`Unsupported PAYMENT_GATEWAY: ${provider}`);
}

module.exports = { createPaymentGateway };
