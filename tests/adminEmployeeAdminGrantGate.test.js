'use strict';

/**
 * B3 fix Batch S1, finding #1 (CRITICAL): only a raw superadmin may grant
 * the 'admin' role via POST/PUT /api/admin/employees — an admin granting
 * admin (to someone else, or to themselves via PUT) was previously
 * unrestricted, contradicting docs/v3/09_PERMISSION_MATRIX.md:292,330-332
 * ("Admin: Limited (can't create Admin)... prevents privilege escalation
 * without Owner knowledge"). Direct-handler-invocation technique (see
 * tests/automationsRoutes.test.js) — exercises the final route handler,
 * where this check lives, bypassing the router-level authMiddleware/
 * adminMiddleware/rateLimit that a real request would also pass through.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/config/telegram', () => ({ sendMessage: jest.fn(() => Promise.resolve()) }));

const dynamodb = require('../src/config/dynamodb');
const adminRouter = require('../src/routes/admin');

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

describe('POST /api/admin/employees — admin-grant escalation gate', () => {
  beforeEach(() => jest.clearAllMocks());

  const handler = () => getRouteHandler(adminRouter, '/employees', 'post');
  const validBody = (role) => ({ email: 'new@test.com', password: 'ValidPass123!', name: 'New Person', role });

  test('admin requesting role: admin is rejected with 403, no DB writes', async () => {
    const req = { body: validBody('admin'), user: { id: 'u1', role: 'admin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.query).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('superadmin requesting role: admin succeeds', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const req = { body: validBody('admin'), user: { id: 'u1', role: 'superadmin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(dynamodb.put).toHaveBeenCalledTimes(1);
  });

  test('admin requesting role: manager succeeds (no regression on non-admin role grants)', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const req = { body: validBody('manager'), user: { id: 'u1', role: 'admin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(dynamodb.put).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/admin/employees/:id — admin-grant escalation gate', () => {
  beforeEach(() => jest.clearAllMocks());

  const handler = () => getRouteHandler(adminRouter, '/employees/:id', 'put');

  test('admin setting role: admin on another employee is rejected with 403, no DB reads/writes', async () => {
    const req = { params: { id: 'emp_target' }, body: { role: 'admin' }, user: { id: 'u1', role: 'admin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('admin self-promoting (PUT on own id) with role: admin is rejected with 403', async () => {
    const req = { params: { id: 'u1' }, body: { role: 'admin' }, user: { id: 'u1', role: 'admin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('superadmin setting role: admin succeeds', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: 'emp_target', email: 't@test.com', companyId: CID, role: 'manager' } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { id: 'emp_target', role: 'admin' } }) });
    const req = { params: { id: 'emp_target' }, body: { role: 'admin' }, user: { id: 'u1', role: 'superadmin', companyId: CID, email: 'owner@test.com' } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(dynamodb.update).toHaveBeenCalledTimes(1);
  });

  test('admin demoting another admin to manager is NOT blocked (demotion is not an escalation)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: 'emp_target', email: 't@test.com', companyId: CID, role: 'admin' } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { id: 'emp_target', role: 'manager' } }) });
    const req = { params: { id: 'emp_target' }, body: { role: 'manager' }, user: { id: 'u1', role: 'admin', companyId: CID, email: 'admin@test.com' } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(dynamodb.update).toHaveBeenCalledTimes(1);
  });

  test('admin updating an unrelated field (name) with no role change succeeds', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: 'emp_target', email: 't@test.com', companyId: CID, role: 'manager' } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { id: 'emp_target', name: 'Renamed' } }) });
    const req = { params: { id: 'emp_target' }, body: { name: 'Renamed' }, user: { id: 'u1', role: 'admin', companyId: CID, email: 'admin@test.com' } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(dynamodb.update).toHaveBeenCalledTimes(1);
  });
});
