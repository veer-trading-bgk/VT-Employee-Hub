'use strict';

/**
 * Tests for the 2026-07-28 Meta Health PR 1: Cloud API registration + PIN.
 * Found live (WABA 1024855430389913, angelbrokingbgk@gmail.com): messaging/
 * webhooks/templates all worked, but Meta's registration handshake (POST
 * /{phone-number-id}/register, which also sets the two-step-verification
 * PIN) was never called anywhere in this codebase -- causing WhatsApp
 * Manager's 2FA toggle to fail with "Account does not exist in Cloud API".
 * graphApiHelpers.registerPhoneNumber() closes this: checks is_pin_enabled
 * first (never re-registers an already-registered number, both per explicit
 * requirement and Meta's 10-calls/72h rate limit), generates a PIN only when
 * actually needed, and is wired into manual-connect, the OAuth callback, and
 * PUT /config (mirroring exactly how subscribeWabaWebhooks was wired in the
 * prior session's fix) -- never fails the parent operation.
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
const { registerPhoneNumber } = require('../src/services/graphApiHelpers');
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
const FAKE_TOKEN = 'EAAsupersecrettoken_should_never_appear_in_any_log_XYZ789';

const META_ERROR = {
  error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'AbC123XyZ' },
};

// Any 6-digit string is a plausible generated PIN -- assert none of them ever appear in a log call.
function expectNoPinInLogs() {
  for (const fn of [logger.error, logger.warn, logger.info]) {
    for (const call of fn.mock.calls) {
      for (const arg of call) {
        const str = typeof arg === 'string' ? arg : JSON.stringify(arg);
        expect(str).not.toMatch(/\b\d{6}\b/);
      }
    }
  }
}

describe('graphApiHelpers.registerPhoneNumber', () => {
  beforeEach(() => jest.clearAllMocks());

  test('already registered (is_pin_enabled true): short-circuits, never calls /register', async () => {
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: true } });

    const result = await registerPhoneNumber({ wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: FAKE_TOKEN, companyId: 'acme' });

    expect(result).toEqual({ alreadyRegistered: true, registered: false });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('not registered: generates a PIN, calls /register, persists lastRegisterAttemptAt then pinRegisteredAt, PIN never logged', async () => {
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } });
    axios.post.mockResolvedValueOnce({ data: { success: true } });
    dynamodb.update.mockReturnValue(resolved({}));

    const result = await registerPhoneNumber({ wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: FAKE_TOKEN, companyId: 'acme' });

    expect(result.alreadyRegistered).toBe(false);
    expect(result.registered).toBe(true);
    expect(result.pin).toMatch(/^\d{6}$/);

    const [postUrl, body, options] = axios.post.mock.calls[0];
    expect(postUrl).toContain('pid_1/register');
    expect(body).toEqual({ messaging_product: 'whatsapp', pin: result.pin });
    expect(options.params.access_token).toBe(FAKE_TOKEN);

    expect(dynamodb.update).toHaveBeenCalledTimes(2);
    expect(dynamodb.update.mock.calls[0][0].UpdateExpression).toContain('lastRegisterAttemptAt');
    expect(dynamodb.update.mock.calls[1][0].UpdateExpression).toContain('pinRegisteredAt');
    expectNoPinInLogs();
  });

  test('is_pin_enabled check fails: returns an error, never attempts /register', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const result = await registerPhoneNumber({ wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: FAKE_TOKEN, companyId: 'acme' });

    expect(result.registered).toBe(false);
    expect(result.error).toBe(META_ERROR.error.message);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('cooldown: a registration attempt within the last 5 minutes is skipped, no /register call', async () => {
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } });
    const recentAttempt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago

    const result = await registerPhoneNumber({
      wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: FAKE_TOKEN, companyId: 'acme',
      lastRegisterAttemptAt: recentAttempt,
    });

    expect(result.registered).toBe(false);
    expect(result.skipped).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('an attempt older than 5 minutes is NOT blocked by the cooldown', async () => {
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } });
    axios.post.mockResolvedValueOnce({ data: { success: true } });
    dynamodb.update.mockReturnValue(resolved({}));
    const oldAttempt = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 minutes ago

    const result = await registerPhoneNumber({
      wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: FAKE_TOKEN, companyId: 'acme',
      lastRegisterAttemptAt: oldAttempt,
    });

    expect(result.registered).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('/register call fails: returns an error without throwing, PIN never logged even on failure', async () => {
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } });
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    dynamodb.update.mockReturnValue(resolved({}));

    const result = await registerPhoneNumber({ wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: FAKE_TOKEN, companyId: 'acme' });

    expect(result.registered).toBe(false);
    expect(result.error).toBe(META_ERROR.error.message);
    expectNoPinInLogs();
  });
});

describe('POST /api/whatsapp/manual-connect — registration wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  test('fresh registration succeeds: registered true, pinGenerated present', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } }) // phone verify
      .mockResolvedValueOnce({ data: { is_pin_enabled: false } }); // registerPhoneNumber's check
    axios.post
      .mockResolvedValueOnce({ data: {} }) // subscribeWabaWebhooks
      .mockResolvedValueOnce({ data: { success: true } }); // /register
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'waba_123' }, user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.registered).toBe(true);
    expect(body.pinGenerated).toMatch(/^\d{6}$/);
    expect(body).not.toHaveProperty('registrationWarning');
  });

  test('already registered: registered true, no pinGenerated key', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } })
      .mockResolvedValueOnce({ data: { is_pin_enabled: true } });
    axios.post.mockResolvedValueOnce({ data: {} }); // subscribeWabaWebhooks only
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'waba_123' }, user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.registered).toBe(true);
    expect(body).not.toHaveProperty('pinGenerated');
  });

  test('registration fails: route still succeeds overall, registrationWarning present', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } })
      .mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } }); // is_pin_enabled check fails
    axios.post.mockResolvedValueOnce({ data: {} }); // subscribeWabaWebhooks
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'waba_123' }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(500);
    const [body] = res.json.mock.calls[0];
    expect(body.success).toBe(true);
    expect(body.registered).toBe(false);
    expect(body.registrationWarning).toContain('Two-step verification registration incomplete');
  });
});

describe('GET /api/whatsapp/auth/callback — registration wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  function stateFor(companyId, userId) {
    return Buffer.from(JSON.stringify({ companyId, userId })).toString('base64');
  }

  test('fresh registration succeeds: popup postMessage payload includes the pin field', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { access_token: FAKE_TOKEN } })
      .mockResolvedValueOnce({ data: { id: 'biz_1', name: 'Acme' } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'waba_123' }] } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'pid_123', display_phone_number: '+91 90000 00000' }] } })
      .mockResolvedValueOnce({ data: { is_pin_enabled: false } }); // registerPhoneNumber's check
    axios.post
      .mockResolvedValueOnce({ data: {} }) // subscribeWabaWebhooks
      .mockResolvedValueOnce({ data: { success: true } }); // /register
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/auth/callback', 'get');
    const res = mockRes();
    await handler({ query: { code: 'auth_code_123', state: stateFor('acme', 'emp_1') } }, res, jest.fn());

    const [html] = res.send.mock.calls[0];
    expect(html).toMatch(/,pin:'\d{6}'/);
  });

  test('already registered: popup postMessage payload has no pin field', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { access_token: FAKE_TOKEN } })
      .mockResolvedValueOnce({ data: { id: 'biz_1', name: 'Acme' } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'waba_123' }] } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'pid_123', display_phone_number: '+91 90000 00000' }] } })
      .mockResolvedValueOnce({ data: { is_pin_enabled: true } });
    axios.post.mockResolvedValueOnce({ data: {} });
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/auth/callback', 'get');
    const res = mockRes();
    await handler({ query: { code: 'auth_code_123', state: stateFor('acme', 'emp_1') } }, res, jest.fn());

    const [html] = res.send.mock.calls[0];
    expect(html).not.toMatch(/pin:/);
  });
});

describe('PUT /api/whatsapp/config — registration wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  const STORED_CFG = { phoneNumberId: 'pid_old', wabaId: 'waba_old', accessToken: FAKE_TOKEN, businessManagerId: null };

  function mockStoredConfig(cfg = STORED_CFG) {
    dynamodb.get.mockReturnValue(resolved({ Item: cfg }));
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));
  }

  test('wabaId changed: registerPhoneNumber is called, registered/pinGenerated present', async () => {
    mockStoredConfig();
    axios.post
      .mockResolvedValueOnce({ data: {} }) // subscribeWabaWebhooks
      .mockResolvedValueOnce({ data: { success: true } }); // /register
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } }); // registerPhoneNumber's check

    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({ body: { wabaId: 'waba_new' }, user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.registered).toBe(true);
    expect(body.pinGenerated).toMatch(/^\d{6}$/);
  });

  test('neither wabaId nor accessToken changed: registerPhoneNumber is never called', async () => {
    mockStoredConfig();

    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({ body: { businessManagerId: 'bm_123' }, user: USER }, res, jest.fn());

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    const [body] = res.json.mock.calls[0];
    expect(body).not.toHaveProperty('registered');
  });
});
