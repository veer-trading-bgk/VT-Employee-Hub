'use strict';

/**
 * Use-case registry for AIService.generate() — per ADR-015 Rule 3. Adding a new AI
 * feature is a new entry here plus a caller; it is never a new method on AIService
 * and never a new fetch() call anywhere else in the codebase.
 *
 * Field meaning:
 *   model            — Anthropic model id, never hardcoded at a call site.
 *   maxTokens         — passed straight through to the Messages API.
 *   promptVersion     — bumped by hand whenever promptTemplate's text changes; written
 *                       onto every AIUSAGE# record for compliance auditability.
 *   promptTemplate    — (context) => string. Receives the ALREADY-REDACTED context
 *                       (AIService redacts before calling this) and returns the full
 *                       prompt text. No prompt string is ever built outside this file.
 *   outputMode        — 'text' (raw string returned as-is) | 'json' (parsed +
 *                       validated against `schema` before ever reaching the caller).
 *   schema            — required when outputMode is 'json'; a zod schema.
 *   rateLimit         — { limit, windowMs } passed to rateLimiter's atomicIncrement().
 *   customerFacing    — whether this useCase's output is itself a customer-facing
 *                       action (vs. an internal report the requesting user reads
 *                       directly). The approval gate (point 7) only ever applies when
 *                       this is true — an internal analyst report has no downstream
 *                       action to gate. Both use cases below are analyst-facing
 *                       reports, not customer-facing content, so this is false for
 *                       both; `approval` is therefore not read for either.
 *   approval          — only consulted when customerFacing is true. { risk: 'low'|
 *                       'medium'|'high', autonomous: boolean, confidenceThreshold? }.
 *                       Omitted here since neither use case is customerFacing.
 *   localeAware       — whether to append a "respond in {preferredLanguage}"
 *                       instruction when the caller supplies one. Both of today's use
 *                       cases produce internal, employee-facing English text, so
 *                       false for both.
 */
const AI_CONFIG = {
  'metrics-insights': {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 512,
    promptVersion: 'v1',
    outputMode: 'text',
    customerFacing: false,
    localeAware: false,
    rateLimit: { limit: 20, windowMs: 60_000 },
    promptTemplate: (context) => {
      const { metrics, period, userRole } = context;
      const metricsText = Object.entries(metrics)
        .map(([key, m]) => {
          const actual = Number(m.actual) || 0;
          const target = Number(m.target) || 0;
          const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
          return `  - ${key.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase()}: ${actual} / ${target} (${pct}%)`;
        })
        .join('\n');

      return `You are a business intelligence analyst for VT Trading, a fintech company. Analyze this employee's metrics for ${period} and provide concise, actionable insights.

METRICS (${period}):
${metricsText}

USER ROLE: ${userRole}

Provide 3–5 specific bullet-point insights (max 200 words total) covering:
• Overall performance vs targets
• What's working well
• What needs improvement
• Specific recommended actions for this ${userRole}

Be direct, professional, and data-driven. No generic advice.`;
    },
  },

  'team-metrics-insights': {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 400,
    promptVersion: 'v1',
    outputMode: 'text',
    customerFacing: false,
    localeAware: false,
    rateLimit: { limit: 20, windowMs: 60_000 },
    promptTemplate: (context) => {
      const { teamMetrics, topPerformers, atRisk } = context;
      return `You are analyzing a fintech sales team at VT Trading.

TEAM PERFORMANCE:
${JSON.stringify(teamMetrics, null, 2)}

TOP PERFORMERS: ${topPerformers.join(', ') || 'N/A'}
AT RISK (below 70%): ${atRisk.join(', ') || 'None'}

Provide 3 actionable bullet points (max 150 words):
• Team health assessment
• Key recommendations for manager
• Specific support needed for at-risk employees`;
    },
  },
};

// ── Cost/usage pricing ────────────────────────────────────────────────────────
// PRE-LAUNCH TODO: these per-model token prices, the margin multiplier, and the
// points-per-USD conversion rate are PLACEHOLDER VALUES ONLY — verify against
// Anthropic's actual current published pricing before any of this feeds real
// billing. Nothing is deducted from a wallet using these numbers yet (see
// WalletService/AIService — usage is logged, not charged, in this phase); this
// block exists so the logging pipeline has real cost figures to record from day
// one, ready to switch on real deduction later without a second migration.
const PRICING = {
  models: {
    'claude-haiku-4-5-20251001': { inputPerMillion: 1.0, outputPerMillion: 5.0 }, // PLACEHOLDER
  },
  marginMultiplier: 1.5, // PLACEHOLDER
  pointsPerUsd: 100,     // PLACEHOLDER — 1 wallet point = $0.01 at this rate
  freeCallsPerMonth: 300,
};

module.exports = { AI_CONFIG, PRICING };
