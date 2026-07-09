'use strict';

/**
 * Tests for POST /api/crm/import (2026-07-09, docs/phase3/TECHNICAL_DEBT.md,
 * Track A2 Fix 1): rateLimit bumped 5 -> 15/60s now that one request covers
 * a whole import (<=2000 leads) instead of one request per row (the old
 * per-row pattern this limit was originally sized for -- fixed separately in
 * 95063cd, 2026-07-08). Confirms the new limit value behaviorally (fires the
 * real rate-limit middleware repeatedly) rather than just reading the source
 * line, plus a basic regression check that the import route itself still
 * works with valid data.
 *
 * No prior tests existed for src/routes/crm.js's /import route at all --
 * confirmed by repo search before writing these.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/CustomerIdentityService', () => ({ resolveOrCreate: jest.fn() }));
jest.mock('../src/services/PipelineService', () => ({
  getPipelineStages: jest.fn(), isValidStage: jest.fn(),
}));
jest.mock('../src/services/LeadService', () => ({}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.DYNAMODB_TABLE_AUDIT = 'vt-audit-test';

const dynamodb = require('../src/config/dynamodb');
const CIS = require('../src/services/CustomerIdentityService');
const PipelineService = require('../src/services/PipelineService');
const crmRouter = require('../src/routes/crm');

function getRoute(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer?.route;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { id: 'emp_1', role: 'admin', companyId: 'acme', name: 'Viir' };

beforeEach(() => {
  jest.clearAllMocks();
  PipelineService.getPipelineStages.mockResolvedValue([{ key: 'new_lead', name: 'New Lead' }]);
  dynamodb.query.mockReturnValue(resolved({ Items: [] })); // scanAllLeads: no existing leads
  dynamodb.update.mockReturnValue(resolved({}));
  CIS.resolveOrCreate.mockResolvedValue({
    existed: false, leadId: 'new_lead_1', action: 'created',
    lead: { PK: 'LEAD#acme#new_lead_1' },
  });
});

describe('POST /api/crm/import — basic regression (route logic unaffected by the rate-limit value change)', () => {
  test('a valid single-lead import still succeeds', async () => {
    const route = getRoute(crmRouter, '/import', 'post');
    const handler = route.stack[route.stack.length - 1].handle;
    const res = mockRes();

    await handler({
      body: { leads: [{ name: 'Priya', phone: '9000000000' }] },
      user: USER,
    }, res, jest.fn());

    expect(CIS.resolveOrCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, imported: 1 }));
  });

  test('still rejects an empty leads array with 400', async () => {
    const route = getRoute(crmRouter, '/import', 'post');
    const handler = route.stack[route.stack.length - 1].handle;
    const res = mockRes();

    await handler({ body: { leads: [] }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('still rejects over 2000 leads with 400 (the server-side cap this rate-limit fix relies on)', async () => {
    const route = getRoute(crmRouter, '/import', 'post');
    const handler = route.stack[route.stack.length - 1].handle;
    const res = mockRes();

    const leads = Array.from({ length: 2001 }, (_, i) => ({ name: `L${i}`, phone: `90000${String(i).padStart(5, '0')}` }));
    await handler({ body: { leads }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/crm/import — rate limit is 15/60s (bumped from 5), tested behaviorally', () => {
  test('the 15th request in a window still passes; the 16th is rejected with 429', async () => {
    const route = getRoute(crmRouter, '/import', 'post');
    // Middleware order: authMiddleware, checkRole([...]), rateLimit(15, 60_000), handler.
    const rateLimitMiddleware = route.stack[2].handle;

    // atomicIncrement's DynamoDB ADD returns the post-increment count —
    // simulate a real counter climbing by 1 on each call within this window.
    let count = 0;
    dynamodb.update.mockImplementation(() => {
      count++;
      return resolved({ Attributes: { count } });
    });

    const next = jest.fn();
    for (let i = 0; i < 15; i++) {
      const res = mockRes();
      await rateLimitMiddleware({ ip: '1.2.3.4' }, res, next);
    }
    expect(next).toHaveBeenCalledTimes(15);

    const res16 = mockRes();
    const next16 = jest.fn();
    await rateLimitMiddleware({ ip: '1.2.3.4' }, res16, next16);

    expect(next16).not.toHaveBeenCalled();
    expect(res16.status).toHaveBeenCalledWith(429);
  });
});
