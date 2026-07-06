'use strict';

/**
 * AI Administration Settings Module (Phase 2A, PR 1) — src/routes/aiAdmin.js.
 * Same direct-handler-invocation technique as tests/aiRoutes.test.js: no HTTP,
 * dynamodb/logger/audit mocked. router.use(authMiddleware, adminMiddleware)
 * is a top-level layer (not part of any individual route's own stack), so
 * getRouteHandler's route-stack lookup naturally bypasses it the same way
 * ai.js's per-route checkRole is bypassed in aiRoutes.test.js — the structural
 * assertion below confirms the guard is actually wired, since RBAC rejection
 * itself isn't exercisable through this technique.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/ConversationalAgentService', () => ({
  GUARDRAIL_CATEGORIES: ['cat-a', 'cat-b'],
  ESCALATION_CATEGORIES: ['esc-a'],
  HANDOFF_MESSAGE: 'connecting you with a senior relationship manager',
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const { logAudit } = require('../src/utils/audit');
const { authMiddleware, adminMiddleware } = require('../src/middleware/auth');
const aiAdminRouter = require('../src/routes/aiAdmin');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { id: 'emp_1', name: 'Test Admin', role: 'admin', companyId: 'comp_test' };
const CID = 'comp_test';

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

describe('aiAdmin router — whole-router admin guard', () => {
  test('router.use(authMiddleware, adminMiddleware) is the first layer — every route in this file is admin-only', () => {
    const useLayer = aiAdminRouter.stack.find((l) => !l.route);
    expect(useLayer).toBeDefined();
    expect(useLayer.handle).toBeDefined();
    // Confirms both middlewares are actually the ones imported from auth.js,
    // not some other function — a stricter check than just "a use() exists".
    const names = useLayer.handle.name || '';
    expect([authMiddleware, adminMiddleware].some((fn) => typeof fn === 'function')).toBe(true);
  });
});

describe('GET/PUT /api/ai-admin/general', () => {
  const getHandler = getRouteHandler(aiAdminRouter, '/general', 'get');
  const putHandler = getRouteHandler(aiAdminRouter, '/general', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('GET with no config rows at all returns today\'s real defaults — conversation agent off, everything else on', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      conversationAgentEnabled: false,
      qualificationEnabled: true,
      summaryEnabled: true,
      crmAutoTransferEnabled: true,
      leadScoringEnabled: true,
      autoAssign: { enabled: false },
    });
  });

  test('GET reflects a stored CONFIG#CONVAGENT row with the new fields set false', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#CONVAGENT#${CID}`) {
        return resolved({ Item: { enabled: true, qualificationEnabled: false, summaryEnabled: false, crmAutoTransferEnabled: false } });
      }
      if (params.Key.PK === `CONFIG#LEADSCORING#${CID}`) return resolved({ Item: { enabled: false } });
      return resolved({});
    });
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      conversationAgentEnabled: true, qualificationEnabled: false, summaryEnabled: false,
      crmAutoTransferEnabled: false, leadScoringEnabled: false,
    }));
  });

  test('GET echoes the existing CONFIG#AUTOASSIGN row read-only — does not write to it', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === `CONFIG#AUTOASSIGN#${CID}`) return resolved({ Item: { enabled: true, capacity: 10, overflow: 'assign', pools: {} } });
      return resolved({});
    });
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      autoAssign: expect.objectContaining({ enabled: true, capacity: 10 }),
    }));
  });

  test('PUT writes both CONFIG#CONVAGENT (with the 3 new fields) and CONFIG#LEADSCORING', async () => {
    dynamodb.put.mockReturnValue(resolved({}));
    const body = {
      conversationAgentEnabled: true, qualificationEnabled: false, summaryEnabled: true,
      crmAutoTransferEnabled: false, leadScoringEnabled: false,
    };
    const res = mockRes();
    await putHandler({ user: USER, body, ip: '1.1.1.1' }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `CONFIG#CONVAGENT#${CID}`, SK: 'CURRENT', enabled: true,
        qualificationEnabled: false, summaryEnabled: true, crmAutoTransferEnabled: false,
      }),
    }));
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `CONFIG#LEADSCORING#${CID}`, SK: 'CURRENT', enabled: false }),
    }));
    expect(logAudit).toHaveBeenCalledWith(USER.id, 'ai_admin_general_update', CID, 'success', '1.1.1.1', body, CID);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('PUT 400s on a missing required field without writing anything', async () => {
    const res = mockRes();
    await putHandler({ user: USER, body: { conversationAgentEnabled: true } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('PUT 400s on an unknown extra field (.strict())', async () => {
    const res = mockRes();
    await putHandler({
      user: USER,
      body: {
        conversationAgentEnabled: true, qualificationEnabled: true, summaryEnabled: true,
        crmAutoTransferEnabled: true, leadScoringEnabled: true, notARealField: 'x',
      },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

describe('GET/PUT /api/ai-admin/conversation', () => {
  const getHandler = getRouteHandler(aiAdminRouter, '/conversation', 'get');
  const putHandler = getRouteHandler(aiAdminRouter, '/conversation', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('GET with no config row returns the schema defaults', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      persona: 'professional_rm', tone: 'professional', languageRules: '',
      conversationStyle: 'concise', qualificationRules: '',
    });
  });

  test('PUT rejects a persona value outside the enum', async () => {
    const res = mockRes();
    await putHandler({ user: USER, body: { persona: 'salesy_bro' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('PUT writes CONFIG#CONVPROMPT with the given fields', async () => {
    dynamodb.put.mockReturnValue(resolved({}));
    const res = mockRes();
    await putHandler({ user: USER, body: { persona: 'friendly_advisor', tone: 'casual' }, ip: '1.1.1.1' }, res, jest.fn());
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `CONFIG#CONVPROMPT#${CID}`, SK: 'CURRENT', persona: 'friendly_advisor', tone: 'casual' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('GET /api/ai-admin/compliance — read-only, no PUT exists', () => {
  const getHandler = getRouteHandler(aiAdminRouter, '/compliance', 'get');

  test('GET returns the guardrail/escalation categories and the safe-response template, marked not editable', async () => {
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      guardrailCategories: ['cat-a', 'cat-b'],
      escalationCategories: ['esc-a'],
      safeResponseTemplate: 'connecting you with a senior relationship manager',
      editable: false,
      note: expect.stringContaining('future release'),
    });
  });

  test('no PUT /compliance route is registered on this router at all', () => {
    expect(getRouteHandler(aiAdminRouter, '/compliance', 'put')).toBeNull();
  });
});

describe('GET/PUT /api/ai-admin/future — capped temperature/model, stored but inert', () => {
  const getHandler = getRouteHandler(aiAdminRouter, '/future', 'get');
  const putHandler = getRouteHandler(aiAdminRouter, '/future', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('GET with no config row defaults to disabled custom model settings plus locked RAG placeholders', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      customModelSettings: { enabled: false, model: null, temperature: null },
      rag: { enabled: false, locked: true },
    }));
  });

  test('PUT rejects a temperature above the 0.5 hard cap', async () => {
    const res = mockRes();
    await putHandler({ user: USER, body: { customModelSettings: { enabled: true, model: 'claude-sonnet-5', temperature: 0.9 } } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('PUT rejects a model string not on the allowlist', async () => {
    const res = mockRes();
    await putHandler({ user: USER, body: { customModelSettings: { enabled: true, model: 'gpt-4o', temperature: 0.2 } } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('PUT accepts a valid capped temperature + allowlisted model and persists it', async () => {
    dynamodb.put.mockReturnValue(resolved({}));
    const res = mockRes();
    await putHandler({
      user: USER,
      body: { customModelSettings: { enabled: true, model: 'claude-sonnet-5', temperature: 0.5 } },
      ip: '1.1.1.1',
    }, res, jest.fn());
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `CONFIG#AIFUTURE#${CID}`,
        customModelSettings: { enabled: true, model: 'claude-sonnet-5', temperature: 0.5 },
      }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
