'use strict';

/**
 * Contract tests for CONFIG#BRANCH# CRUD (Item 1c) — the office directory
 * shared by the Send Location canvas node's dropdown and the Inbox
 * composer's own "Send Location" button.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(), sendLocation: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const whatsappRouter = require('../src/routes/whatsapp');
const { branchSchema } = require('../src/utils/validation');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { companyId: 'acme' };

describe('branchSchema', () => {
  test('accepts a valid branch', () => {
    expect(branchSchema.safeParse({ name: 'HQ', address: '1 MG Road', latitude: 12.97, longitude: 77.59 }).success).toBe(true);
  });
  test('rejects a missing name', () => {
    expect(branchSchema.safeParse({ latitude: 1, longitude: 2 }).success).toBe(false);
  });
  test('rejects an out-of-range latitude/longitude', () => {
    expect(branchSchema.safeParse({ name: 'x', latitude: 200, longitude: 2 }).success).toBe(false);
    expect(branchSchema.safeParse({ name: 'x', latitude: 1, longitude: 200 }).success).toBe(false);
  });
});

describe('GET /api/whatsapp/branches', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists all branches for the company', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [
      { branchId: 'b1', name: 'HQ', latitude: 1, longitude: 2 },
      { branchId: 'b2', name: 'Branch 2', latitude: 3, longitude: 4 },
    ] }) });
    const handler = getRouteHandler(whatsappRouter, '/branches', 'get');
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':pk': 'CONFIG#BRANCH#acme' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, branches: expect.arrayContaining([expect.objectContaining({ branchId: 'b1' })]),
    }));
  });
});

describe('POST /api/whatsapp/branches', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects invalid input with 400 and never writes', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/branches', 'post');
    const res = mockRes();
    await handler({ body: { name: '' }, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('creates a new branch with a generated branchId', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/branches', 'post');
    const res = mockRes();
    await handler({ body: { name: 'HQ Office', address: '1 MG Road', latitude: 12.97, longitude: 77.59 }, user: USER }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: 'CONFIG#BRANCH#acme', name: 'HQ Office', latitude: 12.97, longitude: 77.59,
        branchId: expect.any(String),
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('PUT /api/whatsapp/branches/:branchId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('404s when the branch does not exist', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/branches/:branchId', 'put');
    const res = mockRes();
    await handler({ params: { branchId: 'missing' }, body: { name: 'x', latitude: 1, longitude: 2 }, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('updates an existing branch', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { branchId: 'b1' } }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/branches/:branchId', 'put');
    const res = mockRes();
    await handler({ params: { branchId: 'b1' }, body: { name: 'Renamed HQ', latitude: 1, longitude: 2 }, user: USER }, res, jest.fn());
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ branchId: 'b1', name: 'Renamed HQ' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('DELETE /api/whatsapp/branches/:branchId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes the branch', async () => {
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/branches/:branchId', 'delete');
    const res = mockRes();
    await handler({ params: { branchId: 'b1' }, user: USER }, res, jest.fn());
    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'CONFIG#BRANCH#acme', SK: 'BRANCH#b1' },
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
