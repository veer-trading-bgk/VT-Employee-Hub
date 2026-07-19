'use strict';

/**
 * Contract tests for igGraphApiHelpers.fetchDisplayName — Instagram DM
 * contact display-name lookup (GET /{igsid}?fields=name). Verified against
 * Meta's live User Profile API docs: `name` (a display name) IS exposed for a
 * DM sender's IGSID; `username` is NOT — the API rejects that field request
 * outright. This is why the field is called "display name," never a
 * @username, and why the fetch always requests `fields=name` only.
 */

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/config/dynamodb', () => ({ get: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const igGraphApiHelpers = require('../src/services/igGraphApiHelpers');

const CID = 'comp_test';
const IGSID = 'ig_17841400000000000';
const VALID_CFG = { accessToken: 'tok_ig', igBusinessAccountId: 'igba_1' };

function mockConfig(cfg) {
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve(cfg ? { Item: cfg } : {}) });
}

describe('igGraphApiHelpers.fetchDisplayName', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requests fields=name (NOT username — Meta rejects that field for a DM sender) with Bearer-equivalent access_token param', async () => {
    mockConfig(VALID_CFG);
    axios.get.mockResolvedValue({ data: { name: 'Yukta' } });

    const name = await igGraphApiHelpers.fetchDisplayName(CID, IGSID);

    expect(name).toBe('Yukta');
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toMatch(new RegExp(`/${IGSID}$`));
    expect(opts.params).toEqual({ fields: 'name', access_token: 'tok_ig' });
  });

  test('returns null (never throws) when Instagram is not connected for this company', async () => {
    mockConfig(null);
    const name = await igGraphApiHelpers.fetchDisplayName(CID, IGSID);
    expect(name).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('returns null (never throws) on a Meta API error — e.g. the user has never messaged the business (consent not met)', async () => {
    mockConfig(VALID_CFG);
    axios.get.mockRejectedValue({ response: { status: 400, data: { error: { message: 'User consent required' } } } });

    const name = await igGraphApiHelpers.fetchDisplayName(CID, IGSID);

    expect(name).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('fetchDisplayName'));
  });

  test('returns null when Meta has no name on file for this user (empty response)', async () => {
    mockConfig(VALID_CFG);
    axios.get.mockResolvedValue({ data: {} });

    const name = await igGraphApiHelpers.fetchDisplayName(CID, IGSID);

    expect(name).toBeNull();
  });
});
