'use strict';

/**
 * IntentDetectionService — the first real feature built on AIService.js.
 * Fire-and-forget, never-throws convention (matches conversationResolver.js's
 * own contract), triggered once per conversation from the webhook. Writes the
 * canonical classification onto CONV# via ConversationService, and mirrors it
 * onto LEAD#/INBOX# (read-optimised denormalisation, same pattern
 * lastMessageAt/lastMessagePreview already use) so Contact 360's existing
 * GET /api/crm/leads/:id response carries intent/confidence with zero new
 * routes or Customer360Context changes.
 */

jest.mock('../src/config/dynamodb', () => ({
  update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AIService', () => ({
  generate: jest.fn(),
}));
jest.mock('../src/services/ConversationService', () => ({
  getConversation: jest.fn(),
  classifyIntent: jest.fn(),
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const dynamodb = require('../src/config/dynamodb');
const AIService = require('../src/services/AIService');
const ConversationService = require('../src/services/ConversationService');
const IntentDetectionService = require('../src/services/IntentDetectionService');

const CID = 'comp_test';
const CVID = 'conv_01ABCDEFGHJK';
const LEAD_PK = `LEAD#${CID}#lead_001`;
const INBOX_PK = `INBOX#${CID}#9876543210`;
const TEXT = 'What documents do I need for KYC?';

beforeEach(() => {
  jest.clearAllMocks();
  dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });
  ConversationService.getConversation.mockResolvedValue({ conversationId: CVID, classifiedAt: null });
  ConversationService.classifyIntent.mockResolvedValue({ intent: 'kyc_query', confidence: 0.9, classifiedAt: '2026-07-05T09:00:00.000Z' });
  AIService.generate.mockResolvedValue({ ok: true, data: { intent: 'kyc_query', confidence: 0.9 }, usage: {} });
});

describe('classifyIfNeededForLead()', () => {
  test('calls AIService.generate with the inbox-intent-detection useCase and the message text', async () => {
    await IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT);
    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'inbox-intent-detection',
      companyId: CID,
      context: { message: TEXT },
      user: expect.objectContaining({ id: 'system' }),
    }));
  });

  test('writes the classification onto CONV# via ConversationService.classifyIntent', async () => {
    await IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT);
    expect(ConversationService.classifyIntent).toHaveBeenCalledWith(CID, CVID, { intent: 'kyc_query', confidence: 0.9 });
  });

  test('mirrors the classification onto LEAD# METADATA', async () => {
    await IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      UpdateExpression: expect.stringContaining('intent'),
      ExpressionAttributeValues: expect.objectContaining({
        ':i': 'kyc_query', ':c': 0.9, ':ca': '2026-07-05T09:00:00.000Z',
      }),
    }));
  });

  test('skips entirely — no AIService call — when the conversation is already classified', async () => {
    ConversationService.getConversation.mockResolvedValue({ conversationId: CVID, classifiedAt: '2026-07-01T00:00:00.000Z' });
    await IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT);
    expect(AIService.generate).not.toHaveBeenCalled();
    expect(ConversationService.classifyIntent).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('skips when the conversation cannot be found', async () => {
    ConversationService.getConversation.mockResolvedValue(null);
    await IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('does not write anything when AIService returns ok: false (disabled/rate-limited/provider error)', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'disabled_usecase', detail: 'off' });
    await IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT);
    expect(ConversationService.classifyIntent).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('never throws — swallows an AIService error', async () => {
    AIService.generate.mockRejectedValue(new Error('network down'));
    await expect(IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT)).resolves.toBeUndefined();
  });

  test('never throws — swallows a ConversationService.getConversation error', async () => {
    ConversationService.getConversation.mockRejectedValue(new Error('DDB timeout'));
    await expect(IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT)).resolves.toBeUndefined();
  });

  test('never throws — swallows a ConversationService.classifyIntent error', async () => {
    ConversationService.classifyIntent.mockRejectedValue(new Error('write failed'));
    await expect(IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT)).resolves.toBeUndefined();
  });

  test('never throws — swallows the LEAD# mirror-write DynamoDB error', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(new Error('DDB down')) });
    await expect(IntentDetectionService.classifyIfNeededForLead(CID, CVID, LEAD_PK, TEXT)).resolves.toBeUndefined();
  });
});

describe('classifyIfNeededForInbox()', () => {
  test('mirrors the classification onto INBOX# CONTACT (not METADATA)', async () => {
    await IntentDetectionService.classifyIfNeededForInbox(CID, CVID, INBOX_PK, TEXT);
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
      ExpressionAttributeValues: expect.objectContaining({ ':i': 'kyc_query', ':c': 0.9 }),
    }));
  });

  test('writes the canonical CONV# classification the same way as the lead path', async () => {
    await IntentDetectionService.classifyIfNeededForInbox(CID, CVID, INBOX_PK, TEXT);
    expect(ConversationService.classifyIntent).toHaveBeenCalledWith(CID, CVID, { intent: 'kyc_query', confidence: 0.9 });
  });

  test('skips when already classified', async () => {
    ConversationService.getConversation.mockResolvedValue({ conversationId: CVID, classifiedAt: '2026-07-01T00:00:00.000Z' });
    await IntentDetectionService.classifyIfNeededForInbox(CID, CVID, INBOX_PK, TEXT);
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('never throws — swallows any internal error', async () => {
    AIService.generate.mockRejectedValue(new Error('boom'));
    await expect(IntentDetectionService.classifyIfNeededForInbox(CID, CVID, INBOX_PK, TEXT)).resolves.toBeUndefined();
  });
});
