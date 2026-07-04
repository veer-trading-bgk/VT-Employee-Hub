'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/dynamodb', () => ({
  get:    jest.fn(),
  update: jest.fn(),
}));
jest.mock('../src/services/ContactService');
jest.mock('../src/services/ConversationService');

const dynamodb            = require('../src/config/dynamodb');
const ContactService      = require('../src/services/ContactService');
const ConversationService = require('../src/services/ConversationService');
const resolver            = require('../src/utils/conversationResolver');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID      = 'comp_test';
const PHONE10  = '9901251785';
const INBOX_PK = `INBOX#${CID}#${PHONE10}`;
const LEAD_PK  = `LEAD#${CID}#lead_abc`;

const CONTACT = Object.freeze({ contactId: 'contact_01', phoneE164: '+919901251785', displayName: 'Alice' });
const CONV    = Object.freeze({ conversationId: 'conv_01ABCDEFGHJK' });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

  // Default: no existing convId on DDB items
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
  dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

  // ContactService defaults
  ContactService.createContact.mockResolvedValue({ contact: CONTACT, created: true });
  ContactService.findContactByPhone.mockResolvedValue(null);

  // ConversationService defaults
  ConversationService.createConversation.mockResolvedValue(CONV);
  ConversationService.updateLastMessage.mockResolvedValue(undefined);
  ConversationService.incrementUnread.mockResolvedValue(undefined);
  ConversationService.resolveConversation.mockResolvedValue(undefined);
  ConversationService.reopenConversation.mockResolvedValue(undefined);
  ConversationService.markRead.mockResolvedValue(undefined);
});

afterEach(() => { delete process.env.DYNAMODB_TABLE_METRICS; });

// ─── resolveForInbox ──────────────────────────────────────────────────────────

describe('resolveForInbox()', () => {
  test('creates Contact + CONV# when no convId on CONTACT item', async () => {
    await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'hi', timestamp: '2026-06-28T00:00:00.000Z' });
    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ phone: PHONE10, source: 'whatsapp_inbound' }),
      'system',
    );
    expect(ConversationService.createConversation).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ contactId: CONTACT.contactId, channel: 'whatsapp' }),
      'system',
    );
  });

  test('stores convId and contactId on INBOX# CONTACT item', async () => {
    await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: '', timestamp: '' });
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
      ExpressionAttributeValues: expect.objectContaining({
        ':cv':   CONV.conversationId,
        ':ctid': CONTACT.contactId,
      }),
    }));
  });

  test('uses if_not_exists to guard concurrent webhook races', async () => {
    await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK });
    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toMatch(/if_not_exists\(convId/);
    expect(call.UpdateExpression).toMatch(/if_not_exists\(contactId/);
  });

  test('passes waName as displayName when available', async () => {
    await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, waName: 'Alice Smith' });
    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ displayName: 'Alice Smith' }),
      'system',
    );
  });

  test('falls back to phone10 as displayName when no waName', async () => {
    await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK });
    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ displayName: PHONE10 }),
      'system',
    );
  });

  test('updates existing CONV# when convId is found on CONTACT item', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { convId: 'conv_existing' } }),
    });
    await resolver.resolveForInbox(CID, PHONE10, {
      inboxPK: INBOX_PK, text: 'reply', timestamp: '2026-06-28T10:00:00.000Z',
    });
    expect(ContactService.createContact).not.toHaveBeenCalled();
    expect(ConversationService.createConversation).not.toHaveBeenCalled();
    expect(ConversationService.updateLastMessage).toHaveBeenCalledWith(
      CID, 'conv_existing',
      expect.objectContaining({ text: 'reply' }),
    );
    expect(ConversationService.incrementUnread).toHaveBeenCalledWith(CID, 'conv_existing', 1);
  });

  test('returns { conversationId } on the fast (existing convId) path — lets IntentDetectionService chain off it', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { convId: 'conv_existing' } }),
    });
    const result = await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK });
    expect(result).toEqual({ conversationId: 'conv_existing' });
  });

  test('returns { conversationId } on the creation path', async () => {
    const result = await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'hi', timestamp: '2026-06-28T00:00:00.000Z' });
    expect(result).toEqual({ conversationId: CONV.conversationId });
  });

  test('does NOT call createContact when convId is already present', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_x' } }) });
    await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK });
    expect(ContactService.createContact).not.toHaveBeenCalled();
  });

  test('never throws — catches ContactService error', async () => {
    ContactService.createContact.mockRejectedValue(new Error('DDB down'));
    await expect(resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK })).resolves.toBeUndefined();
  });

  test('never throws — catches ConversationService error', async () => {
    ConversationService.createConversation.mockRejectedValue(new Error('conv error'));
    await expect(resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK })).resolves.toBeUndefined();
  });

  test('never throws — catches DynamoDB error on initial get', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    await expect(resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK })).resolves.toBeUndefined();
  });
});

