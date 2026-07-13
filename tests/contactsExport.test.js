'use strict';

/**
 * Tests for GET /api/contacts/export (2026-07-09, docs/phase3/TECHNICAL_DEBT.md,
 * Track A2 Fix 2). Validates the two things that matter for a refactor that
 * extracts shared logic into a new route: (1) the new route returns exactly
 * what the paginated route already produced across all its pages for the
 * same filters -- proving fetchFilteredContacts() wasn't accidentally
 * changed while being extracted -- and (2) RBAC scoping on the new route
 * matches the existing paginated route's real behavior: admin sees
 * everything, team_lead sees own + team (OQ-006, resolved 2026-07-13 —
 * see TeamScopeService), everyone else sees own-assigned-only, never
 * company-wide data.
 *
 * No prior tests existed for src/routes/contacts.js at all -- confirmed by
 * repo search before writing these.
 */

jest.mock('../src/config/dynamodb', () => ({
  query: jest.fn(),
  scan: jest.fn(),
}));
jest.mock('../src/services/TagService', () => ({
  expandTagFilter: jest.fn(),
  matchesTagFilter: jest.fn(),
}));
jest.mock('../src/services/PipelineService', () => ({}));
jest.mock('../src/services/TeamScopeService', () => ({
  getTeamMemberIds: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const TeamScopeService = require('../src/services/TeamScopeService');
const contactsRouter = require('../src/routes/contacts');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const CID = 'comp_test';
const ADMIN = { id: 'emp_admin', role: 'admin', companyId: CID };
const TEAM_LEAD = { id: 'emp_tl', role: 'team_lead', companyId: CID };

// 7 leads: 3 assigned to emp_tl, 4 assigned to other employees. Distinct
// lastMessageAt/createdAt timestamps so the sort order is deterministic and
// checkable across the page-boundary in the equivalence test.
function makeLeads() {
  const base = new Date('2026-07-01T00:00:00.000Z').getTime();
  return Array.from({ length: 7 }, (_, i) => ({
    PK: `LEAD#${CID}#lead${i}`, SK: 'METADATA',
    leadId: `lead${i}`, companyId: CID,
    name: `Lead ${i}`, phone: `900000000${i}`,
    assignedTo: i < 3 ? 'emp_tl' : `emp_other${i}`,
    createdAt: new Date(base + i * 60_000).toISOString(),
    lastMessageAt: new Date(base + i * 60_000).toISOString(),
    tags: [],
  }));
}

function mockDynamoForLeads(leads) {
  // Single-page GSI query result (no ExclusiveStartKey loop needed for these
  // small fixtures) -- LastEvaluatedKey omitted so the do/while in
  // fetchFilteredContacts() exits after one call.
  dynamodb.query.mockReturnValue(resolved({ Items: leads }));
  // Admin's INBOX# scan — empty for these tests, no unknown contacts in play.
  dynamodb.scan.mockReturnValue(resolved({ Items: [] }));
}

beforeEach(() => {
  jest.clearAllMocks();
  TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set());
});

describe('GET /api/contacts/export — equivalence with the paginated GET / route', () => {
  test('one export call returns the exact same rows, in the exact same order, as concatenating every page', async () => {
    const leads = makeLeads();
    mockDynamoForLeads(leads);

    const listHandler = getRouteHandler(contactsRouter, '/', 'get');
    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');

    // Walk the paginated route with a small page size to force multiple pages.
    const paginated = [];
    for (let page = 1; page <= 3; page++) {
      const res = mockRes();
      await listHandler({ query: { page: String(page), pageSize: '3' }, user: ADMIN }, res, jest.fn());
      const body = res.json.mock.calls[0][0];
      paginated.push(...body.contacts);
    }

    const exportRes = mockRes();
    await exportHandler({ query: {}, user: ADMIN }, exportRes, jest.fn());
    const exportBody = exportRes.json.mock.calls[0][0];

    expect(exportBody.total).toBe(7);
    expect(paginated.length).toBe(7);
    expect(exportBody.contacts.map((c) => c.id)).toEqual(paginated.map((c) => c.id));
    expect(exportBody.contacts).toEqual(paginated);
  });

  test('equivalence holds with a filter applied too (source)', async () => {
    const leads = makeLeads().map((l, i) => ({ ...l, source: i % 2 === 0 ? 'whatsapp' : 'manual' }));
    mockDynamoForLeads(leads);

    const listHandler = getRouteHandler(contactsRouter, '/', 'get');
    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');

    const listRes = mockRes();
    await listHandler({ query: { source: 'whatsapp', page: '1', pageSize: '50' }, user: ADMIN }, listRes, jest.fn());
    const listBody = listRes.json.mock.calls[0][0];

    const exportRes = mockRes();
    await exportHandler({ query: { source: 'whatsapp' }, user: ADMIN }, exportRes, jest.fn());
    const exportBody = exportRes.json.mock.calls[0][0];

    expect(exportBody.total).toBe(4); // indices 0,2,4,6
    expect(exportBody.contacts).toEqual(listBody.contacts);
  });
});

describe('GET /api/contacts (paginated) — inherits the same team_lead scoping as /export and /all', () => {
  test('GET / returns the same team-scoped rows as /export for the same team_lead', async () => {
    const leads = makeLeads();
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['emp_other3', 'emp_other4']));

    mockDynamoForLeads(leads);
    const listHandler = getRouteHandler(contactsRouter, '/', 'get');
    const listRes = mockRes();
    await listHandler({ query: { pageSize: '50' }, user: TEAM_LEAD }, listRes, jest.fn());
    const listBody = listRes.json.mock.calls[0][0];

    mockDynamoForLeads(leads);
    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');
    const exportRes = mockRes();
    await exportHandler({ query: {}, user: TEAM_LEAD }, exportRes, jest.fn());
    const exportBody = exportRes.json.mock.calls[0][0];

    expect(listBody.total).toBe(5);
    expect(listBody.contacts.map((c) => c.id).sort()).toEqual(exportBody.contacts.map((c) => c.id).sort());
  });
});

