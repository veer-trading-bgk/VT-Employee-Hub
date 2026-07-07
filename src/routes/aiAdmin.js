'use strict';

const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const {
  aiAdminGeneralSchema, aiAdminConversationSchema, aiAdminFutureSchema, promptAddendumDraftSchema,
  stripStorageMetadata,
} = require('../utils/validation');
const {
  GUARDRAIL_CATEGORIES, ESCALATION_CATEGORIES, HANDOFF_MESSAGE,
} = require('../services/ConversationalAgentService');
const { testPromptAddendum } = require('../services/PromptTestService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * AI Administration (Phase 2A) — General/Conversation/Compliance/Future/
 * Prompt Management settings. Admin-only, whole-router-guarded (same pattern
 * as admin.js/platform.js, not ai.js's per-route repetition) — every route
 * here is admin-only by design, there is no mixed-role route in this file.
 *
 * Scope, deliberately:
 * - Maximum AI Reply Count / Human Handoff Turn are NOT here — reaffirmed
 *   superadmin-only per ADR-016 (docs/adr/ADR-016-ai-chat-design-requirements.md).
 * - Compliance is READ-ONLY (no PUT route at all), still — guardrail/
 *   escalation regex patterns stay code-only even in PR 2 (explicit decision:
 *   a non-technical admin hand-editing raw regex is a real risk this gate
 *   can't fully catch — see docs/bible/19_DECISION_LOG.md's Phase 2A / PR 2 entry).
 * - Prompt Management (below, /prompt-addendum/*) is a BOUNDED free-text
 *   addendum appended after the permanently code-locked hard compliance
 *   rules in aiConfig.js — never a full prompt override. Every path that can
 *   make it live (publish, restore) re-runs PromptTestService's live-
 *   generation gate fresh, every time — a client-shown prior pass is never
 *   trusted as a substitute.
 */
router.use(authMiddleware, adminMiddleware);

function promptAddendumConfigKey(companyId) {
  return { PK: `CONFIG#PROMPTADDENDUM#${companyId}`, SK: 'CURRENT' };
}
function promptAddendumVersionKey(companyId, version) {
  return { PK: `CONFIG#PROMPTADDENDUM#${companyId}`, SK: `VERSION#${String(version).padStart(6, '0')}` };
}

function configKey(namespace, companyId) {
  return { PK: `CONFIG#${namespace}#${companyId}`, SK: 'CURRENT' };
}

// ── General ────────────────────────────────────────────────────────────────
router.get('/general', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const [convAgent, leadScoring, autoAssign] = await Promise.all([
      dynamodb.get({ TableName: TABLE, Key: configKey('CONVAGENT', companyId) }).promise(),
      dynamodb.get({ TableName: TABLE, Key: configKey('LEADSCORING', companyId) }).promise(),
      dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#AUTOASSIGN#${companyId}`, SK: 'current' } }).promise(),
    ]);

    const cfg = convAgent.Item ?? {};
    res.json({
      conversationAgentEnabled: cfg.enabled ?? false,
      qualificationEnabled: cfg.qualificationEnabled ?? true,
      summaryEnabled: cfg.summaryEnabled ?? true,
      crmAutoTransferEnabled: cfg.crmAutoTransferEnabled ?? true,
      leadScoringEnabled: leadScoring.Item?.enabled ?? true,
      // Read-only echo — the actual write path stays /api/admin/crm/auto-assign,
      // this is display-only so the General tab doesn't need a second control
      // that could drift from the real one.
      autoAssign: autoAssign.Item ?? { enabled: false },
    });
  } catch (err) { next(err); }
});

router.put('/general', async (req, res, next) => {
  try {
    const parsed = aiAdminGeneralSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const { conversationAgentEnabled, qualificationEnabled, summaryEnabled, crmAutoTransferEnabled, leadScoringEnabled } = parsed.data;
    const companyId = req.user.companyId;
    const now = new Date().toISOString();

    await Promise.all([
      dynamodb.put({
        TableName: TABLE,
        Item: {
          ...configKey('CONVAGENT', companyId),
          companyId,
          enabled: conversationAgentEnabled,
          qualificationEnabled, summaryEnabled, crmAutoTransferEnabled,
          updatedBy: req.user.id, updatedAt: now,
        },
      }).promise(),
      dynamodb.put({
        TableName: TABLE,
        Item: { ...configKey('LEADSCORING', companyId), companyId, enabled: leadScoringEnabled, updatedBy: req.user.id, updatedAt: now },
      }).promise(),
    ]);

    await logAudit(req.user.id, 'ai_admin_general_update', companyId, 'success', req.ip, parsed.data, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Conversation ───────────────────────────────────────────────────────────
router.get('/conversation', async (req, res, next) => {
  try {
    const r = await dynamodb.get({ TableName: TABLE, Key: configKey('CONVPROMPT', req.user.companyId) }).promise();
    const parsed = aiAdminConversationSchema.parse(stripStorageMetadata(r.Item));
    res.json(parsed);
  } catch (err) { next(err); }
});

router.put('/conversation', async (req, res, next) => {
  try {
    const parsed = aiAdminConversationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const companyId = req.user.companyId;
    await dynamodb.put({
      TableName: TABLE,
      Item: { ...configKey('CONVPROMPT', companyId), companyId, ...parsed.data, updatedBy: req.user.id, updatedAt: new Date().toISOString() },
    }).promise();

    await logAudit(req.user.id, 'ai_admin_conversation_update', companyId, 'success', req.ip, parsed.data, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Compliance — read-only by design, no PUT route in this file ────────────
router.get('/compliance', async (req, res) => {
  res.json({
    guardrailCategories: GUARDRAIL_CATEGORIES,
    escalationCategories: ESCALATION_CATEGORIES,
    safeResponseTemplate: HANDOFF_MESSAGE,
    editable: false,
    note: 'Editing arrives in a future release, gated behind an automated compliance test suite.',
  });
});

// ── Future AI Settings ───────────────────────────────────────────────────────
router.get('/future', async (req, res, next) => {
  try {
    const r = await dynamodb.get({ TableName: TABLE, Key: configKey('AIFUTURE', req.user.companyId) }).promise();
    const parsed = aiAdminFutureSchema.parse(stripStorageMetadata(r.Item));
    res.json({
      ...parsed,
      // Locked placeholders — no RAG infra exists yet (Phase 2A explicitly defers it).
      rag: { enabled: false, locked: true },
      embedding: { model: null, locked: true },
      search: { locked: true },
    });
  } catch (err) { next(err); }
});

router.put('/future', async (req, res, next) => {
  try {
    const parsed = aiAdminFutureSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const companyId = req.user.companyId;
    await dynamodb.put({
      TableName: TABLE,
      Item: { ...configKey('AIFUTURE', companyId), companyId, ...parsed.data, updatedBy: req.user.id, updatedAt: new Date().toISOString() },
    }).promise();

    await logAudit(req.user.id, 'ai_admin_future_update', companyId, 'success', req.ip, parsed.data, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Prompt Management (Phase 2A, PR 2) ───────────────────────────────────────
// One shared rate-limit bucket across test/publish/restore — each triggers
// the same 5-real-Anthropic-call gate, so all three share one budget rather
// than each getting their own (which would let an admin burn through 3x the
// intended API cost by mixing the three actions).
const PROMPT_TEST_RATE_LIMIT = rateLimit(30, 60 * 60_000);

router.get('/prompt-addendum', async (req, res, next) => {
  try {
    const r = await dynamodb.get({ TableName: TABLE, Key: promptAddendumConfigKey(req.user.companyId) }).promise();
    const cfg = r.Item ?? {};
    res.json({
      activeText: cfg.activeText ?? '',
      activeVersion: cfg.activeVersion ?? 0,
      draftText: cfg.draftText ?? '',
      lastTestResult: cfg.lastTestResult ?? null,
    });
  } catch (err) { next(err); }
});

router.put('/prompt-addendum/draft', async (req, res, next) => {
  try {
    const parsed = promptAddendumDraftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const companyId = req.user.companyId;
    // No gate — a draft is never live, only /publish or /restore can reach a
    // real customer, and both re-test regardless of what's saved here.
    await dynamodb.update({
      TableName: TABLE,
      Key: promptAddendumConfigKey(companyId),
      UpdateExpression: 'SET draftText = :d, companyId = :cid, updatedBy = :ub, updatedAt = :ua, activeText = if_not_exists(activeText, :empty), activeVersion = if_not_exists(activeVersion, :zero)',
      ExpressionAttributeValues: {
        ':d': parsed.data.text, ':cid': companyId, ':ub': req.user.id, ':ua': new Date().toISOString(),
        ':empty': '', ':zero': 0,
      },
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/prompt-addendum/test', PROMPT_TEST_RATE_LIMIT, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    let candidateText = req.body?.text;
    if (typeof candidateText !== 'string') {
      const r = await dynamodb.get({ TableName: TABLE, Key: promptAddendumConfigKey(companyId) }).promise();
      candidateText = r.Item?.draftText ?? '';
    }

    const testResult = await testPromptAddendum(companyId, candidateText);

    await dynamodb.update({
      TableName: TABLE,
      Key: promptAddendumConfigKey(companyId),
      UpdateExpression: 'SET lastTestResult = :tr, companyId = :cid, updatedAt = :ua, draftText = if_not_exists(draftText, :empty), activeText = if_not_exists(activeText, :empty), activeVersion = if_not_exists(activeVersion, :zero)',
      ExpressionAttributeValues: {
        ':tr': testResult, ':cid': companyId, ':ua': new Date().toISOString(), ':empty': '', ':zero': 0,
      },
    }).promise();

    await logAudit(req.user.id, 'ai_admin_prompt_test', companyId, testResult.allPassed ? 'success' : 'failed', req.ip, { allPassed: testResult.allPassed }, companyId);
    res.json(testResult);
  } catch (err) { next(err); }
});

router.post('/prompt-addendum/publish', PROMPT_TEST_RATE_LIMIT, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const r = await dynamodb.get({ TableName: TABLE, Key: promptAddendumConfigKey(companyId) }).promise();
    const cfg = r.Item ?? {};
    const candidateText = cfg.draftText ?? '';

    // Always re-test the CURRENT draft here — never trust a client-supplied
    // "it already passed" claim, and never trust cfg.lastTestResult either
    // (the draft may have been edited again since that test ran).
    const testResult = await testPromptAddendum(companyId, candidateText);
    if (!testResult.allPassed) {
      await logAudit(req.user.id, 'ai_admin_prompt_publish', companyId, 'blocked', req.ip, { allPassed: false }, companyId);
      return res.status(422).json({ error: 'Compliance test failed — not published', testResult });
    }

    const newVersion = (cfg.activeVersion ?? 0) + 1;
    const now = new Date().toISOString();

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        ...promptAddendumVersionKey(companyId, newVersion),
        companyId, version: newVersion, text: candidateText,
        publishedAt: now, publishedBy: req.user.id, testResult, restoredFrom: null,
      },
    }).promise();

    await dynamodb.update({
      TableName: TABLE,
      Key: promptAddendumConfigKey(companyId),
      UpdateExpression: 'SET activeText = :t, activeVersion = :v, draftText = :empty, lastTestResult = :tr, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':t': candidateText, ':v': newVersion, ':empty': '', ':tr': testResult, ':ub': req.user.id, ':ua': now,
      },
    }).promise();

    await logAudit(req.user.id, 'ai_admin_prompt_publish', companyId, 'success', req.ip, { version: newVersion }, companyId);
    res.json({ success: true, version: newVersion, testResult });
  } catch (err) { next(err); }
});

router.get('/prompt-addendum/versions', async (req, res, next) => {
  try {
    const { Items = [] } = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': `CONFIG#PROMPTADDENDUM#${req.user.companyId}`, ':pfx': 'VERSION#' },
      ScanIndexForward: false,
    }).promise();
    res.json({ versions: Items });
  } catch (err) { next(err); }
});

router.post('/prompt-addendum/versions/:version/restore', PROMPT_TEST_RATE_LIMIT, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'Invalid version' });

    const r = await dynamodb.get({ TableName: TABLE, Key: promptAddendumVersionKey(companyId, version) }).promise();
    if (!r.Item) return res.status(404).json({ error: 'Version not found' });

    // Re-tested against TODAY's guardrail rules, not the rules live when
    // this version was originally published — rules may have tightened
    // since (explicit decision, docs/bible/19_DECISION_LOG.md Phase 2A / PR 2).
    const testResult = await testPromptAddendum(companyId, r.Item.text);
    if (!testResult.allPassed) {
      await logAudit(req.user.id, 'ai_admin_prompt_restore', companyId, 'blocked', req.ip, { fromVersion: version, allPassed: false }, companyId);
      return res.status(422).json({ error: 'This version no longer passes the current compliance test — not restored', testResult });
    }

    const currentCfg = await dynamodb.get({ TableName: TABLE, Key: promptAddendumConfigKey(companyId) }).promise();
    const newVersion = (currentCfg.Item?.activeVersion ?? 0) + 1;
    const now = new Date().toISOString();

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        ...promptAddendumVersionKey(companyId, newVersion),
        companyId, version: newVersion, text: r.Item.text,
        publishedAt: now, publishedBy: req.user.id, testResult, restoredFrom: version,
      },
    }).promise();

    await dynamodb.update({
      TableName: TABLE,
      Key: promptAddendumConfigKey(companyId),
      UpdateExpression: 'SET activeText = :t, activeVersion = :v, draftText = :empty, lastTestResult = :tr, updatedBy = :ub, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':t': r.Item.text, ':v': newVersion, ':empty': '', ':tr': testResult, ':ub': req.user.id, ':ua': now,
      },
    }).promise();

    await logAudit(req.user.id, 'ai_admin_prompt_restore', companyId, 'success', req.ip, { fromVersion: version, newVersion }, companyId);
    res.json({ success: true, version: newVersion, restoredFrom: version, testResult });
  } catch (err) { next(err); }
});

module.exports = router;
