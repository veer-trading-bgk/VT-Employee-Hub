'use strict';

/**
 * Contract tests for InstagramCommentService — the post-grouped comment store
 * (Instagram page v3, ADR-022). Uses guardedUpdateMock so every UpdateExpression
 * is validated against DynamoDB's reserved-word list automatically (the same
 * guard that closes the Era-19 "path" bug class) — this store's field names
 * (replyStatus, unrepliedComments, …) deliberately avoid reserved words and this
 * proves it.
 */

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

jest.mock('../src/config/dynamodb', () => ({ put: jest.fn(), update: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const { guardedUpdateMock } = require('./helpers/dynamoReservedWords');
const svc = require('../src/services/InstagramCommentService');

const CID = 'comp_test';
const MEDIA = 'media_99';
const CMT = 'cmt_1';
const TS = 1700000000000;

describe('InstagramCommentService.recordComment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.update.mockImplementation(guardedUpdateMock());
  });

  test('writes a post-grouped CMT# record with the comment fields + unreplied status', async () => {
    await svc.recordComment(CID, { mediaId: MEDIA, commentId: CMT, commenterIgsid: 'ig_c1', fromUsername: 'jane', commentText: 'send link', timestamp: TS, mediaProductType: 'FEED' });

    const item = dynamodb.put.mock.calls[0][0].Item;
    expect(item.PK).toBe(`IGPOST#${CID}#${MEDIA}`);
    expect(item.SK).toBe(`CMT#${TS}#${CMT}`);
    expect(item).toMatchObject({
      commentId: CMT, mediaId: MEDIA, commenterIgsid: 'ig_c1', fromUsername: 'jane',
      commentText: 'send link', source: 'comment', replyStatus: 'unreplied', commentedAt: TS,
    });
    // The stored attribute must never be a bare `timestamp` — the
    // FlowResponsesByCompany GSI declares that name as a String-typed key
    // table-wide, so a Number-typed `timestamp` anywhere rejects the write.
    expect(item.timestamp).toBeUndefined();
  });

  test('upserts the per-post META summary, increments both best-effort counts, ISO recency stamps', async () => {
    await svc.recordComment(CID, { mediaId: MEDIA, commentId: CMT, commentText: 'x', timestamp: TS, mediaProductType: 'REELS' });

    const metaCall = dynamodb.update.mock.calls.find((c) => c[0].Key.SK === 'META');
    expect(metaCall[0].Key.PK).toBe(`IGPOST#${CID}#${MEDIA}`);
    expect(metaCall[0].UpdateExpression).toContain('ADD totalComments :one, unrepliedComments :one');
    expect(metaCall[0].UpdateExpression).toContain('firstCommentAt = if_not_exists(firstCommentAt, :iso)');
    expect(metaCall[0].ExpressionAttributeValues[':one']).toBe(1);
    expect(metaCall[0].ExpressionAttributeValues[':mpt']).toBe('REELS');
    expect(metaCall[0].ExpressionAttributeValues[':iso']).toBe(new Date(TS).toISOString());
  });

  test('rejects missing companyId / mediaId / commentId before any write', async () => {
    await expect(svc.recordComment(null, { mediaId: MEDIA, commentId: CMT, commentText: 'x' })).rejects.toThrow(/companyId/);
    await expect(svc.recordComment(CID, { commentId: CMT, commentText: 'x' })).rejects.toThrow(/mediaId/);
    await expect(svc.recordComment(CID, { mediaId: MEDIA, commentText: 'x' })).rejects.toThrow(/commentId/);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });
});

describe('InstagramCommentService.markCommentReplied', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.update.mockImplementation(guardedUpdateMock());
  });

  test('flips the comment to replied (conditional on unreplied) and decrements the unreplied count once', async () => {
    await svc.markCommentReplied(CID, MEDIA, CMT, TS);

    const flip = dynamodb.update.mock.calls.find((c) => String(c[0].Key.SK).startsWith('CMT#'));
    const dec  = dynamodb.update.mock.calls.find((c) => c[0].Key.SK === 'META');
    expect(flip[0].Key.SK).toBe(`CMT#${TS}#${CMT}`);
    expect(flip[0].ConditionExpression).toContain('replyStatus = :u');
    expect(flip[0].ExpressionAttributeValues).toMatchObject({ ':r': 'replied', ':u': 'unreplied' });
    expect(dec[0].UpdateExpression).toContain('ADD unrepliedComments :neg');
    expect(dec[0].ExpressionAttributeValues[':neg']).toBe(-1);
  });

  test('does NOT decrement when the comment is already replied (conditional check fails) — no double-count', async () => {
    dynamodb.update.mockImplementationOnce(() => ({
      promise: () => Promise.reject(Object.assign(new Error('cond'), { code: 'ConditionalCheckFailedException' })),
    }));
    await svc.markCommentReplied(CID, MEDIA, CMT, TS);
    expect(dynamodb.update).toHaveBeenCalledTimes(1); // flip attempt only, no META decrement
  });

  test('no-ops (no DB calls) when required coords are missing — not a comment-sourced context', async () => {
    await svc.markCommentReplied(CID, MEDIA, CMT, undefined);
    await svc.markCommentReplied(CID, undefined, CMT, TS);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});
