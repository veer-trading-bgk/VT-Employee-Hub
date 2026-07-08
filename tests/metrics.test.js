'use strict';

/**
 * src/routes/metrics.js — Team Entry userId-targeting fix (2026-07-08).
 *
 * POST /add, PUT /set, POST /correction, and GET /my previously hard-coded
 * req.user.id and never read a body/query userId, even though the frontend's
 * "Team Entry" tab (entry/page.tsx, gated to v3Role owner/admin/manager — raw
 * roles superadmin/admin/manager/team_lead via toV3Role()) sends userId
 * expecting to act on another employee's record. Writes/reads silently
 * targeted the caller's own record instead, with no error.
 *
 * Direct-handler-invocation (same convention as whatsappListReply.test.js) —
 * these 4 routes have no per-route middleware of their own (auth is applied
 * only at app.js's mount level: app.use('/api/metrics', authMiddleware, ...)),
 * so req.user is constructed directly rather than mocking authMiddleware.
 *
 * Role/team semantics resolved against the codebase's own existing convention
 * (POST /add-for-member, this same file) rather than the literal word "manager"
 * in the originating task spec: 11_SECURITY.md documents `manager` as broad
 * company-wide access and `team_lead` as the narrower, team-scoped role, and
 * /add-for-member's real, already-shipped code only restricts `team_lead`
 * (`req.user.role === 'team_lead' && target.teamLeadId !== req.user.id`) —
 * `manager` is treated identically to `admin` (company-wide, no team check)
 * everywhere else in this file. Tests below verify that actual behavior.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/config/telegram', () => ({ sendMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/wsNotify', () => ({ notifyCompany: jest.fn().mockResolvedValue(undefined) }));

const dynamodb = require('../src/config/dynamodb');
const { logAudit } = require('../src/utils/audit');
const metricsRouter = require('../src/routes/metrics');

const EMP_TABLE = 'vt-employees-test';
const METRICS_TABLE = 'vt-metrics-test';

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const COMPANY_A = 'company_a';
const COMPANY_B = 'company_b';

const ADMIN_USER      = { id: 'admin_1', email: 'admin@co.com',   name: 'Admin One',   role: 'admin',      companyId: COMPANY_A };
const MANAGER_USER    = { id: 'mgr_1',   email: 'mgr@co.com',     name: 'Manager One', role: 'manager',    companyId: COMPANY_A };
const TEAMLEAD_USER   = { id: 'tl_1',    email: 'tl@co.com',      name: 'TL One',      role: 'team_lead',  companyId: COMPANY_A };
const TELECALLER_USER = { id: 'sales_1', email: 'sales@co.com',   name: 'Sales One',   role: 'telecaller', companyId: COMPANY_A };
const SUPERADMIN_USER = { id: 'sa_1',    email: 'sa@apforce.in',  name: 'Super Admin', role: 'superadmin', companyId: null };

// Performer-tier employees (agent/telecaller/intern) — the realistic targets of Team Entry.
const OWN_TEAM_MEMBER   = { id: 'perf_1', name: 'Perf One',   email: 'perf1@co.com', role: 'agent', companyId: COMPANY_A, teamLeadId: 'tl_1' };
const OTHER_TEAM_MEMBER = { id: 'perf_2', name: 'Perf Two',   email: 'perf2@co.com', role: 'agent', companyId: COMPANY_A, teamLeadId: 'tl_2' };
const CROSS_COMPANY_EMP = { id: 'perf_3', name: 'Perf Three', email: 'perf3@co.com', role: 'agent', companyId: COMPANY_B, teamLeadId: 'tl_9' };

const EMPLOYEES_BY_ID = {
  [OWN_TEAM_MEMBER.id]:   OWN_TEAM_MEMBER,
  [OTHER_TEAM_MEMBER.id]: OTHER_TEAM_MEMBER,
  [CROSS_COMPANY_EMP.id]: CROSS_COMPANY_EMP,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_EMPLOYEES = EMP_TABLE;
  process.env.DYNAMODB_TABLE_METRICS = METRICS_TABLE;

  dynamodb.get.mockImplementation((params) => {
    if (params.TableName === EMP_TABLE) {
      return resolved({ Item: EMPLOYEES_BY_ID[params.Key.id] });
    }
    // METRICS_TABLE — no existing/locked record by default
    return resolved({});
  });
  dynamodb.update.mockReturnValue(resolved({}));
  dynamodb.put.mockReturnValue(resolved({}));
  dynamodb.delete.mockReturnValue(resolved({}));
  dynamodb.query.mockReturnValue(resolved({ Items: [] }));
});

describe('POST /api/metrics/add — userId targeting', () => {
  const handler = getRouteHandler(metricsRouter, '/add', 'post');

  test('self-entry (no userId in body) is unchanged — writes to the caller\'s own record', async () => {
    const req = { user: TELECALLER_USER, body: { metric_type: 'kyc', value: 2 }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(TELECALLER_USER.id);
    expect(updateCall.ExpressionAttributeValues[':em']).toBe(TELECALLER_USER.email);
    expect(updateCall.ExpressionAttributeValues[':ef']).toBe('web');
  });

  test('team_lead entering for their own team member is allowed and attributes the record to the target', async () => {
    const req = { user: TEAMLEAD_USER, body: { metric_type: 'kyc', value: 2, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(OWN_TEAM_MEMBER.id);
    expect(updateCall.ExpressionAttributeValues[':em']).toBe(OWN_TEAM_MEMBER.email);
    expect(updateCall.ExpressionAttributeValues[':nm']).toBe(OWN_TEAM_MEMBER.name);
    expect(updateCall.ExpressionAttributeValues[':ef']).toBe('proxy');
  });

  test('team_lead entering for an employee on a DIFFERENT team is rejected with 403', async () => {
    const req = { user: TEAMLEAD_USER, body: { metric_type: 'kyc', value: 2, userId: OTHER_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('not assigned to your team') }));
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('manager entering for ANY performer in the company is allowed, regardless of team (company-wide, not team-scoped)', async () => {
    const req = { user: MANAGER_USER, body: { metric_type: 'kyc', value: 2, userId: OTHER_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(OTHER_TEAM_MEMBER.id);
  });

  test('admin entering for anyone in the same company is allowed', async () => {
    const req = { user: ADMIN_USER, body: { metric_type: 'kyc', value: 2, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(OWN_TEAM_MEMBER.id);
    expect(updateCall.ExpressionAttributeValues[':__cid']).toBe(COMPANY_A);
  });

  test('admin targeting an employee in a DIFFERENT company is rejected with 403 (cross-tenant guard)', async () => {
    const req = { user: ADMIN_USER, body: { metric_type: 'kyc', value: 2, userId: CROSS_COMPANY_EMP.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Access denied' }));
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('superadmin can target an employee in a different company (bypass, matching admin.js convention)', async () => {
    const req = { user: SUPERADMIN_USER, body: { metric_type: 'kyc', value: 2, userId: CROSS_COMPANY_EMP.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(CROSS_COMPANY_EMP.id);
  });

  test('a sales-tier role (telecaller) passing a userId param is rejected with 403 — cannot act for anyone else', async () => {
    const req = { user: TELECALLER_USER, body: { metric_type: 'kyc', value: 2, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Not authorized') }));
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('a userId equal to the caller\'s own id is treated as self-entry, not a proxy path', async () => {
    const req = { user: MANAGER_USER, body: { metric_type: 'kyc', value: 2, userId: MANAGER_USER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(dynamodb.get).not.toHaveBeenCalledWith(expect.objectContaining({ TableName: EMP_TABLE }));
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.ExpressionAttributeValues[':ef']).toBe('web');
  });

  test('a non-existent target userId is rejected with 404', async () => {
    const req = { user: ADMIN_USER, body: { metric_type: 'kyc', value: 2, userId: 'nonexistent_emp' }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('audit log attributes the action to the actor, not the target, and records targetUserId', async () => {
    const req = { user: ADMIN_USER, body: { metric_type: 'kyc', value: 2, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    await handler(req, mockRes(), jest.fn());

    expect(logAudit).toHaveBeenCalledWith(
      ADMIN_USER.id, 'metric_added', expect.any(String), 'success', req.ip,
      expect.objectContaining({ targetUserId: OWN_TEAM_MEMBER.id }),
    );
  });
});

describe('PUT /api/metrics/set — userId targeting', () => {
  const handler = getRouteHandler(metricsRouter, '/set', 'put');

  test('self-entry (no userId) is unchanged', async () => {
    const req = { user: TELECALLER_USER, body: { metric_type: 'kyc', value: 5 }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(TELECALLER_USER.id);
  });

  test('team_lead correcting a value for their own team member is allowed', async () => {
    const req = { user: TEAMLEAD_USER, body: { metric_type: 'kyc', value: 5, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    const updateCall = dynamodb.update.mock.calls[0][0];
    expect(updateCall.Key.PK).toBe(OWN_TEAM_MEMBER.id);
    expect(updateCall.ExpressionAttributeValues[':cf']).toBe('proxy_correction');
  });

  test('team_lead correcting a value for another team\'s member is rejected with 403', async () => {
    const req = { user: TEAMLEAD_USER, body: { metric_type: 'kyc', value: 5, userId: OTHER_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('sales-tier role with a userId param is rejected with 403', async () => {
    const req = { user: TELECALLER_USER, body: { metric_type: 'kyc', value: 5, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/metrics/correction — userId targeting', () => {
  const handler = getRouteHandler(metricsRouter, '/correction', 'post');

  function withApprovedParent() {
    dynamodb.get.mockImplementation((params) => {
      if (params.TableName === EMP_TABLE) return resolved({ Item: EMPLOYEES_BY_ID[params.Key.id] });
      // parent metric record — approved, so a correction is allowed
      return resolved({ Item: { verificationStatus: 'approved' } });
    });
  }

  test('self-entry correction (no userId) is unchanged', async () => {
    withApprovedParent();
    const req = { user: TELECALLER_USER, body: { metric_type: 'kyc', value: 1 }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const putCall = dynamodb.put.mock.calls[0][0];
    expect(putCall.Item.PK).toBe(TELECALLER_USER.id);
    expect(putCall.Item.email).toBe(TELECALLER_USER.email);
  });

  test('admin submitting a correction for an employee in a different company is rejected with 403', async () => {
    withApprovedParent();
    const req = { user: ADMIN_USER, body: { metric_type: 'kyc', value: 1, userId: CROSS_COMPANY_EMP.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('manager submitting a correction for a performer in the company is allowed and attributes it to the target', async () => {
    withApprovedParent();
    const req = { user: MANAGER_USER, body: { metric_type: 'kyc', value: 1, userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    const putCall = dynamodb.put.mock.calls[0][0];
    expect(putCall.Item.PK).toBe(OWN_TEAM_MEMBER.id);
    expect(putCall.Item.email).toBe(OWN_TEAM_MEMBER.email);
    expect(putCall.Item.enteredFrom).toBe('proxy_correction');
  });
});

describe('GET /api/metrics/my — userId targeting', () => {
  const handler = getRouteHandler(metricsRouter, '/my', 'get');

  test('self (no userId query param) is unchanged', async () => {
    const req = { user: TELECALLER_USER, query: {}, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const queryCall = dynamodb.query.mock.calls[0][0];
    expect(queryCall.ExpressionAttributeValues[':userId']).toBe(TELECALLER_USER.id);
  });

  test('admin querying another employee\'s metrics in the same company is allowed', async () => {
    const req = { user: ADMIN_USER, query: { userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    const queryCall = dynamodb.query.mock.calls[0][0];
    expect(queryCall.ExpressionAttributeValues[':userId']).toBe(OWN_TEAM_MEMBER.id);
  });

  test('team_lead querying a different team\'s member is rejected with 403', async () => {
    const req = { user: TEAMLEAD_USER, query: { userId: OTHER_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });

  test('sales-tier role passing a userId query param is rejected with 403', async () => {
    const req = { user: TELECALLER_USER, query: { userId: OWN_TEAM_MEMBER.id }, ip: '1.1.1.1' };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });
});
