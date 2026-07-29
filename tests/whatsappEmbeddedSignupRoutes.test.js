'use strict';

/**
 * Route-level tests for the 3 new Embedded Signup routes (PR 7a/7c,
 * ADR-024), the onboardingStatus field added to GET /config/full, and a
 * regression check on POST /templates/sync after its PR 7a extraction into
 * graphApiHelpers.syncTemplatesFromMeta().
 *
 * EmbeddedSignupService is mocked wholesale here -- its own orchestration
 * logic (pipeline steps, resume, the duplicate-phone guard) has dedicated
 * coverage in embeddedSignupService.test.js. This file only verifies HTTP
 * wiring: request validation, response shape, and error-code translation.
 *
 * Same direct-handler-invocation technique as whatsappAutoRepair.test.js /
 * whatsappOauthInitScope.test.js -- grabs the route's terminal handler and
 * calls it directly, bypassing authMiddleware/checkRole (already exercised
 * by every pre-existing test using this same pattern in this suite).
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
jest.mock('../src/services/EmbeddedSignupService', () => ({
  getEmbeddedSignupConfig: jest.fn(),
  exchangeSignupCode: jest.fn(),
  runOnboardingPipeline: jest.fn(),
  resumeOnboardingPipeline: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const EmbeddedSignupService = require('../src/services/EmbeddedSignupService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(path, method) {
  const layer = whatsappRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/whatsapp/embedded-signup/config', () => {
  const handler = getRouteHandler('/embedded-signup/config', 'get');

  test('501 with EMBEDDED_SIGNUP_NOT_CONFIGURED when unavailable', () => {
    EmbeddedSignupService.getEmbeddedSignupConfig.mockReturnValue({ available: false });
    const res = mockRes();
    handler({ user: { companyId: 'acme' } }, res);
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMBEDDED_SIGNUP_NOT_CONFIGURED' }));
  });

  test('200 with appId/configId/graphApiVersion when available', () => {
    EmbeddedSignupService.getEmbeddedSignupConfig.mockReturnValue({ available: true, appId: 'app_1', configId: 'cfg_1', graphApiVersion: 'v25.0' });
    const res = mockRes();
    handler({ user: { companyId: 'acme' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ appId: 'app_1', configId: 'cfg_1', graphApiVersion: 'v25.0' });
  });
});

describe('POST /api/whatsapp/embedded-signup/exchange', () => {
  const handler = getRouteHandler('/embedded-signup/exchange', 'post');

  test('400 MISSING_FIELDS when code/wabaId/phoneNumberId are absent', async () => {
    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'u1' }, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_FIELDS' }));
    expect(EmbeddedSignupService.exchangeSignupCode).not.toHaveBeenCalled();
  });

  test('400 with the service\'s own error code/message when the code exchange fails', async () => {
    const err = new Error('Meta rejected the signup code');
    err.code = 'CODE_EXCHANGE_FAILED';
    EmbeddedSignupService.exchangeSignupCode.mockRejectedValue(err);
    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'u1' }, body: { code: 'c', wabaId: 'w', phoneNumberId: 'p' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Meta rejected the signup code', code: 'CODE_EXCHANGE_FAILED', retryable: false });
    expect(EmbeddedSignupService.runOnboardingPipeline).not.toHaveBeenCalled();
  });

  test('200 with onboardingStatus on success, passing all 4 fields through to the pipeline', async () => {
    EmbeddedSignupService.exchangeSignupCode.mockResolvedValue({ accessToken: 'tok' });
    const fakeStatus = { startedAt: 't0', completedAt: 't1', steps: {} };
    EmbeddedSignupService.runOnboardingPipeline.mockResolvedValue(fakeStatus);
    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'u1' }, body: { code: 'c', wabaId: 'w', phoneNumberId: 'p', businessId: 'b' } }, res, jest.fn());

    expect(EmbeddedSignupService.runOnboardingPipeline).toHaveBeenCalledWith({
      companyId: 'acme', userId: 'u1', accessToken: 'tok', wabaId: 'w', phoneNumberId: 'p', businessId: 'b',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, onboardingStatus: fakeStatus });
  });

  test('500 PIPELINE_ERROR (structured, not passed to the generic error handler) on an unexpected exception', async () => {
    EmbeddedSignupService.exchangeSignupCode.mockResolvedValue({ accessToken: 'tok' });
    EmbeddedSignupService.runOnboardingPipeline.mockRejectedValue(new Error('unexpected bug'));
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: { companyId: 'acme', id: 'u1' }, body: { code: 'c', wabaId: 'w', phoneNumberId: 'p' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PIPELINE_ERROR', retryable: true }));
  });
});

describe('POST /api/whatsapp/embedded-signup/resume', () => {
  const handler = getRouteHandler('/embedded-signup/resume', 'post');

  test('400 NO_CONFIG when no WABA config exists for the company', async () => {
    const err = new Error('No WhatsApp configuration found for this company');
    err.code = 'NO_CONFIG';
    EmbeddedSignupService.resumeOnboardingPipeline.mockRejectedValue(err);
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_CONFIG', retryable: false }));
  });

  test('200 with onboardingStatus on success', async () => {
    const fakeStatus = { startedAt: 't0', completedAt: null, steps: {} };
    EmbeddedSignupService.resumeOnboardingPipeline.mockResolvedValue(fakeStatus);
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, onboardingStatus: fakeStatus });
  });

  test('500 PIPELINE_ERROR (structured) on an unexpected exception', async () => {
    EmbeddedSignupService.resumeOnboardingPipeline.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: { companyId: 'acme' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PIPELINE_ERROR' }));
  });
});

describe('GET /api/whatsapp/config/full — onboardingStatus exposure (PR 7c)', () => {
  const handler = getRouteHandler('/config/full', 'get');

  test('includes onboardingStatus when present on an embedded_signup connection', async () => {
    const status = { startedAt: 't0', completedAt: null, steps: {} };
    dynamodb.get.mockReturnValue(resolved({
      Item: { companyId: 'acme', wabaId: 'w', phoneNumberId: 'p', accessToken: 'tok', setupMethod: 'embedded_signup', onboardingStatus: status },
    }));
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ onboardingStatus: status }));
  });

  test('onboardingStatus is null for a classic manual/oauth connection', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { companyId: 'acme', wabaId: 'w', phoneNumberId: 'p', accessToken: 'tok', setupMethod: 'manual' },
    }));
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ onboardingStatus: null }));
  });
});

describe('POST /api/whatsapp/templates/sync — unchanged after PR 7a extraction into graphApiHelpers', () => {
  const handler = getRouteHandler('/templates/sync', 'post');

  test('returns {success, synced, imported, total} via the extracted syncTemplatesFromMeta()', async () => {
    dynamodb.get.mockReturnValueOnce(resolved({ Item: { companyId: 'acme', wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: 'tok' } }));
    axios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'mt1', name: 'hello_world', status: 'APPROVED', language: 'en_US', category: 'UTILITY', quality_score: { score: 'GREEN' }, components: [] }] },
    });
    dynamodb.query.mockReturnValueOnce(resolved({ Items: [] }));
    dynamodb.put.mockReturnValue(resolved({}));

    const res = mockRes();
    await handler({ user: { companyId: 'acme' }, body: {} }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, synced: 0, imported: 1, total: 1 });
  });
});
