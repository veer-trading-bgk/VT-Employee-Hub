'use strict';

/**
 * WhatsAppSendService.sendLocation() — Item 1c. Implements the previously
 * bare 501 stub, following sendMedia()'s exact structure (resolveContact,
 * RBAC, WABA config, Meta Graph API call, message/WAMID/last-message writes,
 * ConversationService sync, and the delayed-response cancel hook every other
 * real send method already has).
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/ConversationService', () => ({
  updateLastMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/DelayedResponseService', () => ({
  cancelPending: jest.fn().mockResolvedValue(undefined),
}));

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const DelayedResponseService = require('../src/services/DelayedResponseService');
const WASendSvc = require('../src/services/WhatsAppSendService');

const CID = 'comp_test';
const PHONE = '9876543210';
const AGENT_USER = { id: 'emp_1', role: 'admin', name: 'Agent' };

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
  dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) }); // resolveContact: unknown contact
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { accessToken: 'tok', phoneNumberId: 'PNID1' } }) });
  dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.LOC1' }] } });
});

describe('sendLocation()', () => {
  test('posts a Meta location message with latitude/longitude/name/address', async () => {
    await WASendSvc.sendLocation(CID, { phone: PHONE }, { latitude: 12.97, longitude: 77.59, name: 'HQ Office', address: '1 MG Road' }, AGENT_USER);

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/PNID1/messages'),
      expect.objectContaining({
        messaging_product: 'whatsapp',
        type: 'location',
        location: { latitude: 12.97, longitude: 77.59, name: 'HQ Office', address: '1 MG Road' },
      }),
      expect.any(Object),
    );
  });

  test('omits name/address from the Meta payload when not provided', async () => {
    await WASendSvc.sendLocation(CID, { phone: PHONE }, { latitude: 1, longitude: 2 }, AGENT_USER);
    const [, body] = axios.post.mock.calls[0];
    expect(body.location).toEqual({ latitude: 1, longitude: 2 });
  });

  test('returns { wamid, timestamp, pk, msgSK }', async () => {
    const result = await WASendSvc.sendLocation(CID, { phone: PHONE }, { latitude: 1, longitude: 2 }, AGENT_USER);
    expect(result.wamid).toBe('wamid.LOC1');
    expect(result.timestamp).toEqual(expect.any(String));
    expect(result.pk).toEqual(expect.any(String));
  });

  test('stores a MSG# record with type: location and a readable preview', async () => {
    await WASendSvc.sendLocation(CID, { phone: PHONE }, { latitude: 1, longitude: 2, name: 'HQ Office' }, AGENT_USER);
    const putCall = dynamodb.put.mock.calls.find((c) => c[0].Item.type === 'location');
    expect(putCall[0].Item).toEqual(expect.objectContaining({
      direction: 'outbound', type: 'location', content: '[Location: HQ Office]',
      location: { latitude: 1, longitude: 2, name: 'HQ Office', address: null },
    }));
  });

  test('fires the delayed-response cancel hook for a real agent', async () => {
    await WASendSvc.sendLocation(CID, { phone: PHONE }, { latitude: 1, longitude: 2 }, AGENT_USER);
    await flushMicrotasks();
    expect(DelayedResponseService.cancelPending).toHaveBeenCalledWith(CID, PHONE);
  });

  test('does not fire the cancel hook for the system actor', async () => {
    await WASendSvc.sendLocation(CID, { phone: PHONE }, { latitude: 1, longitude: 2 }, { id: 'system', role: 'admin', name: 'Automation' });
    await flushMicrotasks();
    expect(DelayedResponseService.cancelPending).not.toHaveBeenCalled();
  });
});
