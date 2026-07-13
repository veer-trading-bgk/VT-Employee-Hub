'use strict';

/**
 * ai.js — POST /insights and POST /team-insights were migrated onto
 * AIService.generate() (ADR-015) and later, deliberately, disconnected from
 * AI entirely (2026-07-08, Era 33, 19_DECISION_LOG.md — a product decision,
 * not a bug: neither had a real caller anywhere in the dashboard). The
 * routes stay mounted and now return an explicit 410 rather than ever
 * reaching AIService.generate() with a useCase removed from AI_CONFIG. Same
 * direct-handler-invocation technique as whatsappWelcomeButtons.test.js: no
 * HTTP, no auth, AIService/dynamodb/WalletService mocked.
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

// Unlike getRouteHandler (final handler only, middleware bypassed —
// deliberate for the handler-logic tests elsewhere in this file), this
// returns the full per-route middleware chain so role-gate behavior
// (checkRole, authMiddleware) can be exercised directly instead of assumed.
function getRouteStack(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer ? layer.route.stack.map((s) => s.handle) : [];
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { id: 'emp_1', name: 'Test User', role: 'admin', companyId: 'comp_test' };

describe('POST /api/ai/insights — deliberately disconnected from AI (Era 33)', () => {
  const handler = getRouteHandler(aiRouter, '/insights', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('returns 410 with an explicit disabled reason, for any request shape — never calls AIService', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { metrics: { kyc: { actual: 5, target: 10 } }, period: 'week' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      error: 'AI insights is disabled',
      reason: 'deliberately disabled, not a bug',
    });
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('still returns 410 even with no body at all — proves this is a hard short-circuit, not a validation branch', async () => {
    const res = mockRes();
    await handler({ user: USER, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(410);
    expect(AIService.generate).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai/team-insights — deliberately disconnected from AI (Era 33)', () => {
  const handler = getRouteHandler(aiRouter, '/team-insights', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('returns 410 with an explicit disabled reason, for any request shape — never calls AIService', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { teamMetrics: { kyc: 5 }, topPerformers: ['Ravi'], atRisk: ['Amit'] },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({
      error: 'AI team insights is disabled',
      reason: 'deliberately disabled, not a bug',
    });
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('still returns 410 even with no body at all', async () => {
    const res = mockRes();
    await handler({ user: USER, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(410);
    expect(AIService.generate).not.toHaveBeenCalled();
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

// B4 audit Finding 9 (2026-07-13): tightened from ['admin', 'manager'] to
// ['admin'] to match the only frontend caller (AISection.tsx, adminOnly).
// getRouteHandler (above) deliberately bypasses middleware to unit-test
// handler logic in isolation — it can't prove a role is actually rejected.
// This exercises the real checkRole middleware from the route's own stack.
describe('GET /api/ai/wallet — role gate (admin-only, tightened from admin+manager)', () => {
  const stack = getRouteStack(aiRouter, '/wallet', 'get');
  const roleGate = stack[stack.length - 2]; // [authMiddleware, checkRole(['admin']), handler]
  beforeEach(() => jest.clearAllMocks());

  test('manager is rejected with 403, never reaches the handler', async () => {
    const req = { user: { ...USER, role: 'manager' } };
    const res = mockRes();
    const next = jest.fn();
    await roleGate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(WalletService.getBalance).not.toHaveBeenCalled();
  });

  test('telecaller is rejected with 403', async () => {
    const req = { user: { ...USER, role: 'telecaller' } };
    const res = mockRes();
    const next = jest.fn();
    await roleGate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('admin passes through to the handler', async () => {
    const req = { user: { ...USER, role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    await roleGate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('superadmin bypasses the gate (checkRole\'s unconditional superadmin bypass)', async () => {
    const req = { user: { ...USER, role: 'superadmin' } };
    const res = mockRes();
    const next = jest.fn();
    await roleGate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
