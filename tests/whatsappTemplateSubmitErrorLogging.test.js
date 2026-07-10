'use strict';

/**
 * Regression test for a 2026-07-10 fix (docs/phase3/TECHNICAL_DEBT.md):
 * POST /api/whatsapp/templates/:id/submit's catch block called
 * logger.error('submit template to Meta failed', err.response.data) --
 * passing the plain Meta error object straight through, which logger.js
 * renders as "[object Object]" (it only extracts .message from real Error
 * instances). Live impact: Viir's Marketing-template submission failed
 * twice with an opaque "invalid parameters" toast and a Telegram alert
 * reading "...failed [object Object]", with no way to see what Meta
 * actually rejected. Same defect class already fixed for the connect/config
 * routes in 101d190 -- same fix here: JSON.stringify the logged detail, and
 * return a rawError field in the response (preferring Meta's own
 * error_user_msg/error_user_title over the generic .message when present,
 * since those name the specific rejected component).
 *
 * Direct-handler-invocation, no HTTP -- same technique as
 * whatsappConnectionErrorLogging.test.js.
 */

jest.mock('axios');
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

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const WASendSvc = require('../src/services/WhatsAppSendService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const COMPANY = 'comp_test';
const USER = { companyId: COMPANY, id: 'emp_1', role: 'admin' };
const WABA_CFG = { accessToken: 'tok_abc', wabaId: 'waba_1', phoneNumberId: 'pnid_1' };
const TEMPLATE = {
  PK: `CONFIG#TMPL#${COMPANY}`, SK: 'TMPL#tmpl_1', templateName: 'promo_1', language: 'en',
  category: 'MARKETING', status: 'DRAFT', components: [{ type: 'BODY', text: 'Hi' }],
};

describe('POST /api/whatsapp/templates/:id/submit — Meta rejection surfacing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a Meta rejection with error_user_msg surfaces that specific message, logs the real detail (not [object Object]), and returns rawError', async () => {
    const META_ERROR = {
      error: {
        message: 'Invalid parameter',
        type: 'OAuthException',
        code: 100,
        error_subcode: 2388023,
        error_user_title: 'Button Type Invalid',
        error_user_msg: 'The location button is not a valid button type for MARKETING category templates.',
        fbtrace_id: 'AbC123XyZ',
      },
    };
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: WABA_CFG }))
      .mockReturnValueOnce(resolved({ Item: TEMPLATE }));
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const handler = getRouteHandler(whatsappRouter, '/templates/:id/submit', 'post');
    const res = mockRes();
    await handler({ params: { id: 'tmpl_1' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    // The specific, end-user-facing message -- not the generic "Invalid parameter" .message.
    expect(body.error).toBe('The location button is not a valid button type for MARKETING category templates.');
    expect(body.rawError).toEqual(META_ERROR);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logMessage).toContain('tmpl_1');
    // The real Meta detail must actually be present and readable (not "[object Object]").
    expect(logDetail).not.toBe('[object Object]');
    expect(logDetail).toContain('Button Type Invalid');
    expect(logDetail).toContain('2388023');
    expect(logDetail).toContain('AbC123XyZ');
  });

  test('a Meta rejection with only the generic .message field falls back to it correctly', async () => {
    const META_ERROR = { error: { message: 'Templates limit reached', type: 'OAuthException', code: 100 } };
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: WABA_CFG }))
      .mockReturnValueOnce(resolved({ Item: TEMPLATE }));
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: META_ERROR } });

    const handler = getRouteHandler(whatsappRouter, '/templates/:id/submit', 'post');
    const res = mockRes();
    await handler({ params: { id: 'tmpl_1' }, user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.error).toBe('Templates limit reached');
    expect(body.rawError).toEqual(META_ERROR);
  });

  test('a successful submission still works unchanged (regression)', async () => {
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: WABA_CFG }))
      .mockReturnValueOnce(resolved({ Item: TEMPLATE }));
    dynamodb.update.mockReturnValueOnce(resolved({}));
    axios.post.mockResolvedValueOnce({ data: { id: 'meta_tmpl_1' } });

    const handler = getRouteHandler(whatsappRouter, '/templates/:id/submit', 'post');
    const res = mockRes();
    await handler({ params: { id: 'tmpl_1' }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: true, metaTemplateId: 'meta_tmpl_1', status: 'PENDING' });
    expect(logger.error).not.toHaveBeenCalled();
    // No headerMediaRef on this template -- the new resolution step must not
    // fire at all for templates that never had a media header.
    expect(WASendSvc.uploadTemplateHeaderHandle).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp/templates/:id/submit — media header handle resolution (2026-07-10)', () => {
  const TEMPLATE_WITH_MEDIA_HEADER = {
    PK: `CONFIG#TMPL#${COMPANY}`, SK: 'TMPL#tmpl_img', templateName: 'promo_img', language: 'en',
    category: 'MARKETING', status: 'DRAFT',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Hi {{1}}' },
    ],
    headerMediaRef: { s3Key: 'uploads/comp_test/pic.png', mimeType: 'image/png', filename: 'pic.png' },
  };

  beforeEach(() => jest.clearAllMocks());

  test('resolves a fresh handle and injects it into a COPY of components -- the stored record is never mutated', async () => {
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: WABA_CFG }))
      .mockReturnValueOnce(resolved({ Item: TEMPLATE_WITH_MEDIA_HEADER }));
    dynamodb.update.mockReturnValueOnce(resolved({}));
    WASendSvc.uploadTemplateHeaderHandle.mockResolvedValueOnce('4::freshHandle');
    axios.post.mockResolvedValueOnce({ data: { id: 'meta_tmpl_img' } });

    const handler = getRouteHandler(whatsappRouter, '/templates/:id/submit', 'post');
    const res = mockRes();
    await handler({ params: { id: 'tmpl_img' }, user: USER }, res, jest.fn());

    expect(WASendSvc.uploadTemplateHeaderHandle).toHaveBeenCalledWith(COMPANY, TEMPLATE_WITH_MEDIA_HEADER.headerMediaRef);

    // The Meta payload's HEADER component has the freshly-resolved handle.
    const [, metaPayload] = axios.post.mock.calls[0];
    const sentHeader = metaPayload.components.find((c) => c.type === 'HEADER');
    expect(sentHeader.example).toEqual({ header_handle: ['4::freshHandle'] });

    // The stored template's OWN components array (module-level TEMPLATE_WITH_MEDIA_HEADER.components)
    // was never mutated -- still has no `example` on its HEADER component.
    const storedHeader = TEMPLATE_WITH_MEDIA_HEADER.components.find((c) => c.type === 'HEADER');
    expect(storedHeader.example).toBeUndefined();

    expect(res.json).toHaveBeenCalledWith({ success: true, metaTemplateId: 'meta_tmpl_img', status: 'PENDING' });
  });

  test('resubmitting a REJECTED template resolves a BRAND NEW handle, never reuses one from a prior attempt', async () => {
    const rejectedTemplate = { ...TEMPLATE_WITH_MEDIA_HEADER, status: 'REJECTED' };
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: WABA_CFG }))
      .mockReturnValueOnce(resolved({ Item: rejectedTemplate }));
    dynamodb.update.mockReturnValueOnce(resolved({}));
    WASendSvc.uploadTemplateHeaderHandle.mockResolvedValueOnce('4::secondAttemptHandle');
    axios.post.mockResolvedValueOnce({ data: { id: 'meta_tmpl_img' } });

    const handler = getRouteHandler(whatsappRouter, '/templates/:id/submit', 'post');
    const res = mockRes();
    await handler({ params: { id: 'tmpl_img' }, user: USER }, res, jest.fn());

    // Same s3Key as the first attempt -- resolution always goes through the
    // stable S3 reference, never a previously-resolved (possibly expired) handle.
    expect(WASendSvc.uploadTemplateHeaderHandle).toHaveBeenCalledWith(COMPANY, rejectedTemplate.headerMediaRef);
    const [, metaPayload] = axios.post.mock.calls[0];
    expect(metaPayload.components.find((c) => c.type === 'HEADER').example).toEqual({ header_handle: ['4::secondAttemptHandle'] });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('a handle-resolution failure surfaces the real error and never reaches Meta at all', async () => {
    dynamodb.get
      .mockReturnValueOnce(resolved({ Item: WABA_CFG }))
      .mockReturnValueOnce(resolved({ Item: TEMPLATE_WITH_MEDIA_HEADER }));
    const uploadErr = Object.assign(new Error('Failed to upload file to Meta'), {
      status: 400, details: { error: { message: 'Unsupported image format' } },
    });
    WASendSvc.uploadTemplateHeaderHandle.mockRejectedValueOnce(uploadErr);

    const handler = getRouteHandler(whatsappRouter, '/templates/:id/submit', 'post');
    const res = mockRes();
    await handler({ params: { id: 'tmpl_img' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toBe('Failed to upload file to Meta');
    expect(body.rawError).toEqual(uploadErr.details);
    // Never reaches the actual template-creation call.
    expect(axios.post).not.toHaveBeenCalled();

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logMessage, logDetail] = logger.error.mock.calls[0];
    expect(logMessage).toContain('tmpl_img');
    expect(logDetail).toContain('Unsupported image format');
  });
});