describe('GET /api/contacts/export — RBAC scoping (OQ-006: team_lead is own + team, not own-only, not company-wide)', () => {
  test('team_lead sees own assigned leads plus team members\' leads, via TeamScopeService', async () => {
    const leads = makeLeads();
    mockDynamoForLeads(leads);
    // lead3/lead4 are assigned to emp_other3/emp_other4 — both on emp_tl's team.
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['emp_other3', 'emp_other4']));

    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');
    const res = mockRes();
    await exportHandler({ query: {}, user: TEAM_LEAD }, res, jest.fn());
    const body = res.json.mock.calls[0][0];

    expect(TeamScopeService.getTeamMemberIds).toHaveBeenCalledWith(CID, 'emp_tl');
    expect(body.total).toBe(5);
    expect(body.contacts.map((c) => c.id).sort()).toEqual(['lead0', 'lead1', 'lead2', 'lead3', 'lead4']);
  });

  test('team_lead never sees leads assigned outside their own id + team (not company-wide)', async () => {
    const leads = makeLeads();
    mockDynamoForLeads(leads);
    // Only emp_other3 is on the team — emp_other5/emp_other6 (lead5/lead6) are not.
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['emp_other3']));

    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');
    const res = mockRes();
    await exportHandler({ query: {}, user: TEAM_LEAD }, res, jest.fn());
    const body = res.json.mock.calls[0][0];

    expect(body.contacts.map((c) => c.id)).not.toEqual(expect.arrayContaining(['lead5', 'lead6']));
  });

  test('admin bypasses TeamScopeService entirely — no team lookup at all', async () => {
    const leads = makeLeads();
    mockDynamoForLeads(leads);

    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');
    const res = mockRes();
    await exportHandler({ query: {}, user: ADMIN }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
  });

  test('team_lead export is a strict subset of what admin sees for the same data', async () => {
    const leads = makeLeads();

    mockDynamoForLeads(leads);
    const exportHandler = getRouteHandler(contactsRouter, '/export', 'get');
    const adminRes = mockRes();
    await exportHandler({ query: {}, user: ADMIN }, adminRes, jest.fn());
    const adminIds = new Set(adminRes.json.mock.calls[0][0].contacts.map((c) => c.id));

    mockDynamoForLeads(leads);
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['emp_other3', 'emp_other4']));
    const tlRes = mockRes();
    await exportHandler({ query: {}, user: TEAM_LEAD }, tlRes, jest.fn());
    const tlBody = tlRes.json.mock.calls[0][0];

    expect(tlBody.total).toBeLessThan(adminIds.size);
    expect(tlBody.contacts.every((c) => adminIds.has(c.id))).toBe(true);
  });
});
