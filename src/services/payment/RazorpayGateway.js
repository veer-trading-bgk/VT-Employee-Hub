'use strict';

/**
 * Razorpay PaymentGateway adapter — Orders API + webhook HMAC verify.
 * Credentials:
 *   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — Orders API
 *   RAZORPAY_WEBHOOK_SECRET — X-Razorpay-Signature (dashboard webhook secret)
 */

const crypto = require('crypto');
const Razorpay = require('razorpay');

function trimSecret(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

class RazorpayGateway {
  /**
   * @param {{ keyId?: string, keySecret?: string, webhookSecret?: string, client?: object }} [opts]
   */
  constructor(opts = {}) {
    // Trim env secrets — trailing whitespace/newlines in Lambda console paste
    // cause Razorpay "Authentication failed" (sandbox E2E 2026-08-03).
    this.keyId = trimSecret(opts.keyId ?? process.env.RAZORPAY_KEY_ID);
    this.keySecret = trimSecret(opts.keySecret ?? process.env.RAZORPAY_KEY_SECRET);
    this.webhookSecret = trimSecret(opts.webhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET);
    this._client = opts.client ?? null;
  }

  _getClient() {
    if (this._client) return this._client;
    if (!this.keyId || !this.keySecret) {
      throw new Error('RazorpayGateway: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured');
    }
    this._client = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret,
    });
    return this._client;
  }

  /**
   * @param {number} amountPaise integer paise (already frozen on PAYMENT#)
   * @param {string} currency e.g. 'INR'
   * @param {string} receipt short id (Razorpay max 40 chars)
   * @returns {Promise<{ orderId: string }>}
   */
  async createOrder(amountPaise, currency, receipt) {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error('RazorpayGateway.createOrder: amountPaise must be a positive integer');
    }
    const order = await this._getClient().orders.create({
      amount: amountPaise,
      currency: currency || 'INR',
      receipt: String(receipt).slice(0, 40),
    });
    if (!order?.id) throw new Error('RazorpayGateway.createOrder: missing order id');
    return { orderId: order.id };
  }

  /**
   * HMAC-SHA256 hex over raw body vs X-Razorpay-Signature.
   * Prefer verifyRazorpayWebhookSignature(req) at the route — this method
   * exists for the PaymentGateway interface and unit tests with buffers.
   * FAIL CLOSED: missing webhookSecret → false (never treat as verified).
   *
   * @param {string|Buffer} rawBody
   * @param {string} signature
   * @returns {boolean}
   */
  verifyWebhook(rawBody, signature) {
    if (!this.webhookSecret) return false;
    if (!signature || rawBody == null) return false;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(String(signature));
    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }

  /**
   * PR 2+ optional reconcile — fetch payment entity from gateway.
   */
  async fetchPayment(gatewayPaymentId) {
    const payment = await this._getClient().payments.fetch(gatewayPaymentId);
    return {
      status: payment.status,
      amountPaise: payment.amount,
      orderId: payment.order_id,
      id: payment.id,
    };
  }

  getPublicKeyId() {
    return this.keyId;
  }
}

module.exports = RazorpayGateway;
