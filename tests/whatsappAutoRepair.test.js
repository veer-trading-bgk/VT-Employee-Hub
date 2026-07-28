'use strict';

/**
 * Tests for the 2026-07-28 Meta Health PR 4: Auto Repair orchestrator.
 * graphApiHelpers.autoRepair(cfg) runs computeHealthSnapshot() (the same
 * function GET /connection/health uses, extracted this PR so the two never
 * compute health differently), builds a repair plan from only the checks
 * that are both (a) currently failing and (b) have a known-safe automated
 * fix (subscribeWabaWebhooks, registerPhoneNumber -- both already
 * idempotent/non-destructive from PR 1), executes only those, and re-checks
 * health afterward. Never touches anything already healthy: running it twice
 * on a healthy account makes zero Meta write calls the second time.
 *
 * Same direct-handler-invocation technique as tests/webhookAutoSubscribe.test.js.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const { autoRepair } = require('../src/services/graphApiHelpers');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const CFG = {
  companyId: 'acme', wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: 'token_1',
  connectedAt: '2026-01-01T00:00:00.000Z', setupMethod: 'manual',
};

// Queues the 5 sequential GETs computeHealthSnapshot makes, in order:
// /me (token, no META_APP_ID/SECRET) -> phone (+is_pin_enabled) -> profile
// -> waba -> subscribed_apps.
function queueHealthSnapshotGets({ pinEnabled, webhookSubscribed, wabaAccessible = true, phoneAccessible = true, tokenValid = true }) {
  axios.get.mockResolvedValueOnce(tokenValid ? { data: { id: 'me_1' } } : Promise.reject(new Error('token invalid')));
  if (phoneAccessible) {
    axios.get.mockResolvedValueOnce({ data: { id: 'pid_1', display_phone_number: '+91 90000 00000', is_pin_enabled: pinEnabled } });
    axios.get.mockResolvedValueOnce({ data: { data: [{}] } }); // profile
  } else {
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'not accessible' } } } });
  }
  if (wabaAccessible) {
    axios.get.mockResolvedValueOnce({ data: { id: 'waba_1', name: 'Acme WABA' } });
    axios.get.mockResolvedValueOnce({ data: { data: webhookSubscribed ? [{ id: 'app_1' }] : [] } });
  } else {
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'not accessible' } } } });
  }
}

describe('graphApiHelpers.autoRepair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    dynamodb.update.mockReturnValue(resolved({}));
  });

  test('completely healthy account: repairPlan empty, nothing executed but the profile-refresh entry, everything reported already_healthy, zero writes', async () => {
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // before
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // after

    const result = await autoRepair(CFG);

    expect(result.repairPlan).toEqual([]);
    expect(result.executed).toEqual([
      { action: 'refresh_profile', label: 'Refresh business profile', status: 'fixed', detail: 'Profile data refreshed from Meta.', durationMs: 0 },
    ]);
    expect(result.skipped.filter((s) => s.reason === 'already_healthy').map((s) => s.action).sort())
      .toEqual(['mediaUpload', 'messaging', 'phone', 'pin', 'templates', 'token', 'waba', 'webhooks'].sort());
    expect(result.remainingIssues).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
    expect(result.summary).toEqual({ fixed: 1, failed: 0, alreadyHealthy: 8, otherSkipped: 0 });
  });

  test('missing webhook only: repairs it, reports fixed, after-snapshot reflects the fix', async () => {
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: false }); // before
    axios.post.mockResolvedValueOnce({ data: {} }); // subscribeWabaWebhooks
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // after

    const result = await autoRepair(CFG);

    expect(result.repairPlan).toEqual([{ action: 'webhooks', label: 'Subscribe webhook' }]);
    expect(result.executed).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'webhooks', status: 'fixed' }),
    ]));
    expect(result.after.webhooks.subscribed).toBe(true);
    expect(result.remainingIssues).toEqual([]);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('missing PIN / registration only: repairs it via registerPhoneNumber, reports fixed', async () => {
    queueHealthSnapshotGets({ pinEnabled: false, webhookSubscribed: true }); // before
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } }); // registerPhoneNumber's own re-check
    axios.post.mockResolvedValueOnce({ data: { success: true } }); // /register
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // after

    const result = await autoRepair(CFG);

    expect(result.repairPlan).toEqual([{ action: 'pin', label: 'Register Cloud API & enable PIN' }]);
    const pinResult = result.executed.find((e) => e.action === 'pin');
    expect(pinResult.status).toBe('fixed');
    expect(result.after.pin.enabled).toBe(true);
    expect(result.remainingIssues).toEqual([]);
  });

  test('invalid token: reflected in remainingIssues, no repair attempted for it (no fix action exists), no crash', async () => {
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true, tokenValid: false }); // before
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true, tokenValid: false }); // after

    const result = await autoRepair(CFG);

    expect(result.success).toBe(true);
    expect(result.remainingIssues.some((i) => i.toLowerCase().includes('token'))).toBe(true);
    expect(result.skipped.find((s) => s.action === 'token')).toBeUndefined(); // not healthy, so not marked already_healthy
    expect(result.repairPlan.some((p) => p.action === 'token')).toBe(false); // no repair action exists for a bad token
  });

  test('partial failure: webhook subscribe fails, PIN registration succeeds -- both reported distinctly', async () => {
    queueHealthSnapshotGets({ pinEnabled: false, webhookSubscribed: false }); // before
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'Webhook subscribe rejected' } } } }); // subscribeWabaWebhooks fails
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } }); // registerPhoneNumber's re-check
    axios.post.mockResolvedValueOnce({ data: { success: true } }); // /register succeeds
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: false }); // after -- webhook still broken

    const result = await autoRepair(CFG);

    const webhookResult = result.executed.find((e) => e.action === 'webhooks');
    const pinResult = result.executed.find((e) => e.action === 'pin');
    expect(webhookResult.status).toBe('failed');
    expect(pinResult.status).toBe('fixed');
    expect(result.remainingIssues.length).toBeGreaterThan(0); // webhook issue still present in `after`
    expect(result.summary).toEqual(expect.objectContaining({ fixed: 2, failed: 1 })); // pin + refresh_profile fixed, webhook failed
  });

  test('idempotency: running twice on an already-healthy account makes zero additional Meta write calls the second time', async () => {
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // run 1: before
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // run 1: after
    await autoRepair(CFG);
    expect(axios.post).not.toHaveBeenCalled();

    jest.clearAllMocks();
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // run 2: before
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true }); // run 2: after
    const result2 = await autoRepair(CFG);

    expect(result2.repairPlan).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled(); // still zero -- no repeated register/subscribe calls
  });

  test('no WABA configured at all: returns gracefully, no Meta calls, no crash', async () => {
    const result = await autoRepair(null);

    expect(result.success).toBe(true);
    expect(result.before.connected).toBe(false);
    expect(result.repairPlan).toEqual([]);
    expect(result.executed).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('never logs the access token or the generated PIN during a repair run', async () => {
    queueHealthSnapshotGets({ pinEnabled: false, webhookSubscribed: false });
    axios.post.mockResolvedValueOnce({ data: {} });
    axios.get.mockResolvedValueOnce({ data: { is_pin_enabled: false } });
    axios.post.mockResolvedValueOnce({ data: { success: true } });
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true });

    await autoRepair(CFG);

    for (const fn of [logger.info, logger.warn, logger.error]) {
      for (const call of fn.mock.calls) {
        for (const arg of call) {
          const str = typeof arg === 'string' ? arg : JSON.stringify(arg);
          expect(str).not.toContain(CFG.accessToken);
          expect(str).not.toMatch(/\b\d{6}\b/); // no bare 6-digit PIN
        }
      }
    }
  });
});

describe('POST /api/whatsapp/repair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    dynamodb.update.mockReturnValue(resolved({}));
  });

  test('no WhatsApp config: 400, no Meta call', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: null }));
    const handler = getRouteHandler(whatsappRouter, '/repair', 'post');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('healthy account: returns the full repair report shape with zero repairs executed', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true });
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true });

    const handler = getRouteHandler(whatsappRouter, '/repair', 'post');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body).toEqual(expect.objectContaining({
      success: true, repairPlan: [], remainingIssues: [],
    }));
    expect(body.before).toBeDefined();
    expect(body.after).toBeDefined();
    expect(typeof body.durationMs).toBe('number');
  });
});

describe('GET /api/whatsapp/connection/health — regression after the autoRepair refactor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
  });

  test('existing customers: health check response shape is unchanged', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
    queueHealthSnapshotGets({ pinEnabled: true, webhookSubscribed: true });

    const handler = getRouteHandler(whatsappRouter, '/connection/health', 'get');
    const res = mockRes();
    await handler({ user: { companyId: 'acme' } }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body).toEqual(expect.objectContaining({
      success: true, connected: true, config: expect.any(Object), token: expect.any(Object),
      waba: expect.any(Object), phone: expect.any(Object), webhooks: expect.any(Object),
      pin: expect.any(Object), profile: expect.any(Object), capabilities: expect.any(Object),
      issues: [], rootCause: null, recommendedFix: [],
    }));
  });
});
