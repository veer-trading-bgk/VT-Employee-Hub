'use strict';

/**
 * Approval queue routes (src/routes/approvals.js) — the fix for ApprovalService.js
 * having zero route and zero frontend. Same direct-handler-invocation technique as
 * aiRoutes.test.js: no HTTP, no auth, ApprovalService mocked so these tests exercise
 * only the route's own request handling (status validation, authorization,
 * 404/409 conflict handling) — not ApprovalService's DynamoDB logic, already
 * covered by approvalService.test.js.
 */

jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/ApprovalService', () => ({
  listApprovals: jest.fn(),
  getApproval: jest.fn(),
  resolveApproval: jest.fn(),
}));

const ApprovalService = require('../src/services/ApprovalService');
const approvalsRouter = require('../src/routes/approvals');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const SALES_USER = { id: 'emp_1', name: 'Ravi', role: 'sales', companyId: 'comp_test' };
const ADMIN_USER = { id: 'emp_admin1', name: 'Admin', role: 'admin', companyId: 'comp_test' };

const PENDING_APPROVAL = {
  approvalId: 'appr_1', companyId: 'comp_test', useCase: 'inbox-reply-suggestion',
  output: { reply: 'Sure, I can help with that.' }, confidence: 0.6, riskLevel: 'medium',
  assignedTo: 'emp_1', originalAssignee: 'emp_1', routingReason: 'direct', status: 'pending',
  createdAt: '2026-07-05T10:00:00.000Z', resolvedBy: null, resolvedAt: null, resolutionNote: null,
};

