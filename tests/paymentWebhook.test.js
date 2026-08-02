'use strict';

/**
 * Payment PR 2 — webhook confirm, duplicate guard, checkout dedup, resume atomicity.
 * Gateway + AutomationEngine fully mocked — no live Razorpay.
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const crypto = require('crypto');
const {
  paymentPK,
  paymentMetaSK,
  paymentOrderLookupPK,
  paymentOrderLookupSK,
  paymentJourneyPK,
  paymentJourneyActiveSK,
  paymentJourneyPaymentSK,
  paymentEventClaimPK,
  journeyDefPK,
  journeyDefSK,
} = require('../src/core/entityKeys');
const { createPaymentService, PaymentError } = require('../src/services/PaymentService');
const { verifyRazorpayWebhookSignature } = require('../src/utils/verifyRazorpayWebhookSignature');

const CID = 'comp_pay2';
const DEF_ID = 'journeydef_01PAY2DEF000000000000000';
const JOURNEY_ID = 'journey_01PAY2INST0000000000000';

const pricedDef = {
  id: DEF_ID,
  screens: [{
    id: 's1',
    fields: [{ id: 'qty', label: 'Tickets', type: 'number', unitPrice: 500 }],
  }],
  gstEnabled: true,
  gstPercent: 18,
  gstMode: 'exclusive',
};

function mockDb() {
  const store = new Map();
  const key = (PK, SK) => `${PK}||${SK}`;
  return {
    store,
    get: jest.fn(({ Key }) => ({
      promise: async () => ({ Item: store.get(key(Key.PK, Key.SK)) }),
    })),
    put: jest.fn((params) => {
      const k = key(params.Item.PK, params.Item.SK);
      if (params.ConditionExpression === 'attribute_not_exists(PK)' && store.has(k)) {
        const err = new Error('ConditionalCheckFailed');
        err.code = 'ConditionalCheckFailedException';
        return { promise: async () => { throw err; } };
      }
      store.set(k, { ...params.Item });
      return { promise: async () => ({}) };
    }),
    update: jest.fn((params) => {
      const k = key(params.Key.PK, params.Key.SK);
      const cur = store.get(k);
      if (!cur) {
        const err = new Error('ConditionalCheckFailed');
        err.code = 'ConditionalCheckFailedException';
        return { promise: async () => { throw err; } };
      }
      // Minimal condition simulation for status/version
      const vals = params.ExpressionAttributeValues || {};
      if (params.ConditionExpression?.includes('#v = :cv')) {
        if ((cur.version ?? 0) !== vals[':cv']) {
          const err = new Error('ConditionalCheckFailed');
          err.code = 'ConditionalCheckFailedException';
          return { promise: async () => { throw err; } };
        }
      }
      if (params.ConditionExpression?.includes('#st = :created OR #st = :pending')) {
        if (cur.status !== 'created' && cur.status !== 'pending') {
          const err = new Error('ConditionalCheckFailed');
          err.code = 'ConditionalCheckFailedException';
          return { promise: async () => { throw err; } };
        }
      }
      const next = { ...cur };
      if (vals[':paid']) next.status = vals[':paid'];
      if (vals[':dup']) next.status = vals[':dup'];
      if (vals[':st']) next.status = vals[':st'];
      if (vals[':oid']) next.gatewayOrderId = vals[':oid'];
      if (vals[':gpid'] !== undefined) next.gatewayPaymentId = vals[':gpid'];
      if (vals[':ik']) next.idempotencyKey = vals[':ik'];
      if (vals[':pa']) next.paidAt = vals[':pa'];
      if (vals[':nv']) next.version = vals[':nv'];
      if (vals[':ua']) next.updatedAt = vals[':ua'];
      if (vals[':prior']) next.priorPaidPaymentId = vals[':prior'];
      if (vals[':fr']) next.failureReason = vals[':fr'];
      store.set(k, next);
      return { promise: async () => ({}) };
    }),
    query: jest.fn(({ KeyConditionExpression, ExpressionAttributeValues }) => {
      const pk = ExpressionAttributeValues[':pk'];
      const pfx = ExpressionAttributeValues[':pfx'];
      const Items = [];
      for (const [k, v] of store.entries()) {
        if (!k.startsWith(`${pk}||`)) continue;
        const sk = k.slice(pk.length + 2);
        if (pfx && !sk.startsWith(pfx)) continue;
        Items.push(v);
      }
      return { promise: async () => ({ Items }) };
    }),
  };
}

function seedDef(db) {
  db.store.set(
    `${journeyDefPK(CID)}||${journeyDefSK(DEF_ID)}`,
    pricedDef,
  );
}

describe('verifyRazorpayWebhookSignature', () => {
  const secret = 'whsec_test';

  test('rejects when secret is missing — fail closed (never treat unsigned as verified)', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const forgedSig = crypto.createHmac('sha256', 'anything').update(raw).digest('hex');
    expect(verifyRazorpayWebhookSignature(
      { headers: { 'x-razorpay-signature': forgedSig }, rawBody: raw },
      '',
    )).toBe(false);
    expect(verifyRazorpayWebhookSignature(
      { headers: { 'x-razorpay-signature': forgedSig }, rawBody: raw },
      undefined,
    )).toBe(false);
    expect(verifyRazorpayWebhookSignature(
      { headers: {}, rawBody: raw },
      null,
    )).toBe(false);
  });

  test('rejects missing/tampered signature when secret set; accepts valid HMAC', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const good = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyRazorpayWebhookSignature(
      { headers: { 'x-razorpay-signature': good }, rawBody: raw },
      secret,
    )).toBe(true);
    expect(verifyRazorpayWebhookSignature(
      { headers: { 'x-razorpay-signature': 'deadbeef' }, rawBody: raw },
      secret,
    )).toBe(false);
    expect(verifyRazorpayWebhookSignature(
      { headers: {}, rawBody: raw },
      secret,
    )).toBe(false);
    // Length mismatch must not throw (timingSafeEqual RangeError guard)
    expect(verifyRazorpayWebhookSignature(
      { headers: { 'x-razorpay-signature': 'short' }, rawBody: raw },
      secret,
    )).toBe(false);
  });
});

describe('PaymentService PR 2 — dedup + confirm', () => {
  let db;
  let gateway;
  let resumeOnWebhook;
  let alert;
  let svc;

  beforeEach(() => {
    db = mockDb();
    seedDef(db);
    gateway = {
      createOrder: jest.fn(async (amountPaise) => ({ orderId: `order_${amountPaise}` })),
      getPublicKeyId: () => 'rzp_test',
      verifyWebhook: () => true,
      fetchPayment: async () => ({}),
    };
    resumeOnWebhook = jest.fn(async () => ({ status: 'resumed', executionId: 'exec_1' }));
    alert = jest.fn();
    jest.spyOn(require('../src/config/logger'), 'alert').mockImplementation(alert);
    svc = createPaymentService({
      db,
      gateway,
      AutomationEngine: { resumeOnWebhook },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('checkout twice before pay → reuses same PAYMENT#/Order', async () => {
    const a = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    expect(a.reused).toBe(false);
    expect(gateway.createOrder).toHaveBeenCalledTimes(1);

    const b = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    expect(b.reused).toBe(true);
    expect(b.paymentId).toBe(a.paymentId);
    expect(b.orderId).toBe(a.orderId);
    expect(gateway.createOrder).toHaveBeenCalledTimes(1);
  });

  test('valid capture → paid + resume once', async () => {
    const checkout = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });

    const result = await svc.confirmGatewayPayment({
      orderId: checkout.orderId,
      amountPaise: 177000,
      gatewayPaymentId: 'pay_1',
      eventKey: 'evt_1',
    });
    expect(result.outcome).toBe('paid_resumed');
    expect(resumeOnWebhook).toHaveBeenCalledTimes(1);
    expect(resumeOnWebhook.mock.calls[0][2].submittedData).toEqual({ qty: '3' });

    const payment = db.store.get(`${paymentPK(CID, checkout.paymentId)}||${paymentMetaSK()}`);
    expect(payment.status).toBe('paid');
  });

  test('second payment for already-paid journey → paid_duplicate, alert, no second resume', async () => {
    const first = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    await svc.confirmGatewayPayment({
      orderId: first.orderId,
      amountPaise: 177000,
      gatewayPaymentId: 'pay_1',
      eventKey: 'evt_1',
    });
    expect(resumeOnWebhook).toHaveBeenCalledTimes(1);

    // Force a second payment row (bypass dedup by clearing ACTIVE + minting manually path:
    // clear ACTIVE so create makes a new one, then confirm with different order).
    db.store.delete(`${paymentJourneyPK(CID, JOURNEY_ID)}||${paymentJourneyActiveSK()}`);
    // Mark first sibling paid already present from confirm
    const second = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    expect(second.paymentId).not.toBe(first.paymentId);

    const dup = await svc.confirmGatewayPayment({
      orderId: second.orderId,
      amountPaise: 177000,
      gatewayPaymentId: 'pay_2',
      eventKey: 'evt_2',
    });
    expect(dup.outcome).toBe('paid_duplicate');
    expect(resumeOnWebhook).toHaveBeenCalledTimes(1); // no second resume
    expect(alert).toHaveBeenCalled();
    expect(alert.mock.calls.some((c) => String(c[0]).includes('paid_duplicate') || String(c[0]).includes('Duplicate'))).toBe(true);

    const payment = db.store.get(`${paymentPK(CID, second.paymentId)}||${paymentMetaSK()}`);
    expect(payment.status).toBe('paid_duplicate');
  });

  test('amount mismatch → not paid, alert', async () => {
    const checkout = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    const result = await svc.confirmGatewayPayment({
      orderId: checkout.orderId,
      amountPaise: 100,
      gatewayPaymentId: 'pay_x',
      eventKey: 'evt_amt',
    });
    expect(result.outcome).toBe('amount_mismatch');
    expect(resumeOnWebhook).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    const payment = db.store.get(`${paymentPK(CID, checkout.paymentId)}||${paymentMetaSK()}`);
    expect(payment.status).toBe('pending');
  });

  test('replayed event id → event_replay no-op', async () => {
    const checkout = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    await svc.confirmGatewayPayment({
      orderId: checkout.orderId,
      amountPaise: 177000,
      gatewayPaymentId: 'pay_1',
      eventKey: 'evt_same',
    });
    resumeOnWebhook.mockClear();
    const replay = await svc.confirmGatewayPayment({
      orderId: checkout.orderId,
      amountPaise: 177000,
      gatewayPaymentId: 'pay_1',
      eventKey: 'evt_same',
    });
    expect(replay.outcome).toBe('event_replay');
    expect(resumeOnWebhook).not.toHaveBeenCalled();
  });

  test('paid then resume throws → status stays paid, alert fired', async () => {
    resumeOnWebhook.mockRejectedValueOnce(new Error('DynamoDB timeout'));
    const checkout = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
    });
    const result = await svc.confirmGatewayPayment({
      orderId: checkout.orderId,
      amountPaise: 177000,
      gatewayPaymentId: 'pay_1',
      eventKey: 'evt_resume_fail',
    });
    expect(result.outcome).toBe('paid_resume_failed');
    const payment = db.store.get(`${paymentPK(CID, checkout.paymentId)}||${paymentMetaSK()}`);
    expect(payment.status).toBe('paid');
    expect(alert).toHaveBeenCalled();
    expect(String(alert.mock.calls[0][0])).toMatch(/paid.*resume/i);
  });
});

describe('Razorpay webhook route — signature gate', () => {
  test('invalid signature → 401, confirm never called', async () => {
    const prev = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_route_test';
    jest.resetModules();
    const payments = require('../src/routes/payments');
    const confirm = jest.fn();
    payments._setPaymentServiceForTests({ confirmGatewayPayment: confirm });

    const raw = Buffer.from(JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'o1', amount: 1, id: 'p1' } } },
    }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await payments.handleRazorpayWebhook({
      headers: { 'x-razorpay-signature': 'nope' },
      rawBody: raw,
      body: JSON.parse(raw.toString()),
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(confirm).not.toHaveBeenCalled();
    if (prev === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prev;
  });

  test('missing RAZORPAY_WEBHOOK_SECRET → 401 fail closed, confirm never called', async () => {
    const prev = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    jest.resetModules();
    const payments = require('../src/routes/payments');
    const confirm = jest.fn();
    payments._setPaymentServiceForTests({ confirmGatewayPayment: confirm });

    const raw = Buffer.from(JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'o1', amount: 1, id: 'p1' } } },
    }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await payments.handleRazorpayWebhook({
      headers: { 'x-razorpay-signature': 'anything' },
      rawBody: raw,
      body: JSON.parse(raw.toString()),
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(confirm).not.toHaveBeenCalled();
    if (prev === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = prev;
  });
});
