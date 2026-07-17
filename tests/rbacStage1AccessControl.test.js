'use strict';

/**
 * Stage 1 of the 2026-07-17 360°-audit fix plan — the 4 access-control
 * findings (contacts.js stage-route ownership gate, team_lead inbox
 * team-scoping, team_lead lead-detail team-scoping, unknown-number send
 * role gate). One describe per fix. Direct-handler-invocation technique
 * throughout (same as tests/tagsContactsRbac.test.js) — authMiddleware is
 * bypassed by injecting req.user; the RBAC logic under test lives either
 * in the handler itself (Fixes 1-3) or in the route's checkRole middleware
 * (Fix 4, exercised by running the route's remaining middleware stack).
 *
 * Deliberately does NOT touch resolve/reopen/pin/mark-read — that is
 * Stage 2, per the plan.
 */

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/TeamScopeService', () => ({
  getTeamMemberIds: jest.fn(),
}));
jest.mock('../src/services/PipelineService', () => ({
  getPipelineStages: jest.fn(), isValidStage: jest.fn(),
}));
jest.mock('../src/services/ContactBulkOpsService', () => {
  const actual = jest.requireActual('../src/services/ContactBulkOpsService');
  return {
    ...actual,
    updateStage: jest.fn(),
    // contactKey stays REAL — Fix 1's ownership fetch builds its Key through
    // it, and the LEAD#/INBOX# shape it produces is part of what's under test.
  };
});
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendText: jest.fn(), sendTemplate: jest.fn(), sendInteractive: jest.fn(), sendMedia: jest.fn(),
  sendLocation: jest.fn(), resolveMediaId: jest.fn(),
}));
jest.mock('../src/utils/verifyMetaWebhookSignature', () => ({
  verifyMetaWebhookSignature: jest.fn(() => true),
}));
jest.mock('../src/utils/wsNotify', () => ({
  notifyCompany: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/utils/conversationResolver', () => ({
  resolveForInbox: jest.fn(), resolveForLead: jest.fn(), syncConvStatus: jest.fn(), syncMarkRead: jest.fn(),
}));
jest.mock('../src/services/IntentDetectionService', () => ({
  classifyIfNeededForLead: jest.fn(), classifyIfNeededForInbox: jest.fn(),
}));
jest.mock('../src/services/WorkingHoursService', () => ({
  shouldSendOOO: jest.fn(), sendOOO: jest.fn(),
}));
jest.mock('../src/services/DelayedResponseService', () => ({
  scheduleIfEnabled: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger: jest.fn(), resumeOnButtonReply: jest.fn(), hasActiveWorkflow: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const TeamScopeService = require('../src/services/TeamScopeService');
const PipelineService = require('../src/services/PipelineService');
const ContactBulkOps = require('../src/services/ContactBulkOpsService');
const WASendSvc = require('../src/services/WhatsAppSendService');

const contactsRouter = require('../src/routes/contacts');
const whatsappRouter = require('../src/routes/whatsapp');
const crmRouter = require('../src/routes/crm');

const CID = 'comp_test';
const resolved = (value) => ({ promise: () => Promise.resolve(value) });

function getRouteLayer(router, path, method) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}

function getRouteHandler(router, path, method) {
  const layer = getRouteLayer(router, path, method);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

// Runs every middleware AFTER authMiddleware (always the first layer) in
// order, chaining next() — so checkRole/rateLimit genuinely execute, which
// is the point of Fix 4's test.
async function runStackAfterAuth(router, path, method, req, res) {
  const layer = getRouteLayer(router, path, method);
  const handlers = layer.route.stack.slice(1).map((s) => s.handle);
  for (const h of handlers) {
    let nextCalled = false;
    await h(req, res, () => { nextCalled = true; });
    if (!nextCalled) return; // response sent (403 etc.) — stop the chain
  }
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), sendStatus: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  PipelineService.isValidStage.mockResolvedValue(true);
  dynamodb.update.mockReturnValue(resolved({}));
  ContactBulkOps.updateStage.mockResolvedValue({ stage: 'interested' });
});

// ─── Fix 1 — PUT /api/contacts/stage ownership gate ──────────────────────────
describe('Fix 1: PUT /api/contacts/stage — restricted-role ownership gate', () => {
  const handler = getRouteHandler(contactsRouter, '/stage', 'put');

  test('telecaller is 403-blocked from changing a NON-owned lead\'s stage (and no write happens)', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { PK: `LEAD#${CID}#lead_1`, SK: 'METADATA', leadId: 'lead_1', assignedTo: 'someone_else' },
    }));
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      body: { leadId: 'lead_1', stage: 'interested' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(ContactBulkOps.updateStage).not.toHaveBeenCalled();
  });

  test('telecaller CAN change the stage of their own assigned lead', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { PK: `LEAD#${CID}#lead_1`, SK: 'METADATA', leadId: 'lead_1', assignedTo: 'emp_tc' },
    }));
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      body: { leadId: 'lead_1', stage: 'interested' },
    }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, stage: 'interested' }));
    expect(ContactBulkOps.updateStage).toHaveBeenCalledWith(CID, { leadId: 'lead_1', phone: undefined }, 'interested');
  });

  test('telecaller gets 404 (not a silent write) for a nonexistent leadId', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      body: { leadId: 'ghost', stage: 'interested' },
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(ContactBulkOps.updateStage).not.toHaveBeenCalled();
  });

  test('admin path is unchanged — no extra ownership read, write proceeds', async () => {
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'admin_1', role: 'admin' },
      body: { leadId: 'lead_1', stage: 'interested' },
    }, res, jest.fn());

    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(ContactBulkOps.updateStage).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('phone-only (unknown contact) path is NOT ownership-gated — no assignedTo exists to check', async () => {
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      body: { phone: '9000000000', stage: 'interested' },
    }, res, jest.fn());

    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(ContactBulkOps.updateStage).toHaveBeenCalledWith(CID, { leadId: undefined, phone: '9000000000' }, 'interested');
  });
});

