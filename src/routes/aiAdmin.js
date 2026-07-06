'use strict';

const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { logAudit } = require('../utils/audit');
const {
  aiAdminGeneralSchema, aiAdminConversationSchema, aiAdminFutureSchema,
} = require('../utils/validation');
const {
  GUARDRAIL_CATEGORIES, ESCALATION_CATEGORIES, HANDOFF_MESSAGE,
} = require('../services/ConversationalAgentService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * AI Administration (Phase 2A, PR 1) — General/Conversation/Compliance/Future
 * settings. Admin-only, whole-router-guarded (same pattern as admin.js/
 * platform.js, not ai.js's per-route repetition) — every route here is
 * admin-only by design, there is no mixed-role route in this file.
 *
 * Scope, deliberately: this is the settings-storage half only.
 * - Maximum AI Reply Count / Human Handoff Turn are NOT here — reaffirmed
 *   superadmin-only per ADR-016 (docs/adr/ADR-016-ai-chat-design-requirements.md).
 * - Compliance is READ-ONLY (no PUT route at all) — editable guardrail/
 *   escalation/safe-response config arrives in PR 2, gated behind a
 *   compliance-test-before-publish check that doesn't exist yet. Shipping an
 *   editable "safe response template" now — the literal customer-facing
 *   fallback text — with no automated defense would undo the point of that gate.
 * - Prompt Management (raw system-prompt text editing/versioning) is PR 2,
 *   not this file. The Conversation tab here is structured/bounded fields only.
 */
router.use(authMiddleware, adminMiddleware);

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
    const parsed = aiAdminConversationSchema.parse(r.Item ?? {});
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
    const parsed = aiAdminFutureSchema.parse(r.Item ?? {});
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

module.exports = router;