// ─── resolveForLead ───────────────────────────────────────────────────────────

describe('resolveForLead()', () => {
  const LEAD_META = { leadId: 'lead_abc', name: 'Bob Sharma' };

  beforeEach(() => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: LEAD_META }) });
  });

  test('creates CONV# when no convId on METADATA', async () => {
    await resolver.resolveForLead(CID, LEAD_PK, PHONE10, { text: 'hi', timestamp: '2026-06-28T00:00:00.000Z' });
    expect(ConversationService.createConversation).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ contactId: CONTACT.contactId, channel: 'whatsapp' }),
      'system',
    );
  });

  test('stores convId and contactId on LEAD# METADATA', async () => {
    await resolver.resolveForLead(CID, LEAD_PK, PHONE10, {});
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      ExpressionAttributeValues: expect.objectContaining({
        ':cv':   CONV.conversationId,
        ':ctid': CONTACT.contactId,
      }),
    }));
  });

  test('uses existing Contact when findContactByPhone returns one', async () => {
    ContactService.findContactByPhone.mockResolvedValue(CONTACT);
    await resolver.resolveForLead(CID, LEAD_PK, PHONE10, {});
    expect(ContactService.findContactByPhone).toHaveBeenCalledWith(CID, PHONE10);
    expect(ContactService.createContact).not.toHaveBeenCalled();
    expect(ConversationService.createConversation).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ contactId: CONTACT.contactId }),
      'system',
    );
  });

  test('creates Contact from lead data when no Contact entity exists', async () => {
    ContactService.findContactByPhone.mockResolvedValue(null);
    await resolver.resolveForLead(CID, LEAD_PK, PHONE10, {});
    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({
        phone:    PHONE10,
        source:   'lead',
        sourceId: LEAD_META.leadId,
      }),
      'system',
    );
  });

  test('passes lead name as displayName to createContact', async () => {
    await resolver.resolveForLead(CID, LEAD_PK, PHONE10, {});
    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ displayName: LEAD_META.name }),
      'system',
    );
  });

  test('updates existing CONV# when convId found on METADATA', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { convId: 'conv_existing' } }),
    });
    await resolver.resolveForLead(CID, LEAD_PK, PHONE10, { text: 'msg', timestamp: '2026-06-28T10:00:00.000Z' });
    expect(ConversationService.createConversation).not.toHaveBeenCalled();
    expect(ConversationService.updateLastMessage).toHaveBeenCalledWith(
      CID, 'conv_existing', expect.objectContaining({ text: 'msg' }),
    );
    expect(ConversationService.incrementUnread).toHaveBeenCalledWith(CID, 'conv_existing', 1);
  });

  test('returns { conversationId } on the fast (existing convId) path — lets IntentDetectionService chain off it', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { convId: 'conv_existing' } }),
    });
    const result = await resolver.resolveForLead(CID, LEAD_PK, PHONE10, {});
    expect(result).toEqual({ conversationId: 'conv_existing' });
  });

  test('returns { conversationId } on the creation path', async () => {
    const result = await resolver.resolveForLead(CID, LEAD_PK, PHONE10, {});
    expect(result).toEqual({ conversationId: CONV.conversationId });
  });

  test('never throws — catches DynamoDB timeout', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    await expect(resolver.resolveForLead(CID, LEAD_PK, PHONE10, {})).resolves.toBeUndefined();
  });

  test('never throws — catches ContactService error', async () => {
    ContactService.createContact.mockRejectedValue(new Error('conflict'));
    await expect(resolver.resolveForLead(CID, LEAD_PK, PHONE10, {})).resolves.toBeUndefined();
  });
});