// ─── Fix 2 — GET /api/whatsapp/inbox team_lead team-scoping ──────────────────
describe('Fix 2: GET /api/whatsapp/inbox — team_lead sees own + team leads only', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox', 'get');

  const LEADS = [
    { PK: `LEAD#${CID}#L1`, SK: 'METADATA', leadId: 'L1', name: 'Own Lead',    phone: '9111111111', assignedTo: 'tl_1',    lastMessageAt: '2026-07-17T10:00:00.000Z' },
    { PK: `LEAD#${CID}#L2`, SK: 'METADATA', leadId: 'L2', name: 'Team Lead',   phone: '9222222222', assignedTo: 'member_1', lastMessageAt: '2026-07-17T09:00:00.000Z' },
    { PK: `LEAD#${CID}#L3`, SK: 'METADATA', leadId: 'L3', name: 'Other Lead',  phone: '9333333333', assignedTo: 'stranger', lastMessageAt: '2026-07-17T08:00:00.000Z' },
  ];

  beforeEach(() => {
    // Single scan mock serves both the LEAD# scan and (for canViewAll roles
    // only) the INBOX# scan — dispatch on the FilterExpression prefix value.
    dynamodb.scan.mockImplementation((params) => {
      const prefix = params?.ExpressionAttributeValues?.[':prefix'] ?? '';
      if (prefix.startsWith('LEAD#')) return resolved({ Items: LEADS });
      return resolved({ Items: [] });
    });
  });

  test('team_lead sees own-assigned AND team-member leads, NOT a stranger\'s', async () => {
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['member_1']));
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'tl_1', role: 'team_lead' },
      query: {},
    }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).toHaveBeenCalledWith(CID, 'tl_1');
    const body = res.json.mock.calls[0][0];
    const ids = body.conversations.map((c) => c.leadId);
    expect(ids).toContain('L1');
    expect(ids).toContain('L2');
    expect(ids).not.toContain('L3');
  });

  test('telecaller stays own-only — TeamScopeService is never consulted for other roles', async () => {
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'member_1', role: 'telecaller' },
      query: {},
    }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
    const ids = res.json.mock.calls[0][0].conversations.map((c) => c.leadId);
    expect(ids).toEqual(['L2']);
  });

  test('admin still sees everything (canViewAll path untouched)', async () => {
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'admin_1', role: 'admin' },
      query: {},
    }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
    const ids = res.json.mock.calls[0][0].conversations.map((c) => c.leadId);
    expect(ids).toEqual(expect.arrayContaining(['L1', 'L2', 'L3']));
  });
});

