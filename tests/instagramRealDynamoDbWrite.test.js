'use strict';

/**
 * Real (NON-MOCKED) DynamoDB write test for the GSI-collision incident
 * (2026-07-19). Every other Instagram test mocks `../src/config/dynamodb`,
 * which is exactly why the original bug shipped undetected: a mocked
 * DocumentClient never enforces the real table's attribute-type constraints,
 * so a Number-typed `timestamp` silently "succeeded" against every mock while
 * failing on every real write (FlowResponsesByCompany's GSI declares
 * `timestamp` as a String-typed key table-wide). This file is the only test
 * in the suite that hits the actual `business_metrics` table, specifically
 * to catch a schema/GSI regression like this one again.
 *
 * Skipped by default — opt in with RUN_REAL_DYNAMODB_TESTS=true and real AWS
 * credentials in the environment. Never runs in CI (the "Run tests" step in
 * .github/workflows/deploy.yml has no AWS credentials available to it).
 */

const RUN = process.env.RUN_REAL_DYNAMODB_TESTS === 'true';
const maybeDescribe = RUN ? describe : describe.skip;

maybeDescribe('Instagram services — real DynamoDB write (schema/GSI regression guard)', () => {
  process.env.DYNAMODB_TABLE_METRICS = process.env.DYNAMODB_TABLE_METRICS || 'business_metrics';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-south-1';

  const dynamodb = require('../src/config/dynamodb');
  const InstagramCommentService = require('../src/services/InstagramCommentService');
  const InstagramContactService = require('../src/services/InstagramContactService');
  const { igPostPK, igPostCommentSK, igContactPK, inboxMsgSK } = require('../src/core/entityKeys');

  const TABLE = process.env.DYNAMODB_TABLE_METRICS;
  const CID = '__test_schema_check__';
  const MEDIA_ID = `__test_schema_check__media_${Date.now()}`;
  const COMMENT_ID = `__test_schema_check__comment_${Date.now()}`;
  const IGSID = `__test_schema_check__igsid_${Date.now()}`;
  const MID = `__test_schema_check__mid_${Date.now()}`;
  const TS = Date.now();

  const cleanupKeys = [];

  afterAll(async () => {
    for (const Key of cleanupKeys) {
      await dynamodb.delete({ TableName: TABLE, Key }).promise().catch(() => {});
    }
  });

  test('InstagramCommentService.recordComment writes a real item with commentedAt (Number), never a Number-typed timestamp', async () => {
    await expect(InstagramCommentService.recordComment(CID, {
      mediaId: MEDIA_ID, commentId: COMMENT_ID, commenterIgsid: 'ig_schema_check',
      fromUsername: 'schema_check', commentText: 'schema regression guard', timestamp: TS,
      mediaProductType: 'FEED',
    })).resolves.toBeUndefined();

    const commentKey = { PK: igPostPK(CID, MEDIA_ID), SK: igPostCommentSK(TS, COMMENT_ID) };
    const metaKey = { PK: igPostPK(CID, MEDIA_ID), SK: 'META' };
    cleanupKeys.push(commentKey, metaKey);

    const { Item } = await dynamodb.get({ TableName: TABLE, Key: commentKey }).promise();
    expect(Item).toBeTruthy();
    expect(Item.commentedAt).toBe(TS);
    expect(Item.timestamp).toBeUndefined();
  });

  test('InstagramContactService.recordMessage writes a real item with sentAt (Number), never a Number-typed timestamp', async () => {
    await expect(InstagramContactService.recordMessage(CID, IGSID, {
      direction: 'inbound', content: 'schema regression guard', timestamp: TS, mid: MID,
    })).resolves.toBeUndefined();

    const msgKey = { PK: igContactPK(CID, IGSID), SK: inboxMsgSK(TS, MID) };
    cleanupKeys.push(msgKey);

    const { Item } = await dynamodb.get({ TableName: TABLE, Key: msgKey }).promise();
    expect(Item).toBeTruthy();
    expect(Item.sentAt).toBe(TS);
    expect(Item.timestamp).toBeUndefined();
  });
});
