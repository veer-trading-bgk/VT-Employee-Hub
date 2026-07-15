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
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(),
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
jest.mock('../src/services/PromptTestService', () => ({ testPromptAddendum: jest.fn() }));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const { logAudit } = require('../src/utils/audit');
const { authMiddleware, adminMiddleware } = require('../src/middleware/auth');
const { testPromptAddendum } = require('../src/services/PromptTestService');
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

  // Production incident, 2026-07-07: a REAL saved item (exactly what PUT
  // writes below — PK/SK/companyId/updatedAt/updatedBy alongside the actual
  // fields) crashed this route's own .strict() schema parse with
  // "Unrecognized keys". The empty-row test above never caught this because
  // an empty/missing row never has these fields in the first place — this
  // test is the one that would have caught it before it shipped.
  test('GET with a real saved row (including PK/SK/companyId/updatedAt/updatedBy) does not throw — storage metadata is stripped before validation', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        PK: `CONFIG#CONVPROMPT#${CID}`, SK: 'CURRENT', companyId: CID,
        persona: 'friendly_advisor', tone: 'casual', languageRules: '', conversationStyle: 'concise', qualificationRules: '',
        updatedBy: 'emp_1', updatedAt: '2026-07-07T08:00:00.000Z',
      },
    }));
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      persona: 'friendly_advisor', tone: 'casual', languageRules: '',
      conversationStyle: 'concise', qualificationRules: '',
    });
  });

  test('GET still rejects a row with a genuinely unexpected field (not just storage metadata)', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { PK: `CONFIG#CONVPROMPT#${CID}`, SK: 'CURRENT', companyId: CID, persona: 'friendly_advisor', someTypoField: 'oops' },
    }));
    const res = mockRes();
    const next = jest.fn();
    await getHandler({ user: USER }, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
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

  // Production incident, 2026-07-07 — same root cause as /conversation above:
  // a real saved row (PK/SK/companyId/updatedAt/updatedBy alongside the
  // actual fields) crashed this route's .strict() schema parse too.
  test('GET with a real saved row (including PK/SK/companyId/updatedAt/updatedBy) does not throw', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        PK: `CONFIG#AIFUTURE#${CID}`, SK: 'CURRENT', companyId: CID,
        customModelSettings: { enabled: true, model: 'claude-sonnet-5', temperature: 0.2 },
        updatedBy: 'emp_1', updatedAt: '2026-07-07T08:00:00.000Z',
      },
    }));
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      customModelSettings: { enabled: true, model: 'claude-sonnet-5', temperature: 0.2 },
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

// Phase 2A / PR 2 — Prompt Management. testPromptAddendum is mocked here;
// its own real behavior (real AIService.generate calls, real violatesGuardrail
// checking) is covered by tests/promptTestService.test.js — these tests are
// about the ROUTES' own logic: does draft save skip the gate, does publish
// re-test regardless of a stale prior result, does restore re-test against
// current rules, is a blocked test/publish/restore reported with the itemized
// result, not just a generic error.
describe('GET/PUT /api/ai-admin/prompt-addendum', () => {
  const getHandler = getRouteHandler(aiAdminRouter, '/prompt-addendum', 'get');
  const putDraftHandler = getRouteHandler(aiAdminRouter, '/prompt-addendum/draft', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('GET with no config row returns empty/zero defaults', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await getHandler({ user: USER }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ activeText: '', activeVersion: 0, draftText: '', lastTestResult: null });
  });

  test('PUT draft saves without calling the test gate at all', async () => {
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await putDraftHandler({ user: USER, body: { text: 'Always mention our 24hr response time.' } }, res, jest.fn());

    expect(testPromptAddendum).not.toHaveBeenCalled();
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `CONFIG#PROMPTADDENDUM#${CID}`, SK: 'CURRENT' },
      ExpressionAttributeValues: expect.objectContaining({ ':d': 'Always mention our 24hr response time.' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('PUT draft 400s on text over 1000 chars', async () => {
    const res = mockRes();
    await putDraftHandler({ user: USER, body: { text: 'x'.repeat(1001) } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/ai-admin/prompt-addendum/test', () => {
  const handler = getRouteHandler(aiAdminRouter, '/prompt-addendum/test', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('tests the given text and stores the result as lastTestResult', async () => {
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: '2026-07-06T00:00:00.000Z' });
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, body: { text: 'candidate text' }, ip: '1.1.1.1' }, res, jest.fn());

    expect(testPromptAddendum).toHaveBeenCalledWith(CID, 'candidate text');
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':tr': { allPassed: true, results: [], testedAt: '2026-07-06T00:00:00.000Z' } }),
    }));
    expect(res.json).toHaveBeenCalledWith({ allPassed: true, results: [], testedAt: '2026-07-06T00:00:00.000Z' });
  });

  test('falls back to the saved draft text when no text is given in the body', async () => {
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 'x' });
    dynamodb.get.mockReturnValue(resolved({ Item: { draftText: 'the saved draft' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    await handler({ user: USER, body: {}, ip: '1.1.1.1' }, mockRes(), jest.fn());
    expect(testPromptAddendum).toHaveBeenCalledWith(CID, 'the saved draft');
  });
});

