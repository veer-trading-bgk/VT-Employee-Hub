'use strict';

/**
 * Regression tests for the 2026-07-24 fix (discovered via a live customer
 * onboarding): POST /manual-connect and GET /auth/callback both connected a
 * company's WABA (stored credentials, wrote the CONFIG#PHONEID# reverse
 * index) but never called Meta's POST /{waba-id}/subscribed_apps -- so
 * inbound messages/status updates silently never arrived until someone
 * manually subscribed later. Fixed by calling the new
 * graphApiHelpers.subscribeWabaWebhooks(cfg) helper at connect time on both
 * paths, non-fatally: a subscribe failure must never fail the connect
 * itself (the WABA config write already succeeded and should stand).
 *
 * Same direct-handler-invocation technique as
 * tests/whatsappConnectionErrorLogging.test.js and
 * tests/whatsappOauthInitScope.test.js: no HTTP, no auth, dynamodb/logger/
 * axios/WhatsAppSendService mocked.
 *
 * A second gap (found 2026-07-28 via a live customer onboarding: WABA
 * 1024855430389913): PUT /api/whatsapp/config never called
 * subscribeWabaWebhooks at all, so correcting a bad wabaId/accessToken
 * post-connect (e.g. via this route, right after a manual-connect whose
 * initial subscribe failed) left the webhook silently unsubscribed forever.
 * Fixed by re-subscribing whenever wabaId or accessToken changes.
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
const { subscribeWabaWebhooks } = require('../src/services/graphApiHelpers');
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

// Asserts the token never appears in any logger.error call made during a test.
function expectNoTokenInLogs() {
  for (const call of logger.error.mock.calls) {
    for (const arg of call) {
      const str = typeof arg === 'string' ? arg : JSON.stringify(arg);
      expect(str).not.toContain(FAKE_TOKEN);
    }
  }
}

describe('graphApiHelpers.subscribeWabaWebhooks', () => {
  beforeEach(() => jest.clearAllMocks());

  test('success returns { subscribed: true } and posts to the subscribed_apps endpoint', async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true } });
    const result = await subscribeWabaWebhooks({ wabaId: 'waba_123', accessToken: FAKE_TOKEN });

    expect(result).toEqual({ subscribed: true });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toContain('waba_123/subscribed_apps');
    expect(body).toBeNull();
    expect(options.params.access_token).toBe(FAKE_TOKEN);
    expect(options.timeout).toBe(10000);
  });

  test('a Meta rejection returns { subscribed: false, error, rawError } without throwing, and logs redacted detail', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const result = await subscribeWabaWebhooks({ wabaId: 'waba_123', accessToken: FAKE_TOKEN });

    expect(result.subscribed).toBe(false);
    expect(result.error).toBe(META_ERROR.error.message);
    expect(result.rawError).toEqual(META_ERROR);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logMessage).toContain('waba_123');
    expect(logDetail).not.toBe('[object Object]');
    expect(logDetail).toContain('OAuthException');
    expect(logDetail).toContain('463');
    expectNoTokenInLogs();
  });

  test('a network-level failure with no response still resolves (never throws)', async () => {
    axios.post.mockRejectedValueOnce(new Error('socket hang up'));
    const result = await subscribeWabaWebhooks({ wabaId: 'waba_123', accessToken: FAKE_TOKEN });
    expect(result.subscribed).toBe(false);
    expect(result.error).toBe('socket hang up');
    expectNoTokenInLogs();
  });
});

describe('POST /api/whatsapp/manual-connect — webhook auto-subscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  test('successful connect + successful subscribe: webhookSubscribed true, no webhookWarning key', async () => {
    axios.get.mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } });
    axios.post.mockResolvedValueOnce({ data: {} });
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'waba_123' }, user: USER }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, webhookSubscribed: true }));
    const [body] = res.json.mock.calls[0];
    expect(body).not.toHaveProperty('webhookWarning');

    // subscribed_apps call happened against the resolved waba id
    const [postUrl] = axios.post.mock.calls[0];
    expect(postUrl).toContain('waba_123/subscribed_apps');
    expectNoTokenInLogs();
  });

  test('successful connect + subscribe FAILS: route still succeeds, webhookSubscribed false + webhookWarning, token never logged', async () => {
    axios.get.mockResolvedValueOnce({ data: { display_phone_number: '+91 90000 00000' } });
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/manual-connect', 'post');
    const res = mockRes();
    await handler({ body: { accessToken: FAKE_TOKEN, phoneNumberId: 'pid_123', wabaId: 'waba_123' }, user: USER }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      webhookSubscribed: false,
      webhookWarning: expect.stringContaining('Webhook subscription failed'),
    }));

    expectNoTokenInLogs();
  });
});

describe('PUT /api/whatsapp/config — webhook re-subscribe on wabaId/token change', () => {
  beforeEach(() => jest.clearAllMocks());

  const STORED_CFG = {
    phoneNumberId: 'pid_old', wabaId: 'waba_old', accessToken: FAKE_TOKEN, businessManagerId: null,
  };

  function mockStoredConfig(cfg = STORED_CFG) {
    dynamodb.get.mockReturnValue(resolved({ Item: cfg }));
    dynamodb.put.mockReturnValue(resolved({}));
  }

  test('wabaId changed, token unchanged: re-subscribes with the new wabaId and the existing (unchanged) token', async () => {
    mockStoredConfig();
    // No credential re-validation GET is expected here -- only wabaId changed,
    // not phoneNumberId/accessToken. The one GET that does happen is
    // registerPhoneNumber's is_pin_enabled check (2026-07-28 PR) -- mocked
    // "already registered" so it short-circuits without an extra POST,
    // keeping this test's focus purely on webhook re-subscribe behavior.
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: true } });
    axios.post.mockResolvedValueOnce({ data: {} });

    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({ body: { wabaId: 'waba_new' }, user: USER }, res, jest.fn());

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [postUrl, , options] = axios.post.mock.calls[0];
    expect(postUrl).toContain('waba_new/subscribed_apps');
    expect(options.params.access_token).toBe(FAKE_TOKEN);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, webhookSubscribed: true }));
    expectNoTokenInLogs();
  });

  test('accessToken changed: validates against Meta, then re-subscribes with the new token', async () => {
    mockStoredConfig();
    const NEW_TOKEN = 'EAAbrandnewtoken_should_never_appear_in_any_log_ABC123';
    axios.get
      .mockResolvedValueOnce({ data: { id: 'pid_old' } }) // credential re-validation
      .mockResolvedValueOnce({ data: { is_pin_enabled: true } }); // registerPhoneNumber's check (2026-07-28 PR)
    axios.post.mockResolvedValueOnce({ data: {} });

    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({ body: { accessToken: NEW_TOKEN }, user: USER }, res, jest.fn());

    const [postUrl, , options] = axios.post.mock.calls[0];
    expect(postUrl).toContain('waba_old/subscribed_apps');
    expect(options.params.access_token).toBe(NEW_TOKEN);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, webhookSubscribed: true }));
  });

  test('neither wabaId nor accessToken changed (e.g. only businessManagerId edited): never re-subscribes', async () => {
    mockStoredConfig();

    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({ body: { businessManagerId: 'bm_123' }, user: USER }, res, jest.fn());

    expect(axios.post).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const [body] = res.json.mock.calls[0];
    expect(body).not.toHaveProperty('webhookSubscribed');
    expect(body).not.toHaveProperty('webhookWarning');
  });

  test('wabaId changed but the re-subscribe fails: route still succeeds, webhookWarning surfaced, token never logged', async () => {
    mockStoredConfig();
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: true } }); // registerPhoneNumber's check (2026-07-28 PR)
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const handler = getRouteHandler(whatsappRouter, '/config', 'put');
    const res = mockRes();
    await handler({ body: { wabaId: 'waba_new' }, user: USER }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      webhookSubscribed: false,
      webhookWarning: expect.stringContaining('Webhook subscription failed'),
    }));
    expectNoTokenInLogs();
  });
});

describe('GET /api/whatsapp/auth/callback — webhook auto-subscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  function stateFor(companyId, userId) {
    return Buffer.from(JSON.stringify({ companyId, userId })).toString('base64');
  }

  test('successful connect + successful subscribe: popup message has no webhook-failure wording', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { access_token: FAKE_TOKEN } }) // oauth/access_token
      .mockResolvedValueOnce({ data: { id: 'biz_1', name: 'Acme' } }) // /me
      .mockResolvedValueOnce({ data: { data: [{ id: 'waba_123' }] } }) // whatsapp_business_accounts
      .mockResolvedValueOnce({ data: { data: [{ id: 'pid_123', display_phone_number: '+91 90000 00000' }] } }); // phone_numbers
    axios.post.mockResolvedValueOnce({ data: {} });
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/auth/callback', 'get');
    const res = mockRes();
    await handler({ query: { code: 'auth_code_123', state: stateFor('acme', 'emp_1') } }, res, jest.fn());

    expect(res.send).toHaveBeenCalledTimes(1);
    const [html] = res.send.mock.calls[0];
    expect(html).toContain("type:'waba_connected'");
    expect(html).not.toContain('webhook subscription failed');

    const [postUrl] = axios.post.mock.calls[0];
    expect(postUrl).toContain('waba_123/subscribed_apps');
    expectNoTokenInLogs();
  });

  test('successful connect + subscribe fails: still a success popup, message contains webhook warning, token never logged', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { access_token: FAKE_TOKEN } })
      .mockResolvedValueOnce({ data: { id: 'biz_1', name: 'Acme' } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'waba_123' }] } })
      .mockResolvedValueOnce({ data: { data: [{ id: 'pid_123', display_phone_number: '+91 90000 00000' }] } });
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/auth/callback', 'get');
    const res = mockRes();
    await handler({ query: { code: 'auth_code_123', state: stateFor('acme', 'emp_1') } }, res, jest.fn());

    expect(res.send).toHaveBeenCalledTimes(1);
    const [html] = res.send.mock.calls[0];
    expect(html).toContain("type:'waba_connected'"); // still popupHtml(true, ...)
    expect(html).toContain('webhook subscription failed');
    // The full message must appear verbatim, embedded intact inside the
    // single-quoted postMessage payload -- proving no apostrophe was
    // introduced that would have truncated/broken that JS string literal.
    const expectedMessage = 'Connected: +91 90000 00000 (webhook subscription failed — check the WhatsApp Health Check in Settings)';
    expect(expectedMessage).not.toMatch(/'/);
    expect(html).toContain(`message:'${expectedMessage}'`);

    expectNoTokenInLogs();
  });

  test('wabaId-less OAuth success (auto-discovery finds nothing) never calls axios.post for subscribed_apps', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { access_token: FAKE_TOKEN } }) // oauth/access_token
      .mockResolvedValueOnce({ data: { id: 'biz_1', name: 'Acme' } }) // /me
      .mockResolvedValueOnce({ data: { data: [] } }); // whatsapp_business_accounts — none found
    dynamodb.put.mockReturnValue(resolved({}));

    const handler = getRouteHandler(whatsappRouter, '/auth/callback', 'get');
    const res = mockRes();
    await handler({ query: { code: 'auth_code_123', state: stateFor('acme', 'emp_1') } }, res, jest.fn());

    expect(axios.post).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledTimes(1);
    const [html] = res.send.mock.calls[0];
    expect(html).toContain("type:'waba_connected'");
    // Regression guard: this case must read as "no WABA found", not the
    // generic "webhook subscription failed" message -- subscribeWabaWebhooks
    // was never even called (asserted above), so blaming a failed
    // subscription would be actively misleading.
    const expectedMessage = 'Connected: WhatsApp Business (no WhatsApp Business Account found on this Meta account — WhatsApp features will not work until a WABA is linked)';
    expect(expectedMessage).not.toMatch(/'/);
    expect(html).toContain(`message:'${expectedMessage}'`);
    expect(html).not.toContain('webhook subscription failed');
    expectNoTokenInLogs();
  });
});
