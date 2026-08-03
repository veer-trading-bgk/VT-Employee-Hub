'use strict';

/**
 * PaymentService — PAYMENT# before Order, frozen amountPaise, ignore client totals.
 * Gateway is fully mocked — no live Razorpay calls.
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const {
  paymentPK,
  paymentMetaSK,
  paymentOrderLookupPK,
  paymentOrderLookupSK,
  journeyDefPK,
  journeyDefSK,
} = require('../src/core/entityKeys');
const { createPaymentService, PaymentError } = require('../src/services/PaymentService');

const CID = 'comp_pay';
const DEF_ID = 'journeydef_01PAYDEF0000000000000000';
const JOURNEY_ID = 'journey_01PAYINST00000000000000';

const pricedDef = {
  id: DEF_ID,
  screens: [{
    id: 's1',
    title: 'Tickets',
    fields: [{ id: 'qty', label: 'Tickets', type: 'number', unitPrice: 500 }],
  }],
  gstEnabled: true,
  gstPercent: 18,
  gstMode: 'exclusive',
};

function mockDb({ definition = pricedDef } = {}) {
  const puts = [];
  const updates = [];
  return {
    puts,
    updates,
    get: jest.fn(({ Key }) => {
      if (Key.PK === journeyDefPK(CID) && Key.SK === journeyDefSK(DEF_ID)) {
        return { promise: () => Promise.resolve({ Item: definition }) };
      }
      return { promise: () => Promise.resolve({}) };
    }),
    put: jest.fn((params) => {
      puts.push(params.Item);
      return { promise: () => Promise.resolve({}) };
    }),
    update: jest.fn((params) => {
      updates.push(params);
      return { promise: () => Promise.resolve({}) };
    }),
    query: jest.fn(() => ({ promise: () => Promise.resolve({ Items: [] }) })),
  };
}

function mockGateway() {
  const createOrder = jest.fn(async (amountPaise) => ({
    orderId: `order_test_${amountPaise}`,
  }));
  return {
    createOrder,
    verifyWebhook: jest.fn(() => { throw new Error('not wired'); }),
    fetchPayment: jest.fn(async () => { throw new Error('not wired'); }),
    getPublicKeyId: jest.fn(() => 'rzp_test_public_key'),
  };
}

describe('PaymentService.createCheckoutSession', () => {
  test('PAYMENT# written before createOrder; Order uses frozen amountPaise (177000)', async () => {
    const db = mockDb();
    const gateway = mockGateway();
    const orderCallOrder = [];
    gateway.createOrder.mockImplementation(async (amountPaise) => {
      orderCallOrder.push('order');
      // At Order time, PAYMENT put must already have happened with this amount.
      const paymentPut = db.puts.find((i) => i.SK === paymentMetaSK());
      expect(paymentPut).toBeTruthy();
      expect(paymentPut.amountPaise).toBe(amountPaise);
      expect(paymentPut.gatewayOrderId).toBeNull();
      expect(paymentPut.status).toBe('created');
      return { orderId: 'order_ABC' };
    });
    db.put.mockImplementation((params) => {
      if (params.Item.SK === paymentMetaSK()) orderCallOrder.push('payment');
      db.puts.push(params.Item);
      return { promise: () => Promise.resolve({}) };
    });

    const svc = createPaymentService({ db, gateway });
    const result = await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
      clientBody: { amount: 1, amountPaise: 1, total: 1 },
    });

    expect(orderCallOrder[0]).toBe('payment');
    expect(orderCallOrder[1]).toBe('order');
    expect(gateway.createOrder).toHaveBeenCalledWith(177000, 'INR', expect.stringMatching(/^payment_/));
    expect(result.orderId).toBe('order_ABC');
    expect(result.amountPaise).toBe(177000);
    expect(result.keyId).toBe('rzp_test_public_key');

    const payment = db.puts.find((i) => i.SK === paymentMetaSK());
    expect(payment.pricingSnapshot.total).toBe(1770);
    expect(payment.pricingSnapshot.gstAmount).toBe(270);
    expect(payment.submittedData).toEqual({ qty: '3' });

    expect(db.update).toHaveBeenCalled();
    const lookup = db.puts.find((i) => i.SK === paymentOrderLookupSK());
    expect(lookup.PK).toBe(paymentOrderLookupPK('razorpay', 'order_ABC'));
    expect(lookup.paymentId).toBe(payment.id);
  });

  test('client-injected amount fields are ignored — server amount wins', async () => {
    const db = mockDb();
    const gateway = mockGateway();
    const svc = createPaymentService({ db, gateway });

    await svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '3' },
      clientBody: {
        amount: 100,
        amountPaise: 100,
        total: 100,
        pricingSnapshot: { total: 100 },
        gstAmount: 0,
      },
    });

    expect(gateway.createOrder.mock.calls[0][0]).toBe(177000);
    const payment = db.puts.find((i) => i.SK === paymentMetaSK());
    expect(payment.amountPaise).toBe(177000);
    expect(payment.pricingSnapshot.total).toBe(1770);
  });

  test('free journey (no unitPrice) → not_payable, no PAYMENT# / no Order', async () => {
    const db = mockDb({
      definition: {
        id: DEF_ID,
        screens: [{ id: 's1', fields: [{ id: 'name', type: 'text', label: 'Name' }] }],
        gstEnabled: true,
        gstPercent: 18,
      },
    });
    const gateway = mockGateway();
    const svc = createPaymentService({ db, gateway });

    await expect(svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { name: 'Ada' },
    })).rejects.toMatchObject({ code: 'not_payable', status: 400 });

    expect(db.put).not.toHaveBeenCalled();
    expect(gateway.createOrder).not.toHaveBeenCalled();
  });

  test('zero payable total (qty 0) → not_payable', async () => {
    const db = mockDb();
    const gateway = mockGateway();
    const svc = createPaymentService({ db, gateway });

    await expect(svc.createCheckoutSession({
      companyId: CID,
      instance: { id: JOURNEY_ID, journeyDefId: DEF_ID },
      submittedData: { qty: '0' },
    })).rejects.toBeInstanceOf(PaymentError);

    expect(gateway.createOrder).not.toHaveBeenCalled();
  });
});

describe('RazorpayGateway confinement', () => {
  test('RazorpayGateway.verifyWebhook fails closed without secret', () => {
    const RazorpayGateway = require('../src/services/payment/RazorpayGateway');
    const gw = new RazorpayGateway({ keyId: 'k', keySecret: 's', webhookSecret: null });
    expect(gw.verifyWebhook('{}', 'sig')).toBe(false);
  });

  test('PaymentService require graph does not load razorpay when gateway is injected', () => {
    jest.isolateModules(() => {
      const Module = require('module');
      const orig = Module.prototype.require;
      let razorpayLoaded = false;
      Module.prototype.require = function patched(id) {
        if (id === 'razorpay') {
          razorpayLoaded = true;
          throw new Error('razorpay must not load when gateway is injected');
        }
        return orig.apply(this, arguments);
      };
      try {
        require('../src/lib/journeyPricing');
        const { createPaymentService } = require('../src/services/PaymentService');
        createPaymentService({
          gateway: {
            createOrder: async () => ({ orderId: 'x' }),
            getPublicKeyId: () => 'k',
            verifyWebhook: () => false,
            fetchPayment: async () => ({}),
          },
          db: {
            get: () => ({ promise: async () => ({}) }),
            put: () => ({ promise: async () => ({}) }),
            update: () => ({ promise: async () => ({}) }),
          },
        });
        expect(razorpayLoaded).toBe(false);
      } finally {
        Module.prototype.require = orig;
      }
    });
  });

  test('trims whitespace on secrets from env (Lambda paste footgun)', () => {
    const RazorpayGateway = require('../src/services/payment/RazorpayGateway');
    const gw = new RazorpayGateway({
      keyId: ' rzp_test_x ',
      keySecret: 'secret_with_trailing_ws ',
      webhookSecret: ' whsec ',
    });
    expect(gw.keyId).toBe('rzp_test_x');
    expect(gw.keySecret).toBe('secret_with_trailing_ws');
    expect(gw.webhookSecret).toBe('whsec');
  });
});

describe('PaymentService.getPaymentStatus', () => {
  test('returns status when payment belongs to journey; null otherwise', async () => {
    const store = new Map();
    const key = (PK, SK) => `${PK}||${SK}`;
    const db = {
      get: jest.fn(({ Key }) => ({
        promise: async () => ({ Item: store.get(key(Key.PK, Key.SK)) }),
      })),
      put: jest.fn(),
      update: jest.fn(),
      query: jest.fn(),
    };
    store.set(`${paymentPK(CID, 'payment_abc')}||${paymentMetaSK()}`, {
      id: 'payment_abc',
      companyId: CID,
      journeyInstanceId: JOURNEY_ID,
      status: 'paid',
      amountPaise: 100,
      currency: 'INR',
    });
    const svc = createPaymentService({
      db,
      gateway: { createOrder: async () => ({ orderId: 'o' }), getPublicKeyId: () => 'k' },
    });
    const ok = await svc.getPaymentStatus({
      companyId: CID,
      journeyInstanceId: JOURNEY_ID,
      paymentId: 'payment_abc',
    });
    expect(ok).toEqual({
      paymentId: 'payment_abc',
      status: 'paid',
      amountPaise: 100,
      currency: 'INR',
    });
    const wrongJourney = await svc.getPaymentStatus({
      companyId: CID,
      journeyInstanceId: 'journey_other',
      paymentId: 'payment_abc',
    });
    expect(wrongJourney).toBeNull();

    // Same paymentId under a different company PK → GetItem miss → null
    const wrongCompany = await svc.getPaymentStatus({
      companyId: 'comp_other',
      journeyInstanceId: JOURNEY_ID,
      paymentId: 'payment_abc',
    });
    expect(wrongCompany).toBeNull();
    expect(db.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: paymentPK('comp_other', 'payment_abc'), SK: paymentMetaSK() },
    }));
  });

  test('rejects when META.companyId mismatches path companyId (defense-in-depth)', async () => {
    const store = new Map();
    const key = (PK, SK) => `${PK}||${SK}`;
    const db = {
      get: jest.fn(({ Key }) => ({
        promise: async () => ({ Item: store.get(key(Key.PK, Key.SK)) }),
      })),
    };
    store.set(`${paymentPK(CID, 'payment_x')}||${paymentMetaSK()}`, {
      id: 'payment_x',
      companyId: 'comp_tampered',
      journeyInstanceId: JOURNEY_ID,
      status: 'paid',
      amountPaise: 50,
      currency: 'INR',
    });
    const svc = createPaymentService({
      db,
      gateway: { createOrder: async () => ({ orderId: 'o' }), getPublicKeyId: () => 'k' },
    });
    expect(await svc.getPaymentStatus({
      companyId: CID,
      journeyInstanceId: JOURNEY_ID,
      paymentId: 'payment_x',
    })).toBeNull();
  });
});
