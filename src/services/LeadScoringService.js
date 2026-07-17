'use strict';

/**
 * Deterministic lead-priority scoring — no LLM call. This runs across every
 * open lead in every company on a recurring ~60-minute cycle
 * (LeadScoringScheduler.js); a per-lead AIService.generate() call doesn't fit
 * that shape (cost/latency scale with leads × cycles, unbounded, unlike every
 * other AIService useCase which is bounded by a real one-time event). It does
 * still use AI's own output for free: `intent`/`confidence` were already
 * computed once by IntentDetectionService — this formula reuses that result
 * as an input rather than re-deriving it with a second LLM call.
 *
 * Deliberately excludes touchCount (correlation direction unclear without
 * outcome data), tags (no universal, company-agnostic weight is defensible),
 * and probability (the agent's own manual estimate — feeding it back into a
 * "computed" score would double-count the agent's opinion as if it were
 * independent evidence, and create a confusing feedback loop).
 *
 * 2026-07-06 (Era 22): added productInterest and engagement inputs, extending
 * this existing rubric rather than building a second/parallel lead-quality
 * score for ConversationalAgentService's conversation-derived signals. Budget
 * and timeline signals from that same conversation deliberately do NOT get
 * their own new inputs here — they're written onto the existing
 * expectedValue/closureDeadline fields instead, so _valuePoints()/
 * _urgencyPoints() already pick them up unmodified.
 */

// Points contributed by an intent classification, before scaling by
// confidence. Negative for disengagement signals — a lead deep in the
// funnel who says "not interested" should score low despite a strong stage
// position, not just fail to get a bonus.
const INTENT_POINTS = {
  interested: 30,
  kyc_query: 25,
  renewal_inquiry: 20,
  pricing_question: 15,
  support_request: 5,
  other: 0,
  not_interested: -30,
  complaint: -20,
};

// Tune once real conversion data has run through this — starting point only.
const TIER_BANDS = { hot: 70, warm: 40 };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Up to 30 points based on how far along the company's own pipeline this
 * lead's stage is. Stage order comes from PipelineService.getPipelineStages()
 * so a customized pipeline is respected — only the "which key means
 * closed-lost" part is a hardcoded convention (`'lost'`), matching the same
 * convention sales/page.tsx's own KPI cards and PipelineService.DEFAULT_STAGES
 * already use. A fully custom pipeline that renamed/restructured its closing
 * stages isn't detected by this — same accepted limitation already present
 * elsewhere in this codebase, not new here.
 */
function _stagePoints(lead, stages) {
  if (!lead.stage) return 0;
  const current = stages.find((s) => s.key === lead.stage);
  if (!current) return 0;
  const positiveStages = stages.filter((s) => s.key !== 'lost');
  const maxOrder = Math.max(...positiveStages.map((s) => s.order), 1);
  return Math.round((current.order / maxOrder) * 30);
}

/** Up to 30 points (or down to -30) from the AI-classified intent, scaled by the model's own confidence. */
function _intentPoints(lead) {
  if (!lead.intent || !(lead.intent in INTENT_POINTS)) return 0;
  const confidence = typeof lead.confidence === 'number' ? lead.confidence : 1;
  return Math.round(INTENT_POINTS[lead.intent] * confidence);
}

/** Up to 20 points for how recently the customer last messaged in — same recency signal derivePriority() already trusted. */
function _recencyPoints(lead) {
  const lastActive = lead.lastInboundAt ?? lead.lastMessageAt;
  if (!lastActive) return 0;
  const daysSince = (Date.now() - new Date(lastActive).getTime()) / MS_PER_DAY;
  if (daysSince < 1) return 20;
  if (daysSince < 3) return 15;
  if (daysSince < 7) return 10;
  if (daysSince < 14) return 5;
  if (daysSince < 30) return 2;
  return 0;
}

/** Up to 15 points as a closureDeadline approaches — same urgency signal derivePriority() already trusted. */
function _urgencyPoints(lead) {
  if (!lead.closureDeadline) return 0;
  const daysLeft = (new Date(lead.closureDeadline).getTime() - Date.now()) / MS_PER_DAY;
  if (daysLeft < 0) return 0; // deadline already passed
  if (daysLeft <= 3) return 15;
  if (daysLeft <= 7) return 10;
  if (daysLeft <= 14) return 5;
  return 0;
}

