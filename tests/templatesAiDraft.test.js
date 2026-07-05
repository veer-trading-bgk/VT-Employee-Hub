'use strict';

/**
 * POST /api/whatsapp/templates/ai-draft — AI-Assisted Template Creation
 * (aiConfig.js's 'template-creation' useCase). Same direct-handler-invocation
 * technique as aiRoutes.test.js / whatsappNotes.test.js: no HTTP, no auth,
 * AIService mocked. Also proves sendAIError() (exported from ai.js, reused
 * here rather than re-implemented) actually works when imported from a
 * different route file — not just asserted by comment.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AIService', () => ({
  generate: jest.fn(),
}));

// whatsapp.js refuses to load without this (real S3 client instantiation at
// require time, no network call) — not exercised by these handler tests.
process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const AIService = require('../src/services/AIService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { id: 'emp_1', name: 'Admin', role: 'admin', companyId: 'comp_test' };

const VALID_DRAFT = {
  name: 'Insurance Renewal Reminder',
  category: 'UTILITY',
  categoryReasoning: 'Purely informational, no incentive to renew.',
  bodyText: 'Hi {{1}}, your policy #{{2}} expires on {{3}}.',
  bodyVariables: [
    { example: 'Ravi', description: 'Customer name' },
    { example: 'POL-9821', description: 'Policy number' },
    { example: '15 Aug 2026', description: 'Expiry date' },
  ],
};

describe('POST /api/whatsapp/templates/ai-draft', () => {
  const handler = getRouteHandler(whatsappRouter, '/templates/ai-draft', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('route is registered', () => {
    expect(handler).toBeInstanceOf(Function);
  });

  test('400s without calling AIService when description is missing', async () => {
    const res = mockRes();
    await handler({ user: USER, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('400s without calling AIService when description is blank', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { description: '   ' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('calls AIService.generate with useCase template-creation, companyId, trimmed description, and language', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: VALID_DRAFT, usage: { model: 'm' } });
    const res = mockRes();
    await handler({ user: USER, body: { description: '  A renewal reminder  ', language: 'hi' } }, res, jest.fn());

    expect(AIService.generate).toHaveBeenCalledWith({
      useCase: 'template-creation',
      companyId: 'comp_test',
      context: { description: 'A renewal reminder', language: 'hi' },
      user: USER,
    });
  });

  test('defaults language to "en" when not provided', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: VALID_DRAFT, usage: { model: 'm' } });
    await handler({ user: USER, body: { description: 'A shipping update' } }, mockRes(), jest.fn());
    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: { description: 'A shipping update', language: 'en' },
    }));
  });

  test('returns { success: true, draft } on success', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: VALID_DRAFT, usage: { model: 'm' } });
    const res = mockRes();
    await handler({ user: USER, body: { description: 'A renewal reminder' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, draft: VALID_DRAFT });
  });

  test('maps disabled_master to 503 via the shared sendAIError (reused from ai.js, not re-implemented)', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'disabled_master', detail: 'AI is disabled for this company.' });
    const res = mockRes();
    await handler({ user: USER, body: { description: 'x' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('maps rate_limited to 429', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'rate_limited', detail: 'slow down' });
    const res = mockRes();
    await handler({ user: USER, body: { description: 'x' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('maps invalid_output to 502', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'invalid_output', detail: 'bad json' });
    const res = mockRes();
    await handler({ user: USER, body: { description: 'x' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
  });

  test('maps provider_error to 502', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'provider_error', detail: 'boom' });
    const res = mockRes();
    await handler({ user: USER, body: { description: 'x' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
