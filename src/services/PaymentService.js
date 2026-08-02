'use strict';

/**
 * PaymentService — Journey Platform customer checkout (Phase 1 PR 1).
 *
 * Creates PAYMENT# with a frozen pricingSnapshot + amountPaise computed from
 * the stored Journey Definition (never from client totals), then creates a
 * Razorpay Order using that frozen amountPaise.
 *
 * Webhook verification / resume gating → PR 2. No AutomationEngine coupling.
 */

const dynamodb = require('../config/dynamodb');
const { generatePaymentId } = require('../core/id');
const {
  journeyDefPK,
  journeyDefSK,
  paymentPK,
  paymentMetaSK,
  paymentOrderLookupPK,
  paymentOrderLookupSK,
} = require('../core/entityKeys');
const { newMeta, updateMeta } = require('../core/systemMeta');
const { computeAuthoritativeCharge } = require('../lib/journeyPricing');
const { createPaymentGateway } = require('./payment/PaymentGateway');

const TABLE = () => process.env.DYNAMODB_TABLE_METRICS;
const GATEWAY = 'razorpay';

class PaymentError extends Error {
  constructor(message, { status = 400, code = 'payment_error' } = {}) {
    super(message);
    this.name = 'PaymentError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} [deps]
 * @param {object} [deps.gateway] PaymentGateway mock
 * @param {object} [deps.db] dynamodb mock
 */
function createPaymentService(deps = {}) {
  const db = deps.db || dynamodb;
  const gateway = createPaymentGateway(deps.gateway);

  /**
   * Create PAYMENT# then gateway Order. Caller must already have validated
   * the journey capability token and loaded the instance.
   *
   * MULTI-CHECKOUT (PR 1): every call mints a new payment_ id + new Razorpay
   * Order. There is no lookup/reuse of an existing created|pending PAYMENT for
   * this journeyInstanceId. Double-click / retry = N Orders. That is not an
   * amount-tamper risk (each Order still carries server-frozen amountPaise),
   * but N successful captures would charge the customer N times — PR 2's
   * per-PAYMENT pending→paid transition alone does NOT journey-dedup money.
   * Dedup / reuse-pending AND a journey-level already-paid guard on webhook are
   * HARD acceptance criteria for Phase 1 PR 2 (not optional follow-up) — see
   * TECHNICAL_DEBT.md "Journey Payment — orphaned created PAYMENT# / multi-checkout".
   * Within PR 1 there is no webhook/`paid` path, so double-charge cannot occur yet.
   *
   * @param {object} args
   * @param {string} args.companyId
   * @param {object} args.instance journey META item (must include id / journeyDefId)
   * @param {Record<string, string>} args.submittedData field values only
   * @param {object} [args.clientBody] raw req.body — intentionally unused for amounts
   */
  async function createCheckoutSession({
    companyId,
    instance,
    submittedData,
    // eslint-disable-next-line no-unused-vars -- intentionally unused; documents ignore-client-amount contract
    clientBody,
  }) {
    const journeyInstanceId = instance.id;
    const journeyDefId = instance.journeyDefId;
    if (!journeyInstanceId || !journeyDefId) {
      throw new PaymentError('Journey instance missing definition', { status: 404, code: 'not_found' });
    }

    const { Item: definition } = await db.get({
      TableName: TABLE(),
      Key: { PK: journeyDefPK(companyId), SK: journeyDefSK(journeyDefId) },
    }).promise();
    if (!definition) {
      throw new PaymentError('Journey definition not found', { status: 404, code: 'not_found' });
    }

    // Authoritative charge — definition prices × submitted quantities. Never
    // read amount / amountPaise / total / pricingSnapshot from clientBody.
    const values = normalizeSubmittedData(submittedData);
    const charge = computeAuthoritativeCharge(definition, values);
    if (!charge.anyPriced || charge.amountPaise <= 0) {
      throw new PaymentError('No payable amount for this journey', {
        status: 400,
        code: 'not_payable',
      });
    }

    const paymentId = generatePaymentId();
    const meta = newMeta('system');
    const paymentItem = {
      PK: paymentPK(companyId, paymentId),
      SK: paymentMetaSK(),
      id: paymentId,
      companyId,
      journeyInstanceId,
      journeyDefId,
      amountPaise: charge.amountPaise,
      currency: charge.currency,
      pricingSnapshot: charge.pricingSnapshot,
      submittedData: values,
      status: 'created',
      gateway: GATEWAY,
      gatewayOrderId: null,
      gatewayPaymentId: null,
      failureReason: null,
      idempotencyKey: null,
      paidAt: null,
      refundedAt: null,
      ...meta,
    };

    // 1) Persist PAYMENT# BEFORE calling the gateway — Order must use this
    //    frozen amountPaise, not a second recomputation.
    //
    // ORPHAN GAP (PR 1): if createOrder() below throws, this row stays
    // status:'created' / gatewayOrderId:null with no cleanup in this PR.
    // Recovery: Phase 2 expiry sweeper (mark expired + optional admin reconcile),
    // not a sync delete here — see docs/phase3/TECHNICAL_DEBT.md
    // "Journey Payment — orphaned created PAYMENT# / multi-checkout".
    await db.put({ TableName: TABLE(), Item: paymentItem }).promise();

    // 2) Create Order from the frozen item field only.
    // No try/catch→delete in PR 1 (would race a partial gateway success).
    const frozenAmountPaise = paymentItem.amountPaise;
    const { orderId } = await gateway.createOrder(
      frozenAmountPaise,
      paymentItem.currency,
      paymentId,
    );

    // 3) Attach gatewayOrderId + pending + O(1) reverse lookup for PR 2 webhook.
    const patch = updateMeta(paymentItem, 'system');
    await db.update({
      TableName: TABLE(),
      Key: { PK: paymentPK(companyId, paymentId), SK: paymentMetaSK() },
      UpdateExpression:
        'SET gatewayOrderId = :oid, #st = :st, updatedAt = :ua, updatedBy = :ub, #v = :nv',
      ConditionExpression: 'attribute_exists(PK) AND #v = :cv AND #st = :created',
      ExpressionAttributeNames: { '#st': 'status', '#v': 'version' },
      ExpressionAttributeValues: {
        ':oid': orderId,
        ':st': 'pending',
        ':created': 'created',
        ':ua': patch.updatedAt,
        ':ub': patch.updatedBy,
        ':nv': patch.version,
        ':cv': paymentItem.version,
      },
    }).promise();

    await db.put({
      TableName: TABLE(),
      Item: {
        PK: paymentOrderLookupPK(GATEWAY, orderId),
        SK: paymentOrderLookupSK(),
        companyId,
        paymentId,
        gateway: GATEWAY,
        gatewayOrderId: orderId,
        createdAt: patch.updatedAt,
      },
    }).promise();

    const keyId = gateway.getPublicKeyId ? gateway.getPublicKeyId() : null;

    // Public checkout params only — never key_secret / full PAYMENT item.
    return {
      paymentId,
      orderId,
      keyId,
      amountPaise: frozenAmountPaise,
      currency: paymentItem.currency,
      // Display convenience mirroring snapshot total (same as amountPaise/100).
      amountDisplay: paymentItem.pricingSnapshot.total,
    };
  }

  return { createCheckoutSession, PaymentError };
}

function normalizeSubmittedData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    out[String(k)] = String(v);
  }
  return out;
}

/** Default singleton — tests should call createPaymentService({ gateway, db }). */
const defaultService = createPaymentService();

module.exports = {
  createPaymentService,
  createCheckoutSession: defaultService.createCheckoutSession,
  PaymentError,
  normalizeSubmittedData,
};
