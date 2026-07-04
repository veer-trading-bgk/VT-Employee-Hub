'use strict';

/**
 * ai.js route migration — POST /insights and POST /team-insights now call
 * AIService.generate() instead of fetching Anthropic directly (ADR-015 Rule 1
 * migration target #1/#2). Same direct-handler-invocation technique as
 * whatsappWelcomeButtons.test.js: no HTTP, no auth, AIService/dynamodb/
 * WalletService mocked. The exact { insights, generatedAt, model } response
 * shape is asserted to prove InsightsPanel.tsx needs zero changes.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AIService', () => ({
  generate: jest.fn(),
}));
jest.mock('../src/services/WalletService', () => ({
  getBalance: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const AIService = require('../src/services/AIService');
const WalletService = require('../src/services/WalletService');
const aiRouter = require('../src/routes/ai');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { id: 'emp_1', name: 'Test User', role: 'admin', companyId: 'comp_test' };

describe('POST /api/ai/insights — migrated to AIService', () => {
  const handler = getRouteHandler(aiRouter, '/insights', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('calls AIService.generate with useCase metrics-insights, companyId, and structured context', async () => {
    AIService.generate.mockResolvedValue({
      ok: true, data: 'Great job this week.', usage: { model: 'claude-haiku-4-5-20251001' },
    });
    const req = { user: USER, body: { metrics: { kyc: { actual: 5, target: 10 } }, period: 'week' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'metrics-insights',
      companyId: 'comp_test',
      context: expect.objectContaining({ metrics: { kyc: { actual: 5, target: 10 } }, period: 'week', userRole: 'admin' }),
      user: USER,
    }));
  });

  test('preserves the exact { insights, generatedAt, model } response shape — zero frontend change', async () => {
    AIService.generate.mockResolvedValue({
      ok: true, data: 'Great job this week.', usage: { model: 'claude-haiku-4-5-20251001' },
    });
    const req = { user: USER, body: { metrics: { kyc: { actual: 5, target: 10 } } } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      insights: 'Great job this week.',
      model: 'claude-haiku-4-5-20251001',
      generatedAt: expect.any(String),
    }));
  });

  test('coerces an unrecognised role to "employee" before it reaches context (unchanged RBAC-adjacent behavior)', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: 'x', usage: { model: 'm' } });
    const req = { user: { ...USER, role: 'intern' }, body: { metrics: {} } };
    await handler(req, mockRes(), jest.fn());
    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ userRole: 'employee' }),
    }));
  });

  test('400s without calling AIService when metrics is missing', async () => {
    const res = mockRes();
    await handler({ user: USER, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('maps disabled_master to 503 (matches the old "not configured" behavior)', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'disabled_master', detail: 'AI is disabled for this company.' });
    const res = mockRes();
    await handler({ user: USER, body: { metrics: {} } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('maps rate_limited to 429', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'rate_limited', detail: 'slow down' });
    const res = mockRes();
    await handler({ user: USER, body: { metrics: {} } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('maps provider_error to 502 (matches the old "temporarily unavailable" behavior)', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'provider_error', detail: 'boom' });
    const res = mockRes();
    await handler({ user: USER, body: { metrics: {} } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('POST /api/ai/team-insights — migrated to AIService', () => {
  const handler = getRouteHandler(aiRouter, '/team-insights', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('sanitises performer arrays before passing them into context (unchanged input-hygiene behavior)', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: 'x', usage: { model: 'm' } });
    const req = {
      user: USER,
      body: {
        teamMetrics: { kyc: 5 },
        topPerformers: ['Ravi<script>', 42, 'Priya'],
        atRisk: ['Amit@corp.com'],
      },
    };
    await handler(req, mockRes(), jest.fn());
    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'team-metrics-insights',
      companyId: 'comp_test',
      context: expect.objectContaining({
        teamMetrics: { kyc: 5 },
        topPerformers: ['Raviscript', 'Priya'],
        atRisk: ['Amit@corp.com'],
      }),
    }));
  });

  test('400s without calling AIService when teamMetrics is missing', async () => {
    const res = mockRes();
    await handler({ user: USER, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('preserves the { insights, generatedAt } response shape', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: 'Team is healthy.', usage: { model: 'm' } });
    const res = mockRes();
    await handler({ user: USER, body: { teamMetrics: {} } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ insights: 'Team is healthy.', generatedAt: expect.any(String) }));
  });
});

describe('GET/PUT /api/ai/config — master + module toggles', () => {
  const getHandler = getRouteHandler(aiRouter, '/config', 'get');
  const putHandler = getRouteHandler(aiRouter, '/config', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('GET defaults to enabled with no module overrides when no CONFIG#AI# row exists', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ masterEnabled: true, moduleToggles: {} });
  });

  test('GET reflects a stored CONFIG#AI# row', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { masterEnabled: false, moduleToggles: { 'metrics-insights': false } } }) });
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ masterEnabled: false, moduleToggles: { 'metrics-insights': false } });
  });

  test('PUT writes CONFIG#AI#{companyId}/CURRENT', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const res = mockRes();
    await putHandler({ user: USER, body: { masterEnabled: false, moduleToggles: { 'metrics-insights': false } } }, res, jest.fn());
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: 'CONFIG#AI#comp_test', SK: 'CURRENT', masterEnabled: false, moduleToggles: { 'metrics-insights': false },
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('PUT 400s on an invalid body (zod) without writing anything', async () => {
    const res = mockRes();
    await putHandler({ user: USER, body: { masterEnabled: 'not-a-boolean' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

describe('GET /api/ai/wallet — placeholder balance display', () => {
  const handler = getRouteHandler(aiRouter, '/wallet', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('returns the wallet balance from WalletService', async () => {
    WalletService.getBalance.mockResolvedValue(0);
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());
    expect(WalletService.getBalance).toHaveBeenCalledWith('comp_test');
    expect(res.json).toHaveBeenCalledWith({ balancePoints: 0 });
  });
});
