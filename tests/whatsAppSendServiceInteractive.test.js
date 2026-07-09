'use strict';

/**
 * Direct-invocation tests for WhatsAppSendService.sendInteractive()'s own
 * storage behavior. Fixes the 2026-07-09 Inbox rendering audit's Fix 1+2
 * (docs/phase3/TECHNICAL_DEBT.md): previously only interactive.body.text was
 * persisted, so the Inbox had no data to render actual buttons/list rows
 * from, no matter how the frontend renderer was built. interactiveType/
 * interactiveAction are new, additive fields -- content is unchanged, and a
 * record written before this fix (neither field present) must still be a
 * valid shape for any reader.
 *
 * No prior tests existed directly against WhatsAppSendService.js's own
 * implementation -- confirmed by repo search. Every other test file mocks
 * WASendSvc.sendInteractive entirely, testing only that callers invoke it
 * correctly, not what it itself persists.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), query: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/ConversationService', () => ({
  updateLastMessage: jest.fn().mockResolvedValue(undefined),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');

const CID = 'comp_test';
const USER = { id: 'emp_1', role: 'admin', name: 'Viir' };

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

// Skips resolveContact's lookups entirely (WhatsAppSendService.js:142).
const TARGET = { resolvedContact: { pk: 'LEAD#comp_test#lead1', phone: '9000000000', isLead: true } };

beforeEach(() => {
  jest.clearAllMocks();
  dynamodb.get.mockReturnValue(resolved({ Item: { accessToken: 'tok', phoneNumberId: 'pid_1' } })); // CONFIG#WABA
});

describe('sendInteractive() — persists interactive.action alongside body text (additive)', () => {
  test('reply_buttons: interactiveType/interactiveAction stored, content unchanged (still just body.text)', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
    dynamodb.put.mockReturnValue(resolved({}));

    const interactive = {
      type: 'button',
      body: { text: 'Still interested?' },
      action: { buttons: [
        { type: 'reply', reply: { id: 'b1', title: 'Yes' } },
        { type: 'reply', reply: { id: 'b2', title: 'No' } },
      ] },
    };
    await WASendSvc.sendInteractive(CID, TARGET, interactive, USER);

    // 2 puts per send: the MSG# record and the WAMID# reverse-index lookup
    // (_storeWamidLookup) -- selecting the message record specifically.
    expect(dynamodb.put).toHaveBeenCalledTimes(2);
    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'interactive');
    expect(Item.content).toBe('Still interested?');
    expect(Item.type).toBe('interactive');
    expect(Item.interactiveType).toBe('button');
    expect(Item.interactiveAction).toEqual({
      buttons: [
        { type: 'reply', reply: { id: 'b1', title: 'Yes' } },
        { type: 'reply', reply: { id: 'b2', title: 'No' } },
      ],
    });
  });

  test('list: sections/rows stored under interactiveAction, same shape sent to Meta', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.2' }] } });
    dynamodb.put.mockReturnValue(resolved({}));

    const interactive = {
      type: 'list',
      body: { text: 'Pick one' },
      action: { button: 'View Options', sections: [{ rows: [
        { id: 'r1', title: 'Demat', description: 'Open a demat account' },
        { id: 'r2', title: 'Trading' },
      ] }] },
    };
    await WASendSvc.sendInteractive(CID, TARGET, interactive, USER);

    const [{ Item }] = dynamodb.put.mock.calls[0];
    expect(Item.content).toBe('Pick one');
    expect(Item.interactiveType).toBe('list');
    expect(Item.interactiveAction).toEqual({
      button: 'View Options',
      sections: [{ rows: [
        { id: 'r1', title: 'Demat', description: 'Open a demat account' },
        { id: 'r2', title: 'Trading' },
      ] }],
    });
  });

  test('cta_url: action (name + parameters) stored', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.3' }] } });
    dynamodb.put.mockReturnValue(resolved({}));

    const interactive = {
      type: 'cta_url',
      body: { text: 'Check this out' },
      action: { name: 'cta_url', parameters: { display_text: 'Open', url: 'https://example.com' } },
    };
    await WASendSvc.sendInteractive(CID, TARGET, interactive, USER);

    const [{ Item }] = dynamodb.put.mock.calls[0];
    expect(Item.interactiveType).toBe('cta_url');
    expect(Item.interactiveAction).toEqual({ name: 'cta_url', parameters: { display_text: 'Open', url: 'https://example.com' } });
  });

  test('missing interactive.action stores interactiveAction: null, no crash', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.4' }] } });
    dynamodb.put.mockReturnValue(resolved({}));

    await WASendSvc.sendInteractive(CID, TARGET, { type: 'button', body: { text: 'Hi' } }, USER);

    const [{ Item }] = dynamodb.put.mock.calls[0];
    expect(Item.interactiveType).toBe('button');
    expect(Item.interactiveAction).toBeNull();
  });

  test('every pre-existing field on the stored Item is unchanged (direction, type, sentBy, timestamp, waMessageId, msgStatus)', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.5' }] } });
    dynamodb.put.mockReturnValue(resolved({}));

    await WASendSvc.sendInteractive(CID, TARGET, { type: 'button', body: { text: 'Hi' }, action: { buttons: [] } }, USER);

    const [{ Item }] = dynamodb.put.mock.calls[0];
    expect(Item).toEqual(expect.objectContaining({
      direction: 'outbound', type: 'interactive', sentBy: 'emp_1', sentByName: 'Viir',
      waMessageId: 'wamid.5', msgStatus: 'sent',
    }));
    expect(typeof Item.timestamp).toBe('string');
  });
});
