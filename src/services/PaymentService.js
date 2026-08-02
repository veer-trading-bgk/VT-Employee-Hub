'use strict';

/**
 * PaymentService — Journey Platform customer checkout + Razorpay confirm (PR 1–2).
 *
 * PR 1: PAYMENT# with frozen amountPaise → Order create.
 * PR 2: webhook confirm → paid (or paid_duplicate) → resumeOnWebhook once.
 *
 * Paid is FINAL — never reverted if resume fails (alert + deferred retry).
 */

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { generatePaymentId } = require('../core/id');
const {
  journeyDefPK,
  journeyDefSK,
  paymentPK,
  paymentMetaSK,
  paymentOrderLookupPK,
  paymentOrderLookupSK,
  paymentJourneyPK,
  paymentJourneyActiveSK,
  paymentJourneyPaymentSK,
  paymentEventClaimPK,
  paymentEventClaimSK,
} = require('../core/entityKeys');
const { newMeta, updateMeta } = require('../core/systemMeta');
const { computeAuthoritativeCharge } = require('../lib/journeyPricing');
const { createPaymentGateway } = require('./payment/PaymentGateway');

const TABLE = () => process.env.DYNAMODB_TABLE_METRICS;
const GATEWAY = 'razorpay';
const REUSABLE_STATUSES = new Set(['created', 'pending']);

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
 * @param {object} [deps.gateway]
 * @param {object} [deps.db]
 * @param {object} [deps.AutomationEngine] inject for tests
 */
