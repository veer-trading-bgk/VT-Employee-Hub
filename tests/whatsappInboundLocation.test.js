'use strict';

/**
 * Coverage for Finding #12 (2026-07-17 360° audit fix plan): the inbound
 * webhook's type guard previously discarded any message whose type wasn't
 * text/media/flow/button/list — a customer-shared location (type: 'location')
 * was silently dropped: never stored, never reaching the inbox, even though
 * the frontend already had a complete (and, on inspection, fully direction-
 * agnostic) location render branch that only ever fired for OUTBOUND
 * sendLocation() sends. Structured the same way as whatsappListReply.test.js
 * — real dedupPut (not mocked), so these assert on the actual MSG# item
 * dynamodb.put receives, not just a stub returning true.
 */

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(), delete: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));
jest.mock('../src/utils/verifyMetaWebhookSignature', () => ({
  verifyMetaWebhookSignature: jest.fn(() => true),
}));
jest.mock('../src/utils/wsNotify', () => ({
  notifyCompany: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/utils/conversationResolver', () => ({
  resolveForInbox: jest.fn().mockResolvedValue(null),
  resolveForLead:  jest.fn().mockResolvedValue(null),
  syncConvStatus:  jest.fn(),
  syncMarkRead:    jest.fn(),
}));
jest.mock('../src/services/IntentDetectionService', () => ({
  classifyIfNeededForLead:  jest.fn(),
  classifyIfNeededForInbox: jest.fn(),
}));
jest.mock('../src/services/WorkingHoursService', () => ({
  shouldSendOOO: jest.fn().mockResolvedValue(false),
  sendOOO:       jest.fn(),
}));
jest.mock('../src/services/DelayedResponseService', () => ({
  scheduleIfEnabled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger:        jest.fn().mockResolvedValue(undefined),
  resumeOnButtonReply: jest.fn().mockResolvedValue(undefined),
}));

const dynamodb = require('../src/config/dynamodb');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { sendStatus: jest.fn() };
}

const CID = 'comp_test';
const PHONE_NUMBER_ID = 'phone_number_id_1';
const PHONE10 = '9876543210';
const LEAD_PK = `LEAD#${CID}#lead_1`;
const LEAD_ITEM = {
  PK: LEAD_PK, SK: 'METADATA', leadId: 'lead_1', companyId: CID,
  name: 'Test Customer', phone: PHONE10, phoneNorm: PHONE10,
  stage: 'new', tags: [], assignedTo: 'emp_1', chatStatus: 'open',
};

function webhookBody(message) {
  return {
    entry: [{
      id: 'waba_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ wa_id: PHONE10, profile: { name: 'Test Customer' } }],
          messages: [{ from: PHONE10, id: `wamid.${Date.now()}`, timestamp: '1751500000', ...message }],
        },
      }],
    }],
  };
}

const LOCATION_MSG = {
  type: 'location',
  location: { latitude: 12.9716, longitude: 77.5946, name: 'Angel One Branch', address: 'MG Road, Bengaluru' },
};

describe('POST /api/whatsapp/webhook — inbound location messages (Finding #12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

    dynamodb.get.mockImplementation((params) => {
      const pk = params?.Key?.PK ?? '';
      let item;
      if (pk.startsWith('CONFIG#PHONEID#')) item = { companyId: CID };
      else if (pk.startsWith('CONFIG#WABA#')) item = { companyId: CID, phoneNumberId: PHONE_NUMBER_ID, accessToken: 'tok' };
      return { promise: () => Promise.resolve(item ? { Item: item } : {}) };
    });
    dynamodb.query.mockImplementation((params) => {
      const items = params?.IndexName === 'company-phone-index' ? [LEAD_ITEM] : [];
      return { promise: () => Promise.resolve({ Items: items }) };
    });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('known-lead branch: a location message is stored with lat/lng/name/address — not dropped', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody(LOCATION_MSG) }, mockRes(), jest.fn());

    const msgPut = dynamodb.put.mock.calls.find(([a]) => a.Item?.PK === LEAD_PK && a.Item?.SK?.startsWith('MSG#'));
    expect(msgPut).toBeDefined(); // pre-fix: the type guard's `continue` meant this never happened at all
    expect(msgPut[0].Item.type).toBe('location');
    expect(msgPut[0].Item.content).toBe('[Location: Angel One Branch]');
    expect(msgPut[0].Item.location).toEqual({
      latitude: 12.9716, longitude: 77.5946, name: 'Angel One Branch', address: 'MG Road, Bengaluru',
    });
  });

  test('name/address are genuinely optional — falls back to the bare "[Location]" preview and null fields', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'location', location: { latitude: 1, longitude: 2 } }) }, mockRes(), jest.fn());

    const msgPut = dynamodb.put.mock.calls.find(([a]) => a.Item?.PK === LEAD_PK && a.Item?.SK?.startsWith('MSG#'));
    expect(msgPut[0].Item.content).toBe('[Location]');
    expect(msgPut[0].Item.location).toEqual({ latitude: 1, longitude: 2, name: null, address: null });
  });

  test('unknown (INBOX#) contact branch: a location message is stored too, same shape', async () => {
    // No lead for this phone → the webhook takes the unknown-contact else-branch.
    dynamodb.query.mockImplementation(() => ({ promise: () => Promise.resolve({ Items: [] }) }));
    dynamodb.get.mockImplementation((params) => {
      const pk = params?.Key?.PK ?? '';
      if (pk.startsWith('CONFIG#PHONEID#')) return { promise: () => Promise.resolve({ Item: { companyId: CID } }) };
      if (pk.startsWith('CONFIG#WABA#')) return { promise: () => Promise.resolve({ Item: { companyId: CID, phoneNumberId: PHONE_NUMBER_ID, accessToken: 'tok' } }) };
      if (pk.startsWith('INBOX#') && params.Key.SK === 'CONTACT') return { promise: () => Promise.resolve({ Item: { PK: pk, SK: 'CONTACT', phone: PHONE10 } }) };
      return { promise: () => Promise.resolve({}) };
    });

    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody(LOCATION_MSG) }, mockRes(), jest.fn());

    const inboxPK = `INBOX#${CID}#${PHONE10}`;
    const msgPut = dynamodb.put.mock.calls.find(([a]) => a.Item?.PK === inboxPK && a.Item?.SK?.startsWith('MSG#'));
    expect(msgPut).toBeDefined();
    expect(msgPut[0].Item.type).toBe('location');
    expect(msgPut[0].Item.location.name).toBe('Angel One Branch');
  });

  test('a location message does not get swept into media handling (no mediaId, no download attempt shape)', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody(LOCATION_MSG) }, mockRes(), jest.fn());

    const msgPut = dynamodb.put.mock.calls.find(([a]) => a.Item?.PK === LEAD_PK && a.Item?.SK?.startsWith('MSG#'));
    expect(msgPut[0].Item.mediaId).toBeUndefined();
    expect(msgPut[0].Item.mimeType).toBeUndefined();
  });
});
