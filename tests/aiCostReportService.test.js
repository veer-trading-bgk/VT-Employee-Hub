'use strict';

/**
 * AiCostReportService — cross-tenant AI cost aggregation for the Platform
 * module's AI Costs tab (docs/bible/19_DECISION_LOG.md Era 38).
 */

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';
process.env.DYNAMODB_TABLE_EMPLOYEES = 'employees';

jest.mock('../src/config/dynamodb', () => ({ scan: jest.fn() }));

const dynamodb = require('../src/config/dynamodb');
const AiCostReportService = require('../src/services/AiCostReportService');

function aiItem(overrides = {}) {
  return {
    PK: `AIUSAGE#${overrides.companyId ?? 'viir_trading'}#2026-07-08`,
    SK: '2026-07-08T06:45:48.992Z#inbox-intent-detection',
    companyId: 'viir_trading',
    useCase: 'inbox-intent-detection',
    model: 'claude-haiku-4-5-20251001',
    costUsd: 0.001,
    createdAt: '2026-07-08T06:45:48.992Z',
    ...overrides,
  };
}

function embedItem(overrides = {}) {
  return {
    PK: `EMBEDUSAGE#${overrides.companyId ?? 'viir_trading'}#2026-07-08`,
    SK: '2026-07-08T06:45:48.665Z',
    companyId: 'viir_trading',
    inputType: 'query',
    tokens: 100,
    date: '2026-07-08',
    ...overrides,
  };
}

// Mimic a real Scan+FilterExpression: dynamodb.scan is mocked per-call based
// on the FilterExpression's prefix, returning a single unpaginated page.
// registeredCompanyIds defaults to ['viir_trading'] — every fixture below
// that doesn't care about the registered/unregistered split uses that
// companyId, so existing assertions keep working unchanged.
function mockScanSequence(aiItems, embedItems, registeredCompanyIds = ['viir_trading']) {
  dynamodb.scan.mockImplementation((params) => {
    const isAi = params.ExpressionAttributeValues?.[':p'] === 'AIUSAGE#';
    const isEmbed = params.ExpressionAttributeValues?.[':p'] === 'EMBEDUSAGE#';
    const isCompanyRegistry = params.ExpressionAttributeValues?.[':t'] === 'COMPANY_PROFILE';
    const isEntityLookup = params.FilterExpression.includes('entityId');

    if (isCompanyRegistry) {
      return { promise: async () => ({ Items: registeredCompanyIds.map((companyId) => ({ companyId })) }) };
    }

    let items = isAi ? aiItems : isEmbed ? embedItems : [];
    if (isEntityLookup) {
      const eid = params.ExpressionAttributeValues[':eid'];
      items = items.filter((it) => it.entityId === eid);
    } else {
      // date-range filters — apply the same BETWEEN semantics as real DynamoDB
      if (params.ExpressionAttributeValues[':from']) {
        const { ':from': from, ':to': to } = params.ExpressionAttributeValues;
        items = items.filter((it) => it.createdAt >= from && it.createdAt <= to);
      }
      if (params.ExpressionAttributeValues[':fromD']) {
        const { ':fromD': fromD, ':toD': toD } = params.ExpressionAttributeValues;
        items = items.filter((it) => it.date >= fromD && it.date <= toD);
      }
    }
    return { promise: async () => ({ Items: items }) };
  });
}

