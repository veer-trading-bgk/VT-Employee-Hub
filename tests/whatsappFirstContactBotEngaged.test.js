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
  cancelPending:     jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/AutomationEngine', () => ({
  fireTrigger:         jest.fn().mockResolvedValue(undefined),
  resumeOnButtonReply: jest.fn().mockResolvedValue(undefined),
  hasActiveWorkflow:   jest.fn().mockResolvedValue(false), // default: no conversation-started workflow → maybeStart runs as today
}));
jest.mock('../src/services/CustomerIdentityService', () => ({
  resolveOrCreate: jest.fn(),
}));
jest.mock('../src/services/ConversationalAgentService', () => ({
  maybeStart:   jest.fn(),
  continueTurn: jest.fn(),
  startForLead: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const WASendSvc = require('../src/services/WhatsAppSendService');
const AutomationEngine = require('../src/services/AutomationEngine');
const ConversationalAgentService = require('../src/services/ConversationalAgentService');
const DelayedResponseService = require('../src/services/DelayedResponseService');
const WorkingHoursService = require('../src/services/WorkingHoursService');
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

  // ── Era 48: a company that owns first-contact via a whatsapp_conversation_started
  //    workflow suppresses the auto AI-start, so the workflow drives engagement. ──
  test('active whatsapp_conversation_started workflow present — maybeStart is SKIPPED and the workflow fires instead', async () => {
    AutomationEngine.hasActiveWorkflow.mockResolvedValue(true); // this company owns first-contact via a workflow

    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'Hi' } }) }, mockRes(), jest.fn());

    expect(AutomationEngine.hasActiveWorkflow).toHaveBeenCalledWith(CID, 'whatsapp_conversation_started');
    expect(ConversationalAgentService.maybeStart).not.toHaveBeenCalled();      // AI did NOT pre-empt the workflow
    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(CID, 'whatsapp_conversation_started', expect.anything()); // workflow drives it
  });

  test('no whatsapp_conversation_started workflow (default) — maybeStart runs exactly as today', async () => {
    AutomationEngine.hasActiveWorkflow.mockResolvedValue(false); // no such workflow
    ConversationalAgentService.maybeStart.mockResolvedValue(false);

    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'Hi' } }) }, mockRes(), jest.fn());

    expect(AutomationEngine.hasActiveWorkflow).toHaveBeenCalledWith(CID, 'whatsapp_conversation_started');
    expect(ConversationalAgentService.maybeStart).toHaveBeenCalledTimes(1);    // unchanged from today
  });

  // ── Free text = engagement (2026-07-15, 19_DECISION_LOG.md) ──────────────────
  // A typed message on an unengaged, unassigned conversation now starts the AI
  // via startForLead(), in BOTH branches — not only on first contact (maybeStart)
  // or an already-'ai' convo (continueTurn). startForLead()'s own guards
  // (cfg.enabled / assignedTo / handoffState) are unit-tested in
  // conversationalAgentService.test.js; here we test whatsapp.js's WIRING.
  const LEAD_PK = `LEAD#${CID}#lead_1`;
  const LEAD_ITEM = { PK: LEAD_PK, SK: 'METADATA', leadId: 'lead_1', companyId: CID, name: 'Ravi', phone: PHONE10, phoneNorm: PHONE10, stage: 'new_lead', assignedTo: null };
  function existingContactGet() {
    dynamodb.get.mockImplementation((params) => {
      const pk = params?.Key?.PK ?? '';
      let item;
      if (pk.startsWith('CONFIG#PHONEID#')) item = { companyId: CID };
      else if (pk.startsWith('CONFIG#WABA#')) item = { companyId: CID, phoneNumberId: PHONE_NUMBER_ID, accessToken: 'tok' };
      else if (pk.startsWith('INBOX#') && params.Key.SK === 'CONTACT') item = { PK: pk, SK: 'CONTACT', phone: PHONE10 }; // exists -> isFirstContact false
      else if (pk.startsWith('CONFIG#WELCOME#')) item = { enabled: true, messageType: 'template', templateName: 'hello_world', language: 'en' };
      return { promise: () => Promise.resolve(item ? { Item: item } : {}) };
    });
  }
  function knownLeadQuery() {
    dynamodb.query.mockImplementation((params) => ({
      promise: () => Promise.resolve({ Items: params?.IndexName === 'company-phone-index' ? [LEAD_ITEM] : [] }),
    }));
  }

  test('unknown contact, NOT first contact, free text -> startForLead engages; welcome/keyword/conversation_started suppressed', async () => {
    existingContactGet();
    ConversationalAgentService.startForLead.mockResolvedValue(true);
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'what are your charges?' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.maybeStart).not.toHaveBeenCalled(); // not first contact
    expect(ConversationalAgentService.startForLead).toHaveBeenCalledWith(CID, expect.objectContaining({
      phone10: PHONE10, name: 'New Customer', contextHint: 'what are your charges?',
    }));
    // welcome/conversation_started are first-contact-gated (isFirstContact is false here),
    // so the meaningful suppression on this later-turn path is keyword + delayed-response.
    expect(AutomationEngine.fireTrigger).not.toHaveBeenCalledWith(CID, 'keyword_message', expect.anything());
    expect(DelayedResponseService.cancelPending).toHaveBeenCalledWith(CID, PHONE10); // decision 4: EXPLICIT cancel on engagement
  });

  test('overrides a paused whatsapp_conversation_started workflow — later free text still engages via startForLead', async () => {
    existingContactGet();
    AutomationEngine.hasActiveWorkflow.mockResolvedValue(true); // a workflow owned first contact
    ConversationalAgentService.startForLead.mockResolvedValue(true);
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'actually can you help me directly' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.startForLead).toHaveBeenCalledTimes(1); // not gated by the workflow (that only guards first-contact maybeStart)
    expect(ConversationalAgentService.maybeStart).not.toHaveBeenCalled();
    expect(DelayedResponseService.cancelPending).toHaveBeenCalledWith(CID, PHONE10);
  });

  test('unknown contact, later free text, startForLead declines (assigned/disabled) -> keyword_message still fires', async () => {
    existingContactGet();
    ConversationalAgentService.startForLead.mockResolvedValue(false);
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'hello again' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.startForLead).toHaveBeenCalledTimes(1);
    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({ messageText: 'hello again' }));
    expect(DelayedResponseService.cancelPending).not.toHaveBeenCalled(); // declined -> no engagement -> no cancel
  });

  test('REGRESSION: a button_reply never triggers startForLead (type-gated) and the resume path still runs', async () => {
    existingContactGet();
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'btn-1', title: 'Open Demat' } } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.startForLead).not.toHaveBeenCalled(); // not text
    expect(AutomationEngine.resumeOnButtonReply).toHaveBeenCalledWith(CID, PHONE10, 'btn-1');
  });

  test('known lead never AI-engaged (continueTurn false), free text -> startForLead engages; OOO/keyword suppressed', async () => {
    knownLeadQuery();
    ConversationalAgentService.continueTurn.mockResolvedValue(false); // not already 'ai'
    ConversationalAgentService.startForLead.mockResolvedValue(true);
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'is there a fee?' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.continueTurn).toHaveBeenCalledTimes(1);
    expect(ConversationalAgentService.startForLead).toHaveBeenCalledWith(CID, expect.objectContaining({
      leadPK: LEAD_PK, phone10: PHONE10, name: 'Ravi', contextHint: 'is there a fee?',
    }));
    expect(WorkingHoursService.shouldSendOOO).not.toHaveBeenCalled(); // OOO block skipped (botHandled)
    expect(AutomationEngine.fireTrigger).not.toHaveBeenCalledWith(CID, 'keyword_message', expect.anything());
    expect(DelayedResponseService.cancelPending).toHaveBeenCalledWith(CID, PHONE10); // decision 4: EXPLICIT cancel on engagement
  });

  test('known lead, continueTurn false, startForLead declines -> OOO/keyword fall through, no delayed-response cancel', async () => {
    knownLeadQuery();
    ConversationalAgentService.continueTurn.mockResolvedValue(false);
    ConversationalAgentService.startForLead.mockResolvedValue(false);
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'anyone there?' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.startForLead).toHaveBeenCalledTimes(1);
    expect(AutomationEngine.fireTrigger).toHaveBeenCalledWith(CID, 'keyword_message', expect.objectContaining({ messageText: 'anyone there?' }));
    expect(DelayedResponseService.cancelPending).not.toHaveBeenCalled();
  });

  test('known lead already AI-carried (continueTurn true) -> startForLead NOT called (no double-engage)', async () => {
    knownLeadQuery();
    ConversationalAgentService.continueTurn.mockResolvedValue(true);
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'thanks' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.startForLead).not.toHaveBeenCalled();
  });

  test('REGRESSION (known lead): a button_reply never triggers startForLead; resume still runs', async () => {
    knownLeadQuery();
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'btn-9', title: 'Yes' } } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.startForLead).not.toHaveBeenCalled();
    expect(ConversationalAgentService.continueTurn).not.toHaveBeenCalled(); // not text
    expect(AutomationEngine.resumeOnButtonReply).toHaveBeenCalledWith(CID, PHONE10, 'btn-9');
  });

  test('first contact: startForLead is NOT used — maybeStart still owns first contact, even when it declines', async () => {
    AutomationEngine.hasActiveWorkflow.mockResolvedValue(false); // clearAllMocks doesn't reset mockResolvedValue — undo a prior test's true
    ConversationalAgentService.maybeStart.mockResolvedValue(false); // default get -> isFirstContact true
    const handler = getRouteHandler(whatsappRouter, '/webhook', 'post');
    await handler({ body: webhookBody({ type: 'text', text: { body: 'Hi' } }) }, mockRes(), jest.fn());

    expect(ConversationalAgentService.maybeStart).toHaveBeenCalledTimes(1);
    expect(ConversationalAgentService.startForLead).not.toHaveBeenCalled(); // isFirstContact gate
  });
});
