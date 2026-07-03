'use strict';

/**
 * First test coverage for CustomerIdentityService.js (previously zero,
 * despite being one of two ADR-mandated chokepoint services — see
 * docs/bible's audit findings). Written to reproduce a confirmed
 * production incident (2026-07-03, CloudWatch Logs on
 * /aws/lambda/vt-employee-bot-api): POST /api/crm/leads threw a raw,
 * unhandled "Transaction cancelled, please refer cancellation reasons for
 * specific reasons [None, ConditionalCheckFailed, None]" 27 times across
 * the afternoon — the SAME phoneNorm racing itself (multiple concurrent
 * creates for one phone number), correctly detected by the phone-lock
 * ConditionExpression failing (slot 1), but the recovery path's
 * _findByPhone() GSI lookup found no winner even ~2 seconds after the
 * winning transaction committed (DynamoDB GSIs are eventually consistent;
 * the LEAD_PHONE# lock is a base-table write, immediately consistent, so
 * the lock can exist before the GSI catches up).
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), transactWrite: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/events/publisher', () => ({ publishEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/autoAssign', () => ({
  getAutoAssignConfig: jest.fn().mockResolvedValue(null),
  pickNextEmployee: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';

const dynamodb = require('../src/config/dynamodb');
const CIS = require('../src/services/CustomerIdentityService');

function transactionCanceledError(reasons) {
  const err = new Error(
    `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.map((r) => r.Code ?? 'None').join(', ')}]`,
  );
  err.code = 'TransactionCanceledException';
  err.CancellationReasons = reasons;
  return err;
}

const PHONE_LOCK_RACE = [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' }];

describe('CustomerIdentityService.resolveOrCreate — phone-lock race recovery', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reproduces the production bug: GSI lookup finds no winner immediately after the race, and (pre-fix) throws the raw TransactionCanceledException instead of enriching', async () => {
    // No idempotent hit, no existing lead found on the initial GSI lookup
    // (this IS the real customer's first attempt from their point of view).
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) }); // GSI never catches up in this test
    dynamodb.transactWrite.mockReturnValue({ promise: () => Promise.reject(transactionCanceledError(PHONE_LOCK_RACE)) });

    await expect(
      CIS.resolveOrCreate('acme', { phone: '9353266686', name: 'Race Customer', source: 'whatsapp' }, { createdBy: 'emp_1' }),
    ).rejects.toThrow(/Transaction cancelled/);

    // Confirms the retry loop actually ran (not just a single attempt) —
    // 1 initial identity-resolution lookup (resolveOrCreate itself) + 1
    // first race-recovery lookup + up to 4 retries = 6 total calls when
    // the GSI never catches up within the retry budget.
    expect(dynamodb.query).toHaveBeenCalledTimes(6);
  });

  test('fix: when the GSI catches up partway through the retry loop, resolves as enrich instead of throwing', async () => {
    const winnerLead = {
      PK: 'LEAD#acme#winner-lead-id', SK: 'METADATA', leadId: 'winner-lead-id',
      companyId: 'acme', phone: '9353266686', phoneNorm: '9353266686',
      name: '9353266686', tags: [], productInterest: [], leadSourceHistory: [], touchCount: 1,
    };
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) }); // no idempotent hit
    dynamodb.transactWrite.mockImplementation((args) => {
      // _createCustomer's TransactItems always has 3 slots (customer, phone
      // lock, idem lock); _enrichCustomer's has 2 (update, idem lock) — both
      // idem items happen to carry a leadId field, so item count is the
      // reliable way to distinguish the create attempt (races and fails)
      // from the enrich attempt (once the winner is found, succeeds).
      const isCreateAttempt = args.TransactItems.length === 3;
      if (isCreateAttempt) return { promise: () => Promise.reject(transactionCanceledError(PHONE_LOCK_RACE)) };
      return { promise: () => Promise.resolve({}) };
    });

    let queryCalls = 0;
    dynamodb.query.mockImplementation(() => {
      queryCalls++;
      // GSI "catches up" on the 3rd lookup (1 initial + 2 retries) — well
      // within the retry budget this fix adds.
      if (queryCalls >= 3) return { promise: () => Promise.resolve({ Items: [winnerLead] }) };
      return { promise: () => Promise.resolve({ Items: [] }) };
    });

    const result = await CIS.resolveOrCreate(
      'acme', { phone: '9353266686', name: 'Race Customer', source: 'whatsapp' }, { createdBy: 'emp_1' },
    );

    expect(result.existed).toBe(true);
    expect(result.leadId).toBe('winner-lead-id');
    expect(result.action).toBe('enriched');
  });

  test('if the GSI never catches up within the retry budget, still throws (not silently wrong) but only after exhausting retries', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.transactWrite.mockReturnValue({ promise: () => Promise.reject(transactionCanceledError(PHONE_LOCK_RACE)) });

    await expect(
      CIS.resolveOrCreate('acme', { phone: '9999999999', name: 'Unresolvable Race', source: 'whatsapp' }, { createdBy: 'emp_1' }),
    ).rejects.toThrow(/Transaction cancelled/);
    expect(dynamodb.query).toHaveBeenCalledTimes(6); // 1 identity-resolution + 1 first + 4 retries, all exhausted
  });

  test('a genuinely new phone (no race at all) still creates normally — this fix does not change the happy path', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.transactWrite.mockReturnValue({ promise: () => Promise.resolve({}) });

    const result = await CIS.resolveOrCreate(
      'acme', { phone: '9111111111', name: 'Fresh Customer', source: 'whatsapp' }, { createdBy: 'emp_1' },
    );

    expect(result.existed).toBe(false);
    expect(result.action).toBe('created');
    expect(dynamodb.query).toHaveBeenCalledTimes(1); // just the initial identity-resolution lookup, no retry loop entered
  });

  test('idempotent retry (slot 2 failure, not slot 1) is unaffected by this fix — returns cached result immediately, no GSI retry loop', async () => {
    const cachedResult = { leadId: 'cached-lead-id', action: 'created', interactionId: 'int_cached' };
    dynamodb.get.mockImplementation((args) => {
      if (args.Key.PK.startsWith('IDEM#')) return { promise: () => Promise.resolve({ Item: cachedResult }) };
      return { promise: () => Promise.resolve({}) };
    });
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.transactWrite.mockReturnValue({
      promise: () => Promise.reject(transactionCanceledError([{ Code: 'None' }, { Code: 'None' }, { Code: 'ConditionalCheckFailed' }])),
    });

    const result = await CIS.resolveOrCreate(
      'acme', { phone: '9222222222', name: 'Retry Customer', source: 'whatsapp', idempotencyKey: 'webhook-evt-1' }, { createdBy: 'emp_1' },
    );

    expect(result.idempotent).toBe(true);
    expect(result.leadId).toBe('cached-lead-id');
  });
});
