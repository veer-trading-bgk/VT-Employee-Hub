'use strict';

/**
 * Tests for the 2026-07-28 Meta Health PR 5: "Send Test Message" API.
 * POST /api/whatsapp/send-test sends an approved template to any E.164 phone
 * number, for onboarding/troubleshooting verification before any real lead
 * exists. Reuses WhatsAppSendService.sendTemplate() unmodified via its
 * existing `resolvedContact` escape hatch (already used by broadcast loops)
 * -- stays inside ADR-012 (all outbound sends go through
 * WhatsAppSendService), zero changes to that shared file. The synthetic
 * contact's PK lives under a dedicated TESTSEND# namespace so a test send
 * never creates or touches a real lead/conversation and never appears in
 * Inbox/CRM listings (which only query LEAD#/INBOX# prefixes).
 *
 * Error-handling pattern (rawError vs err.status vs generic 500) mirrors
 * tests/whatsappSendTemplateErrorLogging.test.js's already-established,
 * already-correct pattern for the sibling /send-template route.
 */

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

const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const WASendSvc = require('../src/services/WhatsAppSendService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(path, method) {
  const layer = whatsappRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { companyId: 'acme', id: 'emp_1', role: 'admin' };
const CFG = { accessToken: 'token_1', phoneNumberId: 'pid_1', wabaId: 'waba_1' };
const APPROVED_TMPL = { status: 'APPROVED', templateName: 'hello_world', language: 'en' };
const VALID_BODY = { toPhone: '+14155552671', templateId: 'tmpl_1', variableValues: ['Test'] };

// dynamodb.get is called twice per request when it gets this far: once for
// getWabaConfig (via graphApiHelpers), once for the template status pre-check.
function mockConfigAndTemplate({ cfg = CFG, tmpl = APPROVED_TMPL } = {}) {
  dynamodb.get
    .mockReturnValueOnce(resolved({ Item: cfg }))
    .mockReturnValueOnce(resolved({ Item: tmpl }));
}

describe('POST /api/whatsapp/send-test — validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('missing toPhone: 400, no DB/Meta calls', async () => {
    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: { templateId: 'tmpl_1' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });

  test('missing templateId: 400, no DB/Meta calls', async () => {
    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: { toPhone: '+14155552671' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test.each([
    ['9876543210', 'raw digits, no plus'],
    ['+0123456789', 'leading zero after the plus'],
    ['+1234', 'too short'],
    ['not-a-phone', 'not numeric at all'],
  ])('rejects invalid E.164 phone "%s" (%s) before any DB/Meta call', async (toPhone) => {
    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: { toPhone, templateId: 'tmpl_1' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toContain('E.164');
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });

  test('accepts a valid E.164 phone with a real country code other than India', async () => {
    mockConfigAndTemplate();
    WASendSvc.sendTemplate.mockResolvedValueOnce({ wamid: 'wamid.1', timestamp: '2026-07-28T00:00:00.000Z' });

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: VALID_BODY }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(WASendSvc.sendTemplate).toHaveBeenCalledTimes(1);
  });

  test('no WhatsApp config: 400, template is never even looked up', async () => {
    dynamodb.get.mockReturnValueOnce(resolved({ Item: null }));

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: VALID_BODY }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.get).toHaveBeenCalledTimes(1);
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });

  test('template not found: 404, no send attempted', async () => {
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: CFG }))
      .mockReturnValueOnce(resolved({ Item: null }));

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: VALID_BODY }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });

  test.each(['DRAFT', 'PENDING', 'REJECTED'])('template not approved (%s): 400 with a clear reason, no send attempted', async (status) => {
    mockConfigAndTemplate({ tmpl: { ...APPROVED_TMPL, status } });

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: VALID_BODY }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toContain(status);
    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp/send-test — success path', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends via a synthetic TESTSEND# contact, never a real lead/inbox key', async () => {
    mockConfigAndTemplate();
    WASendSvc.sendTemplate.mockResolvedValueOnce({ wamid: 'wamid.123', timestamp: '2026-07-28T12:00:00.000Z' });

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: VALID_BODY }, res, jest.fn());

    expect(WASendSvc.sendTemplate).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({
        resolvedContact: expect.objectContaining({
          pk: 'TESTSEND#acme#14155552671',
          phone: '14155552671',
          leadItem: null,
          isLead: false,
        }),
      }),
      'tmpl_1',
      ['Test'],
      USER,
      expect.objectContaining({ extraFields: { isTestSend: true } }),
    );

    expect(res.json).toHaveBeenCalledWith({ success: true, messageId: 'wamid.123', timestamp: '2026-07-28T12:00:00.000Z' });
  });

  test('variableValues defaults to an empty array when omitted', async () => {
    mockConfigAndTemplate();
    WASendSvc.sendTemplate.mockResolvedValueOnce({ wamid: 'w1', timestamp: 't1' });

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: { toPhone: '+14155552671', templateId: 'tmpl_1' } }, res, jest.fn());

    expect(WASendSvc.sendTemplate).toHaveBeenCalledWith('acme', expect.anything(), 'tmpl_1', [], USER, expect.anything());
  });
});

describe('POST /api/whatsapp/send-test — Meta rejection surfacing (mirrors /send-template)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a real Meta/axios rejection surfaces error_user_msg, logs real detail, returns rawError', async () => {
    mockConfigAndTemplate();
    const META_ERROR = {
      error: {
        message: 'Invalid parameter', type: 'OAuthException', code: 100, error_subcode: 2494007,
        error_user_title: 'Message Undeliverable', error_user_msg: 'The recipient phone number is not a valid WhatsApp user.',
        fbtrace_id: 'XyZ789AbC',
      },
    };
    WASendSvc.sendTemplate.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: USER, body: VALID_BODY }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toBe('The recipient phone number is not a valid WhatsApp user.');
    expect(body.rawError).toEqual(META_ERROR);

    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logMessage).toBe('send-test error');
    expect(logDetail).not.toBe('[object Object]');
    expect(logDetail).toContain('2494007');
  });

  test('a Meta rejection with only the generic .message field falls back to it', async () => {
    mockConfigAndTemplate();
    WASendSvc.sendTemplate.mockRejectedValueOnce({ response: { status: 429, data: { error: { message: 'Rate limit hit' } } } });

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    await handler({ user: USER, body: VALID_BODY }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].error).toBe('Rate limit hit');
  });

  test('a custom service error (real .status, no .response) still works', async () => {
    mockConfigAndTemplate();
    const err = Object.assign(new Error('WhatsApp not configured for this account'), { status: 400 });
    WASendSvc.sendTemplate.mockRejectedValueOnce(err);

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: USER, body: VALID_BODY }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'WhatsApp not configured for this account' });
  });

  test('an unexpected error with no .status and no .response falls through to next(err)', async () => {
    mockConfigAndTemplate();
    WASendSvc.sendTemplate.mockRejectedValueOnce(new Error('totally unexpected'));

    const handler = getRouteHandler('/send-test', 'post');
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: USER, body: VALID_BODY }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
