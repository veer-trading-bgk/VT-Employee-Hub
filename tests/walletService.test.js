'use strict';

/**
 * WalletService — a generic, company-scoped prepaid balance ("points"), designed
 * to back ANY future metered feature (AI overage, WhatsApp Calling minutes, etc.),
 * not just AI. Nothing debits from it yet (see AIService — usage is logged, not
 * charged, in this phase); this is the reusable foundation for when real deduction
 * turns on (starting with WhatsApp Calling's per-minute cost).
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(),
  put: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const WalletService = require('../src/services/WalletService');

const CID = 'comp_test';

describe('WalletService.ensureWallet', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a zero-balance wallet with a conditional put (attribute_not_exists)', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    await WalletService.ensureWallet(CID);
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'vt-metrics-test',
      Item: expect.objectContaining({ PK: `WALLET#${CID}`, SK: 'CURRENT', companyId: CID, balancePoints: 0 }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  });

  test('silently no-ops when the wallet already exists (ConditionalCheckFailedException)', async () => {
    const err = new Error('conditional check failed');
    err.code = 'ConditionalCheckFailedException';
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(WalletService.ensureWallet(CID)).resolves.toBeUndefined();
  });

  test('propagates a genuine DynamoDB error (not the conditional-check case)', async () => {
    const err = new Error('DynamoDB unavailable');
    err.code = 'ProvisionedThroughputExceededException';
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(err) });
    await expect(WalletService.ensureWallet(CID)).rejects.toThrow('DynamoDB unavailable');
  });
});

describe('WalletService.getBalance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ensures the wallet exists, then returns its balance', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { balancePoints: 42 } }) });
    expect(await WalletService.getBalance(CID)).toBe(42);
  });

  test('returns 0 when somehow still no item after ensureWallet', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    expect(await WalletService.getBalance(CID)).toBe(0);
  });
});

describe('WalletService.credit', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ADDs points to balancePoints and writes a ledger transaction record', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { balancePoints: 150 } }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await WalletService.credit(CID, 50, { meterType: 'ai', reason: 'manual-topup' });

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `WALLET#${CID}`, SK: 'CURRENT' },
      UpdateExpression: expect.stringContaining('ADD'),
      ExpressionAttributeValues: expect.objectContaining({ ':delta': 50 }),
    }));
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `WALLET#${CID}`,
        type: 'credit',
        amountPoints: 50,
        meterType: 'ai',
        reason: 'manual-topup',
        balanceAfter: 150,
      }),
    }));
    expect(result.balancePoints).toBe(150);
  });

  test('rejects a non-positive amount without touching DynamoDB', async () => {
    await expect(WalletService.credit(CID, 0, { meterType: 'ai', reason: 'x' })).rejects.toThrow(/positive/);
    await expect(WalletService.credit(CID, -5, { meterType: 'ai', reason: 'x' })).rejects.toThrow(/positive/);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});

describe('WalletService.debit', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ADDs a negative delta guarded by a sufficient-balance condition, writes a ledger record', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { balancePoints: 70 } }) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await WalletService.debit(CID, 30, { meterType: 'calling', reason: 'call-minutes', relatedId: 'call_1' });

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `WALLET#${CID}`, SK: 'CURRENT' },
      UpdateExpression: expect.stringContaining('ADD'),
      ConditionExpression: expect.stringContaining('balancePoints'),
      ExpressionAttributeValues: expect.objectContaining({ ':delta': -30 }),
    }));
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        type: 'debit', amountPoints: 30, meterType: 'calling', reason: 'call-minutes', relatedId: 'call_1', balanceAfter: 70,
      }),
    }));
    expect(result.balancePoints).toBe(70);
  });

  test('throws a typed INSUFFICIENT_BALANCE error when the conditional update fails, without writing a ledger record', async () => {
    // dynamodb.put backs both ensureWallet's conditional create AND the ledger
    // write — stub it to succeed so we can isolate "was a *second* (ledger) put
    // ever attempted" from ensureWallet's own legitimate first put call.
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    const err = new Error('conditional check failed');
    err.code = 'ConditionalCheckFailedException';
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(err) });

    await expect(WalletService.debit(CID, 999, { meterType: 'ai', reason: 'x' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(dynamodb.put).toHaveBeenCalledTimes(1); // only ensureWallet's create — no ledger entry
  });

  test('rejects a non-positive amount without touching DynamoDB', async () => {
    await expect(WalletService.debit(CID, 0, { meterType: 'ai', reason: 'x' })).rejects.toThrow(/positive/);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });
});
