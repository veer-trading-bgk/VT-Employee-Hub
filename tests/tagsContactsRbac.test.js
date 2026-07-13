'use strict';

/**
 * B3 fix Batch S1, finding #2 (CRITICAL): PUT /api/tags/contacts previously
 * had zero role gate and zero ownership scoping — any authenticated
 * employee, any role, could add/remove tags on any contact company-wide.
 * Gate now mirrors docs/v3/09_PERMISSION_MATRIX.md §5's Contacts
 * bulk-actions row (Owner/Admin: all, Manager/Sales: own-only, Support:
 * none) using the same raw-role reasoning contacts.js's own
 * fetchFilteredContacts already documents.
 *
 * team_lead upgraded from own-only to team-scoped 2026-07-13 (OQ-006,
 * docs/v3/12_DECISION_LOG.md, resolved: team-wide) via TeamScopeService,
 * the same helper contacts.js's fetchFilteredContacts() now uses. manager
 * stays own-only, unchanged — OQ-006 resolved team_lead only.
 *
 * Direct-handler-invocation technique (see tests/automationsRoutes.test.js)
 * — PUT /contacts has no checkRole() middleware; the RBAC logic under test
 * lives directly in the route handler itself, so this bypasses only
 * authMiddleware, which a real request would also pass through first.
 */

jest.mock('../src/services/ContactBulkOpsService', () => ({
  getContactAssignee: jest.fn(),
  updateTags: jest.fn(),
}));
jest.mock('../src/services/TeamScopeService', () => ({
  getTeamMemberIds: jest.fn(),
}));

const ContactBulkOps = require('../src/services/ContactBulkOpsService');
const TeamScopeService = require('../src/services/TeamScopeService');
const tagsRouter = require('../src/routes/tags');

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
const OWNER_ID = 'emp_owner';
const OTHER_ID = 'emp_other';

describe('PUT /api/tags/contacts — RBAC + ownership gate', () => {
  const handler = () => getRouteHandler(tagsRouter, '/contacts', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('support (intern) is rejected with 403, no ownership lookup, no write', async () => {
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OTHER_ID, role: 'intern', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(ContactBulkOps.getContactAssignee).not.toHaveBeenCalled();
    expect(ContactBulkOps.updateTags).not.toHaveBeenCalled();
  });

  test('telecaller tagging their own contact succeeds', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: true, assignedTo: OWNER_ID });
    ContactBulkOps.updateTags.mockResolvedValue({ tags: ['t1'] });
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OWNER_ID, role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(ContactBulkOps.updateTags).toHaveBeenCalledTimes(1);
  });

  test('telecaller tagging someone else\'s contact is rejected with 403, no write', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: true, assignedTo: OWNER_ID });
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OTHER_ID, role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(ContactBulkOps.updateTags).not.toHaveBeenCalled();
  });

  test('telecaller tagging a non-existent contact gets 404, not a phantom-create', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: false, assignedTo: null });
    const req = { body: { leadId: 'ghost', add: ['t1'] }, user: { id: OWNER_ID, role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(ContactBulkOps.updateTags).not.toHaveBeenCalled();
  });

  test('manager gets own-only scope too (no team-scoping mechanism exists to reuse)', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: true, assignedTo: OWNER_ID });
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OTHER_ID, role: 'manager', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('team_lead tagging their own contact succeeds, no TeamScopeService lookup needed', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: true, assignedTo: OWNER_ID });
    ContactBulkOps.updateTags.mockResolvedValue({ tags: ['t1'] });
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OWNER_ID, role: 'team_lead', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
    expect(ContactBulkOps.updateTags).toHaveBeenCalledTimes(1);
  });

  test('team_lead tagging a team member\'s contact succeeds (OQ-006: team-scoped, not own-only)', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: true, assignedTo: OTHER_ID });
    ContactBulkOps.updateTags.mockResolvedValue({ tags: ['t1'] });
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set([OTHER_ID]));
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OWNER_ID, role: 'team_lead', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(TeamScopeService.getTeamMemberIds).toHaveBeenCalledWith(CID, OWNER_ID);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(ContactBulkOps.updateTags).toHaveBeenCalledTimes(1);
  });

  test('team_lead tagging a non-team contact is rejected with 403, no write', async () => {
    ContactBulkOps.getContactAssignee.mockResolvedValue({ exists: true, assignedTo: OTHER_ID });
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set()); // OTHER_ID not on the team
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OWNER_ID, role: 'team_lead', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(ContactBulkOps.updateTags).not.toHaveBeenCalled();
  });

  test('admin bypasses ownership scoping entirely — no getContactAssignee lookup at all', async () => {
    ContactBulkOps.updateTags.mockResolvedValue({ tags: ['t1'] });
    const req = { body: { leadId: 'lead1', add: ['t1'] }, user: { id: OTHER_ID, role: 'admin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(ContactBulkOps.getContactAssignee).not.toHaveBeenCalled();
    expect(ContactBulkOps.updateTags).toHaveBeenCalledTimes(1);
  });

  test('superadmin bypasses ownership scoping entirely', async () => {
    ContactBulkOps.updateTags.mockResolvedValue({ tags: ['t1'] });
    const req = { body: { phone: '9876543210', remove: ['t1'] }, user: { id: OTHER_ID, role: 'superadmin', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(ContactBulkOps.updateTags).toHaveBeenCalledTimes(1);
  });
});