/**
 * Up to 15 points when expectedValue is populated — the "how valuable" half
 * of the goal. Most leads won't have this set (crm.js's own comment calls it
 * a "Reserved future-ready field") — absence must mean "no adjustment,"
 * never "zero value," so a lead with no expectedValue is neither rewarded
 * nor punished for it.
 */
function _valuePoints(lead) {
  const value = typeof lead.expectedValue === 'number' ? lead.expectedValue : null;
  if (value === null) return 0;
  if (value >= 100_000) return 15;
  if (value >= 50_000) return 10;
  if (value >= 10_000) return 5;
  if (value > 0) return 2;
  return 0;
}

/**
 * Up to 10 points when at least one product interest has been captured —
 * from ANY source (manual CRM entry, CSV import, or ConversationalAgentService's
 * conversation extraction, 2026-07-06 Era 22), not bot-conversation-specific.
 * A flat bonus, not banded by count: stating one clear interest is the signal
 * that matters, not how many were listed.
 */
function _productInterestPoints(lead) {
  return (lead.productInterest ?? []).length > 0 ? 10 : 0;
}

/**
 * Up to 10 points for conversation engagement depth — populated by
 * ConversationalAgentService at handoff (aiConversationTurns is a snapshot
 * copied from the conversation's own aiTurnCount, not a live join against
 * CONV# — computeScore() runs across every open lead in every company on a
 * schedule, and a per-lead conversation lookup would multiply that sweep's
 * read cost). Absent (no bot conversation ever ran) means no adjustment,
 * never zero-engagement punishment — same "absence isn't a penalty"
 * philosophy as _valuePoints().
 */
function _engagementPoints(lead) {
  const turns = typeof lead.aiConversationTurns === 'number' ? lead.aiConversationTurns : null;
  if (turns === null) return 0;
  if (turns >= 7) return 10;
  if (turns >= 4) return 5;
  return 0;
}

function _tierFor(score) {
  if (score >= TIER_BANDS.hot) return 'hot';
  if (score >= TIER_BANDS.warm) return 'warm';
  return 'cold';
}

/**
 * True when a lead is closed (won or lost) and should be excluded from
 * scoring/prioritization entirely — it's not "who to follow up with next."
 *
 * Stage 3 (2026-07-17 360° audit): now flag-based against the company's
 * real pipeline (`stages`, e.g. `PipelineService.getPipelineStages()`'s
 * result) instead of the previous `stage === 'lost' || Boolean(lead.wonAt)`
 * hardcoded check — the old check named a key ('lost') that doesn't exist
 * in every custom pipeline, and `wonAt` is never written a real value by
 * any current write path (only ever initialized/preserved as `null`), so
 * that half of the check was always dead in practice.
 *
 * A stage's `isWon`/`isLost` flags are opt-in per company (Pipeline Stage
 * Manager) and default to unset — a company that hasn't configured them
 * (including a fresh/default pipeline) has zero closed leads until it does.
 * This is a deliberate behavior change: previously any lead whose stage KEY
 * happened to be `'lost'` closed automatically; now every company,
 * including ones still on the stock default pipeline, must explicitly mark
 * their closing stage(s) once. `stages` defaults to `[]` so a caller that
 * forgets to pass it fails open (never closes a lead) rather than throwing.
 */
function isClosedLead(lead, stages = []) {
  const stageObj = stages.find((s) => s.key === lead.stage);
  return Boolean(stageObj?.isWon || stageObj?.isLost);
}

/**
 * Computes a lead's priority score. `stages` is the calling company's own
 * pipeline (PipelineService.getPipelineStages) — fetch once per sweep per
 * company, never once per lead.
 */
function computeScore(lead, stages) {
  const breakdown = {
    stage: _stagePoints(lead, stages),
    intent: _intentPoints(lead),
    recency: _recencyPoints(lead),
    urgency: _urgencyPoints(lead),
    value: _valuePoints(lead),
    productInterest: _productInterestPoints(lead),
    engagement: _engagementPoints(lead),
  };
  const raw = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const priorityScore = Math.max(0, Math.min(100, Math.round(raw)));
  return {
    priorityScore,
    priorityTier: _tierFor(priorityScore),
    priorityScoreBreakdown: breakdown,
  };
}

module.exports = { computeScore, isClosedLead, TIER_BANDS, INTENT_POINTS };