describe('AiCostReportService.getAiCostReport', () => {
  beforeEach(() => jest.clearAllMocks());

  test('separates production/admin_test/untagged into distinct buckets — never blended', async () => {
    mockScanSequence([
      aiItem({ source: 'production', costUsd: 0.01 }),
      aiItem({ source: 'production', costUsd: 0.02 }),
      aiItem({ source: 'admin_test', costUsd: 0.05 }),
      aiItem({ costUsd: 0.10 }), // untagged — no source field at all
    ], []);

    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });

    expect(report.bySource.production.totalCostUsd).toBeCloseTo(0.03, 6);
    expect(report.bySource.production.calls).toBe(2);
    expect(report.bySource.admin_test.totalCostUsd).toBeCloseTo(0.05, 6);
    expect(report.bySource.admin_test.calls).toBe(1);
    expect(report.bySource.untagged.totalCostUsd).toBeCloseTo(0.10, 6);
    expect(report.bySource.untagged.calls).toBe(1);
  });

  test('computes INR using the named USD_TO_INR_RATE constant', async () => {
    mockScanSequence([aiItem({ source: 'production', costUsd: 1 })], []);
    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    expect(report.usdToInrRate).toBe(AiCostReportService.USD_TO_INR_RATE);
    expect(report.bySource.production.totalCostInr).toBeCloseTo(AiCostReportService.USD_TO_INR_RATE, 6);
  });

  test('breaks down cost per company within a source bucket', async () => {
    mockScanSequence([
      aiItem({ source: 'production', companyId: 'viir_trading', costUsd: 0.01 }),
      aiItem({ source: 'production', companyId: 'other_co', costUsd: 0.02 }),
    ], []);
    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    const byCompany = report.bySource.production.byCompany;
    expect(byCompany).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId: 'viir_trading', costUsd: 0.01 }),
      expect.objectContaining({ companyId: 'other_co', costUsd: 0.02 }),
    ]));
    // sorted highest-cost first
    expect(byCompany[0].companyId).toBe('other_co');
  });

  test('headline (registered) cost excludes unregistered/scratch companyIds, but total still includes everything', async () => {
    mockScanSequence([
      aiItem({ source: 'production', companyId: 'viir_trading', costUsd: 0.01 }),
      aiItem({ source: 'production', companyId: 'retryfix_verification_scratch', costUsd: 0.03 }),
    ], [], ['viir_trading']); // only viir_trading is registered

    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    const bucket = report.bySource.production;

    expect(bucket.totalCostUsd).toBeCloseTo(0.04, 6); // everything, unchanged
    expect(bucket.registeredCostUsd).toBeCloseTo(0.01, 6); // headline — real company only
    expect(bucket.registeredCalls).toBe(1);
    expect(bucket.unregisteredCostUsd).toBeCloseTo(0.03, 6);
    expect(bucket.unregisteredCalls).toBe(1);
    expect(bucket.unregisteredCompanyCount).toBe(1);
  });

  test('byCompany rows are tagged registered/unregistered by COMPANY_PROFILE membership, not naming convention', async () => {
    mockScanSequence([
      aiItem({ source: 'production', companyId: 'viir_trading', costUsd: 0.01 }),
      aiItem({ source: 'production', companyId: 'anything_not_registered', costUsd: 0.02 }),
    ], [], ['viir_trading']);

    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    const byCompany = report.bySource.production.byCompany;

    expect(byCompany.find((c) => c.companyId === 'viir_trading').registered).toBe(true);
    expect(byCompany.find((c) => c.companyId === 'anything_not_registered').registered).toBe(false);
  });

  test('embeddings are split registered/unregistered the same way as AI cost', async () => {
    mockScanSequence([], [
      embedItem({ companyId: 'viir_trading', tokens: 1_000_000 }),
      embedItem({ companyId: 'ragtest_scratch', tokens: 500_000 }),
    ], ['viir_trading']);

    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    const embeddings = report.embeddings;

    expect(embeddings.totalTokens).toBe(1_500_000);
    expect(embeddings.registeredTokens).toBe(1_000_000);
    expect(embeddings.unregisteredTokens).toBe(500_000);
    expect(embeddings.unregisteredCompanyCount).toBe(1);
    expect(embeddings.byCompany.find((c) => c.companyId === 'viir_trading').registered).toBe(true);
    expect(embeddings.byCompany.find((c) => c.companyId === 'ragtest_scratch').registered).toBe(false);
  });

  test('breaks down cost per useCase within a source bucket', async () => {
    mockScanSequence([
      aiItem({ source: 'production', useCase: 'conversational-sales-agent', costUsd: 0.03 }),
      aiItem({ source: 'production', useCase: 'conversation-handoff-summary', costUsd: 0.01 }),
    ], []);
    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    const byUseCase = report.bySource.production.byUseCase;
    expect(byUseCase.find((u) => u.useCase === 'conversational-sales-agent').costUsd).toBe(0.03);
    expect(byUseCase.find((u) => u.useCase === 'conversation-handoff-summary').costUsd).toBe(0.01);
  });

  test('reports embeddings as a token-based estimate, separate from AI cost', async () => {
    mockScanSequence([], [embedItem({ tokens: 1_000_000 })]);
    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    expect(report.embeddings.totalTokens).toBe(1_000_000);
    expect(report.embeddings.estimatedCostUsd).toBeCloseTo(AiCostReportService.VOYAGE_EMBED_USD_PER_MILLION_TOKENS, 6);
    expect(report.embeddings.note).toMatch(/estimate/i);
  });

  test('reports how much tagged data actually exists — the low-data-state signal', async () => {
    mockScanSequence([
      aiItem({ source: 'production', createdAt: '2026-07-08T06:00:00.000Z' }),
      aiItem({ createdAt: '2026-07-04T06:00:00.000Z' }), // untagged, no entityType/entityId/source
    ], []);
    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    expect(report.meta.totalAiUsageRecordsInRange).toBe(2);
    expect(report.meta.taggedAiUsageRecordsInRange).toBe(1);
    expect(report.meta.daysOfTaggedData).toBe(1);
    expect(report.meta.taggedDataDates).toEqual(['2026-07-08']);
  });

  test('defaults to a 30-day range when none is given', async () => {
    mockScanSequence([], []);
    await AiCostReportService.getAiCostReport({});
    const call = dynamodb.scan.mock.calls.find((c) => c[0].ExpressionAttributeValues[':p'] === 'AIUSAGE#');
    const { ':from': from, ':to': to } = call[0].ExpressionAttributeValues;
    const days = (new Date(to) - new Date(from)) / 86_400_000;
    expect(days).toBeCloseTo(30, 0);
  });

  test('Era 40: a historical costUsd:0 record (pre-PRICING-gap-fix, no rate snapshot) is recomputed into the bucket total, not silently zeroed', async () => {
    mockScanSequence([
      // Simulates a real pre-2026-07-08 conversational-sales-agent record —
      // logged costUsd: 0 because PRICING.models had no claude-sonnet-5 entry
      // yet, no inputRatePerMillion/outputRatePerMillion (predates that field).
      aiItem({
        source: 'production', model: 'claude-sonnet-5', useCase: 'conversational-sales-agent',
        costUsd: 0, inputTokens: 1_000_000, outputTokens: 1_000_000,
      }),
    ], []);
    const report = await AiCostReportService.getAiCostReport({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-09T00:00:00.000Z' });
    // live PRICING.models['claude-sonnet-5'] is $2/$10 per MTok, marginMultiplier 1.5
    expect(report.bySource.production.totalCostUsd).toBeCloseTo(18, 6);
    expect(report.bySource.production.totalCostUsd).not.toBe(0);
  });
});

