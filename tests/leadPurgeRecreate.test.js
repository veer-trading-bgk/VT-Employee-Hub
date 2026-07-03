'use strict';

/**
 * Reproduces the production incident of 2026-07-03 (CloudWatch on
 * /aws/lambda/vt-employee-bot-api): after an admin hard-purges a lead
 * (DELETE /api/crm/leads/:id → audit `crm_lead_purged`), every subsequent
 * POST /api/crm/leads for the SAME phone throws a raw
 * "Transaction cancelled … [None, ConditionalCheckFailed, None]" 500 —
 * NOT because of GSI eventual-consistency lag (the earlier, wrong diagnosis
 * behind commit 6d6028f), but because the purge deleted the LEAD# METADATA
 * while leaving the LEAD_PHONE#${companyId}#${phoneNorm} uniqueness lock
 * behind. The orphaned lock blocks every future create for that number, and
 * the race-recovery path can never find a "winner" because the lead was
 * purged — so it exhausts its retries and re-throws.
 *
 * These tests drive the REAL purge route handler and the REAL
 * CustomerIdentityService against a single shared in-memory DynamoDB fake
 * (condition-expression aware, so the phone-lock TransactWrite behaves like
 * production). They encode the DESIRED post-fix behaviour and are expected
 * to FAIL against the pre-fix code (verified before the fix was written).
 *
 * Fix #1  — purge also deletes the LEAD_PHONE# lock (crm.js DELETE handler).
 * Fix #2  — CIS reclaims a permanently-orphaned lock instead of throwing.
 * Fix #1b — CIS ignores a stale IDEM# lock that points at a purged lead.
 */

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';