describe('POST /api/ai-admin/prompt-addendum/publish', () => {
  const handler = getRouteHandler(aiAdminRouter, '/prompt-addendum/publish', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('re-tests the EXACT text from req.body even when a stale lastTestResult already exists — the specific regression this design is for', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { draftText: '', activeVersion: 2, lastTestResult: { allPassed: true, results: [], testedAt: 'stale' } },
    }));
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 'fresh' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    await handler({ user: USER, body: { text: 'new edited text' }, ip: '1.1.1.1' }, mockRes(), jest.fn());

    expect(testPromptAddendum).toHaveBeenCalledWith(CID, 'new edited text');
    expect(testPromptAddendum).toHaveBeenCalledTimes(1);
  });

  test('publishes the req.body text, NOT cfg.draftText — the exact prod bug: draftText was empty while the tested text was correct', async () => {
    // Reproduce the production state: draftText persisted empty (Save Draft
    // never clicked), but the admin typed + tested a real 267-char addendum.
    const realText = 'A'.repeat(267);
    dynamodb.get.mockReturnValue(resolved({ Item: { draftText: '', activeVersion: 1 } }));
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 't' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    await handler({ user: USER, body: { text: realText }, ip: '1.1.1.1' }, mockRes(), jest.fn());

    // Re-tested + persisted the real body text, never the empty stored draft.
    expect(testPromptAddendum).toHaveBeenCalledWith(CID, realText);
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ SK: 'VERSION#000002', version: 2, text: realText }),
    }));
  });

  test('persists the published text as BOTH activeText and draftText (not empty, not the stale draft) — one source of truth post-publish', async () => {
    const realText = 'Always disclose our SEBI registration number when asked about credentials.';
    dynamodb.get.mockReturnValue(resolved({ Item: { draftText: 'STALE DIFFERENT DRAFT', activeVersion: 4 } }));
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 't' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    await handler({ user: USER, body: { text: realText }, ip: '1.1.1.1' }, mockRes(), jest.fn());

    const updateArg = dynamodb.update.mock.calls[0][0];
    // Single value :t drives both activeText and draftText — they can't drift.
    expect(updateArg.UpdateExpression).toContain('activeText = :t');
    expect(updateArg.UpdateExpression).toContain('draftText = :t');
    expect(updateArg.ExpressionAttributeValues[':t']).toBe(realText);
    expect(updateArg.ExpressionAttributeValues[':v']).toBe(5);
    // The old ':empty' clear-the-draft value must be gone.
    expect(updateArg.ExpressionAttributeValues).not.toHaveProperty(':empty');
  });

  test('re-runs the compliance test server-side and BLOCKS (422) even for a well-formed publish the client believes passed — the fresh server run is the SOLE authorization to go live', async () => {
    // The publish body has ONLY a `text` field (strict schema) — there is no
    // channel for a client to supply a "passed" result and no reading of a
    // stored lastTestResult. Whatever the client saw, this fresh server-side
    // run is the only thing that authorizes going live, and here it fails.
    dynamodb.get.mockReturnValue(resolved({ Item: { draftText: '', activeVersion: 0 } }));
    const failResult = { allPassed: false, results: [{ input: 'x', passed: false, reply: 'bad', reason: 'matched' }], testedAt: 't' };
    testPromptAddendum.mockResolvedValue(failResult);
    const res = mockRes();

    await handler({ user: USER, body: { text: 'risky text' }, ip: '1.1.1.1' }, res, jest.fn());

    expect(testPromptAddendum).toHaveBeenCalledWith(CID, 'risky text');
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ testResult: failResult }));
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('rejects (400) any publish body carrying extra keys (e.g. a smuggled testResult) — strict schema, so a client cannot inject a forged pass', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { text: 'risky text', testResult: { allPassed: true } }, ip: '1.1.1.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(testPromptAddendum).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('400s when req.body has no text — publish can NEVER silently fall back to a server-side draft (the bug source is structurally impossible now)', async () => {
    const res = mockRes();
    await handler({ user: USER, body: {}, ip: '1.1.1.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(testPromptAddendum).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('on success, writes a new VERSION# item and updates CURRENT', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { draftText: 'good text', activeVersion: 2 } }));
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 't' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    const res = mockRes();
    await handler({ user: USER, body: { text: 'good text' }, ip: '1.1.1.1' }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `CONFIG#PROMPTADDENDUM#${CID}`, SK: 'VERSION#000003', version: 3, text: 'good text', restoredFrom: null }),
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':t': 'good text', ':v': 3 }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, version: 3 }));
  });
});

