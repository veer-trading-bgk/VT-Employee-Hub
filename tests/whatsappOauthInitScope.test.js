'use strict';

/**
 * Regression test for a 2026-07-10 live-blocking fix (docs/phase3/TECHNICAL_DEBT.md):
 * GET /api/whatsapp/auth/init requested a bare `business_management` scope
 * alongside the two correct whatsapp_business_* scopes — Meta's OAuth
 * dialog rejected the whole request with "Invalid Scopes: business_management"
 * (that scope name is real but this app was never approved for it; it isn't
 * needed — the two whatsapp_business_* scopes are sufficient, confirmed
 * against the working manual System User token connect flow).
 */

jest.mock('../src/config/dynamodb', () => ({}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';
process.env.META_APP_ID = '1669745754311284';
process.env.BACKEND_URL = 'https://api.example.com';

const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(path, method) {
  const layer = whatsappRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('GET /api/whatsapp/auth/init — OAuth scope string', () => {
  test('requests only the two whatsapp_business_* scopes, never a bare business_management', () => {
    const handler = getRouteHandler('/auth/init', 'get');
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    handler({ user: { companyId: 'comp_test', id: 'emp_1' } }, res);

    const [{ url }] = res.json.mock.calls[0];
    const scope = new URL(url).searchParams.get('scope').split(',');

    expect(scope).toEqual(['whatsapp_business_management', 'whatsapp_business_messaging']);
    expect(scope).not.toContain('business_management');
  });
});