function createPaymentService(deps = {}) {
  const db = deps.db || dynamodb;
  const gateway = createPaymentGateway(deps.gateway);
  const getEngine = () => deps.AutomationEngine || require('./AutomationEngine');

  /**
   * Create or reuse PAYMENT# + Order.
   * Dedup: if ACTIVE pointer → created|pending PAYMENT with same amountPaise,
   * return that checkout (same order_id) without minting a second Order.
   */
  async function createCheckoutSession({
    companyId,
    instance,
    submittedData,
    // eslint-disable-next-line no-unused-vars
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

    const values = normalizeSubmittedData(submittedData);
    const charge = computeAuthoritativeCharge(definition, values);
    if (!charge.anyPriced || charge.amountPaise <= 0) {
      throw new PaymentError('No payable amount for this journey', {
        status: 400,
        code: 'not_payable',
      });
    }

    // ── Checkout dedup (PR 2 hard AC) ──────────────────────────────────────
    const reused = await tryReuseActiveCheckout({
      companyId,
      journeyInstanceId,
      amountPaise: charge.amountPaise,
    });
    if (reused) return reused;

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

    // ORPHAN GAP: if createOrder throws, row stays created/null order — Phase 2 sweeper.
    await db.put({ TableName: TABLE(), Item: paymentItem }).promise();
    await putJourneyIndexSibling(companyId, journeyInstanceId, paymentId, 'created', charge.amountPaise);

    const frozenAmountPaise = paymentItem.amountPaise;
    const { orderId } = await gateway.createOrder(
      frozenAmountPaise,
      paymentItem.currency,
      paymentId,
    );

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

    await putJourneyIndexSibling(companyId, journeyInstanceId, paymentId, 'pending', frozenAmountPaise);
    await putJourneyActivePointer(companyId, journeyInstanceId, {
      paymentId,
      amountPaise: frozenAmountPaise,
      gatewayOrderId: orderId,
      status: 'pending',
    });

    const keyId = gateway.getPublicKeyId ? gateway.getPublicKeyId() : null;
    return {
      paymentId,
      orderId,
      keyId,
      amountPaise: frozenAmountPaise,
      currency: paymentItem.currency,
      amountDisplay: paymentItem.pricingSnapshot.total,
      reused: false,
    };
  }

  async function tryReuseActiveCheckout({ companyId, journeyInstanceId, amountPaise }) {
    const { Item: active } = await db.get({
      TableName: TABLE(),
      Key: {
        PK: paymentJourneyPK(companyId, journeyInstanceId),
        SK: paymentJourneyActiveSK(),
      },
    }).promise();
    if (!active?.paymentId) return null;

    const { Item: existing } = await db.get({
      TableName: TABLE(),
      Key: { PK: paymentPK(companyId, active.paymentId), SK: paymentMetaSK() },
    }).promise();
    if (!existing) return null;
    if (!REUSABLE_STATUSES.has(existing.status)) return null;
    if (existing.amountPaise !== amountPaise) return null;
    if (!existing.gatewayOrderId) return null;

    const keyId = gateway.getPublicKeyId ? gateway.getPublicKeyId() : null;
    return {
      paymentId: existing.id,
      orderId: existing.gatewayOrderId,
      keyId,
      amountPaise: existing.amountPaise,
      currency: existing.currency || 'INR',
      amountDisplay: existing.pricingSnapshot?.total ?? existing.amountPaise / 100,
      reused: true,
    };
  }

  async function putJourneyActivePointer(companyId, journeyInstanceId, fields) {
    await db.put({
      TableName: TABLE(),
      Item: {
        PK: paymentJourneyPK(companyId, journeyInstanceId),
        SK: paymentJourneyActiveSK(),
        companyId,
        journeyInstanceId,
        ...fields,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
  }

  async function putJourneyIndexSibling(companyId, journeyInstanceId, paymentId, status, amountPaise) {
    await db.put({
      TableName: TABLE(),
      Item: {
        PK: paymentJourneyPK(companyId, journeyInstanceId),
        SK: paymentJourneyPaymentSK(paymentId),
        companyId,
        journeyInstanceId,
        paymentId,
        status,
        amountPaise,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
  }

  /**
   * Process a verified Razorpay payment.captured (or equivalent) payload.
   * Caller must already have verified the webhook signature.
   *
   * @returns {{ outcome: string, paymentId?: string, journeyInstanceId?: string }}
   */
  async function confirmGatewayPayment({
    orderId,
    amountPaise,
    gatewayPaymentId,
    eventKey,
  }) {
    if (!orderId || !eventKey) {
      throw new PaymentError('Missing orderId or eventKey', { status: 400, code: 'bad_payload' });
    }

    // Event-id claim — replay → already_claimed → no-op 200 at route.
    const claimed = await claimWebhookEvent(eventKey);
    if (!claimed) {
      return { outcome: 'event_replay' };
    }

    const { Item: lookup } = await db.get({
      TableName: TABLE(),
      Key: {
        PK: paymentOrderLookupPK(GATEWAY, orderId),
        SK: paymentOrderLookupSK(),
      },
    }).promise();
    if (!lookup?.paymentId || !lookup.companyId) {
      logger.alert(
        `Razorpay webhook: unknown order_id <code>${orderId}</code> — no PAYMENT_ORDER lookup`,
      );
      return { outcome: 'unknown_order' };
    }

    const { companyId, paymentId } = lookup;
    const { Item: payment } = await db.get({
      TableName: TABLE(),
      Key: { PK: paymentPK(companyId, paymentId), SK: paymentMetaSK() },
    }).promise();
    if (!payment) {
      logger.alert(`Razorpay webhook: lookup found paymentId <code>${paymentId}</code> but META missing`);
      return { outcome: 'missing_payment' };
    }

    // Idempotent: already paid for THIS payment → safe no-op (resume already ran or not).
    if (payment.status === 'paid') {
      return {
        outcome: 'already_paid',
        paymentId,
        journeyInstanceId: payment.journeyInstanceId,
      };
    }
    if (payment.status === 'paid_duplicate') {
      return {
        outcome: 'already_duplicate',
        paymentId,
        journeyInstanceId: payment.journeyInstanceId,
      };
    }

    // Amount defense-in-depth.
    if (Number(amountPaise) !== Number(payment.amountPaise)) {
      logger.alert(
        `Razorpay amount mismatch for payment <code>${paymentId}</code> `
        + `journey <code>${payment.journeyInstanceId}</code>: `
        + `gateway=${amountPaise} stored=${payment.amountPaise}`,
        companyId,
      );
      return { outcome: 'amount_mismatch', paymentId };
    }

    // Journey-level guard — another PAYMENT already paid for this journey?
    const priorPaid = await findOtherPaidPayment(
      companyId,
      payment.journeyInstanceId,
      paymentId,
    );
    if (priorPaid) {
      await markPaidDuplicate(payment, gatewayPaymentId, eventKey, priorPaid);
      logger.alert(
        `Duplicate Razorpay payment for journey <code>${payment.journeyInstanceId}</code>: `
        + `already paid via <code>${priorPaid}</code>; new payment <code>${paymentId}</code> `
        + `(gateway pay <code>${gatewayPaymentId}</code>) marked <b>paid_duplicate</b> — refund manually`,
        companyId,
      );
      return {
        outcome: 'paid_duplicate',
        paymentId,
        journeyInstanceId: payment.journeyInstanceId,
        priorPaidPaymentId: priorPaid,
      };
    }

    // Conditional created|pending → paid. Never undo this on resume failure.
    const paidOk = await transitionToPaid(payment, gatewayPaymentId, eventKey);
    if (!paidOk) {
      // Lost race — re-read; likely already paid/duplicate.
      const { Item: again } = await db.get({
        TableName: TABLE(),
        Key: { PK: paymentPK(companyId, paymentId), SK: paymentMetaSK() },
      }).promise();
      if (again?.status === 'paid') {
        return { outcome: 'already_paid', paymentId, journeyInstanceId: payment.journeyInstanceId };
      }
      if (again?.status === 'paid_duplicate') {
        return { outcome: 'already_duplicate', paymentId, journeyInstanceId: payment.journeyInstanceId };
      }
      logger.alert(
        `Razorpay webhook: failed to transition payment <code>${paymentId}</code> to paid (race)`,
        companyId,
      );
      return { outcome: 'transition_failed', paymentId };
    }

    await putJourneyIndexSibling(
      companyId,
      payment.journeyInstanceId,
      paymentId,
      'paid',
      payment.amountPaise,
    );

    // Resume ONLY on first successful paid — not paid_duplicate.
    // If resume throws/returns not_found after paid: leave paid, alert.
    // Automatic resume retry is DEFERRED to Phase 2 reconcile / admin action —
    // see TECHNICAL_DEBT.md "Journey Payment — paid but resume failed".
    const submitted = payment.submittedData || {};
    try {
      const result = await getEngine().resumeOnWebhook(
        companyId,
        payment.journeyInstanceId,
        {
          journeyRecord: submitted,
          submittedData: submitted,
          paymentId,
          gatewayPaymentId,
        },
      );
      if (result?.status !== 'resumed') {
        logger.alert(
          `Payment <code>${paymentId}</code> is <b>paid</b> but resumeOnWebhook returned `
          + `<code>${result?.status || 'unknown'}</code> for journey `
          + `<code>${payment.journeyInstanceId}</code> — manual resume / Phase 2 reconcile`,
          companyId,
        );
        return {
          outcome: 'paid_resume_pending',
          paymentId,
          journeyInstanceId: payment.journeyInstanceId,
        };
      }
    } catch (err) {
      logger.alert(
        `Payment <code>${paymentId}</code> is <b>paid</b> but resumeOnWebhook threw for journey `
        + `<code>${payment.journeyInstanceId}</code>: ${err.message} — paid NOT reverted; `
        + `manual resume / Phase 2 reconcile`,
        companyId,
      );
      return {
        outcome: 'paid_resume_failed',
        paymentId,
        journeyInstanceId: payment.journeyInstanceId,
      };
    }

    return {
      outcome: 'paid_resumed',
      paymentId,
      journeyInstanceId: payment.journeyInstanceId,
    };
  }

  async function claimWebhookEvent(eventKey) {
    try {
      await db.put({
        TableName: TABLE(),
        Item: {
          PK: paymentEventClaimPK(GATEWAY, eventKey),
          SK: paymentEventClaimSK(),
          gateway: GATEWAY,
          eventKey,
          claimedAt: new Date().toISOString(),
          // TTL ~30d — DynamoDB eventual; claim is authoritative while present.
          ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }).promise();
      return true;
    } catch (e) {
      if (e.code === 'ConditionalCheckFailedException') return false;
      throw e;
    }
  }

  async function findOtherPaidPayment(companyId, journeyInstanceId, exceptPaymentId) {
    const { Items = [] } = await db.query({
      TableName: TABLE(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: {
        ':pk': paymentJourneyPK(companyId, journeyInstanceId),
        ':pfx': 'PAY#',
      },
    }).promise();
    for (const item of Items) {
      if (item.paymentId === exceptPaymentId) continue;
      if (item.status === 'paid') return item.paymentId;
    }
    return null;
  }

  async function transitionToPaid(payment, gatewayPaymentId, eventKey) {
    const patch = updateMeta(payment, 'system');
    const paidAt = patch.updatedAt;
    try {
      await db.update({
        TableName: TABLE(),
        Key: { PK: paymentPK(payment.companyId, payment.id), SK: paymentMetaSK() },
        UpdateExpression:
          'SET #st = :paid, gatewayPaymentId = :gpid, idempotencyKey = :ik, '
          + 'paidAt = :pa, updatedAt = :ua, updatedBy = :ub, #v = :nv',
        ConditionExpression:
          'attribute_exists(PK) AND #v = :cv AND (#st = :created OR #st = :pending)',
        ExpressionAttributeNames: { '#st': 'status', '#v': 'version' },
        ExpressionAttributeValues: {
          ':paid': 'paid',
          ':created': 'created',
          ':pending': 'pending',
          ':gpid': gatewayPaymentId || null,
          ':ik': eventKey,
          ':pa': paidAt,
          ':ua': patch.updatedAt,
          ':ub': patch.updatedBy,
          ':nv': patch.version,
          ':cv': payment.version ?? 0,
        },
      }).promise();
      return true;
    } catch (e) {
      if (e.code === 'ConditionalCheckFailedException') return false;
      throw e;
    }
  }

  async function markPaidDuplicate(payment, gatewayPaymentId, eventKey, priorPaidPaymentId) {
    const patch = updateMeta(payment, 'system');
    try {
      await db.update({
        TableName: TABLE(),
        Key: { PK: paymentPK(payment.companyId, payment.id), SK: paymentMetaSK() },
        UpdateExpression:
          'SET #st = :dup, gatewayPaymentId = :gpid, idempotencyKey = :ik, '
          + 'priorPaidPaymentId = :prior, failureReason = :fr, '
          + 'paidAt = :pa, updatedAt = :ua, updatedBy = :ub, #v = :nv',
        ConditionExpression:
          'attribute_exists(PK) AND #v = :cv AND (#st = :created OR #st = :pending)',
        ExpressionAttributeNames: { '#st': 'status', '#v': 'version' },
        ExpressionAttributeValues: {
          ':dup': 'paid_duplicate',
          ':created': 'created',
          ':pending': 'pending',
          ':gpid': gatewayPaymentId || null,
          ':ik': eventKey,
          ':prior': priorPaidPaymentId,
          ':fr': 'duplicate_journey_payment',
          ':pa': patch.updatedAt,
          ':ua': patch.updatedAt,
          ':ub': patch.updatedBy,
          ':nv': patch.version,
          ':cv': payment.version ?? 0,
        },
      }).promise();
    } catch (e) {
      if (e.code !== 'ConditionalCheckFailedException') throw e;
    }
    await putJourneyIndexSibling(
      payment.companyId,
      payment.journeyInstanceId,
      payment.id,
      'paid_duplicate',
      payment.amountPaise,
    );
  }

  /**
   * Read-only payment status for the public journey UI poll.
   * Returns null when missing or not owned by this companyId + journeyInstanceId
   * (GetItem on PAYMENT#{companyId}#{paymentId} + field match — never Scan).
   */
  async function getPaymentStatus({ companyId, journeyInstanceId, paymentId }) {
    if (!companyId || !journeyInstanceId || !paymentId) return null;
    const { Item: payment } = await db.get({
      TableName: TABLE(),
      Key: { PK: paymentPK(companyId, paymentId), SK: paymentMetaSK() },
    }).promise();
    if (!payment) return null;
    // Defense-in-depth: PK already scopes company; still reject mismatched fields
    // so a wrong journey (or corrupted row) never leaks another booking's status.
    if (payment.companyId && payment.companyId !== companyId) return null;
    if (payment.journeyInstanceId !== journeyInstanceId) return null;
    return {
      paymentId: payment.id,
      status: payment.status,
      amountPaise: payment.amountPaise,
      currency: payment.currency || 'INR',
    };
  }

  return {
    createCheckoutSession,
    confirmGatewayPayment,
    getPaymentStatus,
    PaymentError,
    tryReuseActiveCheckout,
  };
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

const defaultService = createPaymentService();

module.exports = {
  createPaymentService,
  createCheckoutSession: defaultService.createCheckoutSession,
  confirmGatewayPayment: defaultService.confirmGatewayPayment,
  getPaymentStatus: defaultService.getPaymentStatus,
  PaymentError,
  normalizeSubmittedData,
};
