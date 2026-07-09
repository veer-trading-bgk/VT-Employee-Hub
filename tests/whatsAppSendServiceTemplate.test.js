'use strict';

/**
 * Direct-invocation tests for WhatsAppSendService.sendTemplate()'s resolvedBody
 * storage. Fix 3 of the 2026-07-09 Inbox rendering audit
 * (docs/phase3/TECHNICAL_DEBT.md): content was always a generic
 * "[Template: name]" placeholder -- the real substituted body (computed for
 * the Meta API call) was discarded. resolvedBody is a new, additive field
 * holding that real text; content is deliberately left untouched (it's what
 * TemplateBubble's Automation/Broadcast/Campaign category-label regex
 * parses -- overloading it with real prose would silently break that).
 *
 * Real stored template shapes (components: [{type:'BODY', text:'Hi {{1}}...'}])
 * confirmed against actual CONFIG#TMPL#viir_trading records before writing
 * these fixtures, not invented.
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
const TARGET = { resolvedContact: { pk: 'LEAD#comp_test#lead1', phone: '9000000000', isLead: true } };

function mockConfigThenTemplate(tmplItem) {
  dynamodb.get
    .mockReturnValueOnce(resolved({ Item: { accessToken: 'tok', phoneNumberId: 'pid_1' } })) // CONFIG#WABA
    .mockReturnValueOnce(resolved({ Item: tmplItem })); // CONFIG#TMPL
}

beforeEach(() => {
  jest.clearAllMocks();
  // _getConfig()'s 10-min in-process cache (WhatsAppSendService.js's
  // _cfgCache) is real module state, not a jest mock -- clearAllMocks()
  // doesn't touch it. Without this, only the FIRST test in this file ever
  // actually calls dynamodb.get() for CONFIG#WABA; every test after that
  // hits the cache instead, throwing off the mockReturnValueOnce sequencing
  // below (the "WABA" mock silently gets consumed by the template lookup).
  WASendSvc.invalidateConfigCache(CID);
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
  dynamodb.put.mockReturnValue(resolved({}));
});

describe('sendTemplate() — persists resolvedBody (Fix 3), content unchanged (additive)', () => {
  test('DB template with a {{1}} BODY component: resolvedBody has the real substituted text, content is still the placeholder', async () => {
    mockConfigThenTemplate({
      templateName: 'kyc_activation', name: 'kyc_activation', language: 'en',
      components: [{ type: 'BODY', text: 'Hi {{1}}\n\nYou ac has been activated and code is V46045' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_1', ['Priya'], USER);

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.content).toBe('[Template: kyc_activation]');
    expect(Item.resolvedBody).toBe('Hi Priya\n\nYou ac has been activated and code is V46045');
  });

  test('DB template with a BODY component but no {{n}} placeholders at all: resolvedBody is the static text as-is', async () => {
    mockConfigThenTemplate({
      templateName: 'apointment', name: 'apointment', language: 'en',
      components: [{ type: 'BODY', text: 'Your appointment is booked\nThank you for booking.' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_2', [], USER);

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.resolvedBody).toBe('Your appointment is booked\nThank you for booking.');
  });

  test('multiple variables substitute in order', async () => {
    mockConfigThenTemplate({
      templateName: 'multi', name: 'multi', language: 'en',
      components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} ships on {{3}}.' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_3', ['Amit', '#4471', 'July 12'], USER);

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.resolvedBody).toBe('Hi Amit, your order #4471 ships on July 12.');
  });

  test('a {{n}} with no corresponding param is left as a visible placeholder, not blanked', async () => {
    mockConfigThenTemplate({
      templateName: 'under_supplied', name: 'under_supplied', language: 'en',
      components: [{ type: 'BODY', text: 'Hi {{1}}, code {{2}}.' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_4', ['Priya'], USER); // only 1 param for 2 placeholders

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.resolvedBody).toBe('Hi Priya, code {{2}}.');
  });

  test('name-only path ({templateName, language} — Automation/welcome/broadcast) has no component definitions: resolvedBody is null, content still falls back to the placeholder', async () => {
    dynamodb.get.mockReturnValueOnce(resolved({ Item: { accessToken: 'tok', phoneNumberId: 'pid_1' } })); // CONFIG#WABA only — no TMPL lookup on this path

    await WASendSvc.sendTemplate(CID, TARGET, { templateName: 'welcomemessage', language: 'en' }, ['Priya'], USER, { content: '[Automation: welcomemessage]' });

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.content).toBe('[Automation: welcomemessage]');
    expect(Item.resolvedBody).toBeNull();
    expect(Item.templateId).toBeUndefined(); // no DB id was ever resolved on this path
  });

  test('a BODY component with no .text (malformed) also falls back to resolvedBody: null, no crash', async () => {
    mockConfigThenTemplate({
      templateName: 'malformed', name: 'malformed', language: 'en',
      components: [{ type: 'BODY' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_5', [], USER);

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item.resolvedBody).toBeNull();
  });

  test('every pre-existing field on the stored Item is unchanged', async () => {
    mockConfigThenTemplate({
      templateName: 'kyc_activation', name: 'kyc_activation', language: 'en',
      components: [{ type: 'BODY', text: 'Hi {{1}}' }],
    });

    await WASendSvc.sendTemplate(CID, TARGET, 'tmpl_6', ['Priya'], USER);

    const { Item } = dynamodb.put.mock.calls.map((c) => c[0]).find((c) => c.Item.type === 'template');
    expect(Item).toEqual(expect.objectContaining({
      direction: 'outbound', type: 'template', content: '[Template: kyc_activation]',
      sentBy: 'emp_1', sentByName: 'Viir', templateId: 'tmpl_6', waMessageId: 'wamid.1', msgStatus: 'sent',
    }));
    expect(typeof Item.timestamp).toBe('string');
  });
});
