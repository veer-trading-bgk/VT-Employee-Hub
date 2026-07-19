'use strict';

/**
 * InstagramCommentService — readable, post-grouped storage for Instagram
 * comments (Instagram page v3 — see ADR-022). Sibling to
 * InstagramContactService, not an extension: that service owns contact-grouped
 * DM history (IGCONTACT#{companyId}#{igsid}); this one owns comment history
 * grouped by the post/Reel a comment was made on (IGPOST#{companyId}#{mediaId}),
 * because the Comments tab's post-grouped view needs "all comments for post X"
 * as a direct PK Query. Deliberately NOT a LEAD#/CRM shape — same "lightweight,
 * no CRM" stance as ADR-020/021.
 *
 * Relationship to the IGCOMMENT#{commentId}/CLAIM marker (ADR-021): that marker
 * remains the idempotency gate (keyed purely by commentId, so a webhook retry
 * with a shifted timestamp still dedups). This store is written by
 * processCommentEvent only AFTER the claim is held, so recordComment is
 * once-per-comment. The two are complementary — dedup-by-commentId vs.
 * readable-by-mediaId.
 *
 * Counts on the per-post META item (totalComments / unrepliedComments) are
 * BEST-EFFORT UI badges (atomic ADD), never a source of truth: a partial write
 * or a swallowed error can only make them drift, and a cheap recount (Query the
 * post's CMT# items) is the fallback. This altitude is intentional for a
 * read-only visibility feature (contrast CIS/ADR-014, where counters ARE
 * correctness-critical).
 */

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { igPostPK, igPostMetaSK, igPostCommentSK } = require('../core/entityKeys');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * Persist one inbound comment as a readable, post-grouped record, and bump the
 * post's summary + best-effort counts. Called once-per-comment (gated by the
 * caller's IGCOMMENT# claim). `timestamp` (the function's own param name) is
 * epoch milliseconds — it orders the CMT# sort key (same convention as MSG#
 * items); the META summary carries ISO timestamps for display + in-memory
 * recency sort, mirroring InstagramContactService's MSG#(epoch)/CURRENT(ISO)
 * split.
 *
 * The stored attribute is named `commentedAt`, NOT `timestamp` — a real
 * 2026-07-19 production incident: this table's `FlowResponsesByCompany` GSI
 * declares `timestamp` as a String-typed key table-wide, so ANY item written
 * anywhere in this table with a Number-typed `timestamp` attribute is
 * rejected outright by DynamoDB, regardless of whether that item has
 * anything to do with Flow responses. This silently failed on every single
 * inbound comment since this file shipped (PR1) — no MSG#/CMT# item was ever
 * successfully written. A distinct, entity-specific attribute name (not just
 * fixing the type) is the fix, so no future GSI naming `timestamp` (or any
 * other generic name) can ever collide with this store again. See
 * docs/bible/19_DECISION_LOG.md and InstagramContactService.recordMessage's
 * matching fix (same root cause, same incident).
 */
async function recordComment(companyId, { mediaId, commentId, commenterIgsid, fromUsername, commentText, timestamp, mediaProductType }) {
  if (!companyId) throw new Error('[InstagramCommentService] companyId is required');
  if (!mediaId)   throw new Error('[InstagramCommentService] mediaId is required');
  if (!commentId) throw new Error('[InstagramCommentService] commentId is required');

  const ts  = timestamp ?? Date.now();
  const iso = new Date(ts).toISOString();

  await dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: igPostPK(companyId, mediaId),
      SK: igPostCommentSK(ts, commentId),
      companyId, mediaId, commentId,
      commenterIgsid: commenterIgsid ?? null,
      fromUsername:   fromUsername ?? null,
      commentText,
      commentedAt: ts, // NOT `timestamp` — see the doc comment above.
      source: 'comment',
      replyStatus: 'unreplied',
    },
  }).promise();

  // Upsert the per-post summary. if_not_exists keeps the earliest firstCommentAt;
  // ADD initializes+increments the two best-effort badge counts.
  const sets = ['companyId = :c', 'mediaId = :m', 'lastCommentAt = :iso', 'firstCommentAt = if_not_exists(firstCommentAt, :iso)'];
  const vals = { ':c': companyId, ':m': mediaId, ':iso': iso, ':one': 1 };
  if (mediaProductType) { sets.push('mediaProductType = :mpt'); vals[':mpt'] = mediaProductType; }

  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: igPostPK(companyId, mediaId), SK: igPostMetaSK() },
    UpdateExpression: `SET ${sets.join(', ')} ADD totalComments :one, unrepliedComments :one`,
    ExpressionAttributeValues: vals,
  }).promise();
}

/**
 * Flip a stored comment 'unreplied' → 'replied' when the one private reply for
 * it is sent (ADR-022 D1.4), and decrement the post's unreplied badge EXACTLY
 * once. The conditional transition (replyStatus = 'unreplied') is what makes the
 * decrement idempotent — a retry / re-run / already-replied comment fails the
 * condition and skips the decrement. Never throws (best-effort, like
 * InstagramContactService.recordMessage); returns silently on any miss. Needs
 * the comment's timestamp VALUE (not the stored `commentedAt` attribute name
 * — this is just the local `timestamp` parameter) to address its CMT# sort
 * key — the caller carries it in the comment_received context as ctx.commentTs.
 */
async function markCommentReplied(companyId, mediaId, commentId, timestamp) {
  if (!companyId || !mediaId || !commentId || !timestamp) return; // not a comment-sourced context

  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: igPostPK(companyId, mediaId), SK: igPostCommentSK(timestamp, commentId) },
      UpdateExpression: 'SET replyStatus = :r, repliedAt = :now',
      ConditionExpression: 'attribute_exists(PK) AND replyStatus = :u',
      ExpressionAttributeValues: { ':r': 'replied', ':u': 'unreplied', ':now': new Date().toISOString() },
    }).promise();
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException') return; // already replied, or record missing — no decrement
    logger.warn(`InstagramCommentService.markCommentReplied: ${e.message}`);
    return;
  }

  // Transition genuinely happened → decrement the best-effort unreplied badge.
  await dynamodb.update({
    TableName: TABLE,
    Key: { PK: igPostPK(companyId, mediaId), SK: igPostMetaSK() },
    UpdateExpression: 'ADD unrepliedComments :neg',
    ExpressionAttributeValues: { ':neg': -1 },
  }).promise().catch((e) => logger.warn(`InstagramCommentService.markCommentReplied count: ${e.message}`));
}

module.exports = { recordComment, markCommentReplied };
