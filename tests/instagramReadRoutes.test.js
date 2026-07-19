'use strict';

/**
 * Route tests for the Instagram page's read APIs (v3, PR2): GET /contacts,
 * /contacts/:igsid/messages, /posts, /posts/:mediaId/comments. Direct-handler
 * invocation for happy-path/multi-tenant assertions; runStackAfterAuth (real
 * checkRole middleware) for the admin-only gate — same technique as
 * rbacStage1AccessControl.test.js.
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), scan: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/wsNotify', () => ({ notifyCompany: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/verifyMetaWebhookSignature', () => ({ verifyMetaWebhookSignature: jest.fn(() => true) }));
jest.mock('../src/services/igGraphApiHelpers', () => ({
  getCompanyByIgBusinessId: jest.fn(), getIgConfig: jest.fn(),
  invalidateIgConfigCache: jest.fn(), resolveIgGraphUrl: jest.fn(() => 'https://graph.instagram.com/v24.0'),
}));
jest.mock('../src/services/InstagramContactService', () => ({
  resolveOrCreate: jest.fn(), recordMessage: jest.fn(), get: jest.fn(),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  resumeOnInstagramReply: jest.fn(), pendingInstagramReplyIgsids: jest.fn(),
}));
jest.mock('../src/services/InstagramSendService', () => ({ sendPrivateReply: jest.fn() }));
jest.mock('../src/services/InstagramCommentService', () => ({ markCommentReplied: jest.fn(), recordComment: jest.fn() }));

const dynamodb = require('../src/config/dynamodb');
const AutomationEngine = require('../src/services/AutomationEngine');
const InstagramSendService = require('../src/services/InstagramSendService');
const InstagramCommentService = require('../src/services/InstagramCommentService');
const instagramRouter = require('../src/routes/instagram');

const CID = 'comp_test';
const resolved = (value) => ({ promise: () => Promise.resolve(value) });

function getRouteLayer(router, path, method) {
  return router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
}
function getRouteHandler(router, path, method) {
  const layer = getRouteLayer(router, path, method);
  return layer ? layer.route.stack[layer.route.stack.length - 1].handle : null;
}
// Runs every middleware AFTER authMiddleware (the first layer) — so the real
// checkRole(['admin']) genuinely executes.
async function runStackAfterAuth(router, path, method, req, res) {
  const layer = getRouteLayer(router, path, method);
  const handlers = layer.route.stack.slice(1).map((s) => s.handle);
  for (const h of handlers) {
    let nextCalled = false;
    await h(req, res, () => { nextCalled = true; });
    if (!nextCalled) return;
  }
}
function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), sendStatus: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  AutomationEngine.pendingInstagramReplyIgsids.mockResolvedValue(new Set());
});

describe('GET /api/instagram/contacts', () => {
  const handler = getRouteHandler(instagramRouter, '/contacts', 'get');

  test('lists this company\'s IGCONTACT# CURRENT items, newest-first, with the pendingFollowGate flag and displayName (never a @username)', async () => {
    dynamodb.scan.mockReturnValue(resolved({ Items: [
      { igsid: 'ig_1', displayName: 'Alice Smith', tags: ['vip'], lastMessageAt: '2026-07-19T10:00:00.000Z', createdAt: '2026-07-18T00:00:00.000Z' },
      { igsid: 'ig_2', displayName: 'Bob Jones',   tags: [],      lastMessageAt: '2026-07-19T12:00:00.000Z', createdAt: '2026-07-17T00:00:00.000Z' },
    ] }));
    AutomationEngine.pendingInstagramReplyIgsids.mockResolvedValue(new Set(['ig_1']));

    const res = mockRes();
    await handler({ user: { companyId: CID, role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.contacts.map((c) => c.igsid)).toEqual(['ig_2', 'ig_1']); // sorted by lastMessageAt desc
    expect(body.contacts.find((c) => c.igsid === 'ig_1')).toMatchObject({ displayName: 'Alice Smith', pendingFollowGate: true });
    expect(body.contacts.find((c) => c.igsid === 'ig_2')).toMatchObject({ displayName: 'Bob Jones', pendingFollowGate: false });
    expect(body).toMatchObject({ total: 2, hasMore: false });
  });

  test('scopes the Scan to THIS company only (multi-tenant) — IGCONTACT#{companyId}# prefix + SK=CURRENT', async () => {
    dynamodb.scan.mockReturnValue(resolved({ Items: [] }));
    const res = mockRes();
    await handler({ user: { companyId: CID, role: 'admin' }, query: {} }, res, jest.fn());

    const params = dynamodb.scan.mock.calls[0][0];
    expect(params.FilterExpression).toBe('begins_with(PK, :pfx) AND SK = :sk');
    expect(params.ExpressionAttributeValues).toEqual({ ':pfx': `IGCONTACT#${CID}#`, ':sk': 'CURRENT' });
  });

  test('admin-only: a non-admin is 403-blocked by checkRole and no Scan happens', async () => {
    const res = mockRes();
    await runStackAfterAuth(instagramRouter, '/contacts', 'get', { user: { companyId: CID, role: 'employee' }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.scan).not.toHaveBeenCalled();
  });
});

describe('GET /api/instagram/contacts/:igsid/messages', () => {
  const handler = getRouteHandler(instagramRouter, '/contacts/:igsid/messages', 'get');

  test('PK-Queries the contact\'s MSG# items and returns them chronological (oldest→newest)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [
      { direction: 'outbound', content: 'hi back', timestamp: 1700000002000, type: 'text', igMid: 'mid2' },
      { direction: 'inbound',  content: 'hello',   timestamp: 1700000001000, type: 'text', igMid: 'mid1' },
    ] })); // returned newest-first by the query (ScanIndexForward:false)

    const res = mockRes();
    await handler({ user: { companyId: CID, role: 'admin' }, params: { igsid: 'ig_1' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.igsid).toBe('ig_1');
    expect(body.messages.map((m) => m.mid)).toEqual(['mid1', 'mid2']); // reversed to chronological
    const params = dynamodb.query.mock.calls[0][0];
    expect(params.ExpressionAttributeValues[':pk']).toBe(`IGCONTACT#${CID}#ig_1`); // company-scoped PK
    expect(params.ExpressionAttributeValues[':msg']).toBe('MSG#');
  });

  test('admin-only gate', async () => {
    const res = mockRes();
    await runStackAfterAuth(instagramRouter, '/contacts/:igsid/messages', 'get', { user: { companyId: CID, role: 'manager' }, params: { igsid: 'ig_1' }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/instagram/posts', () => {
  const handler = getRouteHandler(instagramRouter, '/posts', 'get');

  test('lists this company\'s IGPOST# META summaries with badge counts, newest-first by lastCommentAt', async () => {
    dynamodb.scan.mockReturnValue(resolved({ Items: [
      { mediaId: 'media_a', mediaProductType: 'FEED',  totalComments: 3, unrepliedComments: 1, lastCommentAt: '2026-07-19T09:00:00.000Z' },
      { mediaId: 'media_b', mediaProductType: 'REELS', totalComments: 5, unrepliedComments: 0, lastCommentAt: '2026-07-19T11:00:00.000Z' },
    ] }));

    const res = mockRes();
    await handler({ user: { companyId: CID, role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.posts.map((p) => p.mediaId)).toEqual(['media_b', 'media_a']);
    expect(body.posts[1]).toMatchObject({ mediaId: 'media_a', totalComments: 3, unrepliedComments: 1 });
    expect(dynamodb.scan.mock.calls[0][0].ExpressionAttributeValues).toEqual({ ':pfx': `IGPOST#${CID}#`, ':sk': 'META' });
  });

  test('admin-only gate', async () => {
    const res = mockRes();
    await runStackAfterAuth(instagramRouter, '/posts', 'get', { user: { companyId: CID, role: 'employee' }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.scan).not.toHaveBeenCalled();
  });
});

describe('GET /api/instagram/posts/:mediaId/comments', () => {
  const handler = getRouteHandler(instagramRouter, '/posts/:mediaId/comments', 'get');

  test('PK-Queries the post\'s CMT# items with text + reply status, company-scoped', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [
      { commentId: 'c2', commenterIgsid: 'ig_x', fromUsername: 'x', commentText: 'second', timestamp: 1700000002000, replyStatus: 'replied', repliedAt: '2026-07-19T09:00:00.000Z' },
      { commentId: 'c1', fromUsername: 'y', commentText: 'first', timestamp: 1700000001000, replyStatus: 'unreplied' },
    ] }));

    const res = mockRes();
    await handler({ user: { companyId: CID, role: 'admin' }, params: { mediaId: 'media_a' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.mediaId).toBe('media_a');
    expect(body.comments[0]).toMatchObject({ commentId: 'c2', commentText: 'second', replyStatus: 'replied' });
    expect(body.comments[1]).toMatchObject({ commentId: 'c1', replyStatus: 'unreplied' });
    const params = dynamodb.query.mock.calls[0][0];
    expect(params.ExpressionAttributeValues[':pk']).toBe(`IGPOST#${CID}#media_a`); // company-scoped PK
    expect(params.ExpressionAttributeValues[':cmt']).toBe('CMT#');
  });

  test('admin-only gate', async () => {
    const res = mockRes();
    await runStackAfterAuth(instagramRouter, '/posts/:mediaId/comments', 'get', { user: { companyId: CID, role: 'employee' }, params: { mediaId: 'media_a' }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });
});

describe('POST /api/instagram/posts/:mediaId/comments/:commentId/reply — manual private reply', () => {
  const handler = getRouteHandler(instagramRouter, '/posts/:mediaId/comments/:commentId/reply', 'post');
  const okReq = (body = { text: 'Thanks for commenting!' }) => ({
    user: { companyId: CID, role: 'admin' }, params: { mediaId: 'media_a', commentId: 'c1' }, body,
  });

  beforeEach(() => {
    InstagramSendService.sendPrivateReply.mockResolvedValue({ mid: 'mid_pr', igsid: 'ig_recip' });
    InstagramCommentService.markCommentReplied.mockResolvedValue(undefined);
  });

  test('happy path: finds the unreplied comment, sends the private reply, flips its status', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ commentId: 'c1', timestamp: 1700000000000, replyStatus: 'unreplied' }] }));
    const res = mockRes();
    await handler(okReq(), res, jest.fn());

    expect(InstagramSendService.sendPrivateReply).toHaveBeenCalledWith(CID, 'c1', 'Thanks for commenting!');
    expect(InstagramCommentService.markCommentReplied).toHaveBeenCalledWith(CID, 'media_a', 'c1', 1700000000000);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, mid: 'mid_pr' }));
    // Company-scoped lookup.
    expect(dynamodb.query.mock.calls[0][0].ExpressionAttributeValues[':pk']).toBe(`IGPOST#${CID}#media_a`);
  });

  test('REFUSES a second reply: an already-replied comment gets 409, no send (Meta one-reply-per-comment limit)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ commentId: 'c1', timestamp: 1700000000000, replyStatus: 'replied' }] }));
    const res = mockRes();
    await handler(okReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(InstagramSendService.sendPrivateReply).not.toHaveBeenCalled();
    expect(InstagramCommentService.markCommentReplied).not.toHaveBeenCalled();
  });

  test('404 when the comment is not stored', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    const res = mockRes();
    await handler(okReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(InstagramSendService.sendPrivateReply).not.toHaveBeenCalled();
  });

  test('400 on empty reply text — before any lookup or send', async () => {
    const res = mockRes();
    await handler(okReq({ text: '   ' }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.query).not.toHaveBeenCalled();
    expect(InstagramSendService.sendPrivateReply).not.toHaveBeenCalled();
  });

  test('surfaces a Meta send error as-is and does NOT flip the status', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ commentId: 'c1', timestamp: 1700000000000, replyStatus: 'unreplied' }] }));
    InstagramSendService.sendPrivateReply.mockRejectedValue(Object.assign(new Error('This comment can no longer be replied to.'), { status: 400 }));
    const res = mockRes();
    await handler(okReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'This comment can no longer be replied to.' }));
    expect(InstagramCommentService.markCommentReplied).not.toHaveBeenCalled();
  });

  test('admin-only gate', async () => {
    const res = mockRes();
    await runStackAfterAuth(instagramRouter, '/posts/:mediaId/comments/:commentId/reply', 'post',
      { user: { companyId: CID, role: 'employee' }, params: { mediaId: 'media_a', commentId: 'c1' }, body: { text: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(dynamodb.query).not.toHaveBeenCalled();
  });
});

// Multi-tenant isolation, stated explicitly: company B can never address company
// A's data because the companyId is baked into every PK/prefix the routes build.
describe('multi-tenant isolation', () => {
  test('company B\'s messages request builds a company-B PK, never company A\'s', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    const handler = getRouteHandler(instagramRouter, '/contacts/:igsid/messages', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'company_B', role: 'admin' }, params: { igsid: 'ig_shared' }, query: {} }, res, jest.fn());
    expect(dynamodb.query.mock.calls[0][0].ExpressionAttributeValues[':pk']).toBe('IGCONTACT#company_B#ig_shared');
  });
});
