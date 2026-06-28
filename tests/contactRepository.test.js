'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/dynamodb', () => ({
  get:          jest.fn(),
  put:          jest.fn(),
  update:       jest.fn(),
  query:        jest.fn(),
  transactWrite: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');

// ─── Module under test ────────────────────────────────────────────────────────

const repo = require('../src/repositories/ContactRepository');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID  = 'comp_test';
const CTID = 'contact_01ABCDEFGHJKMNPQRST';
const PHONE = '+919876543210';

const CONTACT_ITEM = {
  PK:               `CONTACT#${CID}#${CTID}`,
  SK:               'CONTACT#META',
  contactId:        CTID,
  companyId:        CID,
  phoneE164:        PHONE,
  displayName:      'Test User',
  contactCompanyPK: `CONTACT#${CID}`,
  version:          1,
  createdAt:        '2026-06-28T00:00:00.000Z',
  updatedAt:        '2026-06-28T00:00:00.000Z',
  createdBy:        'system',
  updatedBy:        'system',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
});

afterEach(() => {
  delete process.env.DYNAMODB_TABLE_METRICS;
});

// ─── getById ──────────────────────────────────────────────────────────────────

describe('getById()', () => {
  test('returns the contact item when found', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: CONTACT_ITEM }) });
    const result = await repo.getById(CID, CTID);
    expect(result).toEqual(CONTACT_ITEM);
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'vt-metrics-test',
      Key: { PK: `CONTACT#${CID}#${CTID}`, SK: 'CONTACT#META' },
    }));
  });

  test('returns null when item not found', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    expect(await repo.getById(CID, CTID)).toBeNull();
  });

  test('propagates DynamoDB errors', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('DDB error')) });
    await expect(repo.getById(CID, CTID)).rejects.toThrow('DDB error');
  });
});

// ─── queryByPhone ─────────────────────────────────────────────────────────────

describe('queryByPhone()', () => {
  test('returns the first matching non-deleted contact', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [CONTACT_ITEM] }) });
    const result = await repo.queryByPhone(CID, PHONE);
    expect(result).toEqual(CONTACT_ITEM);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      IndexName:                 'ContactPhoneIndex',
      KeyConditionExpression:    'phoneE164 = :phone AND companyId = :cid',
      ExpressionAttributeValues: { ':phone': PHONE, ':cid': CID },
      Limit:                     1,
    }));
  });

  test('returns null when no match', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    expect(await repo.queryByPhone(CID, PHONE)).toBeNull();
  });

  test('uses attribute_not_exists(deletedAt) filter', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByPhone(CID, PHONE);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      FilterExpression: 'attribute_not_exists(deletedAt)',
    }));
  });
});

// ─── queryByCompany ───────────────────────────────────────────────────────────

describe('queryByCompany()', () => {
  const ITEMS = [CONTACT_ITEM, { ...CONTACT_ITEM, contactId: 'contact_2' }];

  test('returns items and null lastKey when no more pages', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: ITEMS }) });
    const result = await repo.queryByCompany(CID);
    expect(result.items).toEqual(ITEMS);
    expect(result.lastKey).toBeNull();
  });

  test('returns lastKey when more pages exist', async () => {
    const cursor = { PK: 'CONTACT#comp_test#contact_2', SK: 'CONTACT#META' };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: ITEMS, LastEvaluatedKey: cursor }) });
    const result = await repo.queryByCompany(CID, { limit: 2 });
    expect(result.lastKey).toEqual(cursor);
  });

  test('uses ContactsByCompany GSI with newest-first ordering', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      IndexName:        'ContactsByCompany',
      ScanIndexForward: false,
    }));
  });

  test('caps limit at 100', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID, { limit: 999 });
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({ Limit: 100 }));
  });

  test('passes ExclusiveStartKey when lastKey is provided', async () => {
    const cursor = { PK: 'CONTACT#comp_test#x', SK: 'CONTACT#META' };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID, { lastKey: cursor });
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({ ExclusiveStartKey: cursor }));
  });
});

// ─── transactCreate ───────────────────────────────────────────────────────────

describe('transactCreate()', () => {
  const phoneLockItem = { PK: `PHONE#${CID}#${PHONE}`, SK: 'LOCK', contactId: CTID };

  test('calls transactWrite with two Put items', async () => {
    dynamodb.transactWrite.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.transactCreate(CONTACT_ITEM, phoneLockItem);
    const call = dynamodb.transactWrite.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(2);
    expect(call.TransactItems[0].Put.Item).toEqual(phoneLockItem);
    expect(call.TransactItems[1].Put.Item).toEqual(CONTACT_ITEM);
  });

  test('both items use attribute_not_exists(PK) condition', async () => {
    dynamodb.transactWrite.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.transactCreate(CONTACT_ITEM, phoneLockItem);
    const items = dynamodb.transactWrite.mock.calls[0][0].TransactItems;
    for (const { Put } of items) {
      expect(Put.ConditionExpression).toBe('attribute_not_exists(PK)');
    }
  });

  test('propagates TransactionCanceledException (caller handles duplicate)', async () => {
    const err = Object.assign(new Error('tx cancelled'), { code: 'TransactionCanceledException' });
    dynamodb.transactWrite.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(repo.transactCreate(CONTACT_ITEM, phoneLockItem)).rejects.toMatchObject({
      code: 'TransactionCanceledException',
    });
  });
});

// ─── updateItem ───────────────────────────────────────────────────────────────

describe('updateItem()', () => {
  const patch   = { updatedAt: '2026-06-29T00:00:00.000Z', updatedBy: 'emp1', version: 2 };
  const updated = { ...CONTACT_ITEM, ...patch };

  test('returns the updated item (ALL_NEW)', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    const result = await repo.updateItem(CID, CTID, patch, 1);
    expect(result).toEqual(updated);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ReturnValues: 'ALL_NEW',
    }));
  });

  test('uses optimistic locking condition', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    await repo.updateItem(CID, CTID, patch, 1);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ConditionExpression).toContain('#cv = :cv');
    expect(call.ExpressionAttributeValues[':cv']).toBe(1);
  });

  test('SET expression includes all patch fields', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    await repo.updateItem(CID, CTID, patch, 1);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toContain('SET');
    // version, updatedAt, updatedBy should appear
    expect(call.UpdateExpression).toMatch(/#f_version\s*=\s*:f_version/);
  });

  test('handles _removeAttrs from restoreMeta — adds REMOVE clause', async () => {
    const restorePatch = { updatedAt: '2026-06-29T00:00:00.000Z', updatedBy: 'emp1', version: 3,
      _removeAttrs: ['deletedAt', 'deletedBy'] };
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    await repo.updateItem(CID, CTID, restorePatch, 2);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toContain('REMOVE');
    expect(call.UpdateExpression).toMatch(/#r_deletedAt/);
    expect(call.UpdateExpression).toMatch(/#r_deletedBy/);
  });

  test('propagates ConditionalCheckFailedException on version conflict', async () => {
    const err = Object.assign(new Error('condition failed'), { code: 'ConditionalCheckFailedException' });
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(repo.updateItem(CID, CTID, patch, 1)).rejects.toMatchObject({
      code: 'ConditionalCheckFailedException',
    });
  });
});
