'use strict';

/**
 * POST /api/automations/webhook/:companyId/:workflowId/:token — inbound webhook
 * trigger (Part B). Public, no auth — mounted directly in app.js before the
 * authMiddleware guard, same pattern as processTick. Tested here by invoking
 * the exported [rateLimit, handler] pair's handler directly (index 1),
 * skipping the rate-limit middleware itself — same direct-handler-invocation
 * technique used throughout this codebase's route tests.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger: jest.fn(),
  runWorkflowDirect: jest.fn(),
}));
jest.mock('../src/services/CustomerIdentityService', () => ({
  resolveOrCreate: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const AutomationEngine = require('../src/services/AutomationEngine');
const CIS = require('../src/services/CustomerIdentityService');
const automationsRouter = require('../src/routes/automations');

const handleInboundWebhook = automationsRouter.inboundWebhook[1];

const CID = 'comp_test';
const WF_ID = 'wf_hook1';
const TOKEN = 'a'.repeat(48); // crypto.randomBytes(24).toString('hex') length

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function mockReq(overrides = {}) {
  return {
    params: { companyId: CID, workflowId: WF_ID, token: TOKEN },
    headers: {},
    body: { phone: '9876543210' },
    ...overrides,
  };
}

function activeWorkflow(overrides = {}) {
  return {
    id: WF_ID, companyId: CID, name: 'Webhook workflow', status: 'active',
    trigger: { type: 'inbound_webhook', conditions: [], webhookToken: TOKEN },
    steps: [{ id: 's1', type: 'end', config: {} }],
    ...overrides,
  };
}

describe('POST /api/automations/webhook/:companyId/:workflowId/:token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('404s when the workflow does not exist', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const res = mockRes();

    await handleInboundWebhook(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('404s when the workflow exists but its trigger is not inbound_webhook', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow({ trigger: { type: 'lead_created', conditions: [] } }) }) });
    const res = mockRes();

    await handleInboundWebhook(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('404s on a wrong token — same response as "not found," never confirms the workflow exists', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow() }) });
    const res = mockRes();

    await handleInboundWebhook(mockReq({ params: { companyId: CID, workflowId: WF_ID, token: 'wrong-token' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('404s when the workflow is not active (draft)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow({ status: 'draft', enabled: false }) }) });
    const res = mockRes();

    await handleInboundWebhook(mockReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('413s when Content-Length exceeds the payload guard, before any lookup', async () => {
    dynamodb.get.mockClear();
    const res = mockRes();

    await handleInboundWebhook(mockReq({ headers: { 'content-length': '999999' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test('400s when phone is missing', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow() }) });
    const res = mockRes();

    await handleInboundWebhook(mockReq({ body: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('400s when phone normalizes to fewer than 7 digits', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow() }) });
    const res = mockRes();

    await handleInboundWebhook(mockReq({ body: { phone: '123' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('a fresh lead: resolves via CIS with source inbound_webhook, then dispatches the named workflow directly', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow() }) });
    CIS.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_1', action: 'created', interactionId: 'int_1',
      lead: { leadId: 'lead_1', PK: `LEAD#${CID}#lead_1`, name: 'Priya', stage: 'new', tags: [], assignedTo: null },
    });
    const res = mockRes();

    await handleInboundWebhook(mockReq({ body: { phone: '98765 43210', name: 'Priya', email: 'p@example.com' } }), res, jest.fn());

    expect(CIS.resolveOrCreate).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ phone: '9876543210', name: 'Priya', email: 'p@example.com', source: 'inbound_webhook' }),
      { createdBy: 'inbound_webhook' },
    );
    expect(dynamodb.get).toHaveBeenCalledTimes(1); // workflow lookup only — result.lead already had everything needed
    expect(AutomationEngine.runWorkflowDirect).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ id: WF_ID }),
      expect.objectContaining({ leadId: 'lead_1', leadPK: `LEAD#${CID}#lead_1`, phone: '9876543210', name: 'Priya', stage: 'new' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('an existing (enriched) lead has no result.lead — the route fetches the live record by leadId before dispatching', async () => {
    dynamodb.get
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Item: activeWorkflow() }) }) // workflow lookup
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Item: { leadId: 'lead_2', name: 'Ravi', stage: 'interested', tags: ['vip'], assignedTo: 'emp_9' } }) }); // live lead re-fetch
    CIS.resolveOrCreate.mockResolvedValue({ existed: true, leadId: 'lead_2', action: 'enriched', interactionId: 'int_2' });
    const res = mockRes();

    await handleInboundWebhook(mockReq(), res, jest.fn());

    expect(dynamodb.get).toHaveBeenCalledTimes(2);
    expect(AutomationEngine.runWorkflowDirect).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ id: WF_ID }),
      expect.objectContaining({ leadId: 'lead_2', name: 'Ravi', stage: 'interested', tags: ['vip'], assignedTo: 'emp_9' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('Fix 3 (Wave 1 audit): a 12-digit +91-prefixed phone is truncated to 10 digits before reaching CIS and the workflow context', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: activeWorkflow() }) });
    CIS.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'lead_4', action: 'created', interactionId: 'int_4',
      lead: { leadId: 'lead_4', PK: `LEAD#${CID}#lead_4`, name: 'Priya', stage: 'new', tags: [], assignedTo: null },
    });
    const res = mockRes();

    await handleInboundWebhook(mockReq({ body: { phone: '919876543210', name: 'Priya' } }), res, jest.fn());

    expect(CIS.resolveOrCreate).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ phone: '9876543210' }),
      { createdBy: 'inbound_webhook' },
    );
    expect(AutomationEngine.runWorkflowDirect).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ id: WF_ID }),
      expect.objectContaining({ phone: '9876543210' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('DUPLICATES ARE NOT REJECTED — unlike forms.js\'s public submit route, an existing contact still fires the workflow, no 409', async () => {
    dynamodb.get
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Item: activeWorkflow() }) })
      .mockReturnValueOnce({ promise: () => Promise.resolve({ Item: { leadId: 'lead_3', name: 'Existing' } }) });
    CIS.resolveOrCreate.mockResolvedValue({ existed: true, leadId: 'lead_3', action: 'enriched', interactionId: 'int_3' });
    const res = mockRes();

    await handleInboundWebhook(mockReq(), res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(AutomationEngine.runWorkflowDirect).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
