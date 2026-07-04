'use strict';

/**
 * Contract tests for POST /api/automations/:id/duplicate (Item 5, "Save as
 * Template") — same direct-handler-invocation technique used throughout this
 * session's route tests. Personal save-and-reuse only, no superadmin/
 * marketplace publishing — see the ADR-free audit note in the route's own
 * comment for why this stays a plain per-company duplicate.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const automationsRouter = require('../src/routes/automations');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const CID = 'comp_test';
const USER = { companyId: CID, id: 'emp_new', name: 'New Owner' };

describe('POST /api/automations/:id/duplicate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('404s when the source workflow does not exist', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/:id/duplicate', 'post');
    const res = mockRes();
    await handler({ params: { id: 'missing' }, body: {}, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('duplicates a linear (steps[]) workflow with a new id, draft status, and reset run stats', async () => {
    const original = {
      PK: `CONFIG#AUTO#${CID}`, SK: 'AUTO#orig1',
      id: 'orig1', companyId: CID, name: 'Welcome flow', description: 'desc',
      status: 'active', enabled: true,
      trigger: { type: 'lead_created', conditions: [] },
      steps: [{ id: 's1', type: 'send_template', config: { templateName: 'hello' } }],
      runCount: 42, lastRunAt: '2026-07-01T00:00:00.000Z',
      createdBy: 'emp_original', createdByName: 'Original Owner',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: original }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const handler = getRouteHandler(automationsRouter, '/:id/duplicate', 'post');
    const res = mockRes();
    await handler({ params: { id: 'orig1' }, body: {}, user: USER }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const dup = dynamodb.put.mock.calls[0][0].Item;
    expect(dup.id).not.toBe(original.id);
    expect(dup.PK).toBe(`CONFIG#AUTO#${CID}`);
    expect(dup.SK).toBe(`AUTO#${dup.id}`);
    expect(dup.name).toBe('Welcome flow (Copy)');
    expect(dup.status).toBe('draft');
    expect(dup.enabled).toBe(false);
    expect(dup.runCount).toBe(0);
    expect(dup.lastRunAt).toBeNull();
    expect(dup.steps).toEqual(original.steps);
    expect(dup.createdBy).toBe('emp_new'); // the duplicating user, not the original creator
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('duplicates a graph (nodes/edges) workflow, preserving its shape', async () => {
    const original = {
      id: 'orig2', companyId: CID, name: 'Branching flow', status: 'active', enabled: true,
      trigger: { type: 'lead_created', conditions: [] },
      nodes: [{ id: 'n1', type: 'send_template', config: {} }, { id: 'n2', type: 'end', config: {} }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      entryNodeId: 'n1',
      runCount: 5, lastRunAt: '2026-07-01T00:00:00.000Z',
      createdBy: 'emp_original', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: original }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const handler = getRouteHandler(automationsRouter, '/:id/duplicate', 'post');
    const res = mockRes();
    await handler({ params: { id: 'orig2' }, body: {}, user: USER }, res, jest.fn());

    const dup = dynamodb.put.mock.calls[0][0].Item;
    expect(dup.nodes).toEqual(original.nodes);
    expect(dup.edges).toEqual(original.edges);
    expect(dup.entryNodeId).toBe('n1');
    expect(dup.steps).toBeUndefined();
  });

  test('the duplicate has no shared object references with the original (deep copy)', async () => {
    const original = {
      id: 'orig3', companyId: CID, name: 'x', status: 'draft', enabled: false,
      trigger: { type: 'lead_created', conditions: [] },
      steps: [{ id: 's1', type: 'send_template', config: { templateName: 'hello' } }],
      runCount: 0, lastRunAt: null, createdBy: 'u', createdAt: 'x', updatedAt: 'x',
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: original }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const handler = getRouteHandler(automationsRouter, '/:id/duplicate', 'post');
    await handler({ params: { id: 'orig3' }, body: {}, user: USER }, mockRes(), jest.fn());

    const dup = dynamodb.put.mock.calls[0][0].Item;
    expect(dup.steps).not.toBe(original.steps); // different array reference
    expect(dup.steps[0]).not.toBe(original.steps[0]); // different object reference
    dup.steps[0].config.templateName = 'mutated';
    expect(original.steps[0].config.templateName).toBe('hello'); // original untouched
  });

  test('accepts an optional custom name in the request body', async () => {
    const original = { id: 'orig4', companyId: CID, name: 'x', status: 'draft', trigger: { type: 'lead_created' }, steps: [{ id: 's1', type: 'end', config: {} }], createdAt: 'x', updatedAt: 'x' };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: original }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const handler = getRouteHandler(automationsRouter, '/:id/duplicate', 'post');
    await handler({ params: { id: 'orig4' }, body: { name: 'My Template' }, user: USER }, mockRes(), jest.fn());

    expect(dynamodb.put.mock.calls[0][0].Item.name).toBe('My Template');
  });
});
