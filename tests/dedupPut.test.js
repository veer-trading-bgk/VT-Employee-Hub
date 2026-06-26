'use strict';

const { dedupPut } = require('../src/utils/dedupPut');

function makeDynamo(behaviour) {
  return { put: () => ({ promise: behaviour }) };
}

describe('dedupPut', () => {
  const item = { PK: 'LEAD#acme#123', SK: 'MSG#2026-01-01T00:00:00.000Z#wamid1', content: 'hello' };

  test('returns true when item is new (put succeeds)', async () => {
    const db = makeDynamo(() => Promise.resolve());
    expect(await dedupPut(db, 'business_metrics', item)).toBe(true);
  });

  test('returns false on ConditionalCheckFailedException (duplicate webhook)', async () => {
    const err = Object.assign(new Error('Condition failed'), { code: 'ConditionalCheckFailedException' });
    const db = makeDynamo(() => Promise.reject(err));
    expect(await dedupPut(db, 'business_metrics', item)).toBe(false);
  });

  test('throws on unexpected DynamoDB errors (not silently swallowed)', async () => {
    const err = Object.assign(new Error('ProvisionedThroughputExceeded'), { code: 'ProvisionedThroughputExceededException' });
    const db = makeDynamo(() => Promise.reject(err));
    await expect(dedupPut(db, 'business_metrics', item)).rejects.toThrow('ProvisionedThroughputExceeded');
  });

  test('put is called with attribute_not_exists(SK) condition', async () => {
    const putFn = jest.fn(() => ({ promise: () => Promise.resolve() }));
    const db = { put: putFn };
    await dedupPut(db, 'my_table', item);
    expect(putFn).toHaveBeenCalledWith(expect.objectContaining({
      ConditionExpression: 'attribute_not_exists(SK)',
      TableName: 'my_table',
      Item: item,
    }));
  });
});
