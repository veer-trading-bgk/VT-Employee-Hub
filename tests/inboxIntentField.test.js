'use strict';

/**
 * Item 7 — the Inbox conversation list's intent badge needs intent/confidence
 * to actually be present in GET /api/whatsapp/inbox's response. That route
 * uses a curated field projection (not a full item spread), so mirroring
 * intent/confidence onto LEAD#/INBOX# (IntentDetectionService, this
 * session's earlier work) isn't sufficient on its own — this route also
 * needs the two fields added to its projection. Small correction to the
 * "no new backend work" assumption in the original request, verified here
 * rather than just asserted.
 */

jest.mock('../src/config/dynamodb', () => ({
  scan: jest.fn(), get: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(), sendLocation: jest.fn(),
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
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

const USER = { companyId: 'acme', id: 'emp_1', role: 'admin' };

describe('GET /api/whatsapp/inbox — intent/confidence pass-through (Item 7)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('includes intent/confidence for a classified lead', async () => {
    dynamodb.scan.mockImplementation(({ ExpressionAttributeValues }) => {
      if (ExpressionAttributeValues[':prefix'].startsWith('LEAD#')) {
        return { promise: () => Promise.resolve({ Items: [{
          PK: 'LEAD#acme#lead1', leadId: 'lead1', companyId: 'acme', name: 'Ravi', phone: '9876543210',
          stage: 'new_lead', assignedTo: 'emp_1', chatStatus: 'open', lastMessageAt: '2026-07-05T00:00:00.000Z',
          intent: 'kyc_query', confidence: 0.9,
        }] }) };
      }
      return { promise: () => Promise.resolve({ Items: [] }) };
    });

    const handler = getRouteHandler(whatsappRouter, '/inbox', 'get');
    const res = mockRes();
    await handler({ user: USER, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    const conv = body.conversations.find((c) => c.leadId === 'lead1');
    expect(conv.intent).toBe('kyc_query');
    expect(conv.confidence).toBe(0.9);
  });

  test('defaults intent/confidence to null for an unclassified lead', async () => {
    dynamodb.scan.mockImplementation(({ ExpressionAttributeValues }) => {
      if (ExpressionAttributeValues[':prefix'].startsWith('LEAD#')) {
        return { promise: () => Promise.resolve({ Items: [{
          PK: 'LEAD#acme#lead2', leadId: 'lead2', companyId: 'acme', name: 'Priya', phone: '9000000000',
          assignedTo: 'emp_1', chatStatus: 'open', lastMessageAt: '2026-07-05T00:00:00.000Z',
        }] }) };
      }
      return { promise: () => Promise.resolve({ Items: [] }) };
    });

    const handler = getRouteHandler(whatsappRouter, '/inbox', 'get');
    const res = mockRes();
    await handler({ user: USER, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    const conv = body.conversations.find((c) => c.leadId === 'lead2');
    expect(conv.intent).toBeNull();
    expect(conv.confidence).toBeNull();
  });
});
