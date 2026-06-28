'use strict';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), alert: jest.fn(),
}));

// Mock wsConnections so we control what connections are returned without DDB
jest.mock('../src/utils/wsConnections', () => ({
  getConnectionsByCompany: jest.fn(),
  deleteConnection: jest.fn().mockResolvedValue(undefined),
  saveConnection: jest.fn(),
}));

// Mock wsApiClient so we never make real API GW calls
const mockPostToConnection = jest.fn();
jest.mock('../src/config/wsApiClient', () => ({
  getWsApiClient: () => ({
    postToConnection: (params) => ({ promise: () => mockPostToConnection(params) }),
  }),
  resetWsApiClient: jest.fn(),
}));

const { getConnectionsByCompany, deleteConnection } = require('../src/utils/wsConnections');
const { notifyCompany } = require('../src/utils/wsNotify');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WS_ENDPOINT = 'https://fake.execute-api.ap-south-1.amazonaws.com/prod';
});

afterEach(() => {
  delete process.env.WS_ENDPOINT;
});

// ── notifyCompany — guard clauses ─────────────────────────────────────────────

describe('notifyCompany — guard clauses', () => {
  test('is a no-op when WS_ENDPOINT is not set', async () => {
    delete process.env.WS_ENDPOINT;
    await notifyCompany('cmp-1', { event: 'test' });
    expect(getConnectionsByCompany).not.toHaveBeenCalled();
    expect(mockPostToConnection).not.toHaveBeenCalled();
  });

  test('is a no-op when companyId is falsy', async () => {
    await notifyCompany(null, { event: 'test' });
    expect(getConnectionsByCompany).not.toHaveBeenCalled();
  });

  test('is a no-op when there are no active connections', async () => {
    getConnectionsByCompany.mockResolvedValue([]);
    await notifyCompany('cmp-1', { event: 'test' });
    expect(mockPostToConnection).not.toHaveBeenCalled();
  });
});

// ── notifyCompany — happy path ────────────────────────────────────────────────

describe('notifyCompany — happy path', () => {
  test('posts the JSON payload to every connection for the company', async () => {
    getConnectionsByCompany.mockResolvedValue([
      { connectionId: 'conn-a', userId: 'u1', role: 'admin' },
      { connectionId: 'conn-b', userId: 'u2', role: 'agent' },
    ]);
    mockPostToConnection.mockResolvedValue({});

    await notifyCompany('cmp-1', { event: 'metric_added', value: 3 });

    expect(mockPostToConnection).toHaveBeenCalledTimes(2);
    const sentData = mockPostToConnection.mock.calls.map((c) => JSON.parse(c[0].Data));
    expect(sentData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'metric_added', value: 3 }),
      ])
    );
    const connectionIds = mockPostToConnection.mock.calls.map((c) => c[0].ConnectionId);
    expect(connectionIds).toContain('conn-a');
    expect(connectionIds).toContain('conn-b');
  });

  test('scopes the GSI query to the correct companyId', async () => {
    getConnectionsByCompany.mockResolvedValue([]);
    await notifyCompany('cmp-xyz', { event: 'test' });
    expect(getConnectionsByCompany).toHaveBeenCalledWith('cmp-xyz');
  });
});

// ── notifyCompany — stale connection cleanup ──────────────────────────────────

describe('notifyCompany — 410 Gone handling', () => {
  test('deletes stale connection when API GW returns 410', async () => {
    getConnectionsByCompany.mockResolvedValue([
      { connectionId: 'conn-stale', userId: 'u1', role: 'agent' },
    ]);
    const err = new Error('Gone');
    err.statusCode = 410;
    mockPostToConnection.mockRejectedValue(err);

    await notifyCompany('cmp-1', { event: 'test' });

    expect(deleteConnection).toHaveBeenCalledWith('conn-stale');
  });

  test('logs warning but does not delete on non-410 errors', async () => {
    getConnectionsByCompany.mockResolvedValue([
      { connectionId: 'conn-flaky', userId: 'u1', role: 'agent' },
    ]);
    const err = new Error('Service Unavailable');
    err.statusCode = 503;
    mockPostToConnection.mockRejectedValue(err);

    await notifyCompany('cmp-1', { event: 'test' });

    expect(deleteConnection).not.toHaveBeenCalled();
    const logger = require('../src/config/logger');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('continues sending to remaining connections after one fails', async () => {
    getConnectionsByCompany.mockResolvedValue([
      { connectionId: 'conn-bad',  userId: 'u1', role: 'agent' },
      { connectionId: 'conn-good', userId: 'u2', role: 'agent' },
    ]);
    mockPostToConnection
      .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))
      .mockResolvedValueOnce({});

    await notifyCompany('cmp-1', { event: 'test' });

    expect(mockPostToConnection).toHaveBeenCalledTimes(2);
    expect(deleteConnection).toHaveBeenCalledWith('conn-bad');
  });
});

// ── notifyCompany — resilience ────────────────────────────────────────────────

describe('notifyCompany — never throws', () => {
  test('resolves even when getConnectionsByCompany rejects', async () => {
    // wsConnections.getConnectionsByCompany already swallows errors and returns []
    // so notifyCompany sees an empty array and exits silently.
    getConnectionsByCompany.mockResolvedValue([]);
    await expect(notifyCompany('cmp-1', { event: 'test' })).resolves.toBeUndefined();
  });
});
