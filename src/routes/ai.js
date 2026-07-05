const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const logger = require('../config/logger');
const dynamodb = require('../config/dynamodb');
const AIService = require('../services/AIService');
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

// POST /api/ai/insights
router.post('/insights', authMiddleware, async (req, res, next) => {
  try {
    const { metrics, period = 'today' } = req.body;
    if (!metrics || typeof metrics !== 'object') {
      return res.status(400).json({ error: 'metrics object required' });
    }

    // Derive role from the verified JWT — never trust client-supplied role strings
    const userRole = ALLOWED_ROLES.includes(req.user.role) ? req.user.role : 'employee';

    const result = await AIService.generate({
      useCase: 'metrics-insights',
      companyId: req.user.companyId,
      context: { metrics, period, userRole },
      user: req.user,
    });

    if (!result.ok) return sendAIError(res, result);

    res.json({
      insights: result.data,
      generatedAt: new Date().toISOString(),
      model: result.usage.model,
    });
  } catch (error) {
    logger.error('AI insights error', error);
    next(error);
  }
});

// POST /api/ai/team-insights  (admin/manager only)
router.post('/team-insights', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { teamMetrics, topPerformers = [], atRisk = [] } = req.body;
    if (!teamMetrics || typeof teamMetrics !== 'object') {
      return res.status(400).json({ error: 'teamMetrics object required' });
    }

    // Sanitise performer lists — accept only strings, strip anything non-printable
    const sanitise = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .filter((v) => typeof v === 'string')
        .map((v) => v.replace(/[^\w\s@.-]/g, '').slice(0, 100))
        .slice(0, 20);

    const safeTop = sanitise(topPerformers);
    const safeAtRisk = sanitise(atRisk);

    const result = await AIService.generate({
      useCase: 'team-metrics-insights',
      companyId: req.user.companyId,
      context: { teamMetrics, topPerformers: safeTop, atRisk: safeAtRisk },
      user: req.user,
    });

    if (!result.ok) return sendAIError(res, result);

    res.json({
      insights: result.data,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('AI team-insights error', error);
    next(error);
  }
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
router.get('/wallet', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
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
