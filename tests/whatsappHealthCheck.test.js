'use strict';

/**
 * Tests for the 2026-07-28 Meta Health PR 2: consolidated health check +
 * business profile read. Adds `pin` (is_pin_enabled + stored pinRegisteredAt)
 * and `profile` (WhatsApp Business Profile: about/address/description/email/
 * websites/vertical/profile picture) to GET /connection/health, and closes a
 * gap found while building this: computeRootCause/computeRecommendedFix never
 * referenced webhooks.subscribed or pin.enabled at all, so the UI's root-cause
 * banner stayed silently empty whenever one of those was the only failing
 * check.
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
const { getBusinessProfile } = require('../src/services/graphApiHelpers');
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

const USER = { id: 'emp_1', role: 'admin', companyId: 'acme' };
const HEALTHY_CFG = {
  wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: 'token_1', phoneNumber: '+91 90000 00000',
  setupMethod: 'manual', pinRegisteredAt: '2026-07-28T10:00:00.000Z',
};

describe('graphApiHelpers.getBusinessProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  test('maps a full profile response (data[0], not a flat object)', async () => {
    axios.get.mockResolvedValueOnce({
      data: { data: [{ about: 'Trusted trading partner', email: 'support@example.com', websites: ['https://example.com/'], vertical: 'FINANCE', profile_picture_url: 'https://x.com/pic.jpg' }] },
    });

    const result = await getBusinessProfile({ phoneNumberId: 'pid_1', accessToken: 'token_1' });

    expect(result).toEqual({
      accessible: true, about: 'Trusted trading partner', address: null, description: null,
      email: 'support@example.com', profilePictureUrl: 'https://x.com/pic.jpg',
      websites: ['https://example.com/'], vertical: 'FINANCE',
    });
  });

  test('fields Meta has never had set are absent from the response, not null -- all default cleanly', async () => {
    axios.get.mockResolvedValueOnce({ data: { data: [{ messaging_product: 'whatsapp' }] } });

    const result = await getBusinessProfile({ phoneNumberId: 'pid_1', accessToken: 'token_1' });

    expect(result).toEqual({
      accessible: true, about: null, address: null, description: null, email: null,
      profilePictureUrl: null, websites: [], vertical: null,
    });
  });

  test('a Meta failure returns accessible:false with an error, never throws', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'Invalid parameter' } } } });

    const result = await getBusinessProfile({ phoneNumberId: 'pid_1', accessToken: 'token_1' });

    expect(result.accessible).toBe(false);
    expect(result.error).toBe('Invalid parameter');
  });
});

describe('GET /api/whatsapp/connection/health — pin + profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
  });

  function mockHealthySequence({ pinEnabled, webhookSubscribed, profileData }) {
    dynamodb.get.mockReturnValue(resolved({ Item: HEALTHY_CFG }));
    axios.get
      .mockResolvedValueOnce({ data: { id: 'me_1' } }) // token check (/me fallback, no META_APP_ID/SECRET)
      .mockResolvedValueOnce({ data: { id: 'pid_1', display_phone_number: '+91 90000 00000', is_pin_enabled: pinEnabled } }) // phone check
      .mockResolvedValueOnce({ data: { data: [profileData ?? {}] } }) // profile pull
      .mockResolvedValueOnce({ data: { id: 'waba_1', name: 'Acme WABA' } }) // waba check
      .mockResolvedValueOnce({ data: { data: webhookSubscribed ? [{ id: 'app_1' }] : [] } }); // webhook subscription check
  }

  test('everything healthy: pin.enabled true, profile fields mapped, rootCause null', async () => {
    mockHealthySequence({ pinEnabled: true, webhookSubscribed: true, profileData: { email: 'support@example.com', vertical: 'FINANCE' } });

    const handler = getRouteHandler(whatsappRouter, '/connection/health', 'get');
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.pin).toEqual({ enabled: true, registeredAt: HEALTHY_CFG.pinRegisteredAt });
    expect(body.profile).toEqual(expect.objectContaining({ accessible: true, email: 'support@example.com', vertical: 'FINANCE' }));
    expect(body.rootCause).toBeNull();
  });

  test('only webhooks failing: rootCause and recommendedFix reference it (previously silently empty)', async () => {
    mockHealthySequence({ pinEnabled: true, webhookSubscribed: false });

    const handler = getRouteHandler(whatsappRouter, '/connection/health', 'get');
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.webhooks.subscribed).toBe(false);
    expect(body.rootCause).toContain('not subscribed to receive Meta webhooks');
    expect(body.recommendedFix.length).toBeGreaterThan(0);
  });

  test('only PIN missing: rootCause and recommendedFix reference the Cloud API registration gap', async () => {
    mockHealthySequence({ pinEnabled: false, webhookSubscribed: true });

    const handler = getRouteHandler(whatsappRouter, '/connection/health', 'get');
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.pin.enabled).toBe(false);
    expect(body.rootCause).toContain('Account does not exist in Cloud API');
    expect(body.recommendedFix.length).toBeGreaterThan(0);
    expect(body.issues).toContain('Two-step verification PIN is not set — Cloud API registration is incomplete.');
  });
});

describe('GET /api/whatsapp/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the profile for the connected company', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: HEALTHY_CFG }));
    axios.get.mockResolvedValueOnce({ data: { data: [{ about: 'Hello' }] } });

    const handler = getRouteHandler(whatsappRouter, '/profile', 'get');
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.success).toBe(true);
    expect(body.profile.about).toBe('Hello');
  });

  test('no WABA configured: 400 with a clear message, no Meta call made', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: null }));

    const handler = getRouteHandler(whatsappRouter, '/profile', 'get');
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
