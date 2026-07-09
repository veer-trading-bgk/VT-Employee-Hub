'use strict';

/**
 * Regression coverage for the confirmed 2026-07-08 live bug
 * (docs/bible/19_DECISION_LOG.md): ConversationalAgentService.maybeStart()
 * used to return true unconditionally regardless of whether it actually sent
 * a reply, so whatsapp.js's unknown-contact webhook branch — which gates both
 * the welcome message and the whatsapp_conversation_started automation
 * trigger on `!botEngaged` — silently suppressed both for every genuine
 * first-time contact whenever the AI conversation agent failed to respond
 * (disabled feature, rate limit, provider error, etc.).
 *
 * Exercises the real /webhook route (direct-handler-invocation, no HTTP/JWT —
 * same technique as whatsappListReply.test.js), with
 * ConversationalAgentService mocked at the module boundary: this file tests
 * whatsapp.js's own WIRING against maybeStart()'s return value, not
 * ConversationalAgentService's internals (see
 * conversationalAgentService.test.js's "signal failure accurately" block for
 * per-failure-reason coverage of maybeStart() itself).
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
  fireTrigger:         jest.fn().mockResolvedValue(undefined),
  resumeOnButtonReply: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/CustomerIdentityService', () => ({
  resolveOrCreate: jest.fn(),
}));
jest.mock('../src/services/ConversationalAgentService', () => ({
  maybeStart:   jest.fn(),
  continueTurn: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');
const AutomationEngine = require('../src/services/AutomationEngine');
const ConversationalAgentService = require('../src/services/ConversationalAgentService');
const DelayedResponseService = require('../src/services/DelayedResponseService');
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

describe('POST /api/whatsapp/webhook — unknown-contact branch: botEngaged gates welcome + whatsapp_conversation_started', () => {
  const CID = 'comp_test';
  const PHONE_NUMBER_ID = 'phone_number_id_1';
  const PHONE10 = '9901251785';

  function webhookBody(message) {
    return {
      entry: [{
        id: 'waba_1',
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ wa_id: PHONE10, profile: { name: 'New Customer' } }],
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
      // No existing INBOX# CONTACT record -> isFirstContact === true (whatsapp.js:1670)
      else if (pk.startsWith('INBOX#')) item = undefined;
      else if (pk.startsWith('CONFIG#WELCOME#')) item = { enabled: true, messageType: 'template', templateName: 'hello_world', language: 'en' };
      return { promise: () => Promise.resolve(item ? { Item: item } : {}) };
    });
    // No matching lead on the company-phone-index GSI -> falls into the
    // unknown-contact (INBOX#) branch, not the known-lead branch.
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
  });

  test('AI fails to respond (maybeStart correctly signals false, post-fix) — welcome message sent AND whatsapp_conversation_started fires', async () => {
    ConversationalAgentService.maybeStart.mockResolvedValue(false); // no reply was sent this turn

    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'Hi' } }) }, mockRes(), jest.fn());

    expect(WASendSvc.sendTemplate).toHaveBeenCalled(); // welcome message correctly fires
    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(
      CID, 'whatsapp_conversation_started',
      expect.objectContaining({ phone: PHONE10, source: 'whatsapp' }),
    );
    // 2026-07-09 Phase 2 (docs/phase3/TECHNICAL_DEBT.md, FIX 2): confirms the
    // real webhook handler — not just DelayedResponseService's own unit tests
    // — actually threads source: 'whatsapp' through on this branch.
    expect(DelayedResponseService.scheduleIfEnabled).toHaveBeenCalledWith(
      CID, expect.objectContaining({ phone: PHONE10, source: 'whatsapp' }),
    );
  });

  // This is the exact regression this fix targets: before it, maybeStart()
  // returned true here regardless of the underlying failure reason
  // (disabled_usecase in the confirmed live incident; rate_limited,
  // disabled_master, provider_error, and invalid_output are the same class —
  // see conversationalAgentService.test.js for per-reason coverage of
  // maybeStart() itself). whatsapp.js's own gate is correctly reason-blind: it
  // only needs an honest true/false signal, which is what this fix restores.
  test('a reply WAS sent (maybeStart correctly signals true) — welcome message AND whatsapp_conversation_started correctly stay suppressed', async () => {
    ConversationalAgentService.maybeStart.mockResolvedValue(true); // the bot actually replied

    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'Hi' } }) }, mockRes(), jest.fn());

    expect(WASendSvc.sendTemplate).not.toHaveBeenCalled();
    expect(WASendSvc.sendInteractive).not.toHaveBeenCalled();
    expect(AutomationEngine.fireTrigger).not.toHaveBeenCalledWith(CID, 'whatsapp_conversation_started', expect.anything());
  });
});
