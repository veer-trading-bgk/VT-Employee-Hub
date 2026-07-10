'use strict';

/**
 * Regression test for a 2026-07-10 fix (docs/phase3/TECHNICAL_DEBT.md):
 * POST /api/whatsapp/templates and PUT /api/whatsapp/templates/:id now
 * accept and store a headerMediaRef field ({s3Key, mimeType, filename}) —
 * the S3 reference for a media (IMAGE/VIDEO/DOCUMENT) HEADER's example,
 * kept separate from `components` and deliberately NOT resolved into
 * components[].example.header_handle at save time (Meta's Resumable Upload
 * handles expire in ~24h; drafts routinely sit far longer). Resolution
 * happens later, fresh, in POST /templates/:id/submit (own test file,
 * whatsappTemplateSubmitErrorLogging.test.js).
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
  uploadTemplateHeaderHandle: jest.fn(),
}));
jest.mock('axios');

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(path, method) {
  const layer = whatsappRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { companyId: 'comp_test', id: 'emp_1', role: 'admin', name: 'Agent' };
const HEADER_REF = { s3Key: 'uploads/comp_test/pic.png', mimeType: 'image/png', filename: 'pic.png' };

describe('POST /api/whatsapp/templates — headerMediaRef', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores headerMediaRef when provided', async () => {
    dynamodb.query.mockReturnValueOnce(resolved({ Items: [] })); // dup-name check
    dynamodb.put.mockReturnValueOnce(resolved({}));

    const handler = getRouteHandler('/templates', 'post');
    const res = mockRes();
    await handler({
      user: USER,
      body: {
        name: 'Promo', templateName: 'promo_1', category: 'MARKETING',
        components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }],
        headerMediaRef: HEADER_REF,
      },
    }, res, jest.fn());

    const putItem = dynamodb.put.mock.calls[0][0].Item;
    expect(putItem.headerMediaRef).toEqual(HEADER_REF);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  test('stores null when headerMediaRef is not provided (text-only template, regression)', async () => {
    dynamodb.query.mockReturnValueOnce(resolved({ Items: [] }));
    dynamodb.put.mockReturnValueOnce(resolved({}));

    const handler = getRouteHandler('/templates', 'post');
    const res = mockRes();
    await handler({
      user: USER,
      body: { name: 'Text Promo', templateName: 'text_promo', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi' }] },
    }, res, jest.fn());

    const putItem = dynamodb.put.mock.calls[0][0].Item;
    expect(putItem.headerMediaRef).toBeNull();
  });
});

describe('PUT /api/whatsapp/templates/:id — headerMediaRef', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates headerMediaRef when provided in the request body', async () => {
    dynamodb.update.mockReturnValueOnce(resolved({}));

    const handler = getRouteHandler('/templates/:id', 'put');
    const res = mockRes();
    await handler({
      user: USER, params: { id: 'tmpl_1' },
      body: { name: 'Promo', templateName: 'promo_1', category: 'MARKETING', headerMediaRef: HEADER_REF },
    }, res, jest.fn());

    const [call] = dynamodb.update.mock.calls;
    expect(call[0].UpdateExpression).toContain('headerMediaRef = :hmr');
    expect(call[0].ExpressionAttributeValues[':hmr']).toEqual(HEADER_REF);
  });

  test('does NOT touch headerMediaRef when omitted from the request body (partial update, regression)', async () => {
    dynamodb.update.mockReturnValueOnce(resolved({}));

    const handler = getRouteHandler('/templates/:id', 'put');
    const res = mockRes();
    await handler({
      user: USER, params: { id: 'tmpl_1' },
      body: { name: 'Renamed only', templateName: 'promo_1', category: 'MARKETING' },
    }, res, jest.fn());

    const [call] = dynamodb.update.mock.calls;
    expect(call[0].UpdateExpression).not.toContain('headerMediaRef');
    expect(call[0].ExpressionAttributeValues[':hmr']).toBeUndefined();
  });

  test('can explicitly clear headerMediaRef by sending null (header type changed away from media)', async () => {
    dynamodb.update.mockReturnValueOnce(resolved({}));

    const handler = getRouteHandler('/templates/:id', 'put');
    const res = mockRes();
    await handler({
      user: USER, params: { id: 'tmpl_1' },
      body: { name: 'Promo', templateName: 'promo_1', category: 'MARKETING', headerMediaRef: null },
    }, res, jest.fn());

    const [call] = dynamodb.update.mock.calls;
    expect(call[0].UpdateExpression).toContain('headerMediaRef = :hmr');
    expect(call[0].ExpressionAttributeValues[':hmr']).toBeNull();
  });
});
