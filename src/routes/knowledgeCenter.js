'use strict';

const crypto = require('crypto');
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const { knowledgeEntryDraftSchema } = require('../utils/validation');
const { entryKey, versionKey, listEntries } = require('../services/KnowledgeService');
const { testKnowledgeEntry } = require('../services/PromptTestService');
const EmbeddingService = require('../services/EmbeddingService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * Structured Knowledge Center (Phase 2A, PR 3) — admin-authored Q&A entries,
 * keyword-matched into the live conversational-sales-agent prompt (see
 * KnowledgeService.getMatchingEntries). Own top-level nav resource, own
 * router file, not nested under aiAdmin.js (Era 23 decision: Knowledge
 * Center is a separate top-level nav item). Admin-only, whole-router-guarded,
 * same pattern as aiAdmin.js.
 *
 * question/triggers/answer are draft/active-split and gated behind
 * PromptTestService's live-generation test before publish/restore — all
 * three can end up rendered directly into a live customer-facing prompt (see
 * aiConfig.js's knowledgeSection), same reasoning as PR 2's addendum.
 * `category` is display/filter metadata only, never rendered into the
 * prompt, so it is NOT gated — it updates immediately via the draft route.
 *
 * Unlike PR 2's single addendum, publish/restore here set the draft fields
 * to MIRROR the new active fields (not clear them to empty) — an entry
 * always needs a non-empty question/triggers/answer to remain a valid list
 * row, so "clear to empty" (PR 2's literal behavior for its one free-text
 * field) isn't structurally possible here; mirroring means the edit form
 * always shows "what's currently live," ready for further editing.
 *
 * RAG PR A (ADR-017): publish/restore also compute and store an embedding
 * (activeEmbedding, via EmbeddingService) for KnowledgeService's semantic
 * retrieval — never blocking on failure (see computeEmbeddingOrNull).
 */
router.use(authMiddleware, adminMiddleware);

const KNOWLEDGE_TEST_RATE_LIMIT = rateLimit(30, 60 * 60_000);

// RAG PR A (ADR-017) — computed at publish/restore time only, never at
// query time. A failed embed call does NOT block publish: the compliance
// test above is the safety-critical gate; embedding is a retrieval-quality
// concern, not a safety one. Returns null on failure — the entry still
// publishes with activeEmbedding: null, reachable via KnowledgeService's
// keyword fallback until a retry (e.g. the backfill script) fills it in.
async function computeEmbeddingOrNull(companyId, question, answer, entryId) {
  const result = await EmbeddingService.embed({
    texts: [`${question}\n${answer}`], companyId, inputType: 'document',
    entityType: 'document', entityId: entryId,
  });
  if (!result.ok) {
    logger.error(`knowledgeCenter: embedding computation failed for ${companyId} — publishing without one (falls back to keyword matching until retried): ${result.reason}`);
    return null;
  }
  return result.data.embeddings[0];
}

router.get('/', async (req, res, next) => {
  try {
    const entries = await listEntries(req.user.companyId);
    res.json({ entries });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = knowledgeEntryDraftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const companyId = req.user.companyId;
    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { question, triggers, answer, category } = parsed.data;

    const item = {
      ...entryKey(companyId, entryId),
      entryId, companyId,
      draftQuestion: question, draftTriggers: triggers, draftAnswer: answer,
      activeQuestion: null, activeTriggers: [], activeAnswer: null, activeVersion: 0, activePublishedAt: null,
      category: category ?? null,
      archived: false,
      lastTestResult: null,
      createdAt: now, createdBy: req.user.id, updatedAt: now, updatedBy: req.user.id,
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();

    await logAudit(req.user.id, 'knowledge_entry_create', companyId, 'success', req.ip, { entryId }, companyId);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/:entryId/draft', async (req, res, next) => {
  try {
    const parsed = knowledgeEntryDraftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const companyId = req.user.companyId;
    const { entryId } = req.params;
    const existing = await dynamodb.get({ TableName: TABLE, Key: entryKey(companyId, entryId) }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Entry not found' });

    const { question, triggers, answer, category } = parsed.data;
    await dynamodb.update({
      TableName: TABLE,
      Key: entryKey(companyId, entryId),
      UpdateExpression: 'SET draftQuestion = :q, draftTriggers = :t, draftAnswer = :a, category = :c, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':q': question, ':t': triggers, ':a': answer, ':c': category ?? null, ':ub': req.user.id, ':ua': new Date().toISOString(),
      },
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:entryId/test', KNOWLEDGE_TEST_RATE_LIMIT, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { entryId } = req.params;
    const existing = await dynamodb.get({ TableName: TABLE, Key: entryKey(companyId, entryId) }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Entry not found' });

    const candidate = {
      question: existing.Item.draftQuestion, triggers: existing.Item.draftTriggers, answer: existing.Item.draftAnswer,
    };
    const testResult = await testKnowledgeEntry(companyId, candidate);

    await dynamodb.update({
      TableName: TABLE,
      Key: entryKey(companyId, entryId),
      UpdateExpression: 'SET lastTestResult = :tr, updatedAt = :ua',
      ExpressionAttributeValues: { ':tr': testResult, ':ua': new Date().toISOString() },
    }).promise();

    await logAudit(req.user.id, 'knowledge_entry_test', companyId, testResult.allPassed ? 'success' : 'failed', req.ip, { entryId, allPassed: testResult.allPassed }, companyId);
    res.json(testResult);
  } catch (err) { next(err); }
});

router.post('/:entryId/publish', KNOWLEDGE_TEST_RATE_LIMIT, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { entryId } = req.params;
    const r = await dynamodb.get({ TableName: TABLE, Key: entryKey(companyId, entryId) }).promise();
    if (!r.Item) return res.status(404).json({ error: 'Entry not found' });

    const candidate = { question: r.Item.draftQuestion, triggers: r.Item.draftTriggers, answer: r.Item.draftAnswer };

    // Always re-test the CURRENT draft — never trust a client-supplied "it
    // already passed" claim or a stale lastTestResult (the draft may have
    // been edited again since that test ran).
    const testResult = await testKnowledgeEntry(companyId, candidate);
    if (!testResult.allPassed) {
      await logAudit(req.user.id, 'knowledge_entry_publish', companyId, 'blocked', req.ip, { entryId, allPassed: false }, companyId);
      return res.status(422).json({ error: 'Compliance test failed — not published', testResult });
    }

    const newVersion = (r.Item.activeVersion ?? 0) + 1;
    const now = new Date().toISOString();
    const embedding = await computeEmbeddingOrNull(companyId, candidate.question, candidate.answer, entryId);

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        ...versionKey(companyId, entryId, newVersion),
        companyId, entryId, version: newVersion,
        question: candidate.question, triggers: candidate.triggers, answer: candidate.answer, category: r.Item.category,
        publishedAt: now, publishedBy: req.user.id, testResult, restoredFrom: null, embedding,
      },
    }).promise();

    await dynamodb.update({
      TableName: TABLE,
      Key: entryKey(companyId, entryId),
      UpdateExpression: 'SET activeQuestion = :q, activeTriggers = :t, activeAnswer = :a, activeVersion = :v, activePublishedAt = :pa, activeEmbedding = :em, lastTestResult = :tr, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':q': candidate.question, ':t': candidate.triggers, ':a': candidate.answer, ':v': newVersion, ':pa': now,
        ':em': embedding, ':tr': testResult, ':ub': req.user.id, ':ua': now,
      },
    }).promise();

    await logAudit(req.user.id, 'knowledge_entry_publish', companyId, 'success', req.ip, { entryId, version: newVersion, embedded: embedding !== null }, companyId);
    res.json({ success: true, version: newVersion, testResult });
  } catch (err) { next(err); }
});

router.get('/:entryId/versions', async (req, res, next) => {
  try {
    const { Items = [] } = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE_VERSIONS#${req.user.companyId}#${req.params.entryId}`, ':pfx': 'VERSION#' },
      ScanIndexForward: false,
    }).promise();
    res.json({ versions: Items });
  } catch (err) { next(err); }
});

