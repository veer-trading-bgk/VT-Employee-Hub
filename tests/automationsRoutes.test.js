'use strict';

/**
 * Contract tests for POST /api/automations/:id/duplicate (Item 5, "Save as
 * Template") — same direct-handler-invocation technique used throughout this
 * session's route tests. Personal save-and-reuse only, no superadmin/
 * marketplace publishing — see the ADR-free audit note in the route's own
 * comment for why this stays a plain per-company duplicate.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(),
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

// ─── POST / and PUT /:id — trigger.config persistence + validation ───────────
// Regression coverage for an audit finding: both routes used to build the
// stored trigger as a hardcoded { type, conditions } object, which would have
// silently dropped a trigger.config the frontend sent (no error, just gone).
describe('POST /api/automations — trigger.config (keyword_message)', () => {
  beforeEach(() => jest.clearAllMocks());

  function body(trigger, overrides = {}) {
    return {
      name: 'Keyword workflow',
      trigger,
      steps: [{ id: 'end-default', type: 'end', config: {} }],
      ...overrides,
    };
  }

  test('rejects keyword_message with no config at all', async () => {
    const handler = getRouteHandler(automationsRouter, '/', 'post');
    const res = mockRes();
    await handler({ body: body({ type: 'keyword_message', conditions: [] }), user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('rejects keyword_message with an empty keywords array', async () => {
    const handler = getRouteHandler(automationsRouter, '/', 'post');
    const res = mockRes();
    await handler({
      body: body({ type: 'keyword_message', conditions: [], config: { matchMode: 'contains', keywords: [] } }),
      user: USER,
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('rejects keyword_message with keywords that are only whitespace', async () => {
    const handler = getRouteHandler(automationsRouter, '/', 'post');
    const res = mockRes();
    await handler({
      body: body({ type: 'keyword_message', conditions: [], config: { matchMode: 'contains', keywords: ['   ', ''] } }),
      user: USER,
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('rejects an unknown matchMode', async () => {
    const handler = getRouteHandler(automationsRouter, '/', 'post');
    const res = mockRes();
    await handler({
      body: body({ type: 'keyword_message', conditions: [], config: { matchMode: 'starts_with', keywords: ['hi'] } }),
      user: USER,
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('accepts a valid config and persists it, trimmed and blank entries removed', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/', 'post');
    const res = mockRes();
    await handler({
      body: body({
        type: 'keyword_message', conditions: [],
        config: { matchMode: 'any_of', keywords: [' demat ', '', 'ipo  '], caseSensitive: true },
      }),
      user: USER,
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const saved = dynamodb.put.mock.calls[0][0].Item;
    expect(saved.trigger).toEqual({
      type: 'keyword_message', conditions: [],
      config: { matchMode: 'any_of', keywords: ['demat', 'ipo'], caseSensitive: true },
    });
  });

  test('non-keyword trigger types are unaffected — no config key is added', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/', 'post');
    const res = mockRes();
    await handler({ body: body({ type: 'lead_created', conditions: [] }), user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    const saved = dynamodb.put.mock.calls[0][0].Item;
    expect(saved.trigger).toEqual({ type: 'lead_created', conditions: [] });
    expect(saved.trigger.config).toBeUndefined();
  });
});

describe('PUT /api/automations/:id — trigger.config (keyword_message)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: 'wf1', companyId: CID, trigger: { type: 'lead_created', conditions: [] } } }) });
  });

  test('rejects an update to an invalid keyword_message config, and does not write', async () => {
    const handler = getRouteHandler(automationsRouter, '/:id', 'put');
    const res = mockRes();
    await handler({
      params: { id: 'wf1' },
      body: { trigger: { type: 'keyword_message', conditions: [], config: { matchMode: 'contains', keywords: [] } } },
      user: USER,
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('persists a valid keyword_message config update', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/:id', 'put');
    const res = mockRes();
    await handler({
      params: { id: 'wf1' },
      body: { trigger: { type: 'keyword_message', conditions: [], config: { matchMode: 'exact', keywords: ['yes'] } } },
      user: USER,
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':t']).toEqual({
      type: 'keyword_message', conditions: [],
      config: { matchMode: 'exact', keywords: ['yes'], caseSensitive: false },
    });
  });

  test('switching a workflow back to a non-keyword trigger drops any stale config', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: {
      id: 'wf1', companyId: CID,
      trigger: { type: 'keyword_message', conditions: [], config: { matchMode: 'exact', keywords: ['yes'] } },
    } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/:id', 'put');
    const res = mockRes();
    await handler({
      params: { id: 'wf1' },
      body: { trigger: { type: 'lead_created', conditions: [] } },
      user: USER,
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':t']).toEqual({ type: 'lead_created', conditions: [] });
  });
});

// ─── PUT /:id — name-only body (Track A4 Batch 2, canvas rename field) ──────
// The canvas editor's new WorkflowNameField sends {name} alone (no
// nodes/edges/trigger/steps) — this is the existing partial-update PUT
// handler, unchanged; these tests confirm the exact contract the new
// frontend field relies on rather than assuming it from a static read.
describe('PUT /api/automations/:id — name-only body (canvas rename field)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: {
      id: 'wf1', companyId: CID, name: 'Old Name',
      nodes: [{ id: 'n1', type: 'end', config: {} }], edges: [], entryNodeId: 'n1',
      trigger: { type: 'lead_created', conditions: [] },
    } }) });
  });

  test('a {name}-only body updates just the name — no nodes/edges/trigger keys touched', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: 'wf1' }, body: { name: 'New Name' }, user: USER }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true });
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':n']).toBe('New Name');
    expect(call.UpdateExpression).not.toMatch(/nodes|edges|trigger|steps/);
  });

  test('an empty/whitespace-only name is rejected with 400 and does not write', async () => {
    const handler = getRouteHandler(automationsRouter, '/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: 'wf1' }, body: { name: '   ' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('name is trimmed before persisting', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(automationsRouter, '/:id', 'put');
    const res = mockRes();
    await handler({ params: { id: 'wf1' }, body: { name: '  Renamed Flow  ' }, user: USER }, res, jest.fn());

    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':n']).toBe('Renamed Flow');
  });
});

// ─── GET /executions — pagination (Track B2 Batch 2a, Item 8) ──────────────
// Real production companies don't reliably have >200 execution records to
// exercise this against live data, so this is the seeded case the batch's
// validation note allows for. Two things this specifically has to prove:
// (1) the do/while drain actually walks DynamoDB's real LastEvaluatedKey
// across multiple raw pages rather than just reading the first one, and
// (2) status/q filtering happens on the FULL drained set before the
// page/total math, not on an already-capped or already-sliced subset — the
// exact bug the old Limit-then-filter code had (see automations.js's own
// comment on this route).
describe('GET /api/automations/executions — pagination', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeExec(i, overrides = {}) {
    return {
      executionId: `exec-${i}`, workflowId: 'wf-1', workflowName: 'Test Workflow',
      companyId: CID, status: 'completed', contactName: `Contact ${i}`,
      triggeredBy: { type: 'lead_created', entityId: 'lead-1' },
      startedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      ...overrides,
    };
  }

  test('no page param -> single bounded query, no drain, unpaginated response shape unchanged (AutomationDashboard widget)', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [makeExec(1)] }) });
    const handler = getRouteHandler(automationsRouter, '/executions', 'get');
    const res = mockRes();
    await handler({ query: { limit: '5' }, user: USER }, res, jest.fn());

    expect(dynamodb.query).toHaveBeenCalledTimes(1);
    expect(dynamodb.query.mock.calls[0][0].Limit).toBe(5);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.total).toBeUndefined();
    expect(payload.page).toBeUndefined();
  });

  test('page param present -> drains every raw DynamoDB page via LastEvaluatedKey, then slices correctly for the requested page', async () => {
    const allItems = Array.from({ length: 250 }, (_, i) => makeExec(i));
    dynamodb.query
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Items: allItems.slice(0, 150), LastEvaluatedKey: { SK: 'cursor-1' } }) })
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Items: allItems.slice(150, 250) }) });

    const handler = getRouteHandler(automationsRouter, '/executions', 'get');
    const res = mockRes();
    await handler({ query: { page: '3', pageSize: '100' }, user: USER }, res, jest.fn());

    expect(dynamodb.query).toHaveBeenCalledTimes(2);
    expect(dynamodb.query.mock.calls[1][0].ExclusiveStartKey).toEqual({ SK: 'cursor-1' });

    const payload = res.json.mock.calls[0][0];
    expect(payload.total).toBe(250);
    expect(payload.pages).toBe(3);
    expect(payload.page).toBe(3);
    expect(payload.executions).toHaveLength(50); // last partial page: 250 - 200
    expect(payload.executions[0].executionId).toBe('exec-200');
    expect(payload.executions[49].executionId).toBe('exec-249');
  });

  test('status filter narrows total/pages to the filtered count, not the raw drained count', async () => {
    const completed = Array.from({ length: 8 }, (_, i) => makeExec(i, { status: 'completed' }));
    const failed    = Array.from({ length: 3 }, (_, i) => makeExec(100 + i, { status: 'failed' }));
    dynamodb.query.mockReturnValueOnce({ promise: () => Promise.resolve({ Items: [...completed, ...failed] }) });

    const handler = getRouteHandler(automationsRouter, '/executions', 'get');
    const res = mockRes();
    await handler({ query: { page: '1', pageSize: '50', status: 'failed' }, user: USER }, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.total).toBe(3);
    expect(payload.executions).toHaveLength(3);
    expect(payload.executions.every((e) => e.status === 'failed')).toBe(true);
  });

  test('q search filters by workflowName/contactName across the full drained set before slicing', async () => {
    const items = [
      makeExec(1, { workflowName: 'Welcome Flow',    contactName: 'Asha'  }),
      makeExec(2, { workflowName: 'Follow-up Flow',  contactName: 'Ravi'  }),
      makeExec(3, { workflowName: 'Welcome Flow',    contactName: 'Meera' }),
    ];
    dynamodb.query.mockReturnValueOnce({ promise: () => Promise.resolve({ Items: items }) });

    const handler = getRouteHandler(automationsRouter, '/executions', 'get');
    const res = mockRes();
    await handler({ query: { page: '1', pageSize: '50', q: 'welcome' }, user: USER }, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.total).toBe(2);
    expect(payload.executions.map((e) => e.contactName).sort()).toEqual(['Asha', 'Meera']);
  });

  test('sortDir=asc reverses the naturally-descending drain order; no sortDir (or desc) keeps it as-is', async () => {
    // makeExec's startedAt is monotonically increasing with i, so the drain
    // arrives ascending here (unlike real DynamoDB, where ScanIndexForward:false
    // already yields descending) — irrelevant to what's under test: only that
    // sortDir=asc actually re-sorts by startedAt ascending, and its absence
    // leaves the drained order untouched.
    const items = [makeExec(3), makeExec(1), makeExec(2)];
    dynamodb.query.mockReturnValueOnce({ promise: () => Promise.resolve({ Items: items }) });
    const handler = getRouteHandler(automationsRouter, '/executions', 'get');
    const res = mockRes();
    await handler({ query: { page: '1', pageSize: '50', sortDir: 'asc' }, user: USER }, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.executions.map((e) => e.executionId)).toEqual(['exec-1', 'exec-2', 'exec-3']);

    jest.clearAllMocks();
    dynamodb.query.mockReturnValueOnce({ promise: () => Promise.resolve({ Items: items }) });
    const res2 = mockRes();
    await handler({ query: { page: '1', pageSize: '50' }, user: USER }, res2, jest.fn());
    const payload2 = res2.json.mock.calls[0][0];
    expect(payload2.executions.map((e) => e.executionId)).toEqual(['exec-3', 'exec-1', 'exec-2']);
  });
});
