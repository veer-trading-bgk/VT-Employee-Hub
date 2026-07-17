'use strict';

/**
 * PUT /api/crm/pipeline — isWon/isLost flag validation and persistence
 * (Stage 3, 2026-07-17 360° audit fix plan). These flags are what
 * everywhere else in the codebase (LeadScoringService.isClosedLead, the
 * PUT /leads/:id/stage convertedAt branch, the Sales KPI header/team view,
 * journeyInference.ts) reads to replace hardcoded stage-name matching —
 * this route is the one write path, so its validation and exact stored
 * shape matter for all of those readers to behave correctly.
 *
 * Direct-handler-invocation technique (same as tests/crmStageChangedAt.test.js).
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const crmRouter = require('../src/routes/crm');

function getRouteHandler(path, method) {
  const layer = crmRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { companyId: 'acme', id: 'admin_1', role: 'admin' };

describe('PUT /api/crm/pipeline — isWon/isLost', () => {
  const handler = getRouteHandler('/pipeline', 'put');

  beforeEach(() => {
    jest.clearAllMocks();
    // GSI query for the active-leads-block check — no leads, so no stage
    // deletion is ever blocked in these tests (that's a separate concern,
    // pre-existing and untouched by Stage 3).
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    dynamodb.get.mockReturnValue(resolved({}));
    dynamodb.put.mockReturnValue(resolved({}));
  });

  test('rejects a stage marked both Won and Lost with 400, before any write', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [
        { key: 'active_clients', label: 'Active Clients', color: '#22c55e', isWon: true, isLost: true },
      ] },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('persists isWon: true on a stage explicitly marked Won', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [
        { key: 'new_lead', label: 'New Lead', color: '#94a3b8' },
        { key: 'active_clients', label: 'Active Clients', color: '#22c55e', isWon: true },
      ] },
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = dynamodb.put.mock.calls[0][0].Item.stages;
    expect(stored.find((s) => s.key === 'active_clients').isWon).toBe(true);
  });

  test('persists isLost: true on a stage explicitly marked Lost', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [
        { key: 'new_lead', label: 'New Lead', color: '#94a3b8' },
        { key: 'churned', label: 'Churned', color: '#ef4444', isLost: true },
      ] },
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = dynamodb.put.mock.calls[0][0].Item.stages;
    expect(stored.find((s) => s.key === 'churned').isLost).toBe(true);
  });

  test('a stage with neither flag stores neither key at all — not isWon:false/isLost:false', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [
        { key: 'new_lead', label: 'New Lead', color: '#94a3b8' },
      ] },
    }, res, jest.fn());

    const stored = dynamodb.put.mock.calls[0][0].Item.stages[0];
    expect(stored).toEqual({ key: 'new_lead', label: 'New Lead', color: '#94a3b8', order: 0 });
    expect('isWon' in stored).toBe(false);
    expect('isLost' in stored).toBe(false);
  });

  test('an explicit isWon: false / isLost: false on the incoming stage also stores neither key', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [
        { key: 'new_lead', label: 'New Lead', color: '#94a3b8', isWon: false, isLost: false },
      ] },
    }, res, jest.fn());

    const stored = dynamodb.put.mock.calls[0][0].Item.stages[0];
    expect('isWon' in stored).toBe(false);
    expect('isLost' in stored).toBe(false);
  });

  test('multiple DIFFERENT stages can each independently be Won or Lost or neither in the same save', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [
        { key: 'new_lead', label: 'New Lead', color: '#000' },
        { key: 'active_clients', label: 'Active Clients', color: '#000', isWon: true },
        { key: 'churned', label: 'Churned', color: '#000', isLost: true },
      ] },
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const stored = dynamodb.put.mock.calls[0][0].Item.stages;
    expect(stored.find((s) => s.key === 'new_lead').isWon).toBeUndefined();
    expect(stored.find((s) => s.key === 'active_clients').isWon).toBe(true);
    expect(stored.find((s) => s.key === 'churned').isLost).toBe(true);
  });

  test('the existing key/label validation still runs before the isWon/isLost check', async () => {
    const res = mockRes();
    await handler({
      user: USER,
      body: { stages: [{ key: '', label: '', isWon: true, isLost: true }] },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [{ error }] = res.json.mock.calls[0];
    expect(error).toMatch(/key and label/);
  });
});
