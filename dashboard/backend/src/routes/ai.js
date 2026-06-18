const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

const ALLOWED_ROLES = ['admin', 'manager', 'telecaller'];

// POST /api/ai/insights
router.post('/insights', authMiddleware, async (req, res, next) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'AI insights not configured. Set ANTHROPIC_API_KEY in environment.',
      });
    }

    const { metrics, period = 'today' } = req.body;
    if (!metrics || typeof metrics !== 'object') {
      return res.status(400).json({ error: 'metrics object required' });
    }

    // Derive role from the verified JWT — never trust client-supplied role strings
    const userRole = ALLOWED_ROLES.includes(req.user.role) ? req.user.role : 'employee';

    const metricsText = Object.entries(metrics)
      .map(([key, m]) => {
        const actual = Number(m.actual) || 0;
        const target = Number(m.target) || 0;
        const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
        return `  - ${key.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase()}: ${actual} / ${target} (${pct}%)`;
      })
      .join('\n');

    const prompt = `You are a business intelligence analyst for VT Trading, a fintech company. Analyze this employee's metrics for ${period} and provide concise, actionable insights.

METRICS (${period}):
${metricsText}

USER ROLE: ${userRole}

Provide 3–5 specific bullet-point insights (max 200 words total) covering:
• Overall performance vs targets
• What's working well
• What needs improvement
• Specific recommended actions for this ${userRole}

Be direct, professional, and data-driven. No generic advice.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error('Anthropic API error', err);
      return res.status(502).json({ error: 'AI service temporarily unavailable.' });
    }

    const data = await response.json();
    const insights = data.content?.[0]?.text ?? '';

    res.json({
      insights,
      generatedAt: new Date().toISOString(),
      model: 'claude-haiku',
    });
  } catch (error) {
    logger.error('AI insights error', error);
    next(error);
  }
});

// POST /api/ai/team-insights  (admin/manager only)
router.post('/team-insights', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'AI insights not configured.' });
    }

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

    const prompt = `You are analyzing a fintech sales team at VT Trading.

TEAM PERFORMANCE:
${JSON.stringify(teamMetrics, null, 2)}

TOP PERFORMERS: ${safeTop.join(', ') || 'N/A'}
AT RISK (below 70%): ${safeAtRisk.join(', ') || 'None'}

Provide 3 actionable bullet points (max 150 words):
• Team health assessment
• Key recommendations for manager
• Specific support needed for at-risk employees`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'AI service temporarily unavailable.' });
    }

    const data = await response.json();
    res.json({
      insights: data.content?.[0]?.text ?? '',
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('AI team-insights error', error);
    next(error);
  }
});

module.exports = router;
