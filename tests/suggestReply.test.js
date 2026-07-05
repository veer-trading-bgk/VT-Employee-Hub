'use strict';

/**
 * POST /api/whatsapp/inbox/suggest-reply — AI Template Suggestions in Chat
 * (aiConfig.js's 'inbox-template-suggestion' useCase). Same direct-handler-
 * invocation technique as templatesAiDraft.test.js: no HTTP, no auth,
 * AIService/WhatsAppSendService/ContactService mocked.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AIService', () => ({
  generate: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  resolveContact: jest.fn(),
}));
jest.mock('../src/services/ContactService', () => ({
  getContact: jest.fn(),
}));

// whatsapp.js refuses to load without this (real S3 client instantiation at
// require time, no network call) — not exercised by these handler tests.
process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';

const dynamodb = require('../src/config/dynamodb');
const AIService = require('../src/services/AIService');
const WASendSvc = require('../src/services/WhatsAppSendService');
const ContactService = require('../src/services/ContactService');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const AGENT = { id: 'emp_1', name: 'Agent', role: 'telecaller', companyId: 'comp_test' };
const ADMIN = { id: 'admin_1', name: 'Admin', role: 'admin', companyId: 'comp_test' };

const LEAD_CONTACT = {
  pk: 'LEAD#comp_test#lead1',
  phone: '9876543210',
  isLead: true,
  leadItem: {
    PK: 'LEAD#comp_test#lead1', assignedTo: 'emp_1', intent: 'kyc_query', confidence: 0.8, contactId: null,
  },
};

const APPROVED_TEMPLATE = {
  id: 'tmpl_1', name: 'KYC Reminder', category: 'UTILITY', language: 'en',
  bodyPreview: 'Your KYC is pending', variables: ['name'], status: 'APPROVED',
};

function mockMessages(items) {
  dynamodb.query.mockImplementation((params) => {
    if (params.ExpressionAttributeValues[':pfx'] === 'MSG#') {
      return { promise: () => Promise.resolve({ Items: items }) };
    }
    if (params.ExpressionAttributeValues[':pk'] === 'CONFIG#TMPL#comp_test') {
      return { promise: () => Promise.resolve({ Items: [APPROVED_TEMPLATE] }) };
    }
    return { promise: () => Promise.resolve({ Items: [] }) };
  });
}

describe('POST /api/whatsapp/inbox/suggest-reply', () => {
  const handler = getRouteHandler(whatsappRouter, '/inbox/suggest-reply', 'post');
  beforeEach(() => {
    jest.clearAllMocks();
    WASendSvc.resolveContact.mockResolvedValue(LEAD_CONTACT);
    mockMessages([
      { direction: 'inbound', type: 'text', content: 'Can you help with my KYC?', SK: 'MSG#2' },
      { direction: 'outbound', type: 'text', content: 'Sure, one moment', SK: 'MSG#1' },
    ]);
  });

  test('route is registered', () => {
    expect(handler).toBeInstanceOf(Function);
  });

  test('400s without resolving a contact when leadId/leadPK/phone are all missing', async () => {
    const res = mockRes();
    await handler({ user: AGENT, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(WASendSvc.resolveContact).not.toHaveBeenCalled();
  });

  test('403s a restricted-role agent whose lead is assigned to someone else', async () => {
    WASendSvc.resolveContact.mockResolvedValue({ ...LEAD_CONTACT, leadItem: { ...LEAD_CONTACT.leadItem, assignedTo: 'emp_2' } });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('an admin may request a suggestion for a lead not assigned to them', async () => {
    WASendSvc.resolveContact.mockResolvedValue({ ...LEAD_CONTACT, leadItem: { ...LEAD_CONTACT.leadItem, assignedTo: 'emp_2' } });
    AIService.generate.mockResolvedValue({ ok: true, approvalRequired: false, data: { hasSuggestion: false, reasoning: 'x', confidence: 0.9 } });
    const res = mockRes();
    await handler({ user: ADMIN, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(AIService.generate).toHaveBeenCalled();
  });

  test('short-circuits with no_approved_templates and never calls AIService when none exist', async () => {
    dynamodb.query.mockImplementation((params) => {
      if (params.ExpressionAttributeValues[':pfx'] === 'MSG#') return { promise: () => Promise.resolve({ Items: [] }) };
      return { promise: () => Promise.resolve({ Items: [] }) }; // no approved templates
    });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, hasSuggestion: false, reason: 'no_approved_templates' });
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('calls AIService.generate with useCase, conversationHistory, prior intent, and assigneeId = requesting agent', async () => {
    AIService.generate.mockResolvedValue({ ok: true, approvalRequired: false, data: { hasSuggestion: false, reasoning: 'x', confidence: 0.9 } });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'inbox-template-suggestion',
      companyId: 'comp_test',
      user: AGENT,
      assigneeId: 'emp_1',
      conversationHistory: [
        { role: 'assistant', content: 'Sure, one moment' },
        { role: 'user', content: 'Can you help with my KYC?' },
      ],
      context: expect.objectContaining({
        latestMessage: 'Can you help with my KYC?',
        priorIntent: 'kyc_query',
        priorIntentConfidence: 0.8,
        preferredLanguage: null,
        templates: [expect.objectContaining({ id: 'tmpl_1', name: 'KYC Reminder' })],
      }),
    }));
  });

  test('fetches preferredLanguage only when the lead is linked to a CONTACT# profile (contactId present)', async () => {
    WASendSvc.resolveContact.mockResolvedValue({ ...LEAD_CONTACT, leadItem: { ...LEAD_CONTACT.leadItem, contactId: 'contact_1' } });
    ContactService.getContact.mockResolvedValue({ preferredLanguage: 'hi' });
    AIService.generate.mockResolvedValue({ ok: true, approvalRequired: false, data: { hasSuggestion: false, reasoning: 'x', confidence: 0.9 } });

    await handler({ user: AGENT, body: { leadId: 'lead1' } }, mockRes(), jest.fn());

    expect(ContactService.getContact).toHaveBeenCalledWith('comp_test', 'contact_1');
    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ preferredLanguage: 'hi' }),
    }));
  });

  test('skips the CONTACT# lookup entirely when contactId is absent (the common case)', async () => {
    AIService.generate.mockResolvedValue({ ok: true, approvalRequired: false, data: { hasSuggestion: false, reasoning: 'x', confidence: 0.9 } });
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, mockRes(), jest.fn());
    expect(ContactService.getContact).not.toHaveBeenCalled();
  });

  test('reads intent from INBOX#CONTACT for an unknown (non-lead) contact', async () => {
    WASendSvc.resolveContact.mockResolvedValue({ pk: 'INBOX#comp_test#9876543210', phone: '9876543210', isLead: false, leadItem: null });
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { intent: 'pricing_question', confidence: 0.6 } }) });
    AIService.generate.mockResolvedValue({ ok: true, approvalRequired: false, data: { hasSuggestion: false, reasoning: 'x', confidence: 0.9 } });

    await handler({ user: AGENT, body: { phone: '9876543210' } }, mockRes(), jest.fn());

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: 'INBOX#comp_test#9876543210', SK: 'CONTACT' },
    }));
    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ priorIntent: 'pricing_question', priorIntentConfidence: 0.6 }),
    }));
  });

  test('maps disabled_master to 503 via the shared sendAIError', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'disabled_master', detail: 'AI is disabled for this company.' });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('returns hasSuggestion: false with reason pending_approval when the confidence gate routes to Approval — no send-from-Approval pipeline', async () => {
    AIService.generate.mockResolvedValue({
      ok: true, approvalRequired: true, approvalId: 'appr_1',
      data: { hasSuggestion: true, templateId: 'tmpl_1', variableValues: ['Ravi'], reasoning: 'low confidence pick', confidence: 0.4 },
    });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, hasSuggestion: false, reason: 'pending_approval' });
  });

  test('returns hasSuggestion: false with reason no_good_fit when the model itself found nothing suitable', async () => {
    AIService.generate.mockResolvedValue({ ok: true, approvalRequired: false, data: { hasSuggestion: false, reasoning: 'nothing fits', confidence: 0.9 } });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, hasSuggestion: false, reason: 'no_good_fit' });
  });

  test('returns hasSuggestion: false with reason invalid_model_output when the model hallucinates a templateId not in the registry', async () => {
    AIService.generate.mockResolvedValue({
      ok: true, approvalRequired: false,
      data: { hasSuggestion: true, templateId: 'tmpl_does_not_exist', variableValues: ['Ravi'], reasoning: 'x', confidence: 0.9 },
    });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, hasSuggestion: false, reason: 'invalid_model_output' });
  });

  test('returns hasSuggestion: false with reason invalid_model_output when variableValues length does not match the template', async () => {
    AIService.generate.mockResolvedValue({
      ok: true, approvalRequired: false,
      data: { hasSuggestion: true, templateId: 'tmpl_1', variableValues: ['Ravi', 'extra'], reasoning: 'x', confidence: 0.9 },
    });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, hasSuggestion: false, reason: 'invalid_model_output' });
  });

  test('returns a full, validated suggestion on a genuine high-confidence match', async () => {
    AIService.generate.mockResolvedValue({
      ok: true, approvalRequired: false,
      data: { hasSuggestion: true, templateId: 'tmpl_1', variableValues: ['Ravi'], reasoning: 'Matches the KYC question directly.', confidence: 0.92 },
    });
    const res = mockRes();
    await handler({ user: AGENT, body: { leadId: 'lead1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      hasSuggestion: true,
      template: { id: 'tmpl_1', name: 'KYC Reminder', bodyPreview: 'Your KYC is pending', variables: ['name'] },
      variableValues: ['Ravi'],
      reasoning: 'Matches the KYC question directly.',
      confidence: 0.92,
    });
  });
});