router.post('/:entryId/versions/:version/restore', KNOWLEDGE_TEST_RATE_LIMIT, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { entryId } = req.params;
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'Invalid version' });

    const versionRow = await dynamodb.get({ TableName: TABLE, Key: versionKey(companyId, entryId, version) }).promise();
    if (!versionRow.Item) return res.status(404).json({ error: 'Version not found' });

    const current = await dynamodb.get({ TableName: TABLE, Key: entryKey(companyId, entryId) }).promise();
    if (!current.Item) return res.status(404).json({ error: 'Entry not found' });

    const candidate = { question: versionRow.Item.question, triggers: versionRow.Item.triggers, answer: versionRow.Item.answer };

    // Re-tested against TODAY's guardrail rules, not the rules live when
    // this version was originally published — rules may have tightened
    // since (same explicit decision as PR 2's restore).
    const testResult = await testKnowledgeEntry(companyId, candidate);
    if (!testResult.allPassed) {
      await logAudit(req.user.id, 'knowledge_entry_restore', companyId, 'blocked', req.ip, { entryId, fromVersion: version, allPassed: false }, companyId);
      return res.status(422).json({ error: 'This version no longer passes the current compliance test — not restored', testResult });
    }

    const newVersion = (current.Item.activeVersion ?? 0) + 1;
    const now = new Date().toISOString();
    const embedding = await computeEmbeddingOrNull(companyId, candidate.question, candidate.answer, entryId);

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        ...versionKey(companyId, entryId, newVersion),
        companyId, entryId, version: newVersion,
        question: candidate.question, triggers: candidate.triggers, answer: candidate.answer, category: versionRow.Item.category,
        publishedAt: now, publishedBy: req.user.id, testResult, restoredFrom: version, embedding,
      },
    }).promise();

    await dynamodb.update({
      TableName: TABLE,
      Key: entryKey(companyId, entryId),
      // Draft fields mirror the restored content too — see file header note.
      UpdateExpression: 'SET activeQuestion = :q, activeTriggers = :t, activeAnswer = :a, activeVersion = :v, activePublishedAt = :pa, activeEmbedding = :em, draftQuestion = :q, draftTriggers = :t, draftAnswer = :a, category = :c, lastTestResult = :tr, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':q': candidate.question, ':t': candidate.triggers, ':a': candidate.answer, ':v': newVersion, ':pa': now,
        ':em': embedding, ':c': versionRow.Item.category ?? null, ':tr': testResult, ':ub': req.user.id, ':ua': now,
      },
    }).promise();

    await logAudit(req.user.id, 'knowledge_entry_restore', companyId, 'success', req.ip, { entryId, fromVersion: version, newVersion, embedded: embedding !== null }, companyId);
    res.json({ success: true, version: newVersion, restoredFrom: version, testResult });
  } catch (err) { next(err); }
});

router.put('/:entryId/archive', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { entryId } = req.params;
    const existing = await dynamodb.get({ TableName: TABLE, Key: entryKey(companyId, entryId) }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Entry not found' });

    await dynamodb.update({
      TableName: TABLE,
      Key: entryKey(companyId, entryId),
      UpdateExpression: 'SET archived = :a, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: { ':a': true, ':ub': req.user.id, ':ua': new Date().toISOString() },
    }).promise();

    await logAudit(req.user.id, 'knowledge_entry_archive', companyId, 'success', req.ip, { entryId }, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:entryId/unarchive', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { entryId } = req.params;
    const existing = await dynamodb.get({ TableName: TABLE, Key: entryKey(companyId, entryId) }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Entry not found' });

    await dynamodb.update({
      TableName: TABLE,
      Key: entryKey(companyId, entryId),
      UpdateExpression: 'SET archived = :a, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: { ':a': false, ':ub': req.user.id, ':ua': new Date().toISOString() },
    }).promise();

    await logAudit(req.user.id, 'knowledge_entry_unarchive', companyId, 'success', req.ip, { entryId }, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
