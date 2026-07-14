'use strict';

/**
 * ApiKeyService — generation, verification (timing-safe), listing, revocation.
 * Covers spec §5.1 / §7: raw key returned once and never stored, SHA-256 hash
 * at rest, O(1) lookup-item resolution, timing-safe compare, revocation.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), update: jest.fn(),
  delete: jest.fn(), transactWrite: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';

const crypto   = require('crypto');
const dynamodb = require('../src/config/dynamodb');
const ApiKeyService = require('../src/services/ApiKeyService');

const CID = 'comp_test';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function ok(value) { return { promise: () => Promise.resolve(value) }; }

describe('ApiKeyService.generate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('mints an apf_live_ key, stores only its SHA-256 hash, and returns the raw key once', async () => {
    dynamodb.transactWrite.mockReturnValue(ok({}));

    const result = await ApiKeyService.generate(CID, 'Landing page — Insta funnel', 'emp_1');

    // Raw key returned to the caller, correct shape.
    expect(result.rawKey).toMatch(/^apf_live_[0-9a-f]{64}$/);
    expect(result.keyPrefix).toBe(result.rawKey.slice(0, 13));
    expect(result.name).toBe('Landing page — Insta funnel');

    // Two items written atomically: main record + lookup item.
    const args = dynamodb.transactWrite.mock.calls[0][0];
    expect(args.TransactItems).toHaveLength(2);
    const main   = args.TransactItems[0].Put.Item;
    const lookup = args.TransactItems[1].Put.Item;

    // The stored hash equals SHA-256 of the raw key — and the raw key itself is NOT stored.
    expect(main.keyHash).toBe(sha256(result.rawKey));
    expect(main).not.toHaveProperty('rawKey');
    expect(JSON.stringify(main)).not.toContain(result.rawKey);
    expect(main.PK).toBe(`CONFIG#APIKEY#${CID}`);
    expect(main.SK).toBe(`KEY#${result.keyId}`);
    expect(main.status).toBe('active');
    expect(main.lastUsedAt).toBeNull();

    // Lookup item is keyed by the hash and resolves back to {companyId, keyId}.
    expect(lookup.PK).toBe(`CONFIG#APIKEY#LOOKUP#${sha256(result.rawKey)}`);
    expect(lookup.SK).toBe('LOOKUP');
    expect(lookup.companyId).toBe(CID);
    expect(lookup.keyId).toBe(result.keyId);
    expect(lookup.status).toBe('active');
  });

  test('two generated keys are distinct', async () => {
    dynamodb.transactWrite.mockReturnValue(ok({}));
    const a = await ApiKeyService.generate(CID, 'A', 'emp_1');
    const b = await ApiKeyService.generate(CID, 'B', 'emp_1');
    expect(a.rawKey).not.toBe(b.rawKey);
    expect(a.keyId).not.toBe(b.keyId);
  });

  test('throws when companyId is missing', async () => {
    await expect(ApiKeyService.generate(null, 'x', 'emp_1')).rejects.toThrow(/companyId/);
  });
});

describe('ApiKeyService.verify', () => {
  beforeEach(() => jest.clearAllMocks());

  const RAW = 'apf_live_' + 'a'.repeat(64);
  const HASH = sha256(RAW);

  test('a valid, active key resolves to the correct company (timing-safe)', async () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    dynamodb.get
      .mockReturnValueOnce(ok({ Item: { companyId: CID, keyId: 'k1', status: 'active' } }))   // lookup
      .mockReturnValueOnce(ok({ Item: { keyHash: HASH, status: 'active' } }));                // main record
    dynamodb.update.mockReturnValue(ok({}));

    const resolved = await ApiKeyService.verify(RAW);

    expect(resolved).toEqual({ companyId: CID, keyId: 'k1' });
    // Confirms the secret comparison is timing-safe, not a plain === .
    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0];
    expect(Buffer.isBuffer(a)).toBe(true);
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(a.length).toBe(b.length);
    spy.mockRestore();
  });

  test('records lastUsedAt on a successful verify (fire-and-forget)', async () => {
    dynamodb.get
      .mockReturnValueOnce(ok({ Item: { companyId: CID, keyId: 'k1', status: 'active' } }))
      .mockReturnValueOnce(ok({ Item: { keyHash: HASH, status: 'active' } }));
    dynamodb.update.mockReturnValue(ok({}));

    await ApiKeyService.verify(RAW);

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      UpdateExpression: expect.stringContaining('lastUsedAt'),
    }));
  });

  test('returns null for a malformed key (wrong prefix) without hitting DynamoDB', async () => {
    expect(await ApiKeyService.verify('sk_live_whatever')).toBeNull();
    expect(await ApiKeyService.verify(undefined)).toBeNull();
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test('returns null when the key is unknown (no lookup item)', async () => {
    dynamodb.get.mockReturnValueOnce(ok({}));   // lookup miss
    expect(await ApiKeyService.verify(RAW)).toBeNull();
    expect(dynamodb.get).toHaveBeenCalledTimes(1); // never reads the main record
  });

  test('returns null for a revoked key (lookup item flipped to revoked)', async () => {
    dynamodb.get.mockReturnValueOnce(ok({ Item: { companyId: CID, keyId: 'k1', status: 'revoked' } }));
    expect(await ApiKeyService.verify(RAW)).toBeNull();
    expect(dynamodb.get).toHaveBeenCalledTimes(1);
  });

  test('returns null when the main record is revoked even if the lookup still says active', async () => {
    dynamodb.get
      .mockReturnValueOnce(ok({ Item: { companyId: CID, keyId: 'k1', status: 'active' } }))
      .mockReturnValueOnce(ok({ Item: { keyHash: HASH, status: 'revoked' } }));
    expect(await ApiKeyService.verify(RAW)).toBeNull();
  });

  test('returns null when the stored hash does not match (no early-exit — timing-safe compare fails closed)', async () => {
    dynamodb.get
      .mockReturnValueOnce(ok({ Item: { companyId: CID, keyId: 'k1', status: 'active' } }))
      .mockReturnValueOnce(ok({ Item: { keyHash: sha256('apf_live_' + 'b'.repeat(64)), status: 'active' } }));
    expect(await ApiKeyService.verify(RAW)).toBeNull();
  });

  test('fails closed (null) on a DynamoDB error — never authenticates on error', async () => {
    dynamodb.get.mockReturnValueOnce({ promise: () => Promise.reject(new Error('DynamoDB down')) });
    expect(await ApiKeyService.verify(RAW)).toBeNull();
  });
});

describe('ApiKeyService.list', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns sanitized entries and never leaks keyHash', async () => {
    dynamodb.query.mockReturnValue(ok({
      Items: [
        { keyId: 'k1', keyPrefix: 'apf_live_aaaa', name: 'One', keyHash: 'SECRET', createdAt: '2026-07-14T01:00:00Z', lastUsedAt: null, status: 'active', createdBy: 'emp_1' },
        { keyId: 'k2', keyPrefix: 'apf_live_bbbb', name: 'Two', keyHash: 'SECRET', createdAt: '2026-07-14T02:00:00Z', lastUsedAt: '2026-07-14T03:00:00Z', status: 'revoked', createdBy: 'emp_1' },
      ],
    }));

    const keys = await ApiKeyService.list(CID);

    expect(keys).toHaveLength(2);
    expect(keys[0].keyId).toBe('k2'); // newest first
    keys.forEach((k) => expect(k).not.toHaveProperty('keyHash'));
    expect(keys[1]).toEqual(expect.objectContaining({ keyPrefix: 'apf_live_aaaa', name: 'One', status: 'active' }));
  });
});

describe('ApiKeyService.revoke', () => {
  beforeEach(() => jest.clearAllMocks());

  test('flips status to revoked on BOTH the main record and its lookup item', async () => {
    dynamodb.get.mockReturnValue(ok({ Item: { keyId: 'k1', keyHash: 'HASHVAL', status: 'active' } }));
    dynamodb.transactWrite.mockReturnValue(ok({}));

    const result = await ApiKeyService.revoke(CID, 'k1');

    expect(result).toBe(true);
    const items = dynamodb.transactWrite.mock.calls[0][0].TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Update.Key).toEqual({ PK: `CONFIG#APIKEY#${CID}`, SK: 'KEY#k1' });
    expect(items[1].Update.Key).toEqual({ PK: 'CONFIG#APIKEY#LOOKUP#HASHVAL', SK: 'LOOKUP' });
    items.forEach((i) => expect(i.Update.ExpressionAttributeValues[':revoked']).toBe('revoked'));
  });

  test('returns false (no write) when the key does not exist', async () => {
    dynamodb.get.mockReturnValue(ok({}));
    expect(await ApiKeyService.revoke(CID, 'missing')).toBe(false);
    expect(dynamodb.transactWrite).not.toHaveBeenCalled();
  });
});