// ─── syncConvStatus ───────────────────────────────────────────────────────────

describe('syncConvStatus()', () => {
  test('calls resolveConversation when newStatus is "resolved"', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_x' } }) });
    await resolver.syncConvStatus(CID, LEAD_PK, 'resolved', 'emp_actor');
    expect(ConversationService.resolveConversation).toHaveBeenCalledWith(CID, 'conv_x', 'emp_actor');
    expect(ConversationService.reopenConversation).not.toHaveBeenCalled();
  });

  test('calls reopenConversation when newStatus is "open"', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_x' } }) });
    await resolver.syncConvStatus(CID, LEAD_PK, 'open', 'emp_actor');
    expect(ConversationService.reopenConversation).toHaveBeenCalledWith(CID, 'conv_x', 'emp_actor');
    expect(ConversationService.resolveConversation).not.toHaveBeenCalled();
  });

  test('no-ops silently when no convId on METADATA', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: {} }) });
    await resolver.syncConvStatus(CID, LEAD_PK, 'resolved', 'emp_actor');
    expect(ConversationService.resolveConversation).not.toHaveBeenCalled();
  });

  test('no-ops silently when METADATA item missing entirely', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    await resolver.syncConvStatus(CID, LEAD_PK, 'resolved', 'emp_actor');
    expect(ConversationService.resolveConversation).not.toHaveBeenCalled();
  });

  test('never throws — catches ConversationService error', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_x' } }) });
    ConversationService.resolveConversation.mockRejectedValue(new Error('version conflict'));
    await expect(resolver.syncConvStatus(CID, LEAD_PK, 'resolved', 'emp_actor')).resolves.toBeUndefined();
  });

  test('never throws — catches DynamoDB error', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('ddb timeout')) });
    await expect(resolver.syncConvStatus(CID, LEAD_PK, 'resolved', 'emp_actor')).resolves.toBeUndefined();
  });
});

// ─── syncMarkRead ─────────────────────────────────────────────────────────────

describe('syncMarkRead()', () => {
  test('calls markRead via leadPK path', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_x' } }) });
    await resolver.syncMarkRead(CID, { leadPK: LEAD_PK }, 'emp_actor');
    expect(ConversationService.markRead).toHaveBeenCalledWith(CID, 'conv_x', 'emp_actor');
  });

  test('queries LEAD# METADATA (SK=METADATA) for leadPK path', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'x' } }) });
    await resolver.syncMarkRead(CID, { leadPK: LEAD_PK }, 'actor');
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
    }));
  });

  test('calls markRead via inboxPK path', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_y' } }) });
    await resolver.syncMarkRead(CID, { inboxPK: INBOX_PK }, 'emp_actor');
    expect(ConversationService.markRead).toHaveBeenCalledWith(CID, 'conv_y', 'emp_actor');
  });

  test('queries INBOX# CONTACT (SK=CONTACT) for inboxPK path', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'y' } }) });
    await resolver.syncMarkRead(CID, { inboxPK: INBOX_PK }, 'actor');
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
    }));
  });

  test('no-ops when convId is absent', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: {} }) });
    await resolver.syncMarkRead(CID, { leadPK: LEAD_PK }, 'actor');
    expect(ConversationService.markRead).not.toHaveBeenCalled();
  });

  test('no-ops when neither leadPK nor inboxPK provided', async () => {
    await resolver.syncMarkRead(CID, {}, 'actor');
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(ConversationService.markRead).not.toHaveBeenCalled();
  });

  test('never throws — catches DynamoDB error', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('timeout')) });
    await expect(resolver.syncMarkRead(CID, { leadPK: LEAD_PK }, 'actor')).resolves.toBeUndefined();
  });

  test('never throws — catches markRead error', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { convId: 'conv_x' } }) });
    ConversationService.markRead.mockRejectedValue(new Error('not_found'));
    await expect(resolver.syncMarkRead(CID, { leadPK: LEAD_PK }, 'actor')).resolves.toBeUndefined();
  });
});
