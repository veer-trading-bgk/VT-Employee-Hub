'use strict';

/**
 * Route tests for src/routes/instagram.js's webhook endpoints — the
 * security-critical path (signature verification, non-negotiable per the
 * 2026-07-18 plan) and the v1 parsing/dispatch logic (entry.changes vs
 * entry.messaging branch, story-reply/mention stubs, keyword_message fire).
 * Handlers extracted directly from the Express Router, same
 * getRouteHandler() technique used throughout this codebase's route tests.
 *
 * verifyMetaWebhookSignature is mocked here (module factory, so instagram.js's
 * own require() picks up the mock at load time) — its HMAC correctness is
 * that function's own concern, already exercised for real by whatsapp.js's
 * webhook. What THIS file proves is that the route actually calls it and
 * respects its verdict (401 on false, proceeds on true).
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN = 'ig_verify_token_test';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/verifyMetaWebhookSignature', () => ({
  verifyMetaWebhookSignature: jest.fn(),
}));
jest.mock('../src/services/igGraphApiHelpers', () => ({
  getCompanyByIgBusinessId: jest.fn(),
  getIgConfig: jest.fn(),
  invalidateIgConfigCache: jest.fn(),
  resolveIgGraphUrl: jest.fn(() => 'https://graph.instagram.com/v24.0'),
}));
jest.mock('../src/services/InstagramContactService', () => ({
  resolveOrCreate: jest.fn(),
  recordMessage: jest.fn(),
}));
jest.mock('../src/routes/automations', () => ({ runAutomations: jest.fn() }));
jest.mock('../src/services/AutomationEngine', () => ({ resumeOnInstagramReply: jest.fn() }));
jest.mock('../src/services/InstagramCommentService', () => ({ recordComment: jest.fn() }));
jest.mock('../src/utils/wsNotify', () => ({ notifyCompany: jest.fn() }));

const logger = require('../src/config/logger');
const dynamodb = require('../src/config/dynamodb');
const { verifyMetaWebhookSignature } = require('../src/utils/verifyMetaWebhookSignature');
const igGraphApiHelpers = require('../src/services/igGraphApiHelpers');
const InstagramContactService = require('../src/services/InstagramContactService');
const { runAutomations } = require('../src/routes/automations');
const AutomationEngine = require('../src/services/AutomationEngine');
const InstagramCommentService = require('../src/services/InstagramCommentService');
const { notifyCompany } = require('../src/utils/wsNotify');
const instagramRouter = require('../src/routes/instagram');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), sendStatus: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn(), end: jest.fn() };
}

function req(body) {
  return { headers: {}, rawBody: Buffer.from(JSON.stringify(body)), body };
}

const CID = 'comp_test';
const IG_BUSINESS_ID = 'igba_1';
const IGSID = 'ig_sender_1';

describe('GET /api/instagram/webhook — subscription handshake', () => {
  const getHandshake = getRouteHandler(instagramRouter, '/webhook', 'get');

  test('echoes hub.challenge when the verify token matches META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN', () => {
    const res = mockRes();
    getHandshake({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'ig_verify_token_test', 'hub.challenge': 'chal123' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('chal123');
  });

  test('rejects with 403 on a wrong verify token — does not leak the challenge', () => {
    const res = mockRes();
    getHandshake({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'chal123' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('POST /api/instagram/webhook — signature verification is wired and respected', () => {
  const postWebhook = getRouteHandler(instagramRouter, '/webhook', 'post');

  beforeEach(() => jest.clearAllMocks());

  test('rejects 401 when verifyMetaWebhookSignature returns false — non-negotiable, checked first', async () => {
    verifyMetaWebhookSignature.mockReturnValue(false);
    const res = mockRes();
    await postWebhook(req({ entry: [] }), res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('signature verification failed'));
    // Rejected before touching anything downstream.
    expect(igGraphApiHelpers.getCompanyByIgBusinessId).not.toHaveBeenCalled();
  });

  test('proceeds to process the payload when verifyMetaWebhookSignature returns true', async () => {
    verifyMetaWebhookSignature.mockReturnValue(true);
    igGraphApiHelpers.getCompanyByIgBusinessId.mockResolvedValue(null); // no company — proves it got past the signature gate
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, message: { text: 'hi' } }] }] }), res);

    expect(igGraphApiHelpers.getCompanyByIgBusinessId).toHaveBeenCalledWith(IG_BUSINESS_ID);
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });
});

describe('POST /api/instagram/webhook — payload parsing', () => {
  const postWebhook = getRouteHandler(instagramRouter, '/webhook', 'post');

  beforeEach(() => {
    jest.clearAllMocks();
    verifyMetaWebhookSignature.mockReturnValue(true);
    igGraphApiHelpers.getCompanyByIgBusinessId.mockResolvedValue(CID);
    InstagramContactService.resolveOrCreate.mockResolvedValue({ contact: { igsid: IGSID, igUsername: null, tags: [] }, created: true });
    InstagramContactService.recordMessage.mockResolvedValue(undefined);
    runAutomations.mockResolvedValue(undefined);
    AutomationEngine.resumeOnInstagramReply.mockResolvedValue(0); // default: no paused Follow Gate
    InstagramCommentService.recordComment.mockResolvedValue(undefined); // comment store (ADR-022)
    notifyCompany.mockResolvedValue(undefined); // WS push (PR2)
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) }); // dedupPut claim succeeds
  });

  test('entry.changes (comments) with a malformed value (no id/from) is a safe no-op — 200, no claim, no fire', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'comments', value: { text: 'nice!' } }] }] }), res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
  });

  test('entry.messaging with plain text: resolves the contact, records the message, and fires keyword_message with ctx.igsid populated', async () => {
    const res = mockRes();
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, timestamp: 1732000000000, message: { mid: 'mid_1', text: 'hello there' } }] }],
    }), res);

    expect(InstagramContactService.resolveOrCreate).toHaveBeenCalledWith(CID, IGSID, null);
    expect(InstagramContactService.recordMessage).toHaveBeenCalledWith(CID, IGSID, {
      direction: 'inbound', content: 'hello there', timestamp: 1732000000000, mid: 'mid_1',
    });
    expect(runAutomations).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({
      contactId: IGSID, igsid: IGSID, messageText: 'hello there',
    }));
    expect(notifyCompany).toHaveBeenCalledWith(CID, expect.objectContaining({
      event: 'instagram_message', igsid: IGSID, preview: 'hello there', direction: 'inbound',
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('story reply (message.reply_to.story present) — v1 stub: logged, skipped, no keyword fire', async () => {
    const res = mockRes();
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, message: { mid: 'm1', reply_to: { story: { id: 's1', url: 'https://x' } } } }] }],
    }), res);

    expect(InstagramContactService.resolveOrCreate).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('story reply received, deferred'));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('story mention (attachment type story_mention) — v1 stub: logged, skipped, no keyword fire', async () => {
    const res = mockRes();
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, message: { mid: 'm1', attachments: [{ type: 'story_mention', payload: { url: 'https://x' } }] } }] }],
    }), res);

    expect(InstagramContactService.resolveOrCreate).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('story mention received, deferred'));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('message echo (is_echo true) — skipped entirely: no contact resolve, no record, no keyword fire (guards against self-send 2534014)', async () => {
    const res = mockRes();
    // An echo of the business's own outbound reply: sender.id is the BUSINESS
    // account, recipient.id is the user, and message.text carries the sent text.
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{
        sender: { id: IG_BUSINESS_ID }, recipient: { id: IGSID },
        message: { mid: 'mid_echo', is_echo: true, text: 'Hello — welcome!' },
      }] }],
    }), res);

    expect(InstagramContactService.resolveOrCreate).not.toHaveBeenCalled();
    expect(InstagramContactService.recordMessage).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('postback/reaction events with no message.text are skipped silently — not an error', async () => {
    const res = mockRes();
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, postback: { payload: 'GET_STARTED' } }] }],
    }), res);

    expect(runAutomations).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('no company mapped for the igId: warns and 200s, never throws or processes', async () => {
    igGraphApiHelpers.getCompanyByIgBusinessId.mockResolvedValue(null);
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: 'unknown_ig_id', messaging: [{ sender: { id: IGSID }, message: { text: 'hi' } }] }] }), res);

    expect(InstagramContactService.resolveOrCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no company mapped'));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('an inbound DM that resumes a Follow Gate is CONSUMED — keyword_message does NOT also fire', async () => {
    AutomationEngine.resumeOnInstagramReply.mockResolvedValue(1); // a paused gate matched this igsid
    const res = mockRes();
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, message: { mid: 'm_reply', text: 'yes I followed' } }] }],
    }), res);

    expect(AutomationEngine.resumeOnInstagramReply).toHaveBeenCalledWith(CID, IGSID);
    expect(InstagramContactService.recordMessage).toHaveBeenCalled(); // the inbound is still recorded
    expect(runAutomations).not.toHaveBeenCalled();                    // but keyword_message is suppressed
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  // ── entry.changes[] comment events (comment-to-DM v2, ADR-021) ──
  test('a top-level comment on a post claims the comment, STORES it (ADR-022), and fires comment_received with commentId/mediaId/text/commentTs', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'comments', value: {
      id: 'cmt_1', text: 'send me the link', from: { id: 'ig_commenter_1', username: 'jane' }, media: { id: 'media_99', media_product_type: 'FEED' },
    } }] }] }), res);

    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `IGCOMMENT#${CID}#cmt_1`, SK: 'CLAIM' }),
    }));
    expect(InstagramCommentService.recordComment).toHaveBeenCalledWith(CID, expect.objectContaining({
      mediaId: 'media_99', commentId: 'cmt_1', commenterIgsid: 'ig_commenter_1', fromUsername: 'jane',
      commentText: 'send me the link', mediaProductType: 'FEED',
    }));
    expect(notifyCompany).toHaveBeenCalledWith(CID, expect.objectContaining({
      event: 'instagram_comment', mediaId: 'media_99', commentId: 'cmt_1', username: 'jane', preview: 'send me the link',
    }));
    expect(runAutomations).toHaveBeenCalledWith(CID, 'comment_received', expect.objectContaining({
      igsid: 'ig_commenter_1', commentId: 'cmt_1', mediaId: 'media_99', commentText: 'send me the link',
      commentTs: expect.any(Number),
    }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('a comment-store failure is best-effort — the automation still fires and it still 200s', async () => {
    InstagramCommentService.recordComment.mockRejectedValue(new Error('ddb down'));
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'comments', value: {
      id: 'cmt_be', text: 'link please', from: { id: 'ig_c2' }, media: { id: 'media_99' },
    } }] }] }), res);

    expect(runAutomations).toHaveBeenCalledWith(CID, 'comment_received', expect.objectContaining({ commentId: 'cmt_be' }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('comment store failed'));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('a self-comment (from.id === the business account id) is skipped — no claim, no fire (comment-side echo guard)', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'comments', value: {
      id: 'cmt_self', text: 'thanks everyone', from: { id: IG_BUSINESS_ID }, media: { id: 'media_99' },
    } }] }] }), res);

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(InstagramCommentService.recordComment).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('a reply-to-comment (parent_id present) is skipped — v2 targets top-level comments only', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'comments', value: {
      id: 'cmt_reply', text: 'me too', from: { id: 'ig_commenter_2' }, media: { id: 'media_99' }, parent_id: 'cmt_1',
    } }] }] }), res);

    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(InstagramCommentService.recordComment).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('a duplicate comment (claim already exists) does NOT fire the automation again (idempotency)', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject({ code: 'ConditionalCheckFailedException' }) });
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'comments', value: {
      id: 'cmt_dup', text: 'send link', from: { id: 'ig_commenter_3' }, media: { id: 'media_99' },
    } }] }] }), res);

    expect(InstagramCommentService.recordComment).not.toHaveBeenCalled(); // claim lost → no store
    expect(runAutomations).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('duplicate comment'));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('a non-comments changes field is logged and skipped, still 200', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [{ id: IG_BUSINESS_ID, changes: [{ field: 'mentions', value: { media_id: 'x' } }] }] }), res);

    expect(runAutomations).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('an entry carrying BOTH changes (comment) and messaging (DM) processes both halves — neither is dropped', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [{
      id: IG_BUSINESS_ID,
      changes:   [{ field: 'comments', value: { id: 'cmt_both', text: 'link please', from: { id: 'ig_commenter_x' }, media: { id: 'media_99' } } }],
      messaging: [{ sender: { id: IGSID }, message: { mid: 'm_both', text: 'hello there' } }],
    }] }), res);

    expect(runAutomations).toHaveBeenCalledWith(CID, 'comment_received', expect.objectContaining({ commentId: 'cmt_both' }));
    expect(runAutomations).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({ igsid: IGSID }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('multiple batched entries are ALL processed (Meta batches at the entry[] level)', async () => {
    const res = mockRes();
    await postWebhook(req({ entry: [
      { id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, message: { mid: 'm1', text: 'first' } }] },
      { id: IG_BUSINESS_ID, messaging: [{ sender: { id: 'ig_other' }, message: { mid: 'm2', text: 'second' } }] },
    ] }), res);

    expect(runAutomations).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({ igsid: IGSID }));
    expect(runAutomations).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({ igsid: 'ig_other' }));
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  test('always ACKs 200 even when internal processing throws — mirrors whatsapp.js\'s stance', async () => {
    InstagramContactService.resolveOrCreate.mockRejectedValue(new Error('ddb exploded'));
    const res = mockRes();
    await postWebhook(req({
      entry: [{ id: IG_BUSINESS_ID, messaging: [{ sender: { id: IGSID }, message: { text: 'hi' } }] }],
    }), res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(logger.error).toHaveBeenCalledWith('Instagram webhook processing error', expect.any(Error));
  });
});
