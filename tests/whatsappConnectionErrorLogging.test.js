'use strict';

/**
 * Regression tests for the 2026-07-09 fix (docs/phase3/TECHNICAL_DEBT.md):
 * manual-connect, PUT /config, and the WABA OAuth callback all silently
 * swallowed Meta's real error on a failed credential check -- either no
 * logging at all, or a logger.error(msg, err.response.data) call that
 * rendered as "[object Object]" in CloudWatch because logger.js only
 * extracts .message from real Error instances. Fixed to surface Meta's
 * real error (JSON.stringify'd, redacted of the access token) in both a
 * server-side log line and (for the JSON API routes) a rawError field in
 * the response, matching /connection/probe's existing convention.
 *
 * No prior tests existed for any of these routes -- confirmed by repo
 * search before writing these. Same direct-handler-invocation technique as
 * the other whatsapp.js route tests this session: no HTTP, no auth,
 * dynamodb/logger/axios mocked.
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
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { id: 'emp_1', role: 'admin', companyId: 'acme' };
// Deliberately shaped so a naive substring/inclusion check would catch a leak.
const FAKE_TOKEN = 'EAAsupersecrettoken_should_never_appear_in_any_log_XYZ789';

const META_ERROR = {
  error: {
    message: 'Error validating access token: Session has expired',
    type: 'OAuthException',
    code: 190,
    error_subcode: 463,
    fbtrace_id: 'AbC123XyZ',
  },
};

describe('POST /api/whatsapp/manual-connect', () => {
  beforeEach(() => jest.clearAllMocks());

  test('missing fields still rejected with 400 (regression)', async () => {
    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: {}, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('a valid token+phoneNumberId still connects successfully (regression)', async () => {
    axios.get.mockResolvedValueOnce({
      data: { display_phone_number: '+91 90000 00000', whatsapp_business_account: { id: 'waba_123' } },
    });
    dynamodb.put.mockReturnValue(resolved({}));
    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123' }, user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('a Meta-side failure surfaces rawError in the response and logs it (redacted) server-side', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toBe('Invalid credentials — Meta rejected the token or phone number ID');
    expect(body.rawError).toEqual(META_ERROR);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    // The real Meta detail must actually be present (not "[object Object]").
    expect(logDetail).toContain('OAuthException');
    expect(logDetail).toContain('463');
    expect(logDetail).toContain('AbC123XyZ');
    // The token must never appear in either logged argument.
    expect(logMessage).not.toContain(FAKE_TOKEN);
    expect(logDetail).not.toContain(FAKE_TOKEN);
  });
});

describe('PUT /api/whatsapp/config — credential re-verification failure', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a Meta-side failure on token/phone change surfaces rawError and logs it (redacted)', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { companyId: 'acme', accessToken: 'old-token', phoneNumberId: 'old_pid', wabaId: 'waba_1' },
    }));
    axios.get.mockRejectedValueOnce({ response: { status: 401, data: META_ERROR } });
    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({
      body: { accessToken: FAKE_TOKEN, phoneNumberId: 'new_pid' },
      user: USER,
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.rawError).toEqual(META_ERROR);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logDetail).toContain('OAuthException');
    expect(logMessage).not.toContain(FAKE_TOKEN);
    expect(logDetail).not.toContain(FAKE_TOKEN);
  });
});

describe('POST /api/whatsapp/connection/repair — phone-node lookup failure', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a Meta-side failure surfaces rawError and logs it (redacted)', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { companyId: 'acme', accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'pid_123' },
    }));
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    const handler = getRouteHandler(whatsappRouter, '/connection/repair', 'post');
    const res = mockRes();
    await handler({ body: {}, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.rawError).toEqual(META_ERROR);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logDetail).toContain('OAuthException');
    expect(logMessage).not.toContain(FAKE_TOKEN);
    expect(logDetail).not.toContain(FAKE_TOKEN);
  });
});

describe('GET /api/whatsapp/auth/callback — OAuth token exchange failure', () => {
  beforeEach(() => jest.clearAllMocks());

  test('logs the real Meta error (redacted, readable) instead of "[object Object]"', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    const handler = getRouteHandler(whatsappRouter, '/auth/callback', 'get');
    const state = Buffer.from(JSON.stringify({ companyId: 'acme', userId: 'emp_1' })).toString('base64');
    const res = mockRes();
    await handler({ query: { code: 'auth_code_123', state } }, res, jest.fn());

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logDetail).not.toBe('[object Object]');
    expect(logDetail).toContain('OAuthException');
    expect(logMessage).not.toContain(FAKE_TOKEN);
    expect(logDetail).not.toContain(FAKE_TOKEN);
    expect(res.send).toHaveBeenCalled();
  });
});
