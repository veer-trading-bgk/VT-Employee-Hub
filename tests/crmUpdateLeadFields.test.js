'use strict';

/**
 * Regression tests for the 2026-07-09 fix (docs/phase3/TECHNICAL_DEBT.md):
 * updateLeadSchema had no expectedValue/probability fields at all, so
 * CrmTab.tsx's "Expected Value"/"Win Probability" save 400'd unconditionally
 * in production. Same direct-handler-invocation technique as
 * tests/crmValidation.test.js: no HTTP, no auth, dynamodb/logger mocked.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const crmRouter = require('../src/routes/crm');
const { updateLeadSchema } = require('../src/utils/validation');

function getRouteHandler(path, method) {
  const layer = crmRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { companyId: 'acme', id: 'emp_1', role: 'admin' };
const LEAD_ID = 'lead_123';
const PK = `LEAD#acme#${LEAD_ID}`;

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

describe('updateLeadSchema — expectedValue/probability', () => {
  test('accepts valid values for both', () => {
    expect(updateLeadSchema.safeParse({ expectedValue: 50000, probability: 70 }).success).toBe(true);
  });
  test('accepts null for either (explicit clear)', () => {
    expect(updateLeadSchema.safeParse({ expectedValue: null }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ probability: null }).success).toBe(true);
  });
  test('accepts omission of either (untouched by this update)', () => {
    expect(updateLeadSchema.safeParse({ name: 'x' }).success).toBe(true);
  });
  test('accepts boundary values: expectedValue 0, probability 0 and 100', () => {
    expect(updateLeadSchema.safeParse({ expectedValue: 0 }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ probability: 0 }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ probability: 100 }).success).toBe(true);
  });
  test('rejects negative expectedValue', () => {
    expect(updateLeadSchema.safeParse({ expectedValue: -1 }).success).toBe(false);
  });
  test('rejects negative probability and probability over 100', () => {
    expect(updateLeadSchema.safeParse({ probability: -1 }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ probability: 101 }).success).toBe(false);
  });
});

describe('PUT /api/crm/leads/:id — expectedValue/probability persistence', () => {
  beforeEach(() => jest.clearAllMocks());

  function existingLead(overrides = {}) {
    return { PK, SK: 'METADATA', leadId: LEAD_ID, companyId: 'acme', assignedTo: 'emp_1', phone: '9000000000', ...overrides };
  }

  test('expectedValue alone: validates, persists, leaves probability untouched', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: existingLead() }));
    dynamodb.update.mockReturnValue(resolved({}));
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: LEAD_ID }, body: { expectedValue: 75000 }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const [call] = dynamodb.update.mock.calls;
    expect(call[0].ExpressionAttributeValues[':expectedValue']).toBe(75000);
    expect(call[0].ExpressionAttributeValues).not.toHaveProperty(':probability');
  });

  test('probability alone: validates, persists, leaves expectedValue untouched', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: existingLead() }));
    dynamodb.update.mockReturnValue(resolved({}));
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: LEAD_ID }, body: { probability: 60 }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const [call] = dynamodb.update.mock.calls;
    expect(call[0].ExpressionAttributeValues[':probability']).toBe(60);
    expect(call[0].ExpressionAttributeValues).not.toHaveProperty(':expectedValue');
  });

  test('both together: validates, persists both, matches CrmTab.tsx\'s real save payload shape', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: existingLead() }));
    dynamodb.update.mockReturnValue(resolved({}));
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({
      params: { id: LEAD_ID },
      body: {
        source: 'manual', productInterest: ['kyc'], closureDeadline: null, notes: 'hot lead',
        expectedValue: 120000, probability: 80,
      },
      user: USER,
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const [call] = dynamodb.update.mock.calls;
    expect(call[0].ExpressionAttributeValues[':expectedValue']).toBe(120000);
    expect(call[0].ExpressionAttributeValues[':probability']).toBe(80);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('neither field present: existing unrelated fields still update normally (regression)', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: existingLead() }));
    dynamodb.update.mockReturnValue(resolved({}));
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: LEAD_ID }, body: { notes: 'just a note update' }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const [call] = dynamodb.update.mock.calls;
    expect(call[0].ExpressionAttributeValues[':notes']).toBe('just a note update');
    expect(call[0].ExpressionAttributeValues).not.toHaveProperty(':expectedValue');
    expect(call[0].ExpressionAttributeValues).not.toHaveProperty(':probability');
  });

  test('explicit null clears a previously-set value', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: existingLead({ expectedValue: 50000, probability: 40 }) }));
    dynamodb.update.mockReturnValue(resolved({}));
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: LEAD_ID }, body: { expectedValue: null, probability: null }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const [call] = dynamodb.update.mock.calls;
    expect(call[0].ExpressionAttributeValues[':expectedValue']).toBeNull();
    expect(call[0].ExpressionAttributeValues[':probability']).toBeNull();
  });

  test('negative expectedValue is rejected with 400 and never writes', async () => {
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: LEAD_ID }, body: { expectedValue: -500 }, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('probability over 100 is rejected with 400 and never writes', async () => {
    const handler = getRouteHandler('/leads/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: LEAD_ID }, body: { probability: 150 }, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});
