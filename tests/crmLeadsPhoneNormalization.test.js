'use strict';

/**
 * Wave 1 audit — Fix 1: POST /api/crm/leads stripped non-digits with an ad-hoc
 * String(body.phone).replace(/\D/g, '') instead of to10Digit(), so a country-
 * code-prefixed number (+91 98765 43210) became 12 digits and failed
 * createLeadSchema's exact-10-digit regex before ever reaching CIS. This route
 * already calls CIS.resolveOrCreate() (migrated in a prior commit, predating
 * this fix) — only the normalization/truncation half of the original bug
 * report was still real; these tests cover that half plus the existing
 * duplicate-phone 409 contract and the CIS-only creation path.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/CustomerIdentityService', () => ({ resolveOrCreate: jest.fn() }));
jest.mock('../src/services/LeadService', () => ({ linkContactToLead: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/PipelineService', () => ({
  getPipelineStages: jest.fn().mockResolvedValue([{ key: 'new_lead' }]),
  isValidStage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/utils/wsNotify', () => ({ notifyCompany: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/routes/automations', () => ({ runAutomations: jest.fn().mockResolvedValue(undefined) }));

const dynamodb = require('../src/config/dynamodb');
const CIS = require('../src/services/CustomerIdentityService');
const crmRouter = require('../src/routes/crm');

function getRouteHandler(path, method) {
  const layer = crmRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { companyId: 'acme', id: 'emp_1', name: 'Agent', role: 'admin' };

describe('POST /api/crm/leads — phone normalization (Fix 1)', () => {
  const handler = getRouteHandler('/leads', 'post');

  beforeEach(() => jest.clearAllMocks());

  test('a +91-prefixed phone is truncated to 10 digits and succeeds (previously 400s)', async () => {
    CIS.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_1',
      lead: { PK: 'LEAD#acme#lead_1', leadId: 'lead_1', name: 'Test Lead', phone: '9876543210', source: 'manual', stage: 'new_lead', tags: [] },
    });
    const res = mockRes();

    await handler({ body: { name: 'Test Lead', phone: '+91 98765 43210' }, user: USER }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(CIS.resolveOrCreate).toHaveBeenCalledWith(
      'acme',
      expect.objectContaining({ phone: '9876543210' }),
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('a plain 10-digit phone is unaffected', async () => {
    CIS.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_2',
      lead: { PK: 'LEAD#acme#lead_2', leadId: 'lead_2', name: 'Plain', phone: '9000000000', source: 'manual', stage: 'new_lead', tags: [] },
    });
    const res = mockRes();

    await handler({ body: { name: 'Plain', phone: '9000000000' }, user: USER }, res, jest.fn());

    expect(CIS.resolveOrCreate).toHaveBeenCalledWith('acme', expect.objectContaining({ phone: '9000000000' }), expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('duplicate phone still 409s with the existing lead id', async () => {
    CIS.resolveOrCreate.mockResolvedValue({ existed: true, leadId: 'lead_existing' });
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { name: 'Already Here' } }) });
    const res = mockRes();

    await handler({ body: { name: 'Dup', phone: '+91 98765 43210' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      existingLeadId: 'lead_existing', existingName: 'Already Here',
    }));
  });

  test('a non-duplicate phone creates via CIS.resolveOrCreate, never a direct dynamodb.put for the lead', async () => {
    CIS.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_3',
      lead: { PK: 'LEAD#acme#lead_3', leadId: 'lead_3', name: 'Fresh', phone: '9876543210', source: 'manual', stage: 'new_lead', tags: [] },
    });
    const res = mockRes();

    await handler({ body: { name: 'Fresh', phone: '9876543210' }, user: USER }, res, jest.fn());

    expect(CIS.resolveOrCreate).toHaveBeenCalledTimes(1);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
