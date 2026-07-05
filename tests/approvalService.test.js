'use strict';

/**
 * ApprovalService — genuinely new logic (confirmed via audit: autoAssign.js's own
 * fallback is capacity/overflow load-balancing only, NOT leave-aware; nothing in
 * this codebase previously checked LEAVE# before routing anything to anyone).
 * Routing order: (1) the employee the action concerns → (2) their teamLeadId if
 * (1) is on approved leave today → (3) any active admin if (2) is also on leave or
 * unset → (4) unassigned (never silently dropped) if nobody is available.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.DYNAMODB_TABLE_EMPLOYEES = 'employees-test';

const dynamodb = require('../src/config/dynamodb');
const ApprovalService = require('../src/services/ApprovalService');

const CID = 'comp_test';
const TODAY = new Date().toISOString().slice(0, 10);

function leaveQueryResult(items) {
  return { promise: () => Promise.resolve({ Items: items }) };
}
function empGetResult(item) {
  return { promise: () => Promise.resolve({ Item: item }) };
}

describe('ApprovalService.resolveRoutingTarget', () => {
  beforeEach(() => jest.clearAllMocks());

  test('routes directly to the assignee when they are not on leave', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([])); // assignee's leave query — none
    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: 'emp_assignee', routingReason: 'direct' });
  });

  test('does not treat a "pending" (not yet approved) leave request as unavailable', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { status: 'pending', startDate: TODAY, endDate: TODAY },
    ]));
    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: 'emp_assignee', routingReason: 'direct' });
  });

  test('does not treat an approved leave outside today\'s date range as unavailable', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { status: 'approved', startDate: '2020-01-01', endDate: '2020-01-05' },
    ]));
    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: 'emp_assignee', routingReason: 'direct' });
  });

  test('falls back to teamLeadId when the assignee is on approved leave today', async () => {
    dynamodb.query
      .mockReturnValueOnce(leaveQueryResult([{ status: 'approved', startDate: TODAY, endDate: TODAY }])) // assignee on leave
      .mockReturnValueOnce(leaveQueryResult([])); // team lead not on leave
    dynamodb.get.mockReturnValueOnce(empGetResult({ id: 'emp_assignee', teamLeadId: 'emp_lead' }));

    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: 'emp_lead', routingReason: 'leave-fallback-teamlead' });
  });

  test('falls back to any active admin when the team lead is also on leave', async () => {
    dynamodb.query
      .mockReturnValueOnce(leaveQueryResult([{ status: 'approved', startDate: TODAY, endDate: TODAY }])) // assignee on leave
      .mockReturnValueOnce(leaveQueryResult([{ status: 'approved', startDate: TODAY, endDate: TODAY }])) // team lead also on leave
      .mockReturnValueOnce(leaveQueryResult([{ id: 'emp_admin1', role: 'admin', status: 'active' }])); // admin GSI query
    dynamodb.get.mockReturnValueOnce(empGetResult({ id: 'emp_assignee', teamLeadId: 'emp_lead' }));

    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: 'emp_admin1', routingReason: 'leave-fallback-admin' });
  });

  test('falls back straight to admin when the assignee has no teamLeadId set', async () => {
    dynamodb.query
      .mockReturnValueOnce(leaveQueryResult([{ status: 'approved', startDate: TODAY, endDate: TODAY }])) // assignee on leave
      .mockReturnValueOnce(leaveQueryResult([{ id: 'emp_admin1', role: 'admin', status: 'active' }])); // admin GSI query
    dynamodb.get.mockReturnValueOnce(empGetResult({ id: 'emp_assignee', teamLeadId: null }));

    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: 'emp_admin1', routingReason: 'leave-fallback-admin' });
  });

  test('returns unassigned (never silently dropped) when nobody is available', async () => {
    dynamodb.query
      .mockReturnValueOnce(leaveQueryResult([{ status: 'approved', startDate: TODAY, endDate: TODAY }])) // assignee on leave
      .mockReturnValueOnce(leaveQueryResult([])); // no admins found
    dynamodb.get.mockReturnValueOnce(empGetResult({ id: 'emp_assignee', teamLeadId: null }));

    const result = await ApprovalService.resolveRoutingTarget(CID, 'emp_assignee');
    expect(result).toEqual({ targetUserId: null, routingReason: 'unassigned' });
  });
});

describe('ApprovalService.routeApproval', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a pending APPROVAL# record with the resolved routing target', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([])); // assignee not on leave
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const approval = await ApprovalService.routeApproval(CID, {
      useCase: 'inbox-reply-suggestion',
      output: { reply: 'Sure, I can help with that.' },
      confidence: 0.4,
      riskLevel: 'medium',
      promptVersion: 'v1',
      assigneeId: 'emp_assignee',
    });

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `APPROVAL#${CID}`,
        companyId: CID,
        useCase: 'inbox-reply-suggestion',
        confidence: 0.4,
        riskLevel: 'medium',
        promptVersion: 'v1',
        assignedTo: 'emp_assignee',
        routingReason: 'direct',
        status: 'pending',
      }),
    }));
    expect(approval.status).toBe('pending');
    expect(approval.approvalId).toBeDefined();
    expect(approval.SK).toMatch(/^pending#/);
  });
});

describe('ApprovalService.resolveApproval', () => {
  beforeEach(() => jest.clearAllMocks());

  test('moves a pending approval to approved — deletes the old SK, writes the new one', async () => {
    const pendingItem = {
      PK: `APPROVAL#${CID}`, SK: 'pending#2026-07-04T10:00:00.000Z#appr_1',
      approvalId: 'appr_1', status: 'pending', useCase: 'x',
    };
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([pendingItem]));
    dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await ApprovalService.resolveApproval(CID, 'appr_1', { status: 'approved', resolvedBy: 'emp_admin1' });

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `APPROVAL#${CID}`, SK: pendingItem.SK },
    }));
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        SK: expect.stringMatching(/^approved#/),
        status: 'approved',
        resolvedBy: 'emp_admin1',
      }),
    }));
    expect(result.status).toBe('approved');
  });

  test('throws when the approval id does not exist among pending items', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([]));
    await expect(
      ApprovalService.resolveApproval(CID, 'no_such_id', { status: 'approved', resolvedBy: 'emp_admin1' }),
    ).rejects.toThrow(/not found/i);
  });

  test('rejects an invalid status value', async () => {
    await expect(
      ApprovalService.resolveApproval(CID, 'appr_1', { status: 'bogus', resolvedBy: 'emp_admin1' }),
    ).rejects.toThrow(/status/i);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });
});

describe('ApprovalService.listApprovals', () => {
  beforeEach(() => jest.clearAllMocks());

  test('queries by status prefix (a real Query, not a Scan) when status is given', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { approvalId: 'a1', assignedTo: 'emp_1', status: 'pending', createdAt: '2026-07-05T10:00:00.000Z' },
    ]));

    await ApprovalService.listApprovals(CID, { status: 'pending' });

    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `APPROVAL#${CID}`, ':sk': 'pending#' },
    }));
  });

  test('queries the whole partition (no status prefix) when status is omitted', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([]));

    await ApprovalService.listApprovals(CID, {});

    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `APPROVAL#${CID}` },
    }));
  });

  test('ignores an unrecognised status value and queries the whole partition', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([]));

    await ApprovalService.listApprovals(CID, { status: 'bogus' });

    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk',
    }));
  });

  test('filters to one person\'s queue when assignedTo is given', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { approvalId: 'a1', assignedTo: 'emp_1', status: 'pending', createdAt: '2026-07-05T10:00:00.000Z' },
      { approvalId: 'a2', assignedTo: 'emp_2', status: 'pending', createdAt: '2026-07-05T11:00:00.000Z' },
      { approvalId: 'a3', assignedTo: null,    status: 'pending', createdAt: '2026-07-05T12:00:00.000Z' },
    ]));

    const result = await ApprovalService.listApprovals(CID, { status: 'pending', assignedTo: 'emp_1' });

    expect(result.map((a) => a.approvalId)).toEqual(['a1']);
  });

  test('returns everyone\'s approvals, including unassigned, when assignedTo is omitted', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { approvalId: 'a1', assignedTo: 'emp_1', status: 'pending', createdAt: '2026-07-05T10:00:00.000Z' },
      { approvalId: 'a2', assignedTo: null,    status: 'pending', createdAt: '2026-07-05T11:00:00.000Z' },
    ]));

    const result = await ApprovalService.listApprovals(CID, { status: 'pending' });

    expect(result.map((a) => a.approvalId)).toEqual(['a2', 'a1']); // newest first
  });

  test('sorts newest first', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { approvalId: 'old', createdAt: '2026-07-01T00:00:00.000Z' },
      { approvalId: 'new', createdAt: '2026-07-05T00:00:00.000Z' },
    ]));

    const result = await ApprovalService.listApprovals(CID, {});
    expect(result.map((a) => a.approvalId)).toEqual(['new', 'old']);
  });
});

describe('ApprovalService.getApproval', () => {
  beforeEach(() => jest.clearAllMocks());

  test('finds an approval by id regardless of its current status', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([
      { approvalId: 'a1', status: 'approved', createdAt: '2026-07-05T10:00:00.000Z' },
    ]));

    const result = await ApprovalService.getApproval(CID, 'a1');
    expect(result).toMatchObject({ approvalId: 'a1', status: 'approved' });
  });

  test('returns null when no approval matches the id', async () => {
    dynamodb.query.mockReturnValueOnce(leaveQueryResult([]));

    const result = await ApprovalService.getApproval(CID, 'no_such_id');
    expect(result).toBeNull();
  });
});
