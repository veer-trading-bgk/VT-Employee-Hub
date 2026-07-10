'use strict';

/**
 * Track A5 Fix 3 — the ?status=unread filter (whatsapp.js GET /inbox) already
 * existed server-side before this fix; only the Inbox tab UI was missing.
 * Live production data has zero unread conversations right now (verified via
 * a real, read-only invocation of this same handler against real DynamoDB —
 * 3/3 real conversations correctly excluded, counts.unread=0, no false
 * positives), which proves the exclusion path but not inclusion. This test
 * covers the positive case with a realistic mixed-read/unread lead set,
 * following the mocking pattern in inboxIntentField.test.js.
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
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { companyId: 'acme', id: 'emp_1', role: 'admin' };

const LEADS = [
  { PK: 'LEAD#acme#lead1', leadId: 'lead1', companyId: 'acme', name: 'Ravi', phone: '9876543210', assignedTo: 'emp_1', chatStatus: 'open', lastMessageAt: '2026-07-05T00:00:00.000Z', unreadCount: 3 },
  { PK: 'LEAD#acme#lead2', leadId: 'lead2', companyId: 'acme', name: 'Priya', phone: '9000000000', assignedTo: 'emp_1', chatStatus: 'open', lastMessageAt: '2026-07-05T00:00:00.000Z', unreadCount: 0 },
  { PK: 'LEAD#acme#lead3', leadId: 'lead3', companyId: 'acme', name: 'Amit', phone: '9111111111', chatStatus: 'resolved', lastMessageAt: '2026-07-04T00:00:00.000Z', unreadCount: 1 },
];
const UNKNOWN = [
  { PK: 'INBOX#acme#9222222222', phone: '9222222222', waName: 'Unknown A', lastMessageAt: '2026-07-05T00:00:00.000Z', unreadCount: 2 },
  { PK: 'INBOX#acme#9333333333', phone: '9333333333', waName: 'Unknown B', lastMessageAt: '2026-07-05T00:00:00.000Z', unreadCount: 0 },
];

function mockScans() {
  dynamodb.scan.mockImplementation(({ ExpressionAttributeValues }) => {
    if (ExpressionAttributeValues[':prefix'].startsWith('LEAD#')) {
      return { promise: () => Promise.resolve({ Items: LEADS }) };
    }
    if (ExpressionAttributeValues[':prefix'].startsWith('INBOX#')) {
      return { promise: () => Promise.resolve({ Items: UNKNOWN }) };
    }
    return { promise: () => Promise.resolve({ Items: [] }) };
  });
}

describe('GET /api/whatsapp/inbox — ?status=unread (Track A5 Fix 3)', () => {
  beforeEach(() => { jest.clearAllMocks(); mockScans(); });

  test('returns exactly the conversations with unreadCount > 0, leads and unknown contacts alike', async () => {
    const handler = getRouteHandler(whatsappRouter, '/inbox', 'get');
    const res = mockRes();
    await handler({ user: USER, query: { status: 'unread' } }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    const ids = body.conversations.map((c) => c.leadId || c.phone).sort();
    expect(ids).toEqual(['9222222222', 'lead1', 'lead3'].sort());
    expect(body.conversations.every((c) => c.unreadCount > 0)).toBe(true);
  });

  test('counts.unread matches the unread list length, and is computed independent of the active filter', async () => {
    const handler = getRouteHandler(whatsappRouter, '/inbox', 'get');

    const resAll = mockRes();
    await handler({ user: USER, query: { status: 'all' } }, resAll, jest.fn());
    const resUnread = mockRes();
    await handler({ user: USER, query: { status: 'unread' } }, resUnread, jest.fn());

    expect(resAll.json.mock.calls[0][0].counts.unread).toBe(3);
    expect(resUnread.json.mock.calls[0][0].counts.unread).toBe(3);
    expect(resUnread.json.mock.calls[0][0].conversations.length).toBe(3);
  });

  test('a read conversation (unreadCount: 0) is excluded even though it would pass every other filter', async () => {
    const handler = getRouteHandler(whatsappRouter, '/inbox', 'get');
    const res = mockRes();
    await handler({ user: USER, query: { status: 'unread' } }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.conversations.find((c) => c.leadId === 'lead2')).toBeUndefined();
    expect(body.conversations.find((c) => c.phone === '9333333333')).toBeUndefined();
  });
});
