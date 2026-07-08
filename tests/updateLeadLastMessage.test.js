'use strict';

/**
 * Wave 1 audit — Fix 5: WhatsAppSendService._updateLastMessage() was a
 * near-byte-for-byte private reimplementation of this shared util, missing
 * the ACTIVITY# bump the shared util already had for inbound messages. The
 * private copy is now deleted; WhatsAppSendService's 5 outbound send methods
 * call this util directly. Extended here with the isLead param (covering the
 * private copy's INBOX#/CONTACT branch) and an ACTIVITY# bump that now fires
 * for both directions, not just inbound — first direct unit coverage this
 * util has had (previously only exercised indirectly via whatsapp.js webhook
 * tests and whatsAppSendServiceLocation.test.js).
 */

jest.mock('../src/config/dynamodb', () => ({ update: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const { updateLeadLastMessage } = require('../src/utils/updateLeadLastMessage');

const LEAD_PK  = 'LEAD#acme#lead1';
const INBOX_PK = 'INBOX#acme#9876543210';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
});

describe('updateLeadLastMessage() — isLead branch (default true, backward compatible)', () => {
  test('inbound: writes METADATA fields, bumps unreadCount/lastInboundAt, and bumps ACTIVITY#', async () => {
    await updateLeadLastMessage(LEAD_PK, 'hi there', 'inbound', '2026-07-08T00:00:00.000Z');

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      UpdateExpression: expect.stringContaining('lastInboundAt'),
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'ACTIVITY#acme', SK: 'WA' },
    }));
  });

  test('outbound (Fix 5): writes METADATA fields WITHOUT touching unreadCount/lastInboundAt, but still bumps ACTIVITY#', async () => {
    await updateLeadLastMessage(LEAD_PK, 'agent reply', 'outbound', '2026-07-08T00:00:00.000Z');

    const metaCall = dynamodb.update.mock.calls.find((c) => c[0].Key.SK === 'METADATA');
    expect(metaCall[0].UpdateExpression).not.toContain('unreadCount');
    expect(metaCall[0].UpdateExpression).not.toContain('lastInboundAt');

    const activityCall = dynamodb.update.mock.calls.find((c) => c[0].Key.PK === 'ACTIVITY#acme');
    expect(activityCall).toBeDefined();
    expect(activityCall[0].Key).toEqual({ PK: 'ACTIVITY#acme', SK: 'WA' });
  });

  test('defaults isLead to true when the param is omitted (existing callers unaffected)', async () => {
    await updateLeadLastMessage(LEAD_PK, 'hi', 'inbound', '2026-07-08T00:00:00.000Z');
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({ Key: { PK: LEAD_PK, SK: 'METADATA' } }));
  });
});

describe('updateLeadLastMessage() — isLead: false (INBOX#/CONTACT branch, folded in from the deleted private copy)', () => {
  test('writes CONTACT (not METADATA) fields and still bumps ACTIVITY#', async () => {
    await updateLeadLastMessage(INBOX_PK, 'hello', 'outbound', '2026-07-08T00:00:00.000Z', false);

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
      UpdateExpression: expect.stringContaining('lastMessagePreview'),
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'ACTIVITY#acme', SK: 'WA' },
    }));
  });

  test('never sets unreadCount/lastInboundAt on the CONTACT branch even for inbound', async () => {
    await updateLeadLastMessage(INBOX_PK, 'hello', 'inbound', '2026-07-08T00:00:00.000Z', false);
    const contactCall = dynamodb.update.mock.calls.find((c) => c[0].Key.SK === 'CONTACT');
    expect(contactCall[0].UpdateExpression).not.toContain('unreadCount');
  });
});

describe('updateLeadLastMessage() — never throws', () => {
  test('swallows a DynamoDB error', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(new Error('boom')) });
    await expect(updateLeadLastMessage(LEAD_PK, 'hi', 'inbound', '2026-07-08T00:00:00.000Z')).resolves.toBeUndefined();
  });
});