describe('GET /api/approvals — personal queue', () => {
  const handler = getRouteHandler(approvalsRouter, '/', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('lists approvals assigned to the current user, unfiltered by status when omitted', async () => {
    ApprovalService.listApprovals.mockResolvedValue([PENDING_APPROVAL]);
    const res = mockRes();
    await handler({ user: SALES_USER, query: {} }, res, jest.fn());

    expect(ApprovalService.listApprovals).toHaveBeenCalledWith('comp_test', {
      assignedTo: 'emp_1', status: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, approvals: [PENDING_APPROVAL] });
  });

  test('honors an explicit ?status= filter', async () => {
    ApprovalService.listApprovals.mockResolvedValue([]);
    await handler({ user: SALES_USER, query: { status: 'approved' } }, mockRes(), jest.fn());
    expect(ApprovalService.listApprovals).toHaveBeenCalledWith('comp_test', {
      assignedTo: 'emp_1', status: 'approved',
    });
  });

  test('400s on an invalid ?status= value without calling ApprovalService', async () => {
    const res = mockRes();
    await handler({ user: SALES_USER, query: { status: 'bogus' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ApprovalService.listApprovals).not.toHaveBeenCalled();
  });
});

describe('GET /api/approvals/admin — company-wide visibility', () => {
  const handler = getRouteHandler(approvalsRouter, '/admin', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('lists all approvals for the company, including unassigned, unfiltered by status when omitted', async () => {
    const unassigned = { ...PENDING_APPROVAL, approvalId: 'appr_2', assignedTo: null, routingReason: 'unassigned' };
    ApprovalService.listApprovals.mockResolvedValue([PENDING_APPROVAL, unassigned]);
    const res = mockRes();
    await handler({ user: ADMIN_USER, query: {} }, res, jest.fn());

    expect(ApprovalService.listApprovals).toHaveBeenCalledWith('comp_test', { status: undefined });
    expect(res.json).toHaveBeenCalledWith({ success: true, approvals: [PENDING_APPROVAL, unassigned] });
  });

  test('honors an explicit ?status=pending filter', async () => {
    ApprovalService.listApprovals.mockResolvedValue([PENDING_APPROVAL]);
    await handler({ user: ADMIN_USER, query: { status: 'pending' } }, mockRes(), jest.fn());
    expect(ApprovalService.listApprovals).toHaveBeenCalledWith('comp_test', { status: 'pending' });
  });

  test('400s on an invalid ?status= value', async () => {
    const res = mockRes();
    await handler({ user: ADMIN_USER, query: { status: 'bogus' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ApprovalService.listApprovals).not.toHaveBeenCalled();
  });
});

describe('POST /api/approvals/:id/resolve', () => {
  const handler = getRouteHandler(approvalsRouter, '/:id/resolve', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('400s on an invalid status body without looking up the approval', async () => {
    const res = mockRes();
    await handler({ user: SALES_USER, params: { id: 'appr_1' }, body: { status: 'bogus' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ApprovalService.getApproval).not.toHaveBeenCalled();
  });

  test('404s when the approval does not exist', async () => {
    ApprovalService.getApproval.mockResolvedValue(null);
    const res = mockRes();
    await handler({ user: SALES_USER, params: { id: 'no_such_id' }, body: { status: 'approved' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(ApprovalService.resolveApproval).not.toHaveBeenCalled();
  });

  test('the assignee can resolve their own approval', async () => {
    ApprovalService.getApproval.mockResolvedValue(PENDING_APPROVAL);
    ApprovalService.resolveApproval.mockResolvedValue({ ...PENDING_APPROVAL, status: 'approved', resolvedBy: 'emp_1' });
    const res = mockRes();
    await handler({ user: SALES_USER, params: { id: 'appr_1' }, body: { status: 'approved' } }, res, jest.fn());

    expect(ApprovalService.resolveApproval).toHaveBeenCalledWith('comp_test', 'appr_1', {
      status: 'approved', resolvedBy: 'emp_1', resolutionNote: null,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('an admin can resolve an approval assigned to someone else (escalation valve)', async () => {
    ApprovalService.getApproval.mockResolvedValue(PENDING_APPROVAL); // assignedTo: 'emp_1'
    ApprovalService.resolveApproval.mockResolvedValue({ ...PENDING_APPROVAL, status: 'rejected', resolvedBy: 'emp_admin1' });
    const res = mockRes();
    await handler({ user: ADMIN_USER, params: { id: 'appr_1' }, body: { status: 'rejected', resolutionNote: 'Not appropriate' } }, res, jest.fn());

    expect(ApprovalService.resolveApproval).toHaveBeenCalledWith('comp_test', 'appr_1', {
      status: 'rejected', resolvedBy: 'emp_admin1', resolutionNote: 'Not appropriate',
    });
  });

  test('a superadmin can resolve any approval (matches checkRole\'s implicit bypass elsewhere)', async () => {
    ApprovalService.getApproval.mockResolvedValue(PENDING_APPROVAL);
    ApprovalService.resolveApproval.mockResolvedValue({ ...PENDING_APPROVAL, status: 'approved' });
    const res = mockRes();
    await handler({
      user: { id: 'owner_1', role: 'superadmin', companyId: 'comp_test' },
      params: { id: 'appr_1' }, body: { status: 'approved' },
    }, res, jest.fn());
    expect(ApprovalService.resolveApproval).toHaveBeenCalled();
  });

  test('403s a bystander who is neither the assignee nor an admin/manager', async () => {
    ApprovalService.getApproval.mockResolvedValue(PENDING_APPROVAL); // assignedTo: 'emp_1'
    const res = mockRes();
    await handler({
      user: { id: 'emp_2', role: 'sales', companyId: 'comp_test' },
      params: { id: 'appr_1' }, body: { status: 'approved' },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(ApprovalService.resolveApproval).not.toHaveBeenCalled();
  });

  test('409s when the approval was already resolved', async () => {
    ApprovalService.getApproval.mockResolvedValue({ ...PENDING_APPROVAL, status: 'approved' });
    const res = mockRes();
    await handler({ user: SALES_USER, params: { id: 'appr_1' }, body: { status: 'rejected' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(ApprovalService.resolveApproval).not.toHaveBeenCalled();
  });

  test('trims a blank resolutionNote down to null', async () => {
    ApprovalService.getApproval.mockResolvedValue(PENDING_APPROVAL);
    ApprovalService.resolveApproval.mockResolvedValue({ ...PENDING_APPROVAL, status: 'approved' });
    await handler({ user: SALES_USER, params: { id: 'appr_1' }, body: { status: 'approved', resolutionNote: '   ' } }, mockRes(), jest.fn());
    expect(ApprovalService.resolveApproval).toHaveBeenCalledWith('comp_test', 'appr_1', expect.objectContaining({ resolutionNote: null }));
  });
});
