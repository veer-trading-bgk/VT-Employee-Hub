'use strict';

/**
 * Public checkout route tests — token 404, amount injection, no secrets in response.
 * Gateway fully mocked — no live Razorpay charge.
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-wa-media';
process.env.PUBLIC_ASSETS_BUCKET = process.env.PUBLIC_ASSETS_BUCKET || 'apforce-public-assets-test';
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/config/s3', () => ({
  s3Client: { getSignedUrl: jest.fn(() => 'https://s3.example.com/presigned-put') },
  MEDIA_BUCKET: 'test-wa-media',
  PUBLIC_ASSETS_BUCKET: 'apforce-public-assets-test',
}));
jest.mock('../src/services/AutomationEngine', () => ({
  resumeOnWebhook: jest.fn(),
}));
jest.mock('../src/utils/featureFlags', () => ({
  isEnabled: jest.fn().mockResolvedValue(true),
  getFlags: jest.fn(),
  DEFAULTS: { journeys_platform: false },
  _clearCache: jest.fn(),
}));

const crypto = require('crypto');
const dynamodb = require('../src/config/dynamodb');
const { isEnabled } = require('../src/utils/featureFlags');
const {
  journeyDefPK,
  journeyDefSK,
  journeyPK,
  journeyMetaSK,
  paymentMetaSK,
  paymentOrderLookupSK,
} = require('../src/core/entityKeys');
const journeysRouter = require('../src/routes/journeys');
const { createPaymentService } = require('../src/services/PaymentService');

const CID = 'comp_test';
const DEF_ID = 'journeydef_01TESTDEF000000000000000';
const JOURNEY_ID = 'journey_01TESTINSTANCE00000000000';
const RAW_TOKEN = 'a'.repeat(48);
const TOKEN_HASH = crypto.createHash('sha256').update(RAW_TOKEN).digest('hex');

const resolved = (value) => ({ promise: () => Promise.resolve(value) });

function openInstance(overrides = {}) {
  return {
    id: JOURNEY_ID,
    companyId: CID,
    journeyDefId: DEF_ID,
    status: 'opened',
    tokenHash: TOKEN_HASH,
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    version: 1,
    ...overrides,
  };
}

function pricedDef() {
  return {
    id: DEF_ID,
    name: 'Event Booking',
    screens: [{
      id: 's1',
      title: 'Tickets',
      fields: [{ id: 'qty', label: 'Tickets', type: 'number', unitPrice: 500 }],
    }],
    gstEnabled: true,
    gstPercent: 18,
    gstMode: 'exclusive',
  };
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function installMockPaymentService() {
  const createOrder = jest.fn(async (amountPaise) => ({ orderId: `order_${amountPaise}` }));
  const gateway = {
    createOrder,
    getPublicKeyId: () => 'rzp_test_key',
    verifyWebhook: () => { throw new Error('not wired'); },
    fetchPayment: async () => { throw new Error('not wired'); },
  };
  const svc = createPaymentService({ db: dynamodb, gateway });
  journeysRouter._setPaymentServiceForTests(svc);
  return { createOrder, gateway, svc };
}

beforeEach(() => {
  jest.clearAllMocks();
  isEnabled.mockResolvedValue(true);
  dynamodb.put.mockReturnValue(resolved({}));
  dynamodb.get.mockReturnValue(resolved({}));
  dynamodb.update.mockReturnValue(resolved({}));
  installMockPaymentService();
});

describe('POST /api/journeys/.../checkout', () => {
  const handler = journeysRouter.handlePublicCheckout;

  test('valid token + values → PAYMENT# + Order; response has no secrets', async () => {
    const { createOrder } = installMockPaymentService();
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === journeyMetaSK()) return resolved({ Item: openInstance() });
      if (params.Key.SK === journeyDefSK(DEF_ID)) return resolved({ Item: pricedDef() });
      return resolved({});
    });

    const puts = [];
    dynamodb.put.mockImplementation((params) => {
      puts.push(params.Item);
      return resolved({});
    });

    const res = mockRes();
    await handler({
      params: { companyId: CID, journeyInstanceId: JOURNEY_ID, token: RAW_TOKEN },
      headers: {},
      body: {
        submittedData: { qty: '3' },
        amount: 1,
        amountPaise: 99,
        total: 1,
      },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.order_id).toBe('order_177000');
    expect(body.key_id).toBe('rzp_test_key');
    expect(body.amount).toBe(177000);
    expect(body.currency).toBe('INR');
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
    expect(body.key_secret).toBeUndefined();
    expect(body.RAZORPAY_KEY_SECRET).toBeUndefined();

    expect(createOrder).toHaveBeenCalledWith(177000, 'INR', expect.any(String));

    const payment = puts.find((i) => i.SK === paymentMetaSK());
    expect(payment.amountPaise).toBe(177000);
    expect(payment.pricingSnapshot.total).toBe(1770);
    expect(puts.some((i) => i.SK === paymentOrderLookupSK())).toBe(true);
  });

  test('invalid token → 404; no PAYMENT# created', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: openInstance() }));
    const res = mockRes();
    await handler({
      params: { companyId: CID, journeyInstanceId: JOURNEY_ID, token: 'wrong' },
      headers: {},
      body: { submittedData: { qty: '3' } },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('expired token → 404; no PAYMENT#', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: openInstance({ tokenExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    }));
    const res = mockRes();
    await handler({
      params: { companyId: CID, journeyInstanceId: JOURNEY_ID, token: RAW_TOKEN },
      headers: {},
      body: { submittedData: { qty: '3' } },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('free definition → 400 not_payable; no Order', async () => {
    const { createOrder } = installMockPaymentService();
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === journeyMetaSK()) return resolved({ Item: openInstance() });
      if (params.Key.SK === journeyDefSK(DEF_ID)) {
        return resolved({
          Item: {
            id: DEF_ID,
            screens: [{ id: 's1', fields: [{ id: 'name', type: 'text', label: 'Name' }] }],
          },
        });
      }
      return resolved({});
    });

    const res = mockRes();
    await handler({
      params: { companyId: CID, journeyInstanceId: JOURNEY_ID, token: RAW_TOKEN },
      headers: {},
      body: { submittedData: { name: 'Ada' } },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('not_payable');
    expect(createOrder).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});
