'use strict';

/**
 * Regression tests for two 2026-07-09 fixes (docs/phase3/TECHNICAL_DEBT.md):
 *
 * 1. manual-connect, PUT /config, and the WABA OAuth callback all silently
 *    swallowed Meta's real error on a failed credential check -- either no
 *    logging at all, or a logger.error(msg, err.response.data) call that
 *    rendered as "[object Object]" in CloudWatch because logger.js only
 *    extracts .message from real Error instances. Fixed to surface Meta's
 *    real error (JSON.stringify'd, redacted of the access token) in both a
 *    server-side log line and (for the JSON API routes) a rawError field in
 *    the response, matching /connection/probe's existing convention.
 *
 * 2. manual-connect, connection/probe, and connection/repair all requested
 *    a "whatsapp_business_account" field on the phone number node to
 *    auto-detect the WABA ID. Meta's Graph API doesn't support that field
 *    there -- it threw "(#100) Tried accessing nonexisting field" and
 *    failed the WHOLE phone-node call, blocking every reconnect attempt.
 *    The settings form already requires an explicit wabaId, and all three
 *    routes already had a working /me/whatsapp_business_accounts fallback,
 *    so the field was removed; auto-discovery now goes through that
 *    fallback only.
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

  test('a valid token+phoneNumberId+explicit wabaId still connects successfully (regression)', async () => {
    // The settings form always sends an explicit wabaId (page.tsx requires it), so this
    // is the real-world request shape -- manual-connect no longer derives the WABA ID from
    // the phone node's whatsapp_business_account field (removed 2026-07-09; Meta's Graph API
    // doesn't support it there, see TECHNICAL_DEBT.md), only from this explicit value or the
    // /me fallback below.
    axios.get.mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } });
    dynamodb.put.mockReturnValue(resolved({}));
    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'waba_123' }, user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const [, params] = axios.get.mock.calls[0];
    expect(params.params.fields).not.toContain('whatsapp_business_account');
  });

  test('a valid token+phoneNumberId with no explicit wabaId still auto-discovers via /me (regression)', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } })
      .mockResolvedValueOnce({
        data: { whatsapp_business_accounts: { data: [{ id: 'waba_123', phone_numbers: { data: [{ id: 'pid_123' }] } }] } },
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

describe('POST /api/whatsapp/connection/probe — WABA ID auto-discovery', () => {
  beforeEach(() => jest.clearAllMocks());

  test('phone-node lookup never requests the unsupported whatsapp_business_account field', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } })
      .mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    const handler = getRouteHandler(whatsappRouter, '/connection/probe', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123' } }, res, jest.fn());

    const [, params] = axios.get.mock.calls[0];
    expect(params.params.fields).not.toContain('whatsapp_business_account');
  });

  test('phone node reachable + /me finds a matching WABA — genuine autoDiscovered success', async () => {
    // Before the 2026-07-09 fix, this exact scenario was unreachable: the phone-node call
    // above would have thrown "(#100) Tried accessing nonexisting field" and returned
    // phoneValid:false before ever reaching /me. This proves the real bug is fixed, not
    // just worked around.
    axios.get
      .mockResolvedValueOnce({ data: { id: 'pid_123', display_phone_number: '+91 90000 00000', verified_name: 'Acme Corp' } })
      .mockResolvedValueOnce({
        data: { whatsapp_business_accounts: { data: [{ id: 'waba_123', phone_numbers: { data: [{ id: 'pid_123' }] } }] } },
      });
    const handler = getRouteHandler(whatsappRouter, '/connection/probe', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123' } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      phoneValid: true, autoDiscovered: true, discoveryMethod: 'user_waba_list', wabaId: 'waba_123',
    }));
  });

  test('phone node reachable but /me lacks permission — surfaces the MISSING_PERMISSION reason', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { id: 'pid_123', display_phone_number: '+91 90000 00000' } })
      .mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    const handler = getRouteHandler(whatsappRouter, '/connection/probe', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123' } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      phoneValid: true, autoDiscovered: false, requiresManualWabaId: true,
      rawError: expect.objectContaining({ code: 'MISSING_PERMISSION' }),
    }));
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

  test('phone-node lookup never requests the unsupported whatsapp_business_account field, and Path B2 still auto-repairs', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { companyId: 'acme', accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'pid_123' },
    }));
    dynamodb.update.mockReturnValue(resolved({}));
    axios.get
      .mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } })
      .mockResolvedValueOnce({
        data: { whatsapp_business_accounts: { data: [{ id: 'waba_123', phone_numbers: { data: [{ id: 'pid_123' }] } }] } },
      });
    const handler = getRouteHandler(whatsappRouter, '/connection/repair', 'post');
    const res = mockRes();
    await handler({ body: {}, user: USER }, res, jest.fn());

    const [, params] = axios.get.mock.calls[0];
    expect(params.params.fields).not.toContain('whatsapp_business_account');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, method: 'auto', newWabaId: 'waba_123' }));
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
