'use strict';

/**
 * Tests for GET /api/contacts/all (2026-07-09, docs/phase3/TECHNICAL_DEBT.md,
 * Track A3 Batch 1). This route exists because sales/page.tsx (the Sales
 * Kanban board) was calling GET /?pageSize=500 expecting every contact back
 * in one page, but GET / hard-caps pageSize at 100 — silently truncating any
 * company past 100 leads (confirmed live: viir_trading had 114 real leads,
 * 14 invisible on the board). The key regression this suite exists to catch:
 * a >100-item dataset must come back whole from /all, unlike GET /.
 *
 * No prior tests existed for this route (it's new); mirrors the equivalence/
 * RBAC pattern tests/contactsExport.test.js already established for the
 * sibling /export route, which shares the same fetchFilteredContacts() helper.
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

// 150 leads — deliberately past the old 100/page cap so a truncation
// regression can't hide inside a small fixture. 20 assigned to emp_tl, 130
// to other employees (round numbers, easy to assert against).
function makeLeads(n) {
  const base = new Date('2026-07-01T00:00:00.000Z').getTime();
  return Array.from({ length: n }, (_, i) => ({
    PK: `LEAD#${CID}#lead${i}`, SK: 'METADATA',
    leadId: `lead${i}`, companyId: CID,
    name: `Lead ${i}`, phone: `9${String(1000000 + i).padStart(9, '0')}`,
    assignedTo: i < 20 ? 'emp_tl' : `emp_other${i}`,
    createdAt: new Date(base + i * 60_000).toISOString(),
    lastMessageAt: new Date(base + i * 60_000).toISOString(),
    tags: [],
  }));
}

function mockDynamoForLeads(leads) {
  dynamodb.query.mockReturnValue(resolved({ Items: leads }));
  dynamodb.scan.mockReturnValue(resolved({ Items: [] }));
}

beforeEach(() => {
  jest.clearAllMocks();
  TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set());
});

describe('GET /api/contacts/all — no truncation past the 100-item pagination cap', () => {
  test('150 leads: /all returns all 150, unlike GET / which caps at 100', async () => {
    const leads = makeLeads(150);
    mockDynamoForLeads(leads);

    const allHandler = getRouteHandler(contactsRouter, '/all', 'get');
    const listHandler = getRouteHandler(contactsRouter, '/', 'get');

    const allRes = mockRes();
    await allHandler({ query: {}, user: ADMIN }, allRes, jest.fn());
    const allBody = allRes.json.mock.calls[0][0];

    mockDynamoForLeads(leads); // fresh mock call sequence for the second route
    const listRes = mockRes();
    await listHandler({ query: { pageSize: '500' }, user: ADMIN }, listRes, jest.fn());
    const listBody = listRes.json.mock.calls[0][0];

    expect(allBody.total).toBe(150);
    expect(allBody.contacts.length).toBe(150);
    // The exact truncation this fix targets: GET / silently caps pageSize at
    // 100 server-side regardless of what the caller asks for.
    expect(listBody.pageSize).toBe(100);
    expect(listBody.contacts.length).toBe(100);
    expect(listBody.total).toBe(150); // total is accurate — only the slice was ever wrong
  });

  test('no rate limit on /all — mirrors GET /\'s policy, not GET /export\'s (route.stack has no rate-limit middleware layer)', () => {
    const layer = contactsRouter.stack.find((l) => l.route && l.route.path === '/all' && l.route.methods.get);
    // authMiddleware + handler only == 2 layers. GET /export has 3 (auth, rateLimit, handler).
    expect(layer.route.stack.length).toBe(2);
  });
});

describe('GET /api/contacts/all — equivalence with the paginated GET / route (concatenated across pages)', () => {
  test('one /all call returns the exact same rows, same order, as concatenating every page of GET /', async () => {
    const leads = makeLeads(150);
    mockDynamoForLeads(leads);

    const listHandler = getRouteHandler(contactsRouter, '/', 'get');
    const allHandler = getRouteHandler(contactsRouter, '/all', 'get');

    const paginated = [];
    for (let page = 1; page <= 2; page++) {
      const res = mockRes();
      await listHandler({ query: { page: String(page), pageSize: '100' }, user: ADMIN }, res, jest.fn());
      const body = res.json.mock.calls[0][0];
      paginated.push(...body.contacts);
    }

    const allRes = mockRes();
    await allHandler({ query: {}, user: ADMIN }, allRes, jest.fn());
    const allBody = allRes.json.mock.calls[0][0];

    expect(paginated.length).toBe(150);
    expect(allBody.contacts.map((c) => c.id)).toEqual(paginated.map((c) => c.id));
    expect(allBody.contacts).toEqual(paginated);
  });
});

describe('GET /api/contacts/all — RBAC scoping (OQ-006: team_lead is own + team, not own-only, not company-wide)', () => {
  test('team_lead sees own 20 assigned leads plus their team\'s leads, via TeamScopeService', async () => {
    const leads = makeLeads(150);
    mockDynamoForLeads(leads);
    // 10 employees (emp_other20..emp_other29) are on emp_tl's team, one lead each.
    const teamMemberIds = new Set(Array.from({ length: 10 }, (_, i) => `emp_other${20 + i}`));
    TeamScopeService.getTeamMemberIds.mockResolvedValue(teamMemberIds);

    const allHandler = getRouteHandler(contactsRouter, '/all', 'get');
    const res = mockRes();
    await allHandler({ query: {}, user: TEAM_LEAD }, res, jest.fn());
    const body = res.json.mock.calls[0][0];

    expect(TeamScopeService.getTeamMemberIds).toHaveBeenCalledWith(CID, 'emp_tl');
    expect(body.total).toBe(30); // 20 own + 10 team
    expect(body.contacts.every((c) => c.assignedTo === 'emp_tl' || teamMemberIds.has(c.assignedTo))).toBe(true);
  });

  test('team_lead never sees leads assigned outside their own id + team (not company-wide)', async () => {
    const leads = makeLeads(150);
    mockDynamoForLeads(leads);
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['emp_other20']));

    const allHandler = getRouteHandler(contactsRouter, '/all', 'get');
    const res = mockRes();
    await allHandler({ query: {}, user: TEAM_LEAD }, res, jest.fn());
    const body = res.json.mock.calls[0][0];

    expect(body.total).toBe(21); // 20 own + 1 team member
    expect(body.contacts.some((c) => c.assignedTo === 'emp_other100')).toBe(false);
  });

  test('admin bypasses TeamScopeService entirely — no team lookup at all', async () => {
    const leads = makeLeads(150);
    mockDynamoForLeads(leads);

    const allHandler = getRouteHandler(contactsRouter, '/all', 'get');
    const res = mockRes();
    await allHandler({ query: {}, user: ADMIN }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
  });
});
