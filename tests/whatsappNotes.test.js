'use strict';

/**
 * Contract test for the one real internal-notes write endpoint. Written after
 * discovering the Customer 360 Notes tab had been posting to
 * /api/crm/leads/:id/note — a route that never existed in crm.js — since the
 * very first Customer 360 scaffolding commit. Invokes the actual registered
 * route handler directly (no HTTP layer, no auth token — dynamodb is mocked)
 * so a future accidental URL/field-name drift on either side fails CI instead
 * of shipping silently, the way this one did.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

// whatsapp.js refuses to load without this (real S3 client instantiation at
// require time, no network call) — not exercised by these handler tests.
process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const whatsappRouter = require('../src/routes/whatsapp');
const crmRouter = require('../src/routes/crm');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle; // last middleware in the chain = the actual handler
}

describe('POST /api/whatsapp/inbox/:leadId/note', () => {
  beforeEach(() => jest.clearAllMocks());

  test('route is registered', () => {
    expect(getRouteHandler(whatsappRouter, '/inbox/:leadId/note', 'post')).toBeInstanceOf(Function);
  });

  test('writes NOTE#<timestamp> under LEAD#<companyId>#<leadId>, keyed on body.content', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note', 'post');

    const req = {
      params: { leadId: 'lead_123' },
      body: { content: 'Called back, will decide by Friday' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const [putArgs] = dynamodb.put.mock.calls[0];
    expect(putArgs.Item.PK).toBe('LEAD#acme#lead_123');
    expect(putArgs.Item.SK).toMatch(/^NOTE#/);
    expect(putArgs.Item.content).toBe('Called back, will decide by Friday');
    expect(putArgs.Item.authorName).toBe('Test Agent');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('rejects an empty/whitespace-only note with 400 and never writes', async () => {
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note', 'post');
    const req = {
      params: { leadId: 'lead_123' },
      body: { content: '   ' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // Guards against reintroducing a second, competing notes-write endpoint in
  // crm.js — there should be exactly one notes route in the whole backend.
  test('crm.js does not define a competing /leads/:id/note route', () => {
    expect(getRouteHandler(crmRouter, '/leads/:id/note', 'post')).toBeNull();
  });
});

describe('PUT /api/whatsapp/inbox/:leadId/note/:timestamp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('route is registered', () => {
    expect(getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'put')).toBeInstanceOf(Function);
  });

  test('author can edit their own note', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { authorId: 'emp_1', content: 'old text' } }),
    });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'put');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: { content: 'corrected text' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent', role: 'telecaller' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(dynamodb.update).toHaveBeenCalledTimes(1);
    const [updateArgs] = dynamodb.update.mock.calls[0];
    expect(updateArgs.Key).toEqual({ PK: 'LEAD#acme#lead_123', SK: 'NOTE#2026-07-03T10:00:00.000Z' });
    expect(updateArgs.ExpressionAttributeValues[':c']).toBe('corrected text');
    // content/mentions/editedAt must be aliased via ExpressionAttributeNames — several
    // ordinary-looking words are reserved in DynamoDB's UpdateExpression grammar, and a
    // mocked dynamodb.update() won't catch a real reserved-word failure the way this would.
    expect(updateArgs.ExpressionAttributeNames).toEqual(
      expect.objectContaining({ '#content': 'content', '#editedAt': 'editedAt' }),
    );
    expect(updateArgs.UpdateExpression).not.toMatch(/(?<!#)\bcontent\s*=/); // must use #content, not bare `content`
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('a different non-manager agent cannot edit someone else\'s note (403, no write)', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { authorId: 'emp_1', content: 'old text' } }),
    });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'put');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: { content: 'tampered text' },
      user: { companyId: 'acme', id: 'emp_2', name: 'Other Agent', role: 'telecaller' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('a manager can edit any note even if not the author', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { authorId: 'emp_1', content: 'old text' } }),
    });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'put');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: { content: 'manager correction' },
      user: { companyId: 'acme', id: 'emp_manager', name: 'Manager', role: 'manager' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.update).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('404s on a nonexistent note without writing', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'put');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: { content: 'x' },
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent', role: 'telecaller' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('DELETE /api/whatsapp/inbox/:leadId/note/:timestamp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('route is registered', () => {
    expect(getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'delete')).toBeInstanceOf(Function);
  });

  test('author can delete their own note', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { authorId: 'emp_1', content: 'text' } }),
    });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'delete');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: {},
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent', role: 'telecaller' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.delete).toHaveBeenCalledTimes(1);
    const [deleteArgs] = dynamodb.delete.mock.calls[0];
    expect(deleteArgs.Key).toEqual({ PK: 'LEAD#acme#lead_123', SK: 'NOTE#2026-07-03T10:00:00.000Z' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('a different non-manager agent cannot delete someone else\'s note (403, no delete)', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { authorId: 'emp_1', content: 'text' } }),
    });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'delete');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: {},
      user: { companyId: 'acme', id: 'emp_2', name: 'Other Agent', role: 'telecaller' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('404s on a nonexistent note without deleting', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/inbox/:leadId/note/:timestamp', 'delete');

    const req = {
      params: { leadId: 'lead_123', timestamp: '2026-07-03T10:00:00.000Z' },
      body: {},
      user: { companyId: 'acme', id: 'emp_1', name: 'Test Agent', role: 'telecaller' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handler(req, res, next);

    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