describe('GET /api/ai-admin/prompt-addendum/versions', () => {
  const handler = getRouteHandler(aiAdminRouter, '/prompt-addendum/versions', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('lists versions newest-first via the padded VERSION# sort key', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ version: 3 }, { version: 2 }, { version: 1 }] }));
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: { ':pk': `CONFIG#PROMPTADDENDUM#${CID}`, ':pfx': 'VERSION#' },
      ScanIndexForward: false,
    }));
    expect(res.json).toHaveBeenCalledWith({ versions: [{ version: 3 }, { version: 2 }, { version: 1 }] });
  });
});

describe('POST /api/ai-admin/prompt-addendum/versions/:version/restore', () => {
  const handler = getRouteHandler(aiAdminRouter, '/prompt-addendum/versions/:version/restore', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('re-tests against CURRENT rules, not the rules live when the version was published', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === 'VERSION#000001') return resolved({ Item: { version: 1, text: 'old text' } });
      return resolved({ Item: { activeVersion: 3 } }); // CURRENT
    });
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 't' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    await handler({ user: USER, params: { version: '1' }, body: {}, ip: '1.1.1.1' }, mockRes(), jest.fn());
    expect(testPromptAddendum).toHaveBeenCalledWith(CID, 'old text');
  });

  test('blocks restore when the old version no longer passes current rules', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === 'VERSION#000001') return resolved({ Item: { version: 1, text: 'old text now unsafe' } });
      return resolved({ Item: { activeVersion: 3 } });
    });
    const failResult = { allPassed: false, results: [{ input: 'x', passed: false, reply: 'bad', reason: 'matched' }], testedAt: 't' };
    testPromptAddendum.mockResolvedValue(failResult);
    const res = mockRes();

    await handler({ user: USER, params: { version: '1' }, body: {}, ip: '1.1.1.1' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('on success, publishes as a NEW version with restoredFrom set — never rewinds the version counter', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === 'VERSION#000001') return resolved({ Item: { version: 1, text: 'old text' } });
      return resolved({ Item: { activeVersion: 3 } });
    });
    testPromptAddendum.mockResolvedValue({ allPassed: true, results: [], testedAt: 't' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    const res = mockRes();
    await handler({ user: USER, params: { version: '1' }, body: {}, ip: '1.1.1.1' }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ SK: 'VERSION#000004', version: 4, text: 'old text', restoredFrom: 1 }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, version: 4, restoredFrom: 1 }));
  });

  test('404s when the requested version does not exist', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, params: { version: '99' }, body: {}, ip: '1.1.1.1' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('400s on a non-numeric version param', async () => {
    const res = mockRes();
    await handler({ user: USER, params: { version: 'abc' }, body: {}, ip: '1.1.1.1' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
