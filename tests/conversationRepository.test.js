'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/dynamodb', () => ({
  get:    jest.fn(),
  put:    jest.fn(),
  update: jest.fn(),
  query:  jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const repo     = require('../src/repositories/ConversationRepository');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID   = 'comp_test';
const CVID  = 'conv_01ABCDEFGHJKMNPQRST';
const CTID  = 'contact_01ABCDEFGHJKMNPQRST';

const CONV_ITEM = {
  PK:             `CONV#${CID}#${CVID}`,
  SK:             'CONV#META',
  conversationId: CVID,
  companyId:      CID,
  contactId:      CTID,
  channel:        'whatsapp',
  channelAddress: '+919876543210',
  status:         'open',
  assignedTo:     null,
  assignedToName: null,
  lastActivityAt: '2026-06-28T00:00:00.000Z',
  unreadCount:    0,
  convCompanyPK:  `CONV#${CID}`,
  convContactPK:  `CONV_CONTACT#${CID}#${CTID}`,
  version:        1,
  createdAt:      '2026-06-28T00:00:00.000Z',
  updatedAt:      '2026-06-28T00:00:00.000Z',
  createdBy:      'system',
  updatedBy:      'system',
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
  test('returns item when found', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: CONV_ITEM }) });
    expect(await repo.getById(CID, CVID)).toEqual(CONV_ITEM);
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `CONV#${CID}#${CVID}`, SK: 'CONV#META' },
    }));
  });

  test('returns null when not found', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    expect(await repo.getById(CID, CVID)).toBeNull();
  });

  test('propagates DynamoDB errors', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('ddb error')) });
    await expect(repo.getById(CID, CVID)).rejects.toThrow('ddb error');
  });
});

// ─── queryByContact ───────────────────────────────────────────────────────────

describe('queryByContact()', () => {
  test('queries ConvByContact GSI with correct partition key', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [CONV_ITEM] }) });
    const result = await repo.queryByContact(CID, CTID);
    expect(result.items).toEqual([CONV_ITEM]);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      IndexName:                 'ConvByContact',
      KeyConditionExpression:    'convContactPK = :pk',
      ExpressionAttributeValues: { ':pk': `CONV_CONTACT#${CID}#${CTID}` },
    }));
  });

  test('excludes soft-deleted items via filter', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByContact(CID, CTID);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      FilterExpression: 'attribute_not_exists(deletedAt)',
    }));
  });

  test('returns lastKey from pagination', async () => {
    const cursor = { PK: `CONV#${CID}#x`, SK: 'CONV#META' };
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [], LastEvaluatedKey: cursor }) });
    const result = await repo.queryByContact(CID, CTID);
    expect(result.lastKey).toEqual(cursor);
  });

  test('uses ScanIndexForward: false (newest first)', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByContact(CID, CTID);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({ ScanIndexForward: false }));
  });
});

// ─── queryByCompany ───────────────────────────────────────────────────────────

describe('queryByCompany()', () => {
  test('queries ConvByCompany GSI with correct partition key', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID);
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      IndexName:              'ConvByCompany',
      ExpressionAttributeValues: expect.objectContaining({ ':pk': `CONV#${CID}` }),
    }));
  });

  test('adds status filter with ExpressionAttributeNames alias (reserved word)', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID, { status: 'open' });
    const call = dynamodb.query.mock.calls[0][0];
    expect(call.FilterExpression).toContain('#convStatus = :status');
    expect(call.ExpressionAttributeNames['#convStatus']).toBe('status');
    expect(call.ExpressionAttributeValues[':status']).toBe('open');
  });

  test('adds assignedTo filter without ExpressionAttributeNames', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID, { assignedTo: 'emp_abc' });
    const call = dynamodb.query.mock.calls[0][0];
    expect(call.FilterExpression).toContain('assignedTo = :assignedTo');
    expect(call.ExpressionAttributeValues[':assignedTo']).toBe('emp_abc');
  });

  test('does not pass ExpressionAttributeNames when no reserved-word fields are filtered', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID, { assignedTo: 'emp_abc' }); // no status filter
    const call = dynamodb.query.mock.calls[0][0];
    expect(call.ExpressionAttributeNames).toBeUndefined();
  });

  test('caps limit at 100', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    await repo.queryByCompany(CID, { limit: 500 });
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({ Limit: 100 }));
  });
});

