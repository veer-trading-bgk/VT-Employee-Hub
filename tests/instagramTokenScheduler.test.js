'use strict';

/**
 * Tests for InstagramTokenScheduler — the daily-throttled sweep that
 * refreshes Instagram's 60-day long-lived tokens before they expire (no
 * WhatsApp analog). Mirrors LeadScoringScheduler.js's self-throttle-cursor
 * test shape: due/not-due behavior, and the actual refresh-window logic.
 */

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/igGraphApiHelpers', () => ({
  getIgConfig: jest.fn(),
  invalidateIgConfigCache: jest.fn(),
}));

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const igGraphApiHelpers = require('../src/services/igGraphApiHelpers');
const { runDueInstagramTokenRefresh } = require('../src/services/InstagramTokenScheduler');

const CURSOR_KEY = { PK: 'CONFIG#IGTOKENREFRESH#GLOBAL', SK: 'CURRENT' };

function okPromise(v = {}) { return { promise: () => Promise.resolve(v) }; }

describe('InstagramTokenScheduler — self-throttle cursor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  });

  test('no-ops when the last sweep ran under 24 hours ago', async () => {
    dynamodb.get.mockReturnValue(okPromise({ Item: { ...CURSOR_KEY, lastRunAt: new Date().toISOString() } }));

    const result = await runDueInstagramTokenRefresh();

    expect(result).toEqual({ skipped: true });
    expect(dynamodb.scan).not.toHaveBeenCalled();
  });

  test('runs a real sweep when no cursor exists yet (first-ever run)', async () => {
    dynamodb.get.mockReturnValue(okPromise({}));
    dynamodb.scan.mockReturnValue(okPromise({ Items: [] }));
    dynamodb.put.mockReturnValue(okPromise());

    const result = await runDueInstagramTokenRefresh();

    expect(result).toEqual({ checked: 0, refreshedCount: 0, skippedCount: 0, failedCount: 0 });
    expect(dynamodb.scan).toHaveBeenCalledWith(expect.objectContaining({
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
      ExpressionAttributeValues: { ':prefix': 'CONFIG#IG#', ':sk': 'CURRENT' },
    }));
    // Cursor is updated so the next tick (within 24h) no-ops.
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: CURSOR_KEY.PK, SK: CURSOR_KEY.SK }),
    }));
  });

  test('runs again when the last sweep was over 24 hours ago', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    dynamodb.get.mockReturnValue(okPromise({ Item: { ...CURSOR_KEY, lastRunAt: twoDaysAgo } }));
    dynamodb.scan.mockReturnValue(okPromise({ Items: [] }));
    dynamodb.put.mockReturnValue(okPromise());

    const result = await runDueInstagramTokenRefresh();

    expect(result.skipped).toBeUndefined();
    expect(dynamodb.scan).toHaveBeenCalled();
  });
});

describe('InstagramTokenScheduler — refresh-window boundary and behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
    dynamodb.get.mockReturnValue(okPromise({})); // cursor: always due in this block
    dynamodb.put.mockReturnValue(okPromise());
  });

  test('refreshes a token expiring within 7 days, skips one with 30 days of runway', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    dynamodb.scan.mockReturnValue(okPromise({
      Items: [
        { PK: 'CONFIG#IG#acme', SK: 'CURRENT', companyId: 'acme', tokenExpiresAt: soon },
        { PK: 'CONFIG#IG#beta', SK: 'CURRENT', companyId: 'beta', tokenExpiresAt: later },
      ],
    }));
    igGraphApiHelpers.getIgConfig.mockImplementation((companyId) =>
      Promise.resolve({ accessToken: `tok_${companyId}`, igBusinessAccountId: `igba_${companyId}` }));
    axios.get.mockResolvedValue({ data: { access_token: 'new_tok', expires_in: 60 * 24 * 60 * 60 } });
    dynamodb.update.mockReturnValue(okPromise());

    const result = await runDueInstagramTokenRefresh();

    expect(result).toEqual({ checked: 1, refreshedCount: 1, skippedCount: 0, failedCount: 0 });
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][1].params).toEqual({ grant_type: 'ig_refresh_token', access_token: 'tok_acme' });
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'CONFIG#IG#acme', SK: 'CURRENT' },
      UpdateExpression: 'SET accessToken = :t, tokenExpiresAt = :e',
      ExpressionAttributeValues: { ':t': 'new_tok', ':e': expect.any(String) },
    }));
    expect(igGraphApiHelpers.invalidateIgConfigCache).toHaveBeenCalledWith('acme');
  });

  test('a refresh failure for one company logs a warning (not paged) and does not block other companies\' refreshes', async () => {
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    dynamodb.scan.mockReturnValue(okPromise({
      Items: [
        { PK: 'CONFIG#IG#acme', SK: 'CURRENT', companyId: 'acme', tokenExpiresAt: soon },
        { PK: 'CONFIG#IG#beta', SK: 'CURRENT', companyId: 'beta', tokenExpiresAt: soon },
      ],
    }));
    igGraphApiHelpers.getIgConfig.mockImplementation((companyId) =>
      Promise.resolve({ accessToken: `tok_${companyId}`, igBusinessAccountId: `igba_${companyId}` }));
    axios.get
      .mockRejectedValueOnce(new Error('Meta refresh rejected'))
      .mockResolvedValueOnce({ data: { access_token: 'new_tok_beta', expires_in: 60 * 24 * 60 * 60 } });
    dynamodb.update.mockReturnValue(okPromise());

    const result = await runDueInstagramTokenRefresh();

    expect(result).toEqual({ checked: 2, refreshedCount: 1, skippedCount: 0, failedCount: 1 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('acme'));
    expect(logger.error).not.toHaveBeenCalled(); // a token with real days of runway left is not an emergency
  });

  test('a bounded scan pages through LastEvaluatedKey rather than truncating silently', async () => {
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    dynamodb.scan
      .mockReturnValueOnce(okPromise({ Items: [{ PK: 'CONFIG#IG#a', SK: 'CURRENT', companyId: 'a', tokenExpiresAt: soon }], LastEvaluatedKey: { PK: 'x' } }))
      .mockReturnValueOnce(okPromise({ Items: [{ PK: 'CONFIG#IG#b', SK: 'CURRENT', companyId: 'b', tokenExpiresAt: soon }] }));
    igGraphApiHelpers.getIgConfig.mockResolvedValue(null); // config vanished between scan and refresh — treated as skip

    const result = await runDueInstagramTokenRefresh();

    expect(dynamodb.scan).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ checked: 2, refreshedCount: 0, skippedCount: 2, failedCount: 0 });
  });
});
