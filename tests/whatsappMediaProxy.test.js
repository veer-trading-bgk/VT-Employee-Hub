'use strict';

/**
 * Regression tests for the 2026-07-28 fix: GET /api/whatsapp/media/:mediaId
 * was flooding Telegram/Sentry with a useless generic "Error occurred /
 * Request failed with status code 400" alert every time someone opened an
 * Inbox conversation with an attachment past Meta's media retention window
 * (120 alerts in 45 minutes on the day this was found). Confirmed live
 * against Meta that expired media always fails with the same structured
 * error: {"error":{"code":100,"error_subcode":33,"message":"...does not
 * exist..."}}. That specific signature is now caught and turned into a
 * quiet 404 (logger.warn, no Telegram/Sentry page) since it's expected and
 * unrecoverable, not a bug. Any other failure still falls through to the
 * generic errorHandler and alerts exactly as before.
 *
 * Same direct-handler-invocation technique as tests/webhookAutoSubscribe.test.js.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
    setHeader: jest.fn(),
  };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { id: 'emp_1', role: 'admin', companyId: 'acme' };
const CFG = { wabaId: 'waba_123', phoneNumberId: 'pid_123', accessToken: 'token_123' };

const EXPIRED_MEDIA_ERROR = {
  error: {
    message: "Unsupported get request. Object with ID '999' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
    type: 'GraphMethodException',
    code: 100,
    error_subcode: 33,
    fbtrace_id: 'AbC123XyZ',
  },
};

describe('GET /api/whatsapp/media/:mediaId — expired-media handling', () => {
  beforeEach(() => jest.clearAllMocks());

  test('expired media (code 100, subcode 33): quiet 404, logger.warn only, no next(err)/no throw', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: EXPIRED_MEDIA_ERROR } });

    const handler = getRouteHandler(whatsappRouter, '/media/:mediaId', 'get');
    const res = mockRes();
    const next = jest.fn();
    await handler({ params: { mediaId: '999' }, user: USER }, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Media no longer available' });
    expect(next).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('999');
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('a different Meta error (not code 100/subcode 33): still forwarded to next(err), unchanged behavior', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
    const authError = { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } };
    axios.get.mockRejectedValueOnce({ response: { status: 401, data: authError } });

    const handler = getRouteHandler(whatsappRouter, '/media/:mediaId', 'get');
    const res = mockRes();
    const next = jest.fn();
    await handler({ params: { mediaId: '999' }, user: USER }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('successful fetch: proxies bytes through unchanged', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
    axios.get
      .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/some-url' } })
      .mockResolvedValueOnce({ data: Buffer.from('imagebytes'), headers: { 'content-type': 'image/jpeg' } });

    const handler = getRouteHandler(whatsappRouter, '/media/:mediaId', 'get');
    const res = mockRes();
    const next = jest.fn();
    await handler({ params: { mediaId: '999' }, user: USER }, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('imagebytes'));
    expect(next).not.toHaveBeenCalled();
  });
});
