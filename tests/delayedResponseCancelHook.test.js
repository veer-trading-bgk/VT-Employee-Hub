'use strict';

/**
 * Item 3 (Delayed Response Message) — "cancel the pending message if an agent
 * replies before the delay expires." The hook lives in WhatsAppSendService
 * since ADR-012 already routes every outbound send (agent-initiated or
 * system-initiated) through its 4 methods — one shared private helper,
 * DelayedResponseService required lazily (matches the existing lazy-require
 * pattern whatsapp.js's webhook already uses for AutomationEngine, avoiding a
 * circular require: DelayedResponseService.resume() itself calls sendText()).
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
const AGENT_USER = { id: 'emp_1', role: 'admin', name: 'Real Agent' };
const SYSTEM_USER = { id: 'system', role: 'admin', name: 'System' };

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

  // resolveContact: phone target, no lead found -> INBOX# unknown-contact path
  dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
  // _requireConfig: a valid WABA config
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { accessToken: 'tok', phoneNumberId: 'PNID1' } }) });
  dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.ABC' }] } });
});

describe('_fireDelayedResponseCancel — the shared private helper', () => {
  test('calls DelayedResponseService.cancelPending for a real (non-system) agent', async () => {
    WASendSvc._fireDelayedResponseCancel(CID, { phone: PHONE }, AGENT_USER);
    await flushMicrotasks();
    expect(DelayedResponseService.cancelPending).toHaveBeenCalledWith(CID, PHONE);
  });

  test('does NOT call cancelPending for the system actor', async () => {
    WASendSvc._fireDelayedResponseCancel(CID, { phone: PHONE }, SYSTEM_USER);
    await flushMicrotasks();
    expect(DelayedResponseService.cancelPending).not.toHaveBeenCalled();
  });

  test('never throws — swallows a cancelPending rejection', async () => {
    DelayedResponseService.cancelPending.mockRejectedValue(new Error('DDB down'));
    expect(() => WASendSvc._fireDelayedResponseCancel(CID, { phone: PHONE }, AGENT_USER)).not.toThrow();
    await flushMicrotasks();
  });
});

describe('sendText/sendTemplate/sendInteractive/sendMedia — all 4 wire the cancel hook', () => {
  test('sendText fires the cancel hook for a real agent', async () => {
    const spy = jest.spyOn(WASendSvc, '_fireDelayedResponseCancel').mockImplementation(() => {});
    await WASendSvc.sendText(CID, { phone: PHONE }, 'hello', AGENT_USER);
    expect(spy).toHaveBeenCalledWith(CID, expect.objectContaining({ phone: PHONE }), AGENT_USER);
    spy.mockRestore();
  });

  test('sendTemplate fires the cancel hook', async () => {
    const spy = jest.spyOn(WASendSvc, '_fireDelayedResponseCancel').mockImplementation(() => {});
    await WASendSvc.sendTemplate(CID, { phone: PHONE }, { templateName: 'hello', language: 'en' }, [], AGENT_USER);
    expect(spy).toHaveBeenCalledWith(CID, expect.objectContaining({ phone: PHONE }), AGENT_USER);
    spy.mockRestore();
  });

  test('sendInteractive fires the cancel hook', async () => {
    const spy = jest.spyOn(WASendSvc, '_fireDelayedResponseCancel').mockImplementation(() => {});
    await WASendSvc.sendInteractive(CID, { phone: PHONE }, { type: 'button', body: { text: 'hi' }, action: { buttons: [] } }, AGENT_USER);
    expect(spy).toHaveBeenCalledWith(CID, expect.objectContaining({ phone: PHONE }), AGENT_USER);
    spy.mockRestore();
  });

  test('sendMedia fires the cancel hook', async () => {
    const spy = jest.spyOn(WASendSvc, '_fireDelayedResponseCancel').mockImplementation(() => {});
    await WASendSvc.sendMedia(CID, { phone: PHONE }, { mediaType: 'image', url: 'https://x/y.jpg' }, AGENT_USER);
    expect(spy).toHaveBeenCalledWith(CID, expect.objectContaining({ phone: PHONE }), AGENT_USER);
    spy.mockRestore();
  });

  test('none of the 4 methods fire it for the system actor (real end-to-end, not spied)', async () => {
    await WASendSvc.sendText(CID, { phone: PHONE }, 'hello', SYSTEM_USER);
    await flushMicrotasks();
    expect(DelayedResponseService.cancelPending).not.toHaveBeenCalled();
  });
});