jest.mock('../src/config/dynamodb', () => {
  const store = new Map();
  const k = (pk, sk) => `${pk}||${sk}`;

  // Evaluate the (small, fixed) set of ConditionExpressions this code uses.
  function condPass(cond, values, existing) {
    if (!cond) return true;
    const c = cond.trim();
    if (c === 'attribute_not_exists(PK)') return !existing;
    const m = c.match(/^(\w+)\s*=\s*:(\w+)$/); // e.g. "leadId = :stale"
    if (m) {
      const [, attr, valName] = m;
      return !!existing && existing[attr] === values?.[`:${valName}`];
    }
    return true; // unknown expressions default to pass (none used in these tests)
  }

  return {
    __store: store,
    __k: k,
    get: (params) => ({ promise: async () => {
      const item = store.get(k(params.Key.PK, params.Key.SK));
      return item ? { Item: { ...item } } : {};
    } }),
    put: (params) => ({ promise: async () => { store.set(k(params.Item.PK, params.Item.SK), { ...params.Item }); return {}; } }),
    delete: (params) => ({ promise: async () => { store.delete(k(params.Key.PK, params.Key.SK)); return {}; } }),
    update: () => ({ promise: async () => ({ Attributes: {} }) }),
    scan: () => ({ promise: async () => ({ Items: [...store.values()].map((it) => ({ ...it })) }) }),
    query: (params) => ({ promise: async () => {
      const vals = params.ExpressionAttributeValues || {};
      let items = [...store.values()];
      if (params.IndexName === 'company-phone-index') {
        items = items.filter((it) => it.companyId === vals[':cid'] && it.phoneNorm === vals[':norm']);
      } else if (params.IndexName === 'leadsByCompany') {
        items = items.filter((it) => it.companyId === vals[':cid']);
      } else {
        items = items.filter((it) => it.PK === vals[':pk']); // base-table PK = :pk
      }
      const fe = params.FilterExpression || '';
      if (fe.includes('SK = :meta')) items = items.filter((it) => it.SK === vals[':meta']);
      if (fe.includes('attribute_not_exists(deletedAt)')) items = items.filter((it) => it.deletedAt == null);
      if (params.Limit) items = items.slice(0, params.Limit);
      return { Items: items.map((it) => ({ ...it })) };
    } }),
    batchWrite: (params) => ({ promise: async () => {
      const reqItems = params.RequestItems || {};
      for (const table of Object.keys(reqItems)) {
        for (const r of reqItems[table]) {
          if (r.DeleteRequest) store.delete(k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          if (r.PutRequest) store.set(k(r.PutRequest.Item.PK, r.PutRequest.Item.SK), { ...r.PutRequest.Item });
        }
      }
      return {};
    } }),
    transactWrite: (params) => ({ promise: async () => {
      const items = params.TransactItems || [];
      const reasons = items.map((ti) => {
        if (!ti.Put) return { Code: 'None' };
        const existing = store.get(k(ti.Put.Item.PK, ti.Put.Item.SK));
        return condPass(ti.Put.ConditionExpression, ti.Put.ExpressionAttributeValues, existing)
          ? { Code: 'None' } : { Code: 'ConditionalCheckFailed' };
      });
      if (reasons.some((r) => r.Code === 'ConditionalCheckFailed')) {
        const err = new Error(
          `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.map((r) => r.Code).join(', ')}]`,
        );
        err.code = 'TransactionCanceledException';
        err.CancellationReasons = reasons;
        throw err;
      }
      for (const ti of items) {
        if (ti.Put) store.set(k(ti.Put.Item.PK, ti.Put.Item.SK), { ...ti.Put.Item });
        if (ti.Delete) store.delete(k(ti.Delete.Key.PK, ti.Delete.Key.SK));
      }
      return {};
    } }),
  };
});

jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/events/publisher', () => ({ publishEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/utils/autoAssign', () => ({
  getAutoAssignConfig: jest.fn().mockResolvedValue(null),
  pickNextEmployee: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const dynamodb = require('../src/config/dynamodb');
const CIS = require('../src/services/CustomerIdentityService');
const crmRouter = require('../src/routes/crm');
const { leadPhoneLockPK, leadPhoneLockSK, leadPK } = require('../src/core/entityKeys');

const store = dynamodb.__store;
const k = dynamodb.__k;
const COMPANY = 'viir_trading';
const PHONE = '9901251785';
const lockKey = k(leadPhoneLockPK(COMPANY, PHONE), leadPhoneLockSK());

function getPurgeHandler() {
  const layer = crmRouter.stack.find((l) => l.route && l.route.path === '/leads/:id' && l.route.methods.delete);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle; // final handler, after auth/checkRole/rateLimit
}

async function purgeLead(leadId) {
  const handler = getPurgeHandler();
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await handler({ params: { id: leadId }, user: { companyId: COMPANY, id: 'emp_admin' }, ip: '127.0.0.1' }, res, jest.fn());
  return res;
}

function leadExistsInStore(leadId) {
  return store.has(k(leadPK(COMPANY, leadId), 'METADATA'));
}

describe('lead purge → recreate cycle (production incident 2026-07-03)', () => {
  beforeEach(() => { store.clear(); jest.clearAllMocks(); });

  test('FULL CYCLE: create → purge → recreate the same phone succeeds with a fresh, real lead', async () => {
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Race Customer', source: 'whatsapp', idempotencyKey: 'k-seed' }, { createdBy: 'emp_1' },
    );
    expect(created.action).toBe('created');
    expect(store.has(lockKey)).toBe(true);

    await purgeLead(created.leadId);

    // Recreate with a distinct idem key (production failures were ~56 min
    // later — a different 5-min bucket — so they skipped the idem fast path).
    const recreated = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Race Customer Again', source: 'whatsapp', idempotencyKey: 'k-recreate' }, { createdBy: 'emp_1' },
    );

    expect(recreated.action).toBe('created');
    expect(recreated.existed).toBe(false);
    expect(recreated.leadId).not.toBe(created.leadId);
    expect(leadExistsInStore(recreated.leadId)).toBe(true);
  }, 20000);

  test('FIX #1: purge deletes the LEAD_PHONE# uniqueness lock, not just LEAD#/INBOX# records', async () => {
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Lock Owner', source: 'whatsapp', idempotencyKey: 'k1' }, { createdBy: 'emp_1' },
    );
    expect(store.has(lockKey)).toBe(true);

    await purgeLead(created.leadId);

    expect(leadExistsInStore(created.leadId)).toBe(false); // METADATA gone (already worked)
    expect(store.has(lockKey)).toBe(false);                // lock gone (the fix)
  }, 20000);

  test('FIX #2: CIS reclaims a pre-existing orphaned lock (lock present, referenced lead purged) instead of throwing', async () => {
    // Simulate an orphan left by a purge that happened BEFORE fix #1 shipped:
    // a LEAD_PHONE# lock whose referenced leadId has no METADATA item.
    store.set(lockKey, {
      PK: leadPhoneLockPK(COMPANY, PHONE), SK: leadPhoneLockSK(),
      leadId: 'ghost-lead-id', companyId: COMPANY, createdAt: '2026-07-03T11:45:56.936Z',
    });

    const res = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Reclaimer', source: 'whatsapp', idempotencyKey: 'k-reclaim' }, { createdBy: 'emp_1' },
    );

    expect(res.action).toBe('created');
    expect(res.existed).toBe(false);
    expect(res.leadId).not.toBe('ghost-lead-id');
    expect(leadExistsInStore(res.leadId)).toBe(true);
    // The lock must now point at the reclaiming lead, not the ghost.
    expect(store.get(lockKey).leadId).toBe(res.leadId);
  }, 20000);

  test('FIX #1b: a stale IDEM# lock pointing at a purged lead is ignored, not returned as a dangling id', async () => {
    // Same idem key on create and recreate (same 5-min bucket, same source) —
    // the narrow window where a purge orphans an idem lock too.
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Idem Owner', source: 'whatsapp', idempotencyKey: 'k-same' }, { createdBy: 'emp_1' },
    );
    await purgeLead(created.leadId);

    const recreated = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Idem Owner Again', source: 'whatsapp', idempotencyKey: 'k-same' }, { createdBy: 'emp_1' },
    );

    // Must NOT hand back the purged leadId via the idempotency cache.
    expect(recreated.leadId).not.toBe(created.leadId);
    expect(leadExistsInStore(recreated.leadId)).toBe(true);
  }, 20000);

  test('a genuinely fresh phone (no lock, no lead) still creates normally', async () => {
    const res = await CIS.resolveOrCreate(
      COMPANY, { phone: '9000000001', name: 'Brand New', source: 'whatsapp', idempotencyKey: 'k-fresh' }, { createdBy: 'emp_1' },
    );
    expect(res.action).toBe('created');
    expect(leadExistsInStore(res.leadId)).toBe(true);
  });
});
