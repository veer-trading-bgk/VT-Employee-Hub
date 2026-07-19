'use strict';

/**
 * Contract tests for InstagramSendService — v1's one Instagram send
 * capability (plain text). Mirrors FlowManagementService/CapiService's test
 * shape: the config gate rejects before any Meta call, and the payload
 * contract (recipient.id / message.text / Bearer auth) is pinned exactly.
 */

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const InstagramSendService = require('../src/services/InstagramSendService');

const CID = 'comp_test';
const IGSID = 'ig_17841400000000000';
const VALID_CFG = { accessToken: 'tok_ig', igBusinessAccountId: 'igba_1' };

function mockConfig(cfg) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve(cfg ? { Item: cfg } : {}) });
}

describe('InstagramSendService.sendText — config gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects before any Meta call when Instagram is not connected (no config at all)', async () => {
    mockConfig(null);
    await expect(InstagramSendService.sendText(CID, IGSID, 'hi')).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects when accessToken is missing', async () => {
    mockConfig({ igBusinessAccountId: 'igba_1' });
    await expect(InstagramSendService.sendText(CID, IGSID, 'hi')).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects when igBusinessAccountId is missing', async () => {
    mockConfig({ accessToken: 'tok_ig' });
    await expect(InstagramSendService.sendText(CID, IGSID, 'hi')).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a missing igsid or blank text before any Meta call', async () => {
    mockConfig(VALID_CFG);
    await expect(InstagramSendService.sendText(CID, null, 'hi')).rejects.toMatchObject({ status: 400 });
    await expect(InstagramSendService.sendText(CID, IGSID, '   ')).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('InstagramSendService.sendText — payload contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig(VALID_CFG);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    axios.post.mockResolvedValue({ data: { message_id: 'mid_out_1' } });
  });

  test('POSTs to /{igBusinessAccountId}/messages with recipient.id and message.text, Bearer auth', async () => {
    await InstagramSendService.sendText(CID, IGSID, 'Thanks for reaching out!');

    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/igba_1\/messages$/);
    expect(body).toEqual({ recipient: { id: IGSID }, message: { text: 'Thanks for reaching out!' } });
    expect(opts.headers.Authorization).toBe('Bearer tok_ig');
  });

  test('records the outbound message on the recipient\'s IGCONTACT# conversation history', async () => {
    await InstagramSendService.sendText(CID, IGSID, 'hello');

    const putItem = dynamodb.put.mock.calls[0][0].Item;
    expect(putItem.PK).toBe(`IGCONTACT#${CID}#${IGSID}`);
    expect(putItem).toMatchObject({ direction: 'outbound', content: 'hello', igMid: 'mid_out_1' });
  });

  test('returns Meta\'s message_id', async () => {
    await expect(InstagramSendService.sendText(CID, IGSID, 'hello')).resolves.toEqual({ mid: 'mid_out_1' });
  });

  test('surfaces a Meta API error as a typed 400 with the friendly message', async () => {
    axios.post.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Invalid parameter', error_user_msg: 'Message could not be sent.' } } } });
    await expect(InstagramSendService.sendText(CID, IGSID, 'hello')).rejects.toMatchObject({ status: 400, message: 'Message could not be sent.' });
  });
});

describe('InstagramSendService — multi-tenant scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    axios.post.mockResolvedValue({ data: { message_id: 'mid_1' } });
  });

  test("company B's send never uses company A's token or Instagram business account id", async () => {
    const CFGS = {
      'CONFIG#IG#acme': { accessToken: 'tok_acme', igBusinessAccountId: 'igba_acme' },
      'CONFIG#IG#beta': { accessToken: 'tok_beta', igBusinessAccountId: 'igba_beta' },
    };
    dynamodb.get.mockImplementation((params) => ({ promise: () => Promise.resolve({ Item: CFGS[params.Key.PK] }) }));

    await InstagramSendService.sendText('acme', IGSID, 'hi from acme');
    await InstagramSendService.sendText('beta', IGSID, 'hi from beta');

    const [urlA, , optsA] = axios.post.mock.calls[0];
    const [urlB, , optsB] = axios.post.mock.calls[1];
    expect(urlA).toMatch(/\/igba_acme\/messages$/);
    expect(optsA.headers.Authorization).toBe('Bearer tok_acme');
    expect(urlB).toMatch(/\/igba_beta\/messages$/);
    expect(optsB.headers.Authorization).toBe('Bearer tok_beta');
  });
});

// ── Private replies (comment-to-DM v2, ADR-021) ──────────────────────────────
const RECIP = 'ig_17841400000000123'; // canonical IGSID Meta returns in recipient_id
const COMMENT_ID = 'cmt_100';

describe('InstagramSendService.sendPrivateReply — config gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects before any Meta call when Instagram is not connected', async () => {
    mockConfig(null);
    await expect(InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'hi')).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('rejects a missing commentId or blank text before any Meta call', async () => {
    mockConfig(VALID_CFG);
    await expect(InstagramSendService.sendPrivateReply(CID, null, 'hi')).rejects.toMatchObject({ status: 400 });
    await expect(InstagramSendService.sendPrivateReply(CID, COMMENT_ID, '   ')).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('InstagramSendService.sendPrivateReply — payload contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Config for CONFIG#IG#, no existing IGCONTACT# (so resolveOrCreate creates one).
    dynamodb.get.mockImplementation((params) => ({
      promise: () => Promise.resolve(params.Key.PK.startsWith('CONFIG#IG#') ? { Item: VALID_CFG } : {}),
    }));
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    axios.post.mockResolvedValue({ data: { message_id: 'mid_pr_1', recipient_id: RECIP } });
  });

  test('POSTs to /{igBusinessAccountId}/messages with recipient.comment_id (NOT id), message.text, Bearer auth', async () => {
    await InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'Follow us and reply for the link!');

    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/igba_1\/messages$/);
    expect(body).toEqual({ recipient: { comment_id: COMMENT_ID }, message: { text: 'Follow us and reply for the link!' } });
    expect(opts.headers.Authorization).toBe('Bearer tok_ig');
  });

  test('captures the response recipient_id as the canonical IGSID and returns { mid, igsid }', async () => {
    await expect(InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'hi')).resolves.toEqual({ mid: 'mid_pr_1', igsid: RECIP });
  });

  test('records the outbound DM against the response IGSID (recipient_id), NOT the comment_id', async () => {
    await InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'hello');

    const msgPut = dynamodb.put.mock.calls.map((c) => c[0].Item).find((it) => it && it.direction === 'outbound');
    expect(msgPut.PK).toBe(`IGCONTACT#${CID}#${RECIP}`);
    expect(msgPut).toMatchObject({ direction: 'outbound', content: 'hello', igMid: 'mid_pr_1' });
  });

  test('surfaces a Meta API error (e.g. window/one-reply violation) as a typed 400', async () => {
    axios.post.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Cannot send message', error_user_msg: 'This comment can no longer be replied to.' } } } });
    await expect(InstagramSendService.sendPrivateReply(CID, COMMENT_ID, 'hi')).rejects.toMatchObject({ status: 400, message: 'This comment can no longer be replied to.' });
  });
});
