'use strict';

/**
 * Razorpay PaymentGateway adapter — Orders API + hosted Checkout params.
 * Phase 1 PR 1: createOrder only. verifyWebhook / fetchPayment stubs for PR 2.
 *
 * Credentials (test/sandbox for this PR):
 *   RAZORPAY_KEY_ID
 *   RAZORPAY_KEY_SECRET
 * Never expose key_secret outside this file.
 */

const Razorpay = require('razorpay');

class RazorpayGateway {
  /**
   * @param {{ keyId?: string, keySecret?: string, client?: object }} [opts]
   *   `client` — inject a mock Razorpay instance in unit tests (no network).
   */
  constructor(opts = {}) {
    this.keyId = opts.keyId ?? process.env.RAZORPAY_KEY_ID ?? null;
    this.keySecret = opts.keySecret ?? process.env.RAZORPAY_KEY_SECRET ?? null;
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
   * PR 2 — HMAC verification over raw body. Stubbed so the interface exists now.
   * @returns {boolean}
   */
  verifyWebhook(_rawBody, _signature) {
    throw new Error('RazorpayGateway.verifyWebhook: not wired until Phase 1 PR 2');
  }

  /**
   * PR 2+ — fetch payment entity from gateway.
   */
  async fetchPayment(_gatewayPaymentId) {
    throw new Error('RazorpayGateway.fetchPayment: not wired until Phase 1 PR 2');
  }

  /** Public Checkout.js key only — never the secret. */
  getPublicKeyId() {
    return this.keyId;
  }
}

module.exports = RazorpayGateway;
