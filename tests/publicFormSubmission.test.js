'use strict';

/**
 * POST /api/public/form-submission — the public, API-key-authenticated
 * endpoint (spec §8). Tested by invoking the exported [apiKeyRateLimit, handler]
 * array's handler directly (index 1), skipping the rate-limit middleware, the
 * same direct-handler technique the inbound-webhook test uses. Auth (apiKeyAuth)
 * is app-mounted, so req.company is stubbed here as it would be post-auth.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/CustomerIdentityService', () => ({ resolveOrCreate: jest.fn() }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(true) }));
// The route lazy-requires ./automations for runAutomations — mock it.
jest.mock('../src/routes/automations', () => ({ runAutomations: jest.fn().mockResolvedValue(undefined) }));

const dynamodb = require('../src/config/dynamodb');
const CIS = require('../src/services/CustomerIdentityService');
const { runAutomations } = require('../src/routes/automations');
const publicRouter = require('../src/routes/public');

// The route is registered as router.post('/form-submission', apiKeyRateLimit(...), handler).
// Pull the handler (last layer) off the router stack.
const layer = publicRouter.stack.find((l) => l.route && l.route.path === '/form-submission');
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const CID = 'comp_9';

function ok(value) { return { promise: () => Promise.resolve(value) }; }
function fail(err) { return { promise: () => Promise.reject(err) }; }
function conditionalFail() { const e = new Error('conditional'); e.code = 'ConditionalCheckFailedException'; return e; }

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}
function mockReq(body = {}, overrides = {}) {
  return { headers: {}, ip: '9.9.9.9', company: { companyId: CID }, apiKeyId: 'k1', body, ...overrides };
}

const validBody = () => ({
  phone: '+919876543210',
  name: 'Ramesh Kumar',
  event: 'form_submitted',
  tags: ['landing-page-lead'],
  traits: { product_interest: 'demat_account', city: 'Hubli' },
  idempotencyKey: 'form-abc-123',
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
});

describe('POST /api/public/form-submission', () => {
  test('happy path: claims idempotency, resolves via CIS (source api), fires form_submitted with traits, 200', async () => {
    dynamodb.put.mockReturnValue(ok({}));      // idempotency claim
    CIS.resolveOrCreate.mockResolvedValue({
      existed: false, leadId: 'ld_1', action: 'created',
      lead: { leadId: 'ld_1', PK: `LEAD#${CID}#ld_1`, name: 'Ramesh Kumar', stage: 'new', tags: ['landing-page-lead'], assignedTo: null },
    });
    dynamodb.update.mockReturnValue(ok({}));   // complete-mark
    const res = mockRes();

    await handler(mockReq(validBody()), res, jest.fn());

    // companyId came from req.company, phone normalized to 10 digits, source 'api'
    expect(CIS.resolveOrCreate).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({
        phone: '9876543210', name: 'Ramesh Kumar', source: 'api',
        tags: ['landing-page-lead'],
        metadata: { formTraits: { product_interest: 'demat_account', city: 'Hubli' } },
        idempotencyKey: 'form-abc-123',
      }),
      { createdBy: 'api' },
    );
    expect(runAutomations).toHaveBeenCalledWith(
      CID, 'form_submitted',
      expect.objectContaining({ leadId: 'ld_1', phone: '9876543210', source: 'api', traits: { product_interest: 'demat_account', city: 'Hubli' } }),
    );
    // claim was written with attribute_not_exists + a 24h ttl, then completed
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: expect.objectContaining({ PK: `IDEMP#${CID}`, SK: 'form-abc-123', status: 'processing' }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, leadId: 'ld_1', triggered: true });
  });

  test('companyId in the body is rejected by .strict() (ZodError → 400) — never honored', async () => {
    const res = mockRes(); const next = jest.fn();
    // ZodError is funneled to next() → the global errorHandler renders the 400.
    await handler(mockReq({ ...validBody(), companyId: 'other_company' }), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('unknown extra field rejected by .strict() (ZodError → 400)', async () => {
    const res = mockRes(); const next = jest.fn();
    await handler(mockReq({ ...validBody(), sneaky: true }), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
  });

  test('duplicate idempotencyKey → 409, no CIS call, no trigger', async () => {
    dynamodb.put.mockReturnValue(fail(conditionalFail()));
    const res = mockRes();

    await handler(mockReq(validBody()), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(CIS.resolveOrCreate).not.toHaveBeenCalled();
    expect(runAutomations).not.toHaveBeenCalled();
  });

  test('malformed phone → 400, before claiming idempotency', async () => {
    const res = mockRes();
    await handler(mockReq({ ...validBody(), phone: '12345' }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('413 when Content-Length exceeds the payload guard, before any work', async () => {
    const res = mockRes();
    await handler(mockReq(validBody(), { headers: { 'content-length': '999999' } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(413);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('a returning lead is NOT rejected — CIS enriches, trigger still fires, 200', async () => {
    dynamodb.put.mockReturnValue(ok({}));
    CIS.resolveOrCreate.mockResolvedValue({ existed: true, leadId: 'ld_2', action: 'enriched' }); // no result.lead
    dynamodb.get.mockReturnValue(ok({ Item: { leadId: 'ld_2', name: 'Existing', stage: 'interested', tags: ['vip'], assignedTo: 'emp_3' } }));
    dynamodb.update.mockReturnValue(ok({}));
    const res = mockRes();

    await handler(mockReq(validBody()), res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(runAutomations).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, leadId: 'ld_2', triggered: true });
  });

  test('CIS failure releases the idempotency claim (retryable) and surfaces as an error', async () => {
    dynamodb.put.mockReturnValue(ok({}));
    dynamodb.delete.mockReturnValue(ok({}));
    CIS.resolveOrCreate.mockRejectedValue(new Error('CIS down'));
    const res = mockRes(); const next = jest.fn();

    await handler(mockReq(validBody()), res, next);

    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `IDEMP#${CID}`, SK: 'form-abc-123' },
    }));
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('an automation failure is non-fatal — still 200, triggered:false, claim NOT released', async () => {
    dynamodb.put.mockReturnValue(ok({}));
    dynamodb.update.mockReturnValue(ok({}));
    CIS.resolveOrCreate.mockResolvedValue({ existed: false, leadId: 'ld_5', action: 'created', lead: { leadId: 'ld_5', PK: `LEAD#${CID}#ld_5`, name: 'X' } });
    runAutomations.mockRejectedValueOnce(new Error('template send failed'));
    const res = mockRes();

    await handler(mockReq(validBody()), res, jest.fn());

    expect(dynamodb.delete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, leadId: 'ld_5', triggered: false });
  });

  test('traits omitted → CIS called without metadata, trigger gets empty traits', async () => {
    dynamodb.put.mockReturnValue(ok({}));
    dynamodb.update.mockReturnValue(ok({}));
    CIS.resolveOrCreate.mockResolvedValue({ existed: false, leadId: 'ld_6', action: 'created', lead: { leadId: 'ld_6', PK: `LEAD#${CID}#ld_6`, name: 'Y' } });
    const res = mockRes();
    const body = { phone: '9876543210', name: 'Y', idempotencyKey: 'k-6' };

    await handler(mockReq(body), res, jest.fn());

    const cisArg = CIS.resolveOrCreate.mock.calls[0][1];
    expect(cisArg).not.toHaveProperty('metadata');
    expect(runAutomations).toHaveBeenCalledWith(CID, 'form_submitted', expect.objectContaining({ traits: {} }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // This is the race the claim-first design exists to close: two submissions
  // with the SAME idempotencyKey arriving together (double-click / retry). The
  // atomic conditional PUT is modelled here with a stateful mock — the first
  // claim for a key succeeds, any concurrent claim for the same key rejects with
  // ConditionalCheckFailedException (exactly DynamoDB's behavior). The assertion
  // is the guarantee: exactly ONE request reaches CIS and the trigger, the other
  // is 409'd before any side effect. (Two sequential awaited calls would NOT
  // exercise this — the point is that both are in flight at once.)
  test('CONCURRENT double-submit with the same idempotencyKey: exactly one reaches CIS/trigger, the other 409s', async () => {
    const claimed = new Set();
    dynamodb.put.mockImplementation((params) => ({
      promise: () => {
        const sk = params?.Item?.SK;
        if (claimed.has(sk)) return Promise.reject(conditionalFail());
        claimed.add(sk); // first writer for this key wins the claim
        return Promise.resolve({});
      },
    }));
    dynamodb.update.mockReturnValue(ok({}));
    // CIS resolves on a later microtask so both handlers are genuinely in flight
    // past the claim before either completes.
    CIS.resolveOrCreate.mockImplementation(() => Promise.resolve({
      existed: false, leadId: 'ld_race', action: 'created',
      lead: { leadId: 'ld_race', PK: `LEAD#${CID}#ld_race`, name: 'Ramesh Kumar', stage: 'new', tags: [], assignedTo: null },
    }));

    const resA = mockRes();
    const resB = mockRes();
    await Promise.all([
      handler(mockReq(validBody()), resA, jest.fn()),
      handler(mockReq(validBody()), resB, jest.fn()),
    ]);

    // Exactly one side effect each — the winner only.
    expect(CIS.resolveOrCreate).toHaveBeenCalledTimes(1);
    expect(runAutomations).toHaveBeenCalledTimes(1);

    // One 200 (winner), one 409 (loser) — regardless of which handler won.
    const statuses = [resA, resB].flatMap((r) => r.status.mock.calls.map((c) => c[0]));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);
  });
});
