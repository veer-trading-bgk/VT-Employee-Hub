'use strict';

/**
 * Coverage for two related additions to the inbound webhook:
 *   1. list_reply parsing (isListReply/parseListReply) — previously entirely
 *      unhandled, a tapped Message+List row was silently dropped (not stored,
 *      no WS push). Unit-tested the same way whatsappWelcomeButtons.test.js
 *      unit-tests isButtonReply/parseButtonReply.
 *   2. The new keyword_message trigger firing on every inbound text message
 *      or button/list tap, exercised end-to-end through the real /webhook
 *      handler (direct-handler-invocation, no HTTP/JWT) for the known-lead
 *      branch — dynamodb mocked with a small router keyed by PK prefix /
 *      IndexName rather than a single mockReturnValue, since one webhook call
 *      makes several distinct get/query calls.
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
// dedupPut is deliberately NOT mocked — it's a thin wrapper around dynamodb.put
// (see dedupPut.test.js for its own dedicated coverage), and running it for
// real here is what lets these tests assert on the actual MSG# item shape
// dynamodb.put receives, rather than just trusting a stub returned true.
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
const AutomationEngine = require('../src/services/AutomationEngine');
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

describe('inbound list_reply parsing', () => {
  test('isListReply is true only for interactive/list_reply, not button_reply/text/media', () => {
    expect(whatsappRouter.isListReply({ type: 'text' })).toBe(false);
    expect(whatsappRouter.isListReply({ type: 'image' })).toBe(false);
    expect(whatsappRouter.isListReply({ type: 'interactive', interactive: { type: 'button_reply' } })).toBe(false);
    expect(whatsappRouter.isListReply({ type: 'interactive', interactive: { type: 'nfm_reply' } })).toBe(false);
    expect(whatsappRouter.isListReply({ type: 'interactive', interactive: { type: 'list_reply' } })).toBe(true);
  });

  test('parseListReply extracts id, title, and description', () => {
    const msg = { interactive: { list_reply: { id: 'row-1', title: 'Open Demat Account', description: 'KYC in 5 minutes' } } };
    expect(whatsappRouter.parseListReply(msg)).toEqual({
      id: 'row-1', title: 'Open Demat Account', description: 'KYC in 5 minutes',
    });
  });

  test('parseListReply defaults description to null and title to a placeholder when absent', () => {
    const msg = { interactive: { list_reply: { id: 'row-2' } } };
    expect(whatsappRouter.parseListReply(msg)).toEqual({ id: 'row-2', title: '[List selection]', description: null });
  });
});

describe('POST /api/whatsapp/webhook — known-lead branch: list_reply / text / button_reply / media', () => {
  const CID = 'comp_test';
  const PHONE_NUMBER_ID = 'phone_number_id_1';
  const PHONE10 = '9876543210';
  const LEAD_PK = `LEAD#${CID}#lead_1`;
  const LEAD_ITEM = {
    PK: LEAD_PK, SK: 'METADATA', leadId: 'lead_1', companyId: CID,
    name: 'Test Customer', phone: PHONE10, phoneNorm: PHONE10,
    stage: 'new', tags: ['vip'], assignedTo: 'emp_1', chatStatus: 'open',
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

  test('a list_reply tap is stored as a first-class MSG# record and fires keyword_message with the row title', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    const req = { body: webhookBody({
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'row-1', title: 'Open Demat Account', description: '' } },
    }) };
    await handler(req, mockRes(), jest.fn());

    const [putArgs] = dynamodb.put.mock.calls.find(([a]) => a.Item?.PK === LEAD_PK && a.Item?.SK?.startsWith('MSG#'));
    expect(putArgs.Item.type).toBe('list_reply');
    expect(putArgs.Item.content).toBe('Open Demat Account');
    expect(putArgs.Item.listReplyId).toBe('row-1');

    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({
      leadId: 'lead_1', leadPK: LEAD_PK, phone: PHONE10, messageText: 'Open Demat Account',
      stage: 'new', tags: ['vip'], assignedTo: 'emp_1',
    }));
  });

  test('a typed text message fires keyword_message with the message body as messageText', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    const req = { body: webhookBody({ type: 'text', text: { body: 'I want to open a demat account' } }) };
    await handler(req, mockRes(), jest.fn());

    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({
      messageText: 'I want to open a demat account',
    }));
  });

  test('a button_reply tap fires keyword_message with the button title as messageText', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    const req = { body: webhookBody({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'btn-1', title: 'Yes please' } },
    }) };
    await handler(req, mockRes(), jest.fn());

    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({
      messageText: 'Yes please',
    }));
  });

  test('an inbound media message (no button/list/text) does not fire keyword_message', async () => {
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    const req = { body: webhookBody({ type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }) };
    await handler(req, mockRes(), jest.fn());

    expect(AutomationEngine.fireTrigger).not.toHaveBeenCalledWith(CID, 'keyword_message', expect.anything());
  });

  // Proves the ordering fix from the 2026-07-06 incident (19_DECISION_LOG.md Era 20):
  // fireTrigger('keyword_message') used to be fire-and-forget, so res.sendStatus(200)
  // could resolve before it ran at all — a real customer's automated reply was
  // measured 6.3s-49.4s late in production, sometimes never arriving. A deferred
  // promise proves ordering directly: res.sendStatus must NOT fire while
  // fireTrigger()'s own promise is still pending, only after it settles.
  test('res.sendStatus(200) waits for fireTrigger(keyword_message) to settle, not just to be called', async () => {
    let resolveFireTrigger;
    AutomationEngine.fireTrigger.mockReturnValue(new Promise((resolve) => { resolveFireTrigger = resolve; }));

    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    const req = { body: webhookBody({ type: 'text', text: { body: 'Hi' } }) };
    const res = mockRes();

    const handlerPromise = handler(req, res, jest.fn());

    // Yield to the macrotask queue (not just a few microtask ticks) so every
    // OTHER already-resolved awaited call earlier in the handler (config
    // lookups, GSI query, dedupPut, notifyCompany, ...) has fully drained
    // regardless of how many steps precede fireTrigger() — the only thing
    // left blocking progress should be the deliberately-pending deferred
    // promise, so the response must not have been sent yet.
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.sendStatus).not.toHaveBeenCalled();

    resolveFireTrigger();
    await handlerPromise;

    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });
});
