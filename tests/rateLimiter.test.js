'use strict';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), alert: jest.fn(),
}));

// Build a controllable DynamoDB mock before requiring the module under test
const mockUpdate = jest.fn();
const mockGet    = jest.fn();
const mockDelete = jest.fn();

jest.mock('../src/config/dynamodb', () => ({
  update: (...a) => ({ promise: () => mockUpdate(...a) }),
  get:    (...a) => ({ promise: () => mockGet(...a) }),
  delete: (...a) => ({ promise: () => mockDelete(...a) }),
}));

process.env.DYNAMODB_TABLE_AUDIT = 'audit_logs';

const { loginRateLimiter, atomicIncrement, getCount } = require('../src/middleware/rateLimiter');

describe('loginRateLimiter', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isBlocked returns false when count < limit', async () => {
    mockGet.mockResolvedValue({ Item: { count: 3 } });
    expect(await loginRateLimiter.isBlocked('user@test.com')).toBe(false);
  });

  test('isBlocked returns true when count >= 10', async () => {
    mockGet.mockResolvedValue({ Item: { count: 10 } });
    expect(await loginRateLimiter.isBlocked('user@test.com')).toBe(true);
  });

  test('isBlocked returns false when no record exists', async () => {
    mockGet.mockResolvedValue({});
    expect(await loginRateLimiter.isBlocked('new@test.com')).toBe(false);
  });

  test('recordFail increments counter and returns new count', async () => {
    mockUpdate.mockResolvedValue({ Attributes: { count: 4 } });
    const count = await loginRateLimiter.recordFail('user@test.com');
    expect(count).toBe(4);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      UpdateExpression: expect.stringContaining('ADD'),
    }));
  });

  test('recordFail at limit (10) still returns count without throwing', async () => {
    mockUpdate.mockResolvedValue({ Attributes: { count: 10 } });
    const count = await loginRateLimiter.recordFail('user@test.com');
    expect(count).toBe(10);
  });

  test('reset deletes the rate-limit record', async () => {
    mockDelete.mockResolvedValue({});
    await loginRateLimiter.reset('user@test.com');
    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'audit_logs',
      Key: expect.objectContaining({ PK: expect.stringContaining('login_limit#user@test.com') }),
    }));
  });

  test('DynamoDB failure in isBlocked → fail open (not blocked)', async () => {
    mockGet.mockRejectedValue(new Error('DynamoDB unavailable'));
    expect(await loginRateLimiter.isBlocked('user@test.com')).toBe(false);
  });

  test('DynamoDB failure in recordFail → returns 0 (fail open)', async () => {
    mockUpdate.mockRejectedValue(new Error('DynamoDB unavailable'));
    const count = await loginRateLimiter.recordFail('user@test.com');
    expect(count).toBe(0);
  });
});

// atomicIncrement/getCount are exported directly (not just via the loginRateLimiter/
// rateLimit closures) so AIService can key its own per-company/per-useCase counters
// (rate limit + monthly quota) off the exact same primitive, instead of reinventing
// atomic-counter DynamoDB semantics a second time.
describe('atomicIncrement / getCount — reusable primitives', () => {
  beforeEach(() => jest.clearAllMocks());

  test('atomicIncrement ADDs 1 and sets a TTL only if not already present', async () => {
    mockUpdate.mockResolvedValue({ Attributes: { count: 7 } });
    const count = await atomicIncrement('ai_ratelimit#comp_1#metrics-insights', 'window#1000', 60_000);
    expect(count).toBe(7);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'audit_logs',
      Key: { PK: 'ai_ratelimit#comp_1#metrics-insights', SK: 'window#1000' },
      UpdateExpression: expect.stringContaining('ADD'),
    }));
  });

  test('atomicIncrement fails open (returns 0) on a DynamoDB error', async () => {
    mockUpdate.mockRejectedValue(new Error('DynamoDB unavailable'));
    const count = await atomicIncrement('ai_quota#comp_1', 'month#2026-07', 2_592_000_000);
    expect(count).toBe(0);
  });

  test('getCount returns 0 when no record exists', async () => {
    mockGet.mockResolvedValue({});
    expect(await getCount('ai_quota#comp_1', 'month#2026-07')).toBe(0);
  });

  test('getCount returns the stored count', async () => {
    mockGet.mockResolvedValue({ Item: { count: 301 } });
    expect(await getCount('ai_quota#comp_1', 'month#2026-07')).toBe(301);
  });
});
