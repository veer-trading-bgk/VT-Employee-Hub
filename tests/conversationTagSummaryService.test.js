'use strict';

/**
 * Unit tests for ConversationTagSummaryService — the tag+summary AI feature.
 * Mirrors IntentDetectionService.test's direct-call, mocked-dependencies
 * convention. Every dependency is mocked at the module boundary so these
 * tests exercise only this service's own logic (gating, re-validation,
 * LEAD# vs INBOX# behavior split), not AIService/ContactBulkOpsService/
 * NoteService's own internals (those have their own test suites).
 */

jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/AIService', () => ({ generate: jest.fn() }));
jest.mock('../src/services/ConversationService', () => ({
  getConversation: jest.fn(),
  markTagSummaryGenerated: jest.fn(),
}));
jest.mock('../src/services/TagService', () => ({ getCatalog: jest.fn() }));
jest.mock('../src/services/ContactBulkOpsService', () => ({ updateTags: jest.fn() }));
jest.mock('../src/services/NoteService', () => ({ createNote: jest.fn() }));
jest.mock('../src/utils/conversationTranscript', () => ({ fetchTranscriptText: jest.fn() }));

const logger = require('../src/config/logger');
const AIService = require('../src/services/AIService');
const ConversationService = require('../src/services/ConversationService');
const TagService = require('../src/services/TagService');
const ContactBulkOpsService = require('../src/services/ContactBulkOpsService');
const NoteService = require('../src/services/NoteService');
const { fetchTranscriptText } = require('../src/utils/conversationTranscript');
const ConversationTagSummaryService = require('../src/services/ConversationTagSummaryService');

const CATALOG = [
  { id: 't_hot', label: 'Hot Lead', color: '#f00', aiAssignable: true },
  { id: 't_vip', label: 'VIP', color: '#0f0', aiAssignable: false }, // not offered to the model
  { id: 't_kyc', label: 'KYC Pending', color: '#00f', aiAssignable: true },
];

describe('ConversationTagSummaryService.analyzeIfNeededForLead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConversationService.getConversation.mockResolvedValue({ conversationId: 'conv_1' });
    TagService.getCatalog.mockResolvedValue(CATALOG);
    fetchTranscriptText.mockResolvedValue('Customer: hi\nAI: hello');
    ConversationService.markTagSummaryGenerated.mockResolvedValue({ tagSummaryAt: '2026-07-15T00:00:00.000Z' });
    ContactBulkOpsService.updateTags.mockResolvedValue({ tags: [] });
    NoteService.createNote.mockResolvedValue({ timestamp: 't', note: {} });
  });

  test('no-ops if the conversation cannot be found', async () => {
    ConversationService.getConversation.mockResolvedValue(null);
    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('no-ops if already analyzed (tagSummaryAt already set)', async () => {
    ConversationService.getConversation.mockResolvedValue({ conversationId: 'conv_1', tagSummaryAt: '2026-07-14T00:00:00.000Z' });
    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('calls AIService.generate with the aiAssignable-filtered tag list and the transcript', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: ['t_hot'], summary: 'Customer wants a Demat account.' } });

    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      useCase: 'conversation-tag-summary',
      companyId: 'acme',
      context: {
        tagList: '- t_hot: Hot Lead\n- t_kyc: KYC Pending',
        transcript: 'Customer: hi\nAI: hello',
      },
      user: { id: 'system', role: 'admin', name: 'AI Assistant' },
      entityType: 'conversation',
      entityId: 'conv_1',
    }));
  });

  test('applies returned tags and writes the summary as a note ending with the AI marker', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: ['t_hot', 't_kyc'], summary: 'Customer wants a Demat account.' } });

    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');

    expect(ConversationService.markTagSummaryGenerated).toHaveBeenCalledWith('acme', 'conv_1');
    expect(ContactBulkOpsService.updateTags).toHaveBeenCalledWith('acme', { leadId: 'lead_1' }, { add: ['t_hot', 't_kyc'] });
    expect(NoteService.createNote).toHaveBeenCalledWith('acme', 'lead_1', {
      content: 'Customer wants a Demat account.\n\n— Summarized by AI',
      authorId: 'system',
      authorName: 'AI Assistant',
    });
  });

  test('drops any tagId not in the aiAssignable set, including a hallucinated id', async () => {
    AIService.generate.mockResolvedValue({
      ok: true,
      data: { tagIds: ['t_hot', 't_vip', 't_does_not_exist'], summary: 'Summary text.' },
    });

    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');

    // t_vip exists but aiAssignable:false, t_does_not_exist is hallucinated — both dropped
    expect(ContactBulkOpsService.updateTags).toHaveBeenCalledWith('acme', { leadId: 'lead_1' }, { add: ['t_hot'] });
  });

  test('skips updateTags entirely when no valid tags survive filtering, but still writes the note', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: ['t_vip'], summary: 'Summary text.' } });

    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');

    expect(ContactBulkOpsService.updateTags).not.toHaveBeenCalled();
    expect(NoteService.createNote).toHaveBeenCalled();
  });

  test('renders the empty-catalog placeholder when no tags are aiAssignable', async () => {
    TagService.getCatalog.mockResolvedValue([{ id: 't_vip', label: 'VIP', color: '#0f0', aiAssignable: false }]);
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: [], summary: 'Summary text.' } });

    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');

    expect(AIService.generate).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ tagList: '(no tags configured — do not return any tagIds)' }),
    }));
  });

  test('silently no-ops on a disabled/rate-limited/provider-error result — no mark, no tags, no note', async () => {
    AIService.generate.mockResolvedValue({ ok: false, reason: 'disabled_usecase' });

    await ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1');

    expect(ConversationService.markTagSummaryGenerated).not.toHaveBeenCalled();
    expect(ContactBulkOpsService.updateTags).not.toHaveBeenCalled();
    expect(NoteService.createNote).not.toHaveBeenCalled();
  });

  test('never throws — a downstream failure is caught and logged as a warning', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: ['t_hot'], summary: 'Summary text.' } });
    NoteService.createNote.mockRejectedValue(new Error('dynamo down'));

    await expect(
      ConversationTagSummaryService.analyzeIfNeededForLead('acme', 'conv_1', 'LEAD#acme#lead_1', 'lead_1'),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('LEAD#acme#lead_1'));
  });
});

