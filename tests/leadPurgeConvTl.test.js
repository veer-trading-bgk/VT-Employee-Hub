'use strict';

/**
 * Validates the CONV#/TL# purge extension (docs/bible/19_DECISION_LOG.md Era 37,
 * closing the gap flagged in Era 36 / docs/phase3/TECHNICAL_DEBT.md).
 *
 * DELETE /api/crm/leads/:id previously purged only LEAD#/INBOX#/the phone lock,
 * leaving the linked CONV# entity and its TL# timeline (plus the lead's own TL#
 * timeline) behind as orphaned records. This file drives the REAL purge route
 * handler, REAL CustomerIdentityService, REAL ConversationService, and the REAL
 * event publisher/timeline writer (none of these are mocked — only logger,
 * audit, and autoAssign are, to keep the test hermetic) against a single shared
 * in-memory DynamoDB fake, so the TL#/CONV# writes and their subsequent deletion
 * are genuinely exercised end to end.
 */

process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';

jest.mock('../src/config/dynamodb', () => {
  const store = new Map();
  const k = (pk, sk) => `${pk}||${sk}`;

  function condPass(cond, values, existing) {
    if (!cond) return true;
    const c = cond.trim();
    if (c === 'attribute_not_exists(PK)') return !existing;
    const m = c.match(/^(\w+)\s*=\s*:(\w+)$/);
    if (m) {
      const [, attr, valName] = m;
      return !!existing && existing[attr] === values?.[`:${valName}`];
    }
    return true;
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
        items = items.filter((it) => it.PK === vals[':pk']);
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
jest.mock('../src/utils/autoAssign', () => ({
  getAutoAssignConfig: jest.fn().mockResolvedValue(null),
  pickNextEmployee: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

// NOTE: '../src/events/publisher' is deliberately NOT mocked — real TL# writes
// via setImmediate must be flushed with flushImmediate() before asserting.

const dynamodb           = require('../src/config/dynamodb');
const logger             = require('../src/config/logger');
const { logAudit }       = require('../src/utils/audit');
const CIS                = require('../src/services/CustomerIdentityService');
const ConversationService = require('../src/services/ConversationService');
const crmRouter          = require('../src/routes/crm');
const {
  leadPhoneLockPK, leadPhoneLockSK, leadPK,
  conversationPK, tlPK,
} = require('../src/core/entityKeys');
const { ENTITY } = require('../src/events/catalog');

const store = dynamodb.__store;
const k = dynamodb.__k;
const COMPANY = 'viir_trading';
const PHONE = '9901251785';
const lockKey = k(leadPhoneLockPK(COMPANY, PHONE), leadPhoneLockSK());

function flushImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function getPurgeHandler() {
  const layer = crmRouter.stack.find((l) => l.route && l.route.path === '/leads/:id' && l.route.methods.delete);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

async function purgeLead(leadId) {
  const handler = getPurgeHandler();
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await handler({ params: { id: leadId }, user: { companyId: COMPANY, id: 'emp_admin' }, ip: '127.0.0.1' }, res, next);
  return { res, next };
}

function itemsUnderPK(pk) {
  return [...store.values()].filter((it) => it.PK === pk);
}

function leadExistsInStore(leadId) {
  return store.has(k(leadPK(COMPANY, leadId), 'METADATA'));
}

describe('lead purge → CONV#/TL# extension (Era 37)', () => {
  beforeEach(() => { store.clear(); jest.clearAllMocks(); });

  test('purges LEAD#, INBOX#, the phone lock, TL#(LEAD), CONV#, and TL#(CONV) — but leaves TL#(CONTACT) alone', async () => {
    // 1. Real lead creation — also fires a real TOUCH_RECEIVED event onto TL#{cid}#LEAD#{leadId}.
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: PHONE, name: 'Conv Customer', source: 'whatsapp', idempotencyKey: 'k-conv-1' }, { createdBy: 'emp_1' },
    );
    await flushImmediate();
    expect(store.has(lockKey)).toBe(true);
    expect(itemsUnderPK(tlPK(COMPANY, ENTITY.LEAD, created.leadId)).length).toBeGreaterThan(0);

    // 2. Seed a pre-promotion INBOX# shadow item for the same phone.
    const inboxKey = k(`INBOX#${COMPANY}#${PHONE}`, 'CONTACT');
    store.set(inboxKey, { PK: `INBOX#${COMPANY}#${PHONE}`, SK: 'CONTACT', companyId: COMPANY, phone: PHONE });

    // 3. Real conversation creation — fires CONVERSATION_CREATED, fanning out to
    //    TL#{cid}#CONV#{convId} AND TL#{cid}#CONTACT#{contactId} (contact survives purge).
    const CONTACT_ID = 'ctc-test-1';
    const conv = await ConversationService.createConversation(COMPANY, {
      contactId:      CONTACT_ID,
      channel:        'whatsapp',
      channelAddress: '+919901251785',
    }, 'system');
    await flushImmediate();

    // 4. Simulate conversationResolver.js's pointer write (convId + contactId onto LEAD# METADATA) —
    //    the real write path is unit-tested elsewhere; here we only need the resulting shape.
    const leadKey = k(leadPK(COMPANY, created.leadId), 'METADATA');
    store.set(leadKey, { ...store.get(leadKey), convId: conv.conversationId, contactId: CONTACT_ID });

    // ── Pre-purge sanity: everything exists ────────────────────────────────────
    expect(store.has(k(conversationPK(COMPANY, conv.conversationId), 'CONV#META'))).toBe(true);
    const tlConvItemsBefore = itemsUnderPK(tlPK(COMPANY, ENTITY.CONV, conv.conversationId));
    expect(tlConvItemsBefore.length).toBeGreaterThan(0);
    const tlContactItemsBefore = itemsUnderPK(tlPK(COMPANY, ENTITY.CONTACT, CONTACT_ID));
    expect(tlContactItemsBefore.length).toBeGreaterThan(0);
    expect(store.has(inboxKey)).toBe(true);

    // ── Purge ───────────────────────────────────────────────────────────────────
    const { res } = await purgeLead(created.leadId);
    expect(res.json).toHaveBeenCalledWith({ success: true });

    // ── Post-purge: LEAD#/INBOX#/lock (pre-existing behaviour, unmodified) ──────
    expect(leadExistsInStore(created.leadId)).toBe(false);
    expect(store.has(inboxKey)).toBe(false);
    expect(store.has(lockKey)).toBe(false);

    // ── Post-purge: NEW behaviour — CONV#/TL# gone ──────────────────────────────
    expect(store.has(k(conversationPK(COMPANY, conv.conversationId), 'CONV#META'))).toBe(false);
    expect(itemsUnderPK(tlPK(COMPANY, ENTITY.CONV, conv.conversationId)).length).toBe(0);
    expect(itemsUnderPK(tlPK(COMPANY, ENTITY.LEAD, created.leadId)).length).toBe(0);

    // ── Scope check: the Contact's own timeline is NOT touched ──────────────────
    expect(itemsUnderPK(tlPK(COMPANY, ENTITY.CONTACT, CONTACT_ID)).length).toBe(tlContactItemsBefore.length);
  }, 20000);

  test('old-style lead with no convId purges successfully without error (missing-pointer edge case)', async () => {
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: '9000000002', name: 'No Conv Lead', source: 'whatsapp', idempotencyKey: 'k-noconv' }, { createdBy: 'emp_1' },
    );
    await flushImmediate();
    expect(leadExistsInStore(created.leadId)).toBe(true);

    const leadKey = k(leadPK(COMPANY, created.leadId), 'METADATA');
    expect(store.get(leadKey).convId).toBeUndefined();

    const { res, next } = await purgeLead(created.leadId);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(leadExistsInStore(created.leadId)).toBe(false);
    expect(
      logger.info.mock.calls.some((c) => /no convId/i.test(c[0])),
    ).toBe(true);
  }, 20000);

  test('purging a lead with a linked conversation logs the convId it purged', async () => {
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: '9000000003', name: 'Logged Conv Lead', source: 'whatsapp', idempotencyKey: 'k-logconv' }, { createdBy: 'emp_1' },
    );
    await flushImmediate();

    const conv = await ConversationService.createConversation(COMPANY, {
      contactId: 'ctc-test-2', channel: 'whatsapp', channelAddress: '+919000000003',
    }, 'system');
    await flushImmediate();

    const leadKey = k(leadPK(COMPANY, created.leadId), 'METADATA');
    store.set(leadKey, { ...store.get(leadKey), convId: conv.conversationId, contactId: 'ctc-test-2' });

    await purgeLead(created.leadId);

    expect(
      logger.info.mock.calls.some((c) => c[0].includes(conv.conversationId) && /purged linked conversation/i.test(c[0])),
    ).toBe(true);
  }, 20000);

  test('a CONV#/TL# purge failure does not block LEAD# purge, and both the response and the audit record surface the partial failure', async () => {
    const created = await CIS.resolveOrCreate(
      COMPANY, { phone: '9000000004', name: 'Failing Conv Lead', source: 'whatsapp', idempotencyKey: 'k-fail-conv' }, { createdBy: 'emp_1' },
    );
    await flushImmediate();

    const conv = await ConversationService.createConversation(COMPANY, {
      contactId: 'ctc-test-3', channel: 'whatsapp', channelAddress: '+919000000004',
    }, 'system');
    await flushImmediate();

    const leadKey = k(leadPK(COMPANY, created.leadId), 'METADATA');
    store.set(leadKey, { ...store.get(leadKey), convId: conv.conversationId, contactId: 'ctc-test-3' });

    // Force every CONV#/TL# purgePartition query to fail (simulating a transient DDB
    // error), while leaving LEAD#/INBOX# queries — and everything else — untouched.
    const realQuery = dynamodb.query;
    dynamodb.query = jest.fn((params) => {
      const pk = params.ExpressionAttributeValues?.[':pk'];
      if (typeof pk === 'string' && (pk.startsWith('CONV#') || pk.startsWith('TL#'))) {
        return { promise: async () => { throw new Error('Simulated DDB failure'); } };
      }
      return realQuery(params);
    });

    try {
      const { res, next } = await purgeLead(created.leadId);

      // Best-effort CONV#/TL# failure must not block the primary LEAD# purge or 500 the route.
      expect(next).not.toHaveBeenCalled();
      expect(leadExistsInStore(created.leadId)).toBe(false);

      // Nothing was silently deleted despite the simulated failure — the CONV# item survives.
      expect(store.has(k(conversationPK(COMPANY, conv.conversationId), 'CONV#META'))).toBe(true);

      // Response surfaces the partial failure — not identical to a clean purge.
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        warning: expect.stringContaining('partially failed'),
      }));

      // Audit record shows the actual per-partition outcome, not a blanket "success".
      const auditCall = logAudit.mock.calls.find((c) => c[1] === 'crm_lead_purged');
      expect(auditCall).toBeDefined();
      expect(auditCall[5].convTlPurge).toEqual({ tlLead: false, conv: false, tlConv: false });
    } finally {
      dynamodb.query = realQuery;
    }
  }, 20000);
});
