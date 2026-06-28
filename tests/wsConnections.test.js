'use strict';

jest.mock('../src/config/dynamodb');
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');

// ── helpers ───────────────────────────────────────────────────────────────────

function mockPromise(result) {
  return { promise: () => Promise.resolve(result) };
}

// ── module under test ─────────────────────────────────────────────────────────
// Re-require after env is set so table() picks up the value.
let saveConnection, deleteConnection, getConnectionsByCompany;
beforeAll(() => {
  process.env.WS_CONNECTIONS_TABLE = 'ws_connections_test';
  ({ saveConnection, deleteConnection, getConnectionsByCompany } = require('../src/utils/wsConnections'));
});

// ── saveConnection ─────────────────────────────────────────────────────────────

describe('saveConnection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('puts item with all required fields and a TTL ~2h from now', async () => {
    dynamodb.put = jest.fn(() => mockPromise({}));
    const before = Math.floor(Date.now() / 1000);

    await saveConnection('conn-1', 'usr-1', 'cmp-1', 'admin');

    expect(dynamodb.put).toHaveBeenCalledTimes(1);
    const { Item, TableName } = dynamodb.put.mock.calls[0][0];
    expect(TableName).toBe('ws_connections_test');
    expect(Item.connectionId).toBe('conn-1');
    expect(Item.userId).toBe('usr-1');
    expect(Item.companyId).toBe('cmp-1');
    expect(Item.role).toBe('admin');
    expect(typeof Item.connectedAt).toBe('string');
    // TTL should be roughly 2 hours ahead
    const expectedTtl = before + 2 * 60 * 60;
    expect(Item.ttl).toBeGreaterThanOrEqual(expectedTtl);
    expect(Item.ttl).toBeLessThan(expectedTtl + 5);
  });

  test('stores SUPERADMIN as companyId when companyId is null', async () => {
    dynamodb.put = jest.fn(() => mockPromise({}));
    await saveConnection('conn-2', 'usr-super', null, 'superadmin');
    const { Item } = dynamodb.put.mock.calls[0][0];
    expect(Item.companyId).toBe('SUPERADMIN');
  });

  test('propagates DynamoDB errors', async () => {
    dynamodb.put = jest.fn(() => ({ promise: () => Promise.reject(new Error('DDB write failed')) }));
    await expect(saveConnection('conn-3', 'u', 'c', 'agent')).rejects.toThrow('DDB write failed');
  });
});

// ── deleteConnection ───────────────────────────────────────────────────────────

describe('deleteConnection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes by connectionId from the correct table', async () => {
    dynamodb.delete = jest.fn(() => mockPromise({}));
    await deleteConnection('conn-abc');
    expect(dynamodb.delete).toHaveBeenCalledWith({
      TableName: 'ws_connections_test',
      Key: { connectionId: 'conn-abc' },
    });
  });
});

// ── getConnectionsByCompany ────────────────────────────────────────────────────

describe('getConnectionsByCompany', () => {
  beforeEach(() => jest.clearAllMocks());

  test('queries the companyIdIndex GSI and returns Items', async () => {
    const items = [
      { connectionId: 'c1', userId: 'u1', role: 'admin' },
      { connectionId: 'c2', userId: 'u2', role: 'agent' },
    ];
    dynamodb.query = jest.fn(() => mockPromise({ Items: items }));

    const result = await getConnectionsByCompany('cmp-x');

    expect(dynamodb.query).toHaveBeenCalledTimes(1);
    const params = dynamodb.query.mock.calls[0][0];
    expect(params.TableName).toBe('ws_connections_test');
    expect(params.IndexName).toBe('companyIdIndex');
    expect(params.ExpressionAttributeValues[':cid']).toBe('cmp-x');
    expect(result).toEqual(items);
  });

  test('returns empty array when DynamoDB returns no Items', async () => {
    dynamodb.query = jest.fn(() => mockPromise({ Items: [] }));
    const result = await getConnectionsByCompany('cmp-empty');
    expect(result).toEqual([]);
  });

  test('returns empty array (and logs warning) when DynamoDB throws', async () => {
    dynamodb.query = jest.fn(() => ({ promise: () => Promise.reject(new Error('GSI error')) }));
    const result = await getConnectionsByCompany('cmp-err');
    expect(result).toEqual([]);
    const logger = require('../src/config/logger');
    expect(logger.warn).toHaveBeenCalled();
  });
});
