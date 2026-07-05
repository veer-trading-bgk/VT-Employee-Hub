'use strict';

/**
 * GET /api/crm/my-work — "My Work" home dashboard aggregation.
 * Direct-handler-invocation (no HTTP, no auth), dynamodb mocked. Personal-only
 * for every role, including admins — no role branching to test for here,
 * unlike GET /followups or GET /inbox.
 *
 * No Date mocking: the route computes "today" via `new Date().toISOString()`,
 * which does not honor a reassigned `Date.now` (V8's no-arg Date constructor
 * doesn't route through the JS-visible Date.now property). Tests instead
 * compute TODAY the same way at load time and use year-distant past/future
 * dates for "not today," so they're correct on whatever day they actually run.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/wsNotify', () => ({ notifyCompany: jest.fn() }));

const dynamodb = require('../src/config/dynamodb');
const crmRouter = require('../src/routes/crm');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const AGENT = { id: 'emp_1', name: 'Agent One', role: 'telecaller', companyId: 'comp_test' };
const ADMIN = { id: 'admin_1', name: 'Admin One', role: 'admin', companyId: 'comp_test' };

const TODAY = new Date().toISOString().slice(0, 10);
const PAST_DATE = '2020-01-01';
const FUTURE_DATE = '2099-01-01';
const PAST_ISO = `${PAST_DATE}T00:00:00.000Z`;

function lead(overrides = {}) {
  return {
    leadId: 'lead_1', companyId: 'comp_test', name: 'Ravi Kumar', phone: '9876543210',
    stage: 'interested', assignedTo: 'emp_1', createdBy: 'emp_2',
    createdAt: PAST_ISO, updatedAt: PAST_ISO,
    ...overrides,
  };
}

function followup(overrides = {}) {
  return {
    leadId: 'lead_1', leadName: 'Ravi Kumar', leadPhone: '9876543210',
    date: TODAY, note: 'Follow up on KYC', assignedTo: 'emp_1', done: false,
    createdAt: PAST_ISO,
    ...overrides,
  };
}

describe('GET /api/crm/my-work', () => {
  const handler = getRouteHandler(crmRouter, '/my-work', 'get');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockScans({ leads = [], followups = [] } = {}) {
    dynamodb.query.mockImplementation((params) => {
      if (params.IndexName === 'leadsByCompany') {
        return { promise: () => Promise.resolve({ Items: leads }) };
      }
      return { promise: () => Promise.resolve({ Items: [] }) };
    });
    dynamodb.scan.mockImplementation((params) => {
      if (params.ExpressionAttributeValues[':prefix']?.startsWith('FOLLOWUP#')) {
        return { promise: () => Promise.resolve({ Items: followups }) };
      }
      return { promise: () => Promise.resolve({ Items: [] }) };
    });
  }

  function mockEmployee(createdAt) {
    dynamodb.get.mockImplementation(() => ({
      promise: () => Promise.resolve({ Item: createdAt ? { createdAt } : undefined }),
    }));
  }

  test('route is registered', () => {
    expect(handler).toBeInstanceOf(Function);
  });

  test('urgentReplies: only leads assigned to me, inbound, not resolved — sorted oldest-waiting first', async () => {
    mockScans({
      leads: [
        lead({ leadId: 'l1', lastMessageDirection: 'inbound', chatStatus: 'open', lastInboundAt: new Date(Date.now() - 60_000).toISOString() }),
        lead({ leadId: 'l2', lastMessageDirection: 'inbound', chatStatus: 'open', lastInboundAt: new Date(Date.now() - 120_000).toISOString() }),
        lead({ leadId: 'l3', lastMessageDirection: 'outbound', chatStatus: 'open', lastInboundAt: PAST_ISO }),
        lead({ leadId: 'l4', lastMessageDirection: 'inbound', chatStatus: 'resolved', lastInboundAt: PAST_ISO }),
        lead({ leadId: 'l5', assignedTo: 'emp_2', lastMessageDirection: 'inbound', chatStatus: 'open', lastInboundAt: PAST_ISO }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.urgentReplies.map((r) => r.id)).toEqual(['l2', 'l1']);
    expect(payload.urgentReplies[0].waitingMinutes).toBeGreaterThan(0);
  });

  test('recentContacts: only my leads, sorted by lastMessageAt descending', async () => {
    mockScans({
      leads: [
        lead({ leadId: 'l1', lastMessageAt: PAST_ISO }),
        lead({ leadId: 'l2', lastMessageAt: `${TODAY}T00:00:00.000Z` }),
        lead({ leadId: 'l3', assignedTo: 'emp_2', lastMessageAt: `${TODAY}T05:00:00.000Z` }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.recentContacts.map((c) => c.id)).toEqual(['l2', 'l1']);
  });

  test('newContacts KPI: only counts my leads created today', async () => {
    mockScans({
      leads: [
        lead({ leadId: 'l1', createdAt: `${TODAY}T01:00:00.000Z` }),
        lead({ leadId: 'l2', createdAt: PAST_ISO }),
        lead({ leadId: 'l3', assignedTo: 'emp_2', createdAt: `${TODAY}T01:00:00.000Z` }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.kpis.newContacts).toBe(1);
  });

  test('overdue/today follow-ups bucketed by date, excluding done items', async () => {
    mockScans({
      followups: [
        followup({ leadId: 'f1', date: PAST_DATE, done: false }),
        followup({ leadId: 'f2', date: TODAY, done: false }),
        followup({ leadId: 'f3', date: FUTURE_DATE, done: false }),
        followup({ leadId: 'f4', date: PAST_DATE, done: true, doneAt: PAST_ISO }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.overdueFollowups.map((f) => f.contactId)).toEqual(['f1']);
    expect(payload.todayFollowups.map((f) => f.contactId)).toEqual(['f2']);
  });

  test('followupsDone KPI: counts items marked done today, regardless of original due date', async () => {
    mockScans({
      followups: [
        followup({ leadId: 'f1', date: PAST_DATE, done: true, doneAt: `${TODAY}T09:00:00.000Z` }),
        followup({ leadId: 'f2', date: TODAY, done: true, doneAt: PAST_ISO }),
        followup({ leadId: 'f3', date: TODAY, done: false }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.kpis.followupsDone).toBe(1);
  });

  test('gettingStartedProgress includes "contact" when the user created ANY lead in the company (not just assigned to them)', async () => {
    mockScans({
      leads: [
        lead({ leadId: 'l1', assignedTo: 'emp_2', createdBy: 'emp_1' }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.gettingStartedProgress).toContain('contact');
  });

  test('gettingStartedProgress includes "followup" whenever the user has any follow-up, past or future', async () => {
    mockScans({ followups: [followup({ date: FUTURE_DATE })] });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.gettingStartedProgress).toContain('followup');
  });

  test('gettingStartedProgress omits both when neither exists', async () => {
    mockScans({});
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.gettingStartedProgress).toEqual([]);
  });

  test('isNewEmployee is true within the 7-day window', async () => {
    mockScans({});
    mockEmployee(new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()); // 2 days ago
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.isNewEmployee).toBe(true);
  });

  test('isNewEmployee is false outside the 7-day window', async () => {
    mockScans({});
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.isNewEmployee).toBe(false);
  });

  test('isNewEmployee is false when the employee record has no createdAt', async () => {
    mockScans({});
    mockEmployee(undefined);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.isNewEmployee).toBe(false);
  });

  test('admin gets the same personal-only scoping as any other role — no company-wide branch', async () => {
    mockScans({
      leads: [
        lead({ leadId: 'l1', assignedTo: 'admin_1', lastMessageAt: `${TODAY}T00:00:00.000Z` }),
        lead({ leadId: 'l2', assignedTo: 'emp_1', lastMessageAt: `${TODAY}T00:00:00.000Z` }),
      ],
    });
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: ADMIN }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.recentContacts.map((c) => c.id)).toEqual(['l1']);
  });

  test('response shape matches what home/page.tsx expects', async () => {
    mockScans({});
    mockEmployee(PAST_ISO);
    const res = mockRes();
    await handler({ user: AGENT }, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual({
      success: true,
      urgentReplies: [],
      overdueFollowups: [],
      todayFollowups: [],
      recentContacts: [],
      kpis: { followupsDone: 0, newContacts: 0 },
      isNewEmployee: false,
      gettingStartedProgress: [],
    });
  });
});
