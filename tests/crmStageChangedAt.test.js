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

describe('PUT /api/crm/leads/:id/stage — stageChangedAt', () => {
  const handler = getRouteHandler('/leads/:id/stage', 'put');

  beforeEach(() => {
    jest.clearAllMocks();
    PipelineService.isValidStage.mockResolvedValue(true);
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

  test('still stamps stageChangedAt on the converted-stage branch (convertedAt is additive, not a replacement)', async () => {
    await handler({ user: USER, params: { id: LEAD_ID }, body: { stage: 'converted' } }, mockRes(), jest.fn());

    const [{ UpdateExpression, ExpressionAttributeValues }] = dynamodb.update.mock.calls[0];
    expect(UpdateExpression).toMatch(/#sca = :sca/);
    expect(UpdateExpression).toMatch(/#ca = :ca/);
    expect(ExpressionAttributeValues[':sca']).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });
});
