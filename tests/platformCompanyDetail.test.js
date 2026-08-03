'use strict';

/**
 * GET /api/platform/companies/:companyId — CD-01: daysLeftInTrial on detail payload.
 */

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';
process.env.DYNAMODB_TABLE_EMPLOYEES = 'employees';

jest.mock('../src/config/dynamodb', () => ({
  scan: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../src/config/telegram', () => ({ sendMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/AiCostReportService', () => ({
  getAiCostReport: jest.fn(),
  getEntityCostDetail: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const platformRouter = require('../src/routes/platform');

function findRoute(path, method) {
  const layer = platformRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) {
  return { promise: () => Promise.resolve(value) };
}

describe('GET /api/platform/companies/:companyId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
  });

  test('includes daysLeftInTrial derived from trialEndsAt (CD-01)', async () => {
    const trialEndsAt = new Date(Date.now() + 11 * 86_400_000).toISOString();
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        id: 'COMPANY#co_test',
        companyId: 'co_test',
        companyName: 'Test Co',
        adminEmail: 'owner@example.com',
        industry: 'Events',
        city: 'Bengaluru',
        plan: 'trial',
        planStatus: 'active',
        trialEndsAt,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    }));
    dynamodb.scan
      .mockReturnValueOnce(resolved({ Count: 2 }))
      .mockReturnValueOnce(resolved({ Count: 5 }));

    const handler = findRoute('/companies/:companyId', 'get');
    const res = fakeRes();
    await handler({ params: { companyId: 'co_test' } }, res, jest.fn());

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.company.adminEmail).toBe('owner@example.com');
    expect(typeof body.company.daysLeftInTrial).toBe('number');
    expect(body.company.daysLeftInTrial).toBeGreaterThanOrEqual(10);
    expect(body.company.daysLeftInTrial).toBeLessThanOrEqual(12);
    expect(body.stats).toEqual({ employeeCount: 2, leadCount: 5 });
  });

  test('daysLeftInTrial is null when trialEndsAt is absent', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        id: 'COMPANY#co_paid',
        companyId: 'co_paid',
        companyName: 'Paid Co',
        plan: 'paid',
        planStatus: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    dynamodb.scan
      .mockReturnValueOnce(resolved({ Count: 1 }))
      .mockReturnValueOnce(resolved({ Count: 0 }));

    const handler = findRoute('/companies/:companyId', 'get');
    const res = fakeRes();
    await handler({ params: { companyId: 'co_paid' } }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.company.daysLeftInTrial).toBeNull();
    expect(body.company.ownerName).toBeNull();
    expect(body.company.ownerMobile).toBeNull();
  });

  test('CD-02A: attaches ownerName and ownerMobile from linked admin user', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        id: 'COMPANY#co_own',
        companyId: 'co_own',
        companyName: 'Owner Co',
        adminEmail: 'owner@acme.example',
        plan: 'paid',
        planStatus: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    dynamodb.scan
      .mockReturnValueOnce(resolved({ Count: 1 }))
      .mockReturnValueOnce(resolved({ Count: 0 }));
    dynamodb.query.mockReturnValue(resolved({
      Items: [{
        id: 'u_admin',
        email: 'owner@acme.example',
        companyId: 'co_own',
        role: 'admin',
        name: 'Priya Sharma',
        mobileNumber: '9876543210',
      }],
    }));

    const handler = findRoute('/companies/:companyId', 'get');
    const res = fakeRes();
    await handler({ params: { companyId: 'co_own' } }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      IndexName: 'emailIndex',
      KeyConditionExpression: 'email = :email',
    }));
    expect(body.company.ownerName).toBe('Priya Sharma');
    expect(body.company.ownerMobile).toBe('9876543210');
  });
});
