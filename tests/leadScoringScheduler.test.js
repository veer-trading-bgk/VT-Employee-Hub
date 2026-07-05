'use strict';

/**
 * LeadScoringScheduler.runDueLeadScoring() — invoked on every 5-minute
 * EventBridge tick (src/handler.js), self-throttled to ~60 minutes via a
 * single global cursor rather than a second EventBridge rule. Uses the real
 * LeadScoringService (a fast, pure, already-unit-tested function) rather
 * than mocking it, so these tests also cover the real integration between
 * the sweep and the formula, not just the sweep's own plumbing.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/PipelineService', () => ({
  getPipelineStages: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const PipelineService = require('../src/services/PipelineService');
const { runDueLeadScoring } = require('../src/services/LeadScoringScheduler');

const STAGES = [
  { key: 'new_lead', label: 'New Lead', color: '#000', order: 0 },
  { key: 'interested', label: 'Interested', color: '#000', order: 1 },
  { key: 'lost', label: 'Lost', color: '#000', order: 2 },
];

function mockCursor(lastRunAt) {
  dynamodb.get.mockReturnValueOnce({ promise: () => Promise.resolve({ Item: lastRunAt ? { lastRunAt } : undefined }) });
}

function mockScanPages(...pages) {
  for (const items of pages) {
    dynamodb.scan.mockReturnValueOnce({ promise: () => Promise.resolve({ Items: items }) });
  }
}

describe('LeadScoringScheduler.runDueLeadScoring — throttle', () => {
  beforeEach(() => jest.clearAllMocks());

  test('skips entirely when no cursor exists yet is treated as due (first-ever run)', async () => {
    mockCursor(undefined);
    mockScanPages([]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await runDueLeadScoring();
    expect(result.skipped).toBeUndefined();
    expect(dynamodb.scan).toHaveBeenCalledTimes(1);
  });

  test('skips (near-free no-op) when less than ~60 minutes have passed since the last run', async () => {
    mockCursor(new Date(Date.now() - 5 * 60_000).toISOString()); // 5 minutes ago

    const result = await runDueLeadScoring();
    expect(result).toEqual({ skipped: true });
    expect(dynamodb.scan).not.toHaveBeenCalled();
  });

  test('runs again once ~60 minutes have passed since the last run', async () => {
    mockCursor(new Date(Date.now() - 61 * 60_000).toISOString());
    mockScanPages([]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await runDueLeadScoring();
    expect(result.skipped).toBeUndefined();
    expect(dynamodb.scan).toHaveBeenCalledTimes(1);
  });

  test('updates the cursor to now after a real sweep runs', async () => {
    mockCursor(undefined);
    mockScanPages([]);
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await runDueLeadScoring();
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: 'CONFIG#LEADSCORING#GLOBAL', SK: 'CURRENT' }),
    }));
  });
});

describe('LeadScoringScheduler.runDueLeadScoring — sweep behavior', () => {
  beforeEach(() => jest.clearAllMocks());

  test('excludes closed leads (lost stage, wonAt set) from scoring', async () => {
    mockCursor(undefined);
    mockScanPages([
      { PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: 'lost' },
      { PK: 'LEAD#acme#2', SK: 'METADATA', companyId: 'acme', stage: 'interested', wonAt: '2026-01-01T00:00:00.000Z' },
      { PK: 'LEAD#acme#3', SK: 'METADATA', companyId: 'acme', stage: 'interested' },
    ]);
    PipelineService.getPipelineStages.mockResolvedValue(STAGES);
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await runDueLeadScoring();

    expect(result.scannedCount).toBe(3);
    expect(result.eligibleCount).toBe(1);
    expect(result.scoredCount).toBe(1);
    expect(dynamodb.update).toHaveBeenCalledTimes(1);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'LEAD#acme#3', SK: 'METADATA' },
    }));
  });

  test('writes priorityScore/priorityTier/priorityScoreBreakdown/priorityScoreUpdatedAt for each open lead', async () => {
    mockCursor(undefined);
    mockScanPages([{ PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: 'interested' }]);
    PipelineService.getPipelineStages.mockResolvedValue(STAGES);
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await runDueLeadScoring();

    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toContain('priorityScore');
    expect(call.UpdateExpression).toContain('priorityTier');
    expect(call.UpdateExpression).toContain('priorityScoreBreakdown');
    expect(call.UpdateExpression).toContain('priorityScoreUpdatedAt');
    expect(typeof call.ExpressionAttributeValues[':ps']).toBe('number');
    expect(['hot', 'warm', 'cold']).toContain(call.ExpressionAttributeValues[':pt']);
  });

  test('fetches a company\'s pipeline once per sweep, not once per lead', async () => {
    mockCursor(undefined);
    mockScanPages([
      { PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: 'interested' },
      { PK: 'LEAD#acme#2', SK: 'METADATA', companyId: 'acme', stage: 'new_lead' },
      { PK: 'LEAD#acme#3', SK: 'METADATA', companyId: 'acme', stage: 'interested' },
    ]);
    PipelineService.getPipelineStages.mockResolvedValue(STAGES);
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await runDueLeadScoring();
    expect(PipelineService.getPipelineStages).toHaveBeenCalledTimes(1);
  });

  test('handles multiple companies, fetching each company\'s own pipeline separately', async () => {
    mockCursor(undefined);
    mockScanPages([
      { PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: 'interested' },
      { PK: 'LEAD#beta#1', SK: 'METADATA', companyId: 'beta', stage: 'interested' },
    ]);
    PipelineService.getPipelineStages.mockResolvedValue(STAGES);
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    await runDueLeadScoring();
    expect(PipelineService.getPipelineStages).toHaveBeenCalledWith('acme');
    expect(PipelineService.getPipelineStages).toHaveBeenCalledWith('beta');
    expect(dynamodb.update).toHaveBeenCalledTimes(2);
  });

  test('one lead failing to update does not stop the rest of the sweep', async () => {
    mockCursor(undefined);
    mockScanPages([
      { PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: 'interested' },
      { PK: 'LEAD#acme#2', SK: 'METADATA', companyId: 'acme', stage: 'interested' },
    ]);
    PipelineService.getPipelineStages.mockResolvedValue(STAGES);
    dynamodb.update
      .mockReturnValueOnce({ promise: () => Promise.reject(new Error('DDB throttled')) })
      .mockReturnValueOnce({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await runDueLeadScoring();
    expect(result.scoredCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });

  test('paginates the scan across multiple pages via ExclusiveStartKey', async () => {
    mockCursor(undefined);
    dynamodb.scan
      .mockReturnValueOnce({ promise: () => Promise.resolve({
        Items: [{ PK: 'LEAD#acme#1', SK: 'METADATA', companyId: 'acme', stage: 'interested' }],
        LastEvaluatedKey: { PK: 'LEAD#acme#1', SK: 'METADATA' },
      }) })
      .mockReturnValueOnce({ promise: () => Promise.resolve({
        Items: [{ PK: 'LEAD#acme#2', SK: 'METADATA', companyId: 'acme', stage: 'interested' }],
      }) });
    PipelineService.getPipelineStages.mockResolvedValue(STAGES);
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await runDueLeadScoring();
    expect(dynamodb.scan).toHaveBeenCalledTimes(2);
    expect(result.scannedCount).toBe(2);
    expect(result.scoredCount).toBe(2);
  });
});