describe('AiCostReportService.effectiveCost', () => {
  test('a real logged costUsd is used as-is, never recomputed', () => {
    const item = { costUsd: 0.05, model: 'claude-haiku-4-5-20251001', inputTokens: 999_999_999, outputTokens: 999_999_999 };
    expect(AiCostReportService.effectiveCost(item)).toBe(0.05);
  });

  test('costUsd:0 with real tokens and a model present in current PRICING.models recomputes correctly', () => {
    const item = { costUsd: 0, model: 'claude-haiku-4-5-20251001', inputTokens: 1_000_000, outputTokens: 1_000_000 };
    // haiku is $1/$5 per MTok, marginMultiplier 1.5 -> (1*1 + 1*5) * 1.5 = 9
    expect(AiCostReportService.effectiveCost(item)).toBeCloseTo(9, 6);
  });

  test('costUsd:0 with a model NOT in PRICING.models falls back to 0 — does not crash', () => {
    const item = { costUsd: 0, model: 'some-unknown-model-xyz', inputTokens: 1000, outputTokens: 1000 };
    expect(() => AiCostReportService.effectiveCost(item)).not.toThrow();
    expect(AiCostReportService.effectiveCost(item)).toBe(0);
  });

  test('a snapshotted rate on the record wins over current PRICING.models, even when they now differ — proven by comparison, not just presence', () => {
    const withSnapshot = {
      costUsd: 0,
      model: 'claude-sonnet-5', // live PRICING.models['claude-sonnet-5'] is currently $2/$10
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      inputRatePerMillion: 3, outputRatePerMillion: 15, // simulates an OLD, since-changed rate
    };
    const snapshotBasedCost = AiCostReportService.effectiveCost(withSnapshot);
    // snapshot rate: (1*3 + 1*15) * 1.5 = 27
    expect(snapshotBasedCost).toBeCloseTo(27, 6);

    // Same record, but as it would look if it predated the snapshot field —
    // proves the live-PRICING fallback really would give a DIFFERENT answer.
    const withoutSnapshot = { ...withSnapshot, inputRatePerMillion: undefined, outputRatePerMillion: undefined };
    const liveFallbackCost = AiCostReportService.effectiveCost(withoutSnapshot);
    // live rate: (1*2 + 1*10) * 1.5 = 18
    expect(liveFallbackCost).toBeCloseTo(18, 6);

    expect(snapshotBasedCost).not.toBeCloseTo(liveFallbackCost, 6);
  });
});

describe('AiCostReportService.getEntityCostDetail', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns only records matching the given entityId, across sources', async () => {
    mockScanSequence([
      aiItem({ entityId: 'conv_target', source: 'production', costUsd: 0.02 }),
      aiItem({ entityId: 'conv_other', source: 'production', costUsd: 0.5 }),
    ], [
      embedItem({ entityId: 'conv_target', tokens: 500 }),
      embedItem({ entityId: 'conv_other', tokens: 999 }),
    ]);

    const detail = await AiCostReportService.getEntityCostDetail('conv_target');

    expect(detail.aiUsage).toHaveLength(1);
    expect(detail.aiUsage[0].costUsd).toBe(0.02);
    expect(detail.embedUsage).toHaveLength(1);
    expect(detail.embedUsage[0].tokens).toBe(500);
    expect(detail.totals.aiCostUsd).toBe(0.02);
    expect(detail.totals.embedTokens).toBe(500);
  });

  test('throws when entityId is missing', async () => {
    await expect(AiCostReportService.getEntityCostDetail()).rejects.toThrow('entityId is required');
  });

  test('returns zeroed totals, not an error, when nothing matches', async () => {
    mockScanSequence([], []);
    const detail = await AiCostReportService.getEntityCostDetail('conv_nonexistent');
    expect(detail.aiUsage).toEqual([]);
    expect(detail.totals.aiCostUsd).toBe(0);
    expect(detail.totals.aiCalls).toBe(0);
  });
});
