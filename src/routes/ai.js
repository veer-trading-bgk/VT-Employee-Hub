const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const WalletService = require('../services/WalletService');
const { aiConfigSchema } = require('../utils/validation');

const router = express.Router();

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const ALLOWED_ROLES = ['admin', 'manager', 'telecaller'];

// Maps AIService's typed { ok: false, reason, detail } result onto an HTTP
// response — the one place this route-level translation happens, so a reason
// added to the graceful-degradation contract later only needs a case added here,
// not at every call site. Preserves the exact status codes the pre-migration
// direct-fetch implementation used for the two conditions it already handled
// (missing config → 503, provider failure → 502).
function sendAIError(res, result) {
  switch (result.reason) {
    case 'disabled_master':
    case 'disabled_usecase':
      return res.status(503).json({ error: result.detail });
    case 'rate_limited':
      return res.status(429).json({ error: result.detail });
    case 'wallet_exhausted':
      return res.status(402).json({ error: result.detail });
    case 'invalid_output':
      return res.status(502).json({ error: result.detail });
    case 'provider_error':
    default:
      return res.status(502).json({ error: 'AI service temporarily unavailable.' });
  }
}

// 2026-07-08 (Era 33, 19_DECISION_LOG.md) — AI deliberately disconnected
// from this route by product decision, NOT a bug: 'metrics-insights' had no
// real caller anywhere in the dashboard (confirmed before this change) and
// was correctly generating real insights right up until this edit. The
// route, this handler, and the frontend toggle label all stay in place —
// only the AI_CONFIG entry (the actual connection point) was removed.
// Deliberately short-circuits here rather than calling AIService.generate()
// with a useCase that no longer exists, which would throw synchronously.
// POST /api/ai/insights
router.post('/insights', authMiddleware, async (req, res) => {
  return res.status(410).json({
    error: 'AI insights is disabled',
    reason: 'deliberately disabled, not a bug',
  });
});

// 2026-07-08 (Era 33, 19_DECISION_LOG.md) — same deliberate disconnect as
// POST /insights above, not a bug: 'team-metrics-insights' had no real
// caller anywhere in the dashboard and was working correctly right up
// until this edit. Route/handler/toggle label all stay in place — only the
// AI_CONFIG entry was removed. Short-circuits before ever reaching
// AIService.generate() with a now-unknown useCase.
// POST /api/ai/team-insights  (admin/manager only)
router.post('/team-insights', authMiddleware, checkRole(['admin', 'manager']), async (req, res) => {
  return res.status(410).json({
    error: 'AI team insights is disabled',
    reason: 'deliberately disabled, not a bug',
  });
});

// ── Settings > AI tab: master switch + per-useCase module toggles ─────────────
// Admin-only, both directions — this is the emergency kill switch and the
// everyday convenience control beneath it, not a surface any other role needs.
router.get('/config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#AI#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    const item = r.Item;
    res.json({
      masterEnabled: item?.masterEnabled ?? true,
      moduleToggles: item?.moduleToggles ?? {},
    });
  } catch (error) {
    next(error);
  }
});

router.put('/config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const parsed = aiConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const { masterEnabled, moduleToggles = {} } = parsed.data;
    const companyId = req.user.companyId;
    const now = new Date().toISOString();

    await dynamodb.put({
      TableName: TABLE,
      Item: { PK: `CONFIG#AI#${companyId}`, SK: 'CURRENT', companyId, masterEnabled, moduleToggles, updatedAt: now, updatedBy: req.user.id },
    }).promise();

    res.json({ success: true, masterEnabled, moduleToggles });
  } catch (error) {
    next(error);
  }
});

// ── Wallet balance — placeholder display only in this phase ───────────────────
// Nothing debits this yet (AI usage is fully covered by the subscription plan
// today — see AIService/WalletService); this route exists so the Settings > AI
// tab can show a real (if currently static) balance ahead of WhatsApp Calling,
// which will be the first feature to actually draw it down.
//
// admin-only (B4 audit Finding 9, 2026-07-13): the only frontend caller,
// AISection.tsx, is itself adminOnly-gated with no manager override, so a
// manager could previously reach this route directly (curl/devtools) but
// never through any UI — tightened to match the page that actually calls it.
router.get('/wallet', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const balancePoints = await WalletService.getBalance(req.user.companyId);
    res.json({ balancePoints });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
// Exported so other route files that also call AIService.generate() (e.g.
// whatsapp.js's template-creation route) translate its typed { ok: false,
// reason, detail } result the same way, without a second copy of this switch.
module.exports.sendAIError = sendAIError;
