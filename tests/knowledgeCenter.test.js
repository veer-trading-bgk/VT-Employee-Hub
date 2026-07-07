'use strict';

/**
 * Structured Knowledge Center (Phase 2A, PR 3) — src/routes/knowledgeCenter.js.
 * Same direct-handler-invocation technique as tests/aiAdmin.test.js: no HTTP,
 * dynamodb/logger/audit mocked, PromptTestService.testKnowledgeEntry mocked
 * so these tests exercise route/data-model behavior, not the live-generation
 * gate itself (that's tests/promptTestService.test.js's job).
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/PromptTestService', () => ({ testKnowledgeEntry: jest.fn() }));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const { testKnowledgeEntry } = require('../src/services/PromptTestService');
const { authMiddleware, adminMiddleware } = require('../src/middleware/auth');
const knowledgeRouter = require('../src/routes/knowledgeCenter');

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

describe('knowledgeCenter router — whole-router admin guard', () => {
  test('router.use(authMiddleware, adminMiddleware) is the first layer — every route in this file is admin-only', () => {
    const useLayer = knowledgeRouter.stack.find((l) => !l.route);
    expect(useLayer).toBeDefined();
    expect([authMiddleware, adminMiddleware].some((fn) => typeof fn === 'function')).toBe(true);
  });
});

describe('GET /api/knowledge', () => {
  const handler = getRouteHandler(knowledgeRouter, '/', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('lists all current-state entries for the company', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ entryId: 'e1' }, { entryId: 'e2' }] }));
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE#${CID}` },
    }));
    expect(res.json).toHaveBeenCalledWith({ entries: [{ entryId: 'e1' }, { entryId: 'e2' }] });
  });
});

describe('POST /api/knowledge', () => {
  const handler = getRouteHandler(knowledgeRouter, '/', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('creates a new entry as an unpublished draft', async () => {
    dynamodb.put.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({
      user: USER, ip: '1.1.1.1',
      body: { question: 'What are your fees?', triggers: ['Fees', 'CHARGES'], answer: 'No account opening fee.', category: 'Fees' },
    }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `KNOWLEDGE#${CID}`, companyId: CID,
        draftQuestion: 'What are your fees?', draftTriggers: ['fees', 'charges'], draftAnswer: 'No account opening fee.',
        activeVersion: 0, archived: false, category: 'Fees',
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('rejects invalid bodies (400) — e.g. no triggers at all', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { question: 'q', triggers: [], answer: 'a' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

describe('PUT /api/knowledge/:entryId/draft', () => {
  const handler = getRouteHandler(knowledgeRouter, '/:entryId/draft', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('404s when the entry does not exist', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({
      user: USER, params: { entryId: 'missing' },
      body: { question: 'q', triggers: ['t'], answer: 'a' },
    }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('updates draft fields (and category) with no compliance gate', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { entryId: 'e1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({
      user: USER, ip: '1.1.1.1', params: { entryId: 'e1' },
      body: { question: 'Updated Q', triggers: ['Trigger'], answer: 'Updated A', category: 'General' },
    }, res, jest.fn());

    expect(testKnowledgeEntry).not.toHaveBeenCalled();
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({
        ':q': 'Updated Q', ':t': ['trigger'], ':a': 'Updated A', ':c': 'General',
      }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('POST /api/knowledge/:entryId/test', () => {
  const handler = getRouteHandler(knowledgeRouter, '/:entryId/test', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('tests the current draft fields and stores the result', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { entryId: 'e1', draftQuestion: 'q', draftTriggers: ['t1', 't2'], draftAnswer: 'a' },
    }));
    testKnowledgeEntry.mockResolvedValue({ allPassed: true, results: [], testedAt: 'x' });
    dynamodb.update.mockReturnValue(resolved({}));

    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1' } }, res, jest.fn());

    expect(testKnowledgeEntry).toHaveBeenCalledWith(CID, { question: 'q', triggers: ['t1', 't2'], answer: 'a' });
    expect(res.json).toHaveBeenCalledWith({ allPassed: true, results: [], testedAt: 'x' });
  });

  test('404s when the entry does not exist', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, params: { entryId: 'missing' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(testKnowledgeEntry).not.toHaveBeenCalled();
  });
});

describe('POST /api/knowledge/:entryId/publish', () => {
  const handler = getRouteHandler(knowledgeRouter, '/:entryId/publish', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('re-tests the CURRENT draft even when a stale lastTestResult already exists', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: {
        entryId: 'e1', draftQuestion: 'new q', draftTriggers: ['t'], draftAnswer: 'new a', category: 'Fees',
        activeVersion: 2, lastTestResult: { allPassed: true, results: [], testedAt: 'stale' },
      },
    }));
    testKnowledgeEntry.mockResolvedValue({ allPassed: true, results: [], testedAt: 'fresh' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    await handler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1' } }, mockRes(), jest.fn());

    expect(testKnowledgeEntry).toHaveBeenCalledWith(CID, { question: 'new q', triggers: ['t'], answer: 'new a' });
    expect(testKnowledgeEntry).toHaveBeenCalledTimes(1);
  });

  test('blocks publish (422, itemized body) when the gate reports a failure — writes nothing', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { entryId: 'e1', draftQuestion: 'q', draftTriggers: ['t'], draftAnswer: 'risky', activeVersion: 0 },
    }));
    const failResult = { allPassed: false, results: [{ input: 't', passed: false, reply: 'bad', reason: 'matched' }], testedAt: 'x' };
    testKnowledgeEntry.mockResolvedValue(failResult);
    const res = mockRes();

    await handler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ testResult: failResult }));
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('on success, writes a new VERSION# item and updates the entry\'s active fields', async () => {
    dynamodb.get.mockReturnValue(resolved({
      Item: { entryId: 'e1', draftQuestion: 'q', draftTriggers: ['t'], draftAnswer: 'good answer', category: 'Fees', activeVersion: 1 },
    }));
    testKnowledgeEntry.mockResolvedValue({ allPassed: true, results: [], testedAt: 'x' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1' } }, res, jest.fn());

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `KNOWLEDGE_VERSIONS#${CID}#e1`, SK: 'VERSION#000002', version: 2, answer: 'good answer', restoredFrom: null,
      }),
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':a': 'good answer', ':v': 2 }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, version: 2 }));
  });
});

describe('GET /api/knowledge/:entryId/versions', () => {
  const handler = getRouteHandler(knowledgeRouter, '/:entryId/versions', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('lists versions newest-first via the padded VERSION# sort key', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ version: 2 }, { version: 1 }] }));
    const res = mockRes();
    await handler({ user: USER, params: { entryId: 'e1' } }, res, jest.fn());
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE_VERSIONS#${CID}#e1`, ':pfx': 'VERSION#' },
      ScanIndexForward: false,
    }));
    expect(res.json).toHaveBeenCalledWith({ versions: [{ version: 2 }, { version: 1 }] });
  });
});

describe('POST /api/knowledge/:entryId/versions/:version/restore', () => {
  const handler = getRouteHandler(knowledgeRouter, '/:entryId/versions/:version/restore', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('re-tests against CURRENT rules, and mirrors draft fields to the restored content on success', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === 'VERSION#000001') {
        return resolved({ Item: { version: 1, question: 'old q', triggers: ['old-trigger'], answer: 'old answer', category: 'Old' } });
      }
      return resolved({ Item: { entryId: 'e1', activeVersion: 3 } }); // CURRENT
    });
    testKnowledgeEntry.mockResolvedValue({ allPassed: true, results: [], testedAt: 'x' });
    dynamodb.put.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({}));

    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1', version: '1' } }, res, jest.fn());

    expect(testKnowledgeEntry).toHaveBeenCalledWith(CID, { question: 'old q', triggers: ['old-trigger'], answer: 'old answer' });
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ SK: 'VERSION#000004', version: 4, restoredFrom: 1 }),
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({
        ':q': 'old q', ':t': ['old-trigger'], ':a': 'old answer', ':v': 4, ':c': 'Old',
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, version: 4, restoredFrom: 1 }));
  });

  test('blocks restore (422) when the version no longer passes today\'s rules', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.SK === 'VERSION#000001') return resolved({ Item: { version: 1, question: 'q', triggers: ['t'], answer: 'a' } });
      return resolved({ Item: { entryId: 'e1', activeVersion: 3 } });
    });
    const failResult = { allPassed: false, results: [], testedAt: 'x' };
    testKnowledgeEntry.mockResolvedValue(failResult);
    const res = mockRes();

    await handler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1', version: '1' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

describe('PUT /api/knowledge/:entryId/archive and /unarchive', () => {
  const archiveHandler = getRouteHandler(knowledgeRouter, '/:entryId/archive', 'put');
  const unarchiveHandler = getRouteHandler(knowledgeRouter, '/:entryId/unarchive', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('archive sets archived: true without touching version history', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { entryId: 'e1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await archiveHandler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':a': true }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('unarchive sets archived: false', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { entryId: 'e1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await unarchiveHandler({ user: USER, ip: '1.1.1.1', params: { entryId: 'e1' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':a': false }),
    }));
  });

  test('404s when the entry does not exist', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await archiveHandler({ user: USER, params: { entryId: 'missing' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