// ─── putConversation ──────────────────────────────────────────────────────────

describe('putConversation()', () => {
  test('puts item with attribute_not_exists(PK) guard', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.putConversation(CONV_ITEM);
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item:                CONV_ITEM,
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  });

  test('propagates ConditionalCheckFailedException', async () => {
    const err = Object.assign(new Error('dup'), { code: 'ConditionalCheckFailedException' });
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(repo.putConversation(CONV_ITEM)).rejects.toMatchObject({
      code: 'ConditionalCheckFailedException',
    });
  });
});

// ─── updateItem ───────────────────────────────────────────────────────────────

describe('updateItem()', () => {
  const patch   = { status: 'resolved', updatedAt: '2026-06-29T00:00:00.000Z', updatedBy: 'emp1', version: 2 };
  const updated = { ...CONV_ITEM, ...patch };

  test('returns updated item (ALL_NEW)', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    expect(await repo.updateItem(CID, CVID, patch, 1)).toEqual(updated);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({ ReturnValues: 'ALL_NEW' }));
  });

  test('uses optimistic locking with version condition', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    await repo.updateItem(CID, CVID, patch, 1);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ConditionExpression).toContain('#cv = :cv');
    expect(call.ExpressionAttributeValues[':cv']).toBe(1);
  });

  test('handles _removeAttrs — REMOVE clause added to UpdateExpression', async () => {
    const restorePatch = { ...patch, _removeAttrs: ['deletedAt', 'deletedBy'] };
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: updated }) });
    await repo.updateItem(CID, CVID, restorePatch, 1);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toContain('REMOVE');
    expect(call.UpdateExpression).toMatch(/#r_deletedAt/);
  });

  test('propagates ConditionalCheckFailedException', async () => {
    const err = Object.assign(new Error('conflict'), { code: 'ConditionalCheckFailedException' });
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(repo.updateItem(CID, CVID, patch, 1)).rejects.toMatchObject({
      code: 'ConditionalCheckFailedException',
    });
  });
});

// ─── incrementUnread ──────────────────────────────────────────────────────────

describe('incrementUnread()', () => {
  test('uses SET with if_not_exists pattern and delta of 1', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.incrementUnread(CID, CVID);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toContain('if_not_exists(unreadCount');
    expect(call.ExpressionAttributeValues[':delta']).toBe(1);
  });

  test('accepts custom delta', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.incrementUnread(CID, CVID, 5);
    expect(dynamodb.update.mock.calls[0][0].ExpressionAttributeValues[':delta']).toBe(5);
  });

  test('also updates lastActivityAt', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.incrementUnread(CID, CVID);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toContain('lastActivityAt');
    expect(call.ExpressionAttributeValues[':now']).toBeDefined();
  });

  test('has NO ConditionExpression — atomic, no version lock', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.incrementUnread(CID, CVID);
    expect(dynamodb.update.mock.calls[0][0].ConditionExpression).toBeUndefined();
  });
});

// ─── updateLastMessage ────────────────────────────────────────────────────────

describe('updateLastMessage()', () => {
  const fields = {
    lastMessageAt:   '2026-06-28T12:00:00.000Z',
    lastMessageText: 'Hello',
    lastActivityAt:  '2026-06-28T12:00:00.000Z',
    updatedAt:       '2026-06-28T12:00:00.000Z',
  };

  test('writes all four display fields', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.updateLastMessage(CID, CVID, fields);
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.ExpressionAttributeValues[':lat']).toBe(fields.lastMessageAt);
    expect(call.ExpressionAttributeValues[':txt']).toBe(fields.lastMessageText);
    expect(call.ExpressionAttributeValues[':laa']).toBe(fields.lastActivityAt);
    expect(call.ExpressionAttributeValues[':ua']).toBe(fields.updatedAt);
  });

  test('has NO ConditionExpression — best-effort, no version lock', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    await repo.updateLastMessage(CID, CVID, fields);
    expect(dynamodb.update.mock.calls[0][0].ConditionExpression).toBeUndefined();
  });
});
