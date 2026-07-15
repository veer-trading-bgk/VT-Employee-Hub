'use strict';

/**
 * Contract tests for POST /api/tags and PUT /api/tags/:id, focused on the
 * aiAssignable field added alongside label/color. Invokes the real registered
 * route handlers directly (no HTTP layer), dynamodb mocked — same convention
 * as tests/whatsappNotes.test.js.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(),
  put: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const tagsRouter = require('../src/routes/tags');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockCatalog(tags) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { tags } }) });
}

describe('POST /api/tags', () => {
  beforeEach(() => jest.clearAllMocks());

  test('defaults aiAssignable to false when not provided', async () => {
    mockCatalog([]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(tagsRouter, '/', 'post');

    const req = { body: { label: 'Hot Lead' }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      tag: expect.objectContaining({ label: 'Hot Lead', aiAssignable: false }),
    }));
    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.tags[0].aiAssignable).toBe(false);
  });

  test('honors an explicit aiAssignable: true', async () => {
    mockCatalog([]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(tagsRouter, '/', 'post');

    const req = { body: { label: 'KYC Pending', aiAssignable: true }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      tag: expect.objectContaining({ aiAssignable: true }),
    }));
  });

  test('coerces a truthy non-boolean aiAssignable to a real boolean', async () => {
    mockCatalog([]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(tagsRouter, '/', 'post');

    const req = { body: { label: 'Test', aiAssignable: 'yes' }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      tag: expect.objectContaining({ aiAssignable: true }),
    }));
  });

  test('still rejects a missing label with 400 (unchanged existing behavior)', async () => {
    const handler = getRouteHandler(tagsRouter, '/', 'post');
    const req = { body: {}, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('still rejects a duplicate label with 409 (unchanged existing behavior)', async () => {
    mockCatalog([{ id: 't_1', label: 'Hot Lead', color: '#fff' }]);
    const handler = getRouteHandler(tagsRouter, '/', 'post');
    const req = { body: { label: 'hot lead' }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

describe('PUT /api/tags/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates aiAssignable only, leaving label/color untouched', async () => {
    mockCatalog([{ id: 't_1', label: 'Hot Lead', color: '#f00', aiAssignable: false }]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(tagsRouter, '/:id', 'put');

    const req = { params: { id: 't_1' }, body: { aiAssignable: true }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      tag: { id: 't_1', label: 'Hot Lead', color: '#f00', aiAssignable: true },
    }));
  });

  test('updating label/color without aiAssignable in the body leaves aiAssignable untouched', async () => {
    mockCatalog([{ id: 't_1', label: 'Hot Lead', color: '#f00', aiAssignable: true }]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(tagsRouter, '/:id', 'put');

    const req = { params: { id: 't_1' }, body: { label: 'Warm Lead' }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.tag.label).toBe('Warm Lead');
    expect(body.tag.aiAssignable).toBe(true);
  });

  test('aiAssignable: false explicitly turns it back off', async () => {
    mockCatalog([{ id: 't_1', label: 'Hot Lead', color: '#f00', aiAssignable: true }]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(tagsRouter, '/:id', 'put');

    const req = { params: { id: 't_1' }, body: { aiAssignable: false }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.json.mock.calls[0][0].tag.aiAssignable).toBe(false);
  });

  test('404s on a nonexistent tag id, no write', async () => {
    mockCatalog([]);
    const handler = getRouteHandler(tagsRouter, '/:id', 'put');
    const req = { params: { id: 't_missing' }, body: { aiAssignable: true }, user: { companyId: 'acme', id: 'emp_1', role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});
