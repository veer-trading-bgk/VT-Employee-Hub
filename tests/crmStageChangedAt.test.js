'use strict';

/**
 * PUT /api/crm/leads/:id/stage — stageChangedAt stamping (2026-07-17).
 * The Sales Kanban board's own "Recently moved" sort (dashboard
 * sales/page.tsx) depends on this field: without it, dragging a card to a
 * new stage silently kept it wherever the board's (unrelated) sort placed
 * it, instead of floating it to the top of the new column. Same direct-
 * handler-invocation technique as tests/crmUpdateLeadFields.test.js: no
 * HTTP, no auth, dynamodb/logger/PipelineService/automations mocked.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/PipelineService', () => ({
  getPipelineStages: jest.fn(), isValidStage: jest.fn(),
}));
jest.mock('../src/routes/automations', () => ({
  runAutomations: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
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

const USER = { companyId: 'acme', id: 'emp_1', role: 'admin' };
const LEAD_ID = 'lead_123';
const PK = `LEAD#acme#${LEAD_ID}`;

// The stage keys used by this file's tests, no isWon flag — the route now
// fetches this list itself (replacing isValidStage) to look up the target
// stage's isWon flag for the convertedAt branch (Stage 3, 2026-07-17 360°
// audit) — see the dedicated describe block below for that logic
// specifically.
const DEFAULT_TEST_STAGES = [
  { key: 'new', label: 'New', color: '#000', order: 0 },
  { key: 'interested', label: 'Interested', color: '#000', order: 1 },
];

describe('PUT /api/crm/leads/:id/stage — stageChangedAt', () => {
  const handler = getRouteHandler('/leads/:id/stage', 'put');

  beforeEach(() => {
    jest.clearAllMocks();
    PipelineService.getPipelineStages.mockResolvedValue(DEFAULT_TEST_STAGES);
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', leadId: LEAD_ID, companyId: 'acme', assignedTo: 'emp_1', phone: '9000000000', stage: 'new' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.put.mockReturnValue(resolved({}));
  });

  test('stamps stageChangedAt as a real ISO timestamp, aliased via ExpressionAttributeNames', async () => {
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'interested' } }, mockRes(), jest.fn());

    const [{ UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).toMatch(/#sca = :sca/);
    expect(ExpressionAttributeNames['#sca']).toBe('stageChangedAt');
    expect(ExpressionAttributeValues[':sca']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  test('stageChangedAt and updatedAt are stamped with the SAME instant (one now, not two)', async () => {
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'interested' } }, mockRes(), jest.fn());

    const [{ ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(ExpressionAttributeValues[':sca']).toBe(ExpressionAttributeValues[':ua']);
  });

  test('still stamps stageChangedAt on a Won-flagged stage transition (convertedAt is additive, not a replacement)', async () => {
    // Stage 3 (2026-07-17 360° audit): convertedAt now fires on isWon: true,
    // not a literal 'converted' key — this test's own stages list carries
    // the flag on a stage named 'converted' purely for readability continuity
    // with the test's own name; the flag, not the name, is what matters.
    PipelineService.getPipelineStages.mockResolvedValue([
      ...DEFAULT_TEST_STAGES,
      { key: 'converted', label: 'Converted', color: '#000', order: 2, isWon: true },
    ]);
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'converted' } }, mockRes(), jest.fn());

    const [{ UpdateExpression, ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).toMatch(/#sca = :sca/);
    expect(UpdateExpression).toMatch(/#ca = :ca/);
    expect(ExpressionAttributeValues[':sca']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });
});

// Stage 3 (2026-07-17 360° audit) — convertedAt is now flag-based (isWon on
// the NEW stage being transitioned to), replacing the old
// `stage === 'converted'` literal-key match, which never fired for any
// company on the documented default pipeline (no stage named 'converted').
describe('PUT /api/crm/leads/:id/stage — Stage 3: flag-based convertedAt', () => {
  const handler = getRouteHandler('/leads/:id/stage', 'put');

  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.get.mockReturnValue(resolved({ Item: { PK, SK: 'METADATA', leadId: LEAD_ID, companyId: 'acme', assignedTo: 'emp_1', phone: '9000000000', stage: 'new' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.put.mockReturnValue(resolved({}));
  });

  test('fires convertedAt when transitioning to a stage flagged isWon, regardless of its key name', async () => {
    PipelineService.getPipelineStages.mockResolvedValue([
      { key: 'new', label: 'New', color: '#000', order: 0 },
      { key: 'active_clients', label: 'Active Clients', color: '#000', order: 1, isWon: true },
    ]);
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'active_clients' } }, mockRes(), jest.fn());

    const [{ UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).toMatch(/#ca = :ca/);
    expect(ExpressionAttributeNames['#ca']).toBe('convertedAt');
    expect(ExpressionAttributeValues[':ca']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  test('does NOT fire convertedAt for a stage literally named "converted" that lacks the isWon flag — proves this is flag-based, not name-based', async () => {
    PipelineService.getPipelineStages.mockResolvedValue([
      { key: 'new', label: 'New', color: '#000', order: 0 },
      { key: 'converted', label: 'Converted', color: '#000', order: 1 }, // no isWon
    ]);
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'converted' } }, mockRes(), jest.fn());

    const [{ UpdateExpression, ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).not.toMatch(/#ca = :ca/);
    expect(ExpressionAttributeValues[':ca']).toBeUndefined();
  });

  test('does not fire for an ordinary stage transition with no isWon flag anywhere in the pipeline', async () => {
    PipelineService.getPipelineStages.mockResolvedValue([
      { key: 'new', label: 'New', color: '#000', order: 0 },
      { key: 'interested', label: 'Interested', color: '#000', order: 1 },
    ]);
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'interested' } }, mockRes(), jest.fn());

    const [{ UpdateExpression }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).not.toMatch(/#ca = :ca/);
  });

  test('rejects a stage key not present in the company\'s real pipeline with 400, before any write (replaces isValidStage)', async () => {
    PipelineService.getPipelineStages.mockResolvedValue([
      { key: 'new', label: 'New', color: '#000', order: 0 },
    ]);
    const res = mockRes();
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'not_a_real_stage' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('does NOT reset convertedAt on an idempotent PUT into a stage the lead is ALREADY in, even if that stage is isWon (adversarial-review fix)', async () => {
    // Found by adversarial verification: the convertedAt branch fired on
    // targetStage.isWon alone, with no gate on an actual transition — unlike
    // the auto-metric-credit block a few lines below it, which IS gated on
    // lead.stage !== stage. A repeat/idempotent call into an already-Won
    // stage would have silently reset convertedAt to "now", corrupting
    // convertedToday/convertedThisMonth stats. Dormant under the current UI
    // (both call sites already guard stageKey !== contact.stage before
    // calling the API) but reachable from any other caller (retries, a
    // future API consumer) once isWon is a real, live flag.
    dynamodb.get.mockReturnValue(resolved({
      Item: { PK, SK: 'METADATA', leadId: LEAD_ID, companyId: 'acme', assignedTo: 'emp_1', phone: '9000000000', stage: 'active_clients' },
    }));
    PipelineService.getPipelineStages.mockResolvedValue([
      { key: 'new', label: 'New', color: '#000', order: 0 },
      { key: 'active_clients', label: 'Active Clients', color: '#000', order: 1, isWon: true },
    ]);
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'active_clients' } }, mockRes(), jest.fn());

    const [{ UpdateExpression, ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).not.toMatch(/#ca = :ca/);
    expect(ExpressionAttributeValues[':ca']).toBeUndefined();
  });
});
