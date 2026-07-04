'use strict';

/**
 * Contract tests for POST /api/whatsapp/send-location (Item 1c) — the Inbox
 * composer's "Send Location" button, mirroring /send-template's target-
 * resolution shape (leadPK > leadId > phone) but with a saved CONFIG#BRANCH#
 * reference instead of free-typed coordinates.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(), sendLocation: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { companyId: 'acme', id: 'emp_1', role: 'admin', name: 'Agent' };

describe('POST /api/whatsapp/send-location', () => {
  beforeEach(() => jest.clearAllMocks());

  test('400s when neither leadPK/leadId/phone nor branchId is provided', async () => {
    const handler = getRouteHandler(whatsappRouter, '/send-location', 'post');
    const res = mockRes();
    await handler({ body: {}, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(WASendSvc.sendLocation).not.toHaveBeenCalled();
  });

  test('404s when the branch does not exist', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const handler = getRouteHandler(whatsappRouter, '/send-location', 'post');
    const res = mockRes();
    await handler({ body: { phone: '9876543210', branchId: 'missing' }, user: USER }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(WASendSvc.sendLocation).not.toHaveBeenCalled();
  });

  test('sends the branch coordinates as the REAL agent (not the system actor)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { name: 'HQ', address: '1 MG Road', latitude: 12.9, longitude: 77.5 } }) });
    WASendSvc.sendLocation.mockResolvedValue({ wamid: 'wamid.loc1' });

    const handler = getRouteHandler(whatsappRouter, '/send-location', 'post');
    const res = mockRes();
    await handler({ body: { phone: '9876543210', branchId: 'b1' }, user: USER }, res, jest.fn());

    expect(WASendSvc.sendLocation).toHaveBeenCalledWith(
      'acme',
      { phone: '9876543210' },
      { latitude: 12.9, longitude: 77.5, name: 'HQ', address: '1 MG Road' },
      USER,
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('resolves target via leadPK when provided', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { name: 'HQ', latitude: 1, longitude: 2 } }) });
    WASendSvc.sendLocation.mockResolvedValue({ wamid: 'wamid.loc2' });

    const handler = getRouteHandler(whatsappRouter, '/send-location', 'post');
    await handler({ body: { leadPK: 'LEAD#acme#lead1', branchId: 'b1' }, user: USER }, mockRes(), jest.fn());

    expect(WASendSvc.sendLocation).toHaveBeenCalledWith('acme', { leadPK: 'LEAD#acme#lead1' }, expect.any(Object), USER);
  });
});