describe('ConversationTagSummaryService.analyzeIfNeededForInbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConversationService.getConversation.mockResolvedValue({ conversationId: 'conv_1' });
    TagService.getCatalog.mockResolvedValue(CATALOG);
    fetchTranscriptText.mockResolvedValue('Customer: hi');
    ConversationService.markTagSummaryGenerated.mockResolvedValue({ tagSummaryAt: '2026-07-15T00:00:00.000Z' });
    ContactBulkOpsService.updateTags.mockResolvedValue({ tags: [] });
  });

  test('applies tags but never writes a note (no note target for an unknown contact)', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: ['t_hot'], summary: 'A summary that gets discarded.' } });

    await ConversationTagSummaryService.analyzeIfNeededForInbox('acme', 'conv_1', 'INBOX#acme#9886141993', '9886141993');

    expect(ContactBulkOpsService.updateTags).toHaveBeenCalledWith('acme', { phone: '9886141993' }, { add: ['t_hot'] });
    expect(NoteService.createNote).not.toHaveBeenCalled();
  });

  test('skips updateTags when no tags survive filtering', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: [], summary: 'Discarded.' } });

    await ConversationTagSummaryService.analyzeIfNeededForInbox('acme', 'conv_1', 'INBOX#acme#9886141993', '9886141993');

    expect(ContactBulkOpsService.updateTags).not.toHaveBeenCalled();
  });

  test('no-ops if already analyzed', async () => {
    ConversationService.getConversation.mockResolvedValue({ conversationId: 'conv_1', tagSummaryAt: '2026-07-14T00:00:00.000Z' });
    await ConversationTagSummaryService.analyzeIfNeededForInbox('acme', 'conv_1', 'INBOX#acme#9886141993', '9886141993');
    expect(AIService.generate).not.toHaveBeenCalled();
  });

  test('never throws — a downstream failure is caught and logged as a warning', async () => {
    AIService.generate.mockResolvedValue({ ok: true, data: { tagIds: ['t_hot'], summary: 'x' } });
    ContactBulkOpsService.updateTags.mockRejectedValue(new Error('dynamo down'));

    await expect(
      ConversationTagSummaryService.analyzeIfNeededForInbox('acme', 'conv_1', 'INBOX#acme#9886141993', '9886141993'),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('INBOX#acme#9886141993'));
  });
});
