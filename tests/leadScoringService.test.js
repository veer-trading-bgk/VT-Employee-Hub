'use strict';

const { computeScore, isClosedLead, TIER_BANDS } = require('../src/services/LeadScoringService');

const STAGES = [
  { key: 'new_lead', label: 'New Lead', color: '#94a3b8', order: 0 },
  { key: 'contacted', label: 'Contacted', color: '#3b82f6', order: 1 },
  { key: 'interested', label: 'Interested', color: '#f59e0b', order: 2 },
  { key: 'kyc_done', label: 'KYC Done', color: '#8b5cf6', order: 3 },
  { key: 'demat_done', label: 'Demat Done', color: '#22c55e', order: 4 },
  { key: 'lost', label: 'Lost', color: '#ef4444', order: 5 },
];

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

describe('LeadScoringService.isClosedLead', () => {
  test('true for a lead in the "lost" stage', () => {
    expect(isClosedLead({ stage: 'lost' })).toBe(true);
  });

  test('true for a lead with wonAt set, regardless of stage', () => {
    expect(isClosedLead({ stage: 'demat_done', wonAt: now() })).toBe(true);
  });

  test('false for an open lead', () => {
    expect(isClosedLead({ stage: 'interested' })).toBe(false);
  });

  test('false for a lead with no stage at all (defensive default)', () => {
    expect(isClosedLead({})).toBe(false);
  });
});

describe('LeadScoringService.computeScore — stage contribution', () => {
  test('a lead at the highest non-lost stage gets full stage points', () => {
    const { priorityScoreBreakdown } = computeScore({ stage: 'demat_done' }, STAGES);
    expect(priorityScoreBreakdown.stage).toBe(30);
  });

  test('a lead at the first stage gets zero stage points', () => {
    const { priorityScoreBreakdown } = computeScore({ stage: 'new_lead' }, STAGES);
    expect(priorityScoreBreakdown.stage).toBe(0);
  });

  test('a lead at a middle stage gets a proportional share', () => {
    // kyc_done: order 3 of max 4 (demat_done, excluding 'lost') -> round(3/4 * 30) = 23
    const { priorityScoreBreakdown } = computeScore({ stage: 'kyc_done' }, STAGES);
    expect(priorityScoreBreakdown.stage).toBe(23);
  });

  test('an unknown/missing stage key contributes zero, not an error', () => {
    expect(computeScore({ stage: 'not_a_real_stage' }, STAGES).priorityScoreBreakdown.stage).toBe(0);
    expect(computeScore({}, STAGES).priorityScoreBreakdown.stage).toBe(0);
  });

  test('respects a fully custom pipeline with no "lost"-keyed stage at all', () => {
    const custom = [
      { key: 'new', label: 'New', color: '#000', order: 0 },
      { key: 'qualified', label: 'Qualified', color: '#000', order: 1 },
      { key: 'won', label: 'Won', color: '#000', order: 2 },
    ];
    expect(computeScore({ stage: 'won' }, custom).priorityScoreBreakdown.stage).toBe(30);
    expect(computeScore({ stage: 'new' }, custom).priorityScoreBreakdown.stage).toBe(0);
  });
});

describe('LeadScoringService.computeScore — intent contribution', () => {
  test('interested at full confidence gives full positive points', () => {
    expect(computeScore({ intent: 'interested', confidence: 1 }, STAGES).priorityScoreBreakdown.intent).toBe(30);
  });

  test('not_interested is a strong negative, not just "no bonus"', () => {
    expect(computeScore({ intent: 'not_interested', confidence: 1 }, STAGES).priorityScoreBreakdown.intent).toBe(-30);
  });

  test('complaint is a milder negative than not_interested', () => {
    expect(computeScore({ intent: 'complaint', confidence: 1 }, STAGES).priorityScoreBreakdown.intent).toBe(-20);
  });

  test('confidence scales the contribution', () => {
    expect(computeScore({ intent: 'interested', confidence: 0.5 }, STAGES).priorityScoreBreakdown.intent).toBe(15);
  });

  test('no intent classified yet contributes zero, not a penalty', () => {
    expect(computeScore({}, STAGES).priorityScoreBreakdown.intent).toBe(0);
  });

  test('missing confidence defaults to full weight (1)', () => {
    expect(computeScore({ intent: 'interested' }, STAGES).priorityScoreBreakdown.intent).toBe(30);
  });
});

describe('LeadScoringService.computeScore — recency contribution', () => {
  test('active today scores the max', () => {
    expect(computeScore({ lastInboundAt: now() }, STAGES).priorityScoreBreakdown.recency).toBe(20);
  });

  test('silent for 45 days scores zero', () => {
    expect(computeScore({ lastInboundAt: daysAgo(45) }, STAGES).priorityScoreBreakdown.recency).toBe(0);
  });

  test('falls back to lastMessageAt when lastInboundAt is absent', () => {
    expect(computeScore({ lastMessageAt: now() }, STAGES).priorityScoreBreakdown.recency).toBe(20);
  });

  test('no activity timestamp at all contributes zero', () => {
    expect(computeScore({}, STAGES).priorityScoreBreakdown.recency).toBe(0);
  });
});

