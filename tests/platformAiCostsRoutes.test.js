'use strict';

/**
 * GET /api/platform/ai-costs and /api/platform/ai-costs/entity/:entityId —
 * thin route-layer tests. Aggregation math is covered in
 * tests/aiCostReportService.test.js; this file only checks the routes are
 * wired to the service correctly, sit behind the same platformAdminMiddleware
 * gate as every other Platform route, and shape their response as expected.
 */

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';
process.env.DYNAMODB_TABLE_EMPLOYEES = 'employees';

jest.mock('../src/services/AiCostReportService', () => ({
  getAiCostReport: jest.fn(),
  getEntityCostDetail: jest.fn(),
}));
jest.mock('../src/config/dynamodb', () => ({ scan: jest.fn(), get: jest.fn(), update: jest.fn() }));
jest.mock('../src/config/telegram', () => ({ sendMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const AiCostReportService = require('../src/services/AiCostReportService');
const platformRouter = require('../src/routes/platform');

function findRoute(path, method) {
  const layer = platformRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('platformAdminMiddleware gate', () => {
  test('router applies authMiddleware + platformAdminMiddleware before any route, including the new ones', () => {
    // router.use(authMiddleware, platformAdminMiddleware) is registered as
    // stack entries with no `.route` (plain middleware layers) ahead of every
    // route layer — confirms new routes inherit the same gate as /stats etc.
    const middlewareLayers = platformRouter.stack.filter((l) => !l.route);
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(2);

    const aiCostsRouteIndex = platformRouter.stack.findIndex((l) => l.route?.path === '/ai-costs');
    const lastMiddlewareIndex = Math.max(...middlewareLayers.map((l) => platformRouter.stack.indexOf(l)));
    expect(aiCostsRouteIndex).toBeGreaterThan(lastMiddlewareIndex);
  });
});

describe('GET /api/platform/ai-costs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes from/to query params through to the service and returns its result under success:true', async () => {
    const fakeReport = { range: { from: 'a', to: 'b' }, bySource: {}, embeddings: {}, meta: {} };
    AiCostReportService.getAiCostReport.mockResolvedValue(fakeReport);

    const handler = findRoute('/ai-costs', 'get');
    const res = fakeRes();
    await handler({ query: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' } }, res, jest.fn());

    expect(AiCostReportService.getAiCostReport).toHaveBeenCalledWith({
      from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, ...fakeReport });
  });

  test('works with no query params at all (service owns the default range)', async () => {
    AiCostReportService.getAiCostReport.mockResolvedValue({ range: {}, bySource: {}, embeddings: {}, meta: {} });
    const handler = findRoute('/ai-costs', 'get');
    const res = fakeRes();
    await handler({ query: {} }, res, jest.fn());
    expect(AiCostReportService.getAiCostReport).toHaveBeenCalledWith({ from: undefined, to: undefined });
    expect(res.json).toHaveBeenCalled();
  });

  test('forwards a service error to next(), not a thrown exception', async () => {
    const err = new Error('DDB down');
    AiCostReportService.getAiCostReport.mockRejectedValue(err);
    const handler = findRoute('/ai-costs', 'get');
    const next = jest.fn();
    await handler({ query: {} }, fakeRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('GET /api/platform/ai-costs/entity/:entityId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes the entityId param through and returns the drill-down detail', async () => {
    const fakeDetail = { entityId: 'conv_123', aiUsage: [], embedUsage: [], totals: {} };
    AiCostReportService.getEntityCostDetail.mockResolvedValue(fakeDetail);

    const handler = findRoute('/ai-costs/entity/:entityId', 'get');
    const res = fakeRes();
    await handler({ params: { entityId: 'conv_123' } }, res, jest.fn());

    expect(AiCostReportService.getEntityCostDetail).toHaveBeenCalledWith('conv_123');
    expect(res.json).toHaveBeenCalledWith({ success: true, ...fakeDetail });
  });

  test('forwards a service error to next()', async () => {
    const err = new Error('entityId is required');
    AiCostReportService.getEntityCostDetail.mockRejectedValue(err);
    const handler = findRoute('/ai-costs/entity/:entityId', 'get');
    const next = jest.fn();
    await handler({ params: { entityId: '' } }, fakeRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
