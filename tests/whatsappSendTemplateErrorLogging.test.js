'use strict';

/**
 * Regression test for a 2026-07-10 live-blocking fix (docs/phase3/TECHNICAL_DEBT.md):
 * POST /api/whatsapp/send-template's catch block called
 * logger.error('send-template error', err?.response?.data ?? err.message) --
 * the same "[object Object]" defect already fixed tonight at 4 other call
 * sites. Confirmed via CloudWatch: the real 09:32 PM (21:32 IST) failure
 * only ever logged the literal string "[object Object]" -- the actual Meta
 * rejection was never retained anywhere, blocking Viir from sending the
 * newly-approved cdsl_invite_marketing template to a real customer.
 *
 * Also fixes a second, more serious bug in the same catch block: it
 * branched on `err.status`, but a real Meta/axios rejection from
 * sendTemplate()'s unwrapped axios.post() call has `err.response.status`,
 * never a top-level `err.status` (only this service's own custom-thrown
 * errors, e.g. "Template not found", have that). The real Meta error was
 * silently falling through to the generic next(err) 500 handler -- not
 * just mislogged, its detail was discarded entirely from the API response
 * too.
 */

jest.mock('../src/config/dynamodb', () => ({}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendTemplate: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

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

const BODY = { leadPK: 'LEAD#comp_test#lead1', templateId: 'tmpl_1', variableValues: ['Viir'] };
const USER = { companyId: 'comp_test', id: 'emp_1', role: 'admin' };

describe('POST /api/whatsapp/send-template — Meta rejection surfacing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a real Meta/axios rejection (err.response.data, no top-level err.status) surfaces error_user_msg, logs real detail (not [object Object]), and returns rawError', async () => {
    const META_ERROR = {
      error: {
        message: 'Invalid parameter', type: 'OAuthException', code: 100, error_subcode: 2494007,
        error_user_title: 'Message Undeliverable', error_user_msg: 'The recipient phone number is not a valid WhatsApp user.',
        fbtrace_id: 'XyZ789AbC',
      },
    };
    // Unwrapped axios error -- no top-level .status, matching what a real
    // Meta rejection from inside sendTemplate()'s own axios.post() looks like.
    WASendSvc.sendTemplate.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const handler = getRouteHandler('/send-template', 'post');
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: USER, body: BODY }, res, next);

    expect(next).not.toHaveBeenCalled(); // must NOT fall through to the generic 500 handler
    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toBe('The recipient phone number is not a valid WhatsApp user.');
    expect(body.rawError).toEqual(META_ERROR);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logMessage).toBe('send-template error');
    expect(logDetail).not.toBe('[object Object]');
    expect(logDetail).toContain('Message Undeliverable');
    expect(logDetail).toContain('2494007');
  });

  test('a real Meta rejection with only the generic .message field falls back to it', async () => {
    const META_ERROR = { error: { message: 'Rate limit hit', type: 'OAuthException', code: 4 } };
    WASendSvc.sendTemplate.mockRejectedValueOnce({ response: { status: 429, data: META_ERROR } });

    const handler = getRouteHandler('/send-template', 'post');
    const res = mockRes();
    await handler({ user: USER, body: BODY }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(429);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toBe('Rate limit hit');
  });

  test('a custom service error (e.g. "Template not found", real .status, no .response) still works unchanged', async () => {
    const err = Object.assign(new Error('Template not found'), { status: 404 });
    WASendSvc.sendTemplate.mockRejectedValueOnce(err);

    const handler = getRouteHandler('/send-template', 'post');
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: USER, body: BODY }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Template not found' });
  });

  test('a successful send still works unchanged (regression)', async () => {
    WASendSvc.sendTemplate.mockResolvedValueOnce({ wamid: 'wamid.1' });

    const handler = getRouteHandler('/send-template', 'post');
    const res = mockRes();
    await handler({ user: USER, body: BODY }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