describe('LeadScoringService.computeScore — urgency contribution', () => {
  test('a deadline 2 days out scores the max', () => {
    expect(computeScore({ closureDeadline: daysAhead(2) }, STAGES).priorityScoreBreakdown.urgency).toBe(15);
  });

  test('a deadline already passed contributes zero, not a bonus', () => {
    expect(computeScore({ closureDeadline: daysAgo(2) }, STAGES).priorityScoreBreakdown.urgency).toBe(0);
  });

  test('no closureDeadline contributes zero', () => {
    expect(computeScore({}, STAGES).priorityScoreBreakdown.urgency).toBe(0);
  });
});

describe('LeadScoringService.computeScore — value contribution', () => {
  test('a large expectedValue scores the max', () => {
    expect(computeScore({ expectedValue: 500_000 }, STAGES).priorityScoreBreakdown.value).toBe(15);
  });

  test('no expectedValue is neutral (0), never treated as zero-value penalty', () => {
    expect(computeScore({ expectedValue: null }, STAGES).priorityScoreBreakdown.value).toBe(0);
    expect(computeScore({}, STAGES).priorityScoreBreakdown.value).toBe(0);
  });

  test('a small positive expectedValue still contributes something', () => {
    expect(computeScore({ expectedValue: 500 }, STAGES).priorityScoreBreakdown.value).toBe(2);
  });
});

// 2026-07-06 (Era 22) — extends the existing rubric for
// ConversationalAgentService's conversation-derived signals, rather than a
// second/parallel lead-quality score.
describe('LeadScoringService.computeScore — productInterest contribution (Era 22)', () => {
  test('a flat 10 points once any product interest is stated, regardless of count', () => {
    expect(computeScore({ productInterest: ['mutual funds'] }, STAGES).priorityScoreBreakdown.productInterest).toBe(10);
    expect(computeScore({ productInterest: ['mutual funds', 'insurance', 'demat'] }, STAGES).priorityScoreBreakdown.productInterest).toBe(10);
  });

  test('no product interest stated is neutral (0), from any source — manual entry, CSV import, or AI conversation', () => {
    expect(computeScore({ productInterest: [] }, STAGES).priorityScoreBreakdown.productInterest).toBe(0);
    expect(computeScore({}, STAGES).priorityScoreBreakdown.productInterest).toBe(0);
  });
});

describe('LeadScoringService.computeScore — engagement contribution (Era 22)', () => {
  test('7+ AI conversation turns scores the max', () => {
    expect(computeScore({ aiConversationTurns: 7 }, STAGES).priorityScoreBreakdown.engagement).toBe(10);
    expect(computeScore({ aiConversationTurns: 10 }, STAGES).priorityScoreBreakdown.engagement).toBe(10);
  });

  test('4-6 turns scores a partial bonus', () => {
    expect(computeScore({ aiConversationTurns: 4 }, STAGES).priorityScoreBreakdown.engagement).toBe(5);
  });

  test('under 4 turns scores nothing', () => {
    expect(computeScore({ aiConversationTurns: 1 }, STAGES).priorityScoreBreakdown.engagement).toBe(0);
  });

  test('no AI conversation ever run is neutral (0), never a zero-engagement penalty', () => {
    expect(computeScore({}, STAGES).priorityScoreBreakdown.engagement).toBe(0);
    expect(computeScore({ aiConversationTurns: null }, STAGES).priorityScoreBreakdown.engagement).toBe(0);
  });
});

describe('LeadScoringService.computeScore — overall score, tier, and clamping', () => {
  test('clamps to 0 when negative contributions outweigh positive ones', () => {
    const { priorityScore } = computeScore({ stage: 'new_lead', intent: 'not_interested', confidence: 1 }, STAGES);
    expect(priorityScore).toBe(0);
  });

  test('clamps to 100 even if every factor were maxed simultaneously', () => {
    const { priorityScore } = computeScore({
      stage: 'demat_done', intent: 'interested', confidence: 1,
      lastInboundAt: now(), closureDeadline: daysAhead(1), expectedValue: 1_000_000,
    }, STAGES);
    expect(priorityScore).toBe(100);
  });

  test('a strong, fresh, high-value lead lands in the hot tier', () => {
    const result = computeScore({
      stage: 'kyc_done', intent: 'interested', confidence: 0.9,
      lastInboundAt: now(), closureDeadline: daysAhead(2), expectedValue: 200_000,
    }, STAGES);
    expect(result.priorityScore).toBeGreaterThanOrEqual(TIER_BANDS.hot);
    expect(result.priorityTier).toBe('hot');
  });

  test('a brand-new, untouched lead lands in the cold tier', () => {
    const result = computeScore({ stage: 'new_lead' }, STAGES);
    expect(result.priorityScore).toBeLessThan(TIER_BANDS.warm);
    expect(result.priorityTier).toBe('cold');
  });

  test('breakdown fields always sum to the pre-clamp raw total (internally consistent)', () => {
    const lead = { stage: 'interested', intent: 'kyc_query', confidence: 0.8, lastInboundAt: daysAgo(2) };
    const { priorityScoreBreakdown, priorityScore } = computeScore(lead, STAGES);
    const sum = Object.values(priorityScoreBreakdown).reduce((a, b) => a + b, 0);
    expect(priorityScore).toBe(Math.max(0, Math.min(100, sum)));
  });
});