// ─── Fix 3 — GET /api/crm/leads/:id team_lead team-scoping ───────────────────
describe('Fix 3: GET /api/crm/leads/:id — team_lead team-scoped detail access', () => {
  const handler = getRouteHandler(crmRouter, '/leads/:id', 'get');

  function mockLead(assignedTo) {
    dynamodb.get.mockReturnValue(resolved({
      Item: { PK: `LEAD#${CID}#lead_1`, SK: 'METADATA', leadId: 'lead_1', assignedTo, phone: '9111111111', tags: [], productInterest: [] },
    }));
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
  }

  test('team_lead CAN open a team member\'s lead detail', async () => {
    mockLead('member_1');
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['member_1']));
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'tl_1', role: 'team_lead' },
      params: { id: 'lead_1' }, query: {},
    }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('team_lead is 403-blocked from a NON-team lead\'s detail', async () => {
    mockLead('stranger');
    TeamScopeService.getTeamMemberIds.mockResolvedValue(new Set(['member_1']));
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'tl_1', role: 'team_lead' },
      params: { id: 'lead_1' }, query: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('team_lead\'s own-assigned lead never even consults TeamScopeService', async () => {
    mockLead('tl_1');
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'tl_1', role: 'team_lead' },
      params: { id: 'lead_1' }, query: {},
    }, res, jest.fn());

    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('telecaller own-only gate is unchanged by the team_lead addition', async () => {
    mockLead('someone_else');
    const res = mockRes();
    await handler({
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      params: { id: 'lead_1' }, query: {},
    }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(TeamScopeService.getTeamMemberIds).not.toHaveBeenCalled();
  });
});

// ─── Fix 4 — POST /inbox/unknown/:phone/send role gate ───────────────────────
describe('Fix 4: POST /api/whatsapp/inbox/unknown/:phone/send — checkRole gate', () => {
  test('telecaller gets 403 from the route\'s middleware chain — send never fires', async () => {
    const res = mockRes();
    await runStackAfterAuth(whatsappRouter, '/inbox/unknown/:phone/send', 'post', {
      user: { companyId: CID, id: 'emp_tc', role: 'telecaller' },
      params: { phone: '9000000000' },
      body: { message: 'hello' },
      ip: '1.2.3.4',
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(WASendSvc.sendText).not.toHaveBeenCalled();
  });

  test('manager passes the gate and the send fires', async () => {
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.x', timestamp: '2026-07-17T10:00:00.000Z' });
    const res = mockRes();
    await runStackAfterAuth(whatsappRouter, '/inbox/unknown/:phone/send', 'post', {
      user: { companyId: CID, id: 'mgr_1', role: 'manager' },
      params: { phone: '9000000000' },
      body: { message: 'hello' },
      ip: '1.2.3.4',
    }, res);

    expect(WASendSvc.sendText).toHaveBeenCalledWith(CID, { phone: '9000000000' }, 'hello', expect.objectContaining({ role: 'manager' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('admin passes the gate too (checkRole list + superadmin passthrough are middleware-level)', async () => {
    WASendSvc.sendText.mockResolvedValue({ waMessageId: 'wamid.y', timestamp: '2026-07-17T10:00:00.000Z' });
    const res = mockRes();
    await runStackAfterAuth(whatsappRouter, '/inbox/unknown/:phone/send', 'post', {
      user: { companyId: CID, id: 'admin_1', role: 'admin' },
      params: { phone: '9000000000' },
      body: { message: 'hello' },
      ip: '1.2.3.4',
    }, res);

    expect(WASendSvc.sendText).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
