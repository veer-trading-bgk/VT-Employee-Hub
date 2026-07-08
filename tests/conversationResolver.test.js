'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/dynamodb', () => ({
  get:    jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
}));
jest.mock('../src/services/ContactService');
jest.mock('../src/services/ConversationService');

const dynamodb            = require('../src/config/dynamodb');
const ContactService      = require('../src/services/ContactService');
const ConversationService = require('../src/services/ConversationService');
const resolver            = require('../src/utils/conversationResolver');
const { contactPK, contactSK, conversationPK, conversationSK } = require('../src/core/entityKeys');

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
  dynamodb.delete.mockReturnValue({ promise: () => Promise.resolve({}) });

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
    const call = dynamodb.update.mock.calls.find((c) => c[0].Key.PK === INBOX_PK)[0];
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

// ─── Cross-path conversation dedup (Era 41) ───────────────────────────────────
//
// Reproduces the real production bug: whatsapp.js's unknown-contact branch
// fires resolveForInbox() fire-and-forget, then — if the auto-bot-engagement
// feature is on — awaits ConversationalAgentService.maybeStart(), which
// independently calls resolveForLead() for the same contact. Before this fix,
// each created its own Conversation, permanently splitting one physical
// WhatsApp thread into two CONV# entities (the first message stuck in
// whichever one lost). CONTACT#...META.primaryConversationId is now the
// shared pointer both functions check/claim to prevent this.

describe('cross-path conversation dedup (Era 41)', () => {
  const CONTACT_PK = contactPK(CID, CONTACT.contactId);

  test('resolveForInbox reuses an already-claimed Contact conversation instead of creating a new one', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK) return { promise: () => Promise.resolve({ Item: { primaryConversationId: 'conv_existing_from_lead' } }) };
      return { promise: () => Promise.resolve({}) }; // INBOX# CONTACT — no local convId yet
    });

    const result = await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'Hi', timestamp: '2026-07-08T09:46:33.000Z' });

    expect(result).toEqual({ conversationId: 'conv_existing_from_lead' });
    expect(ConversationService.createConversation).not.toHaveBeenCalled();
    expect(ConversationService.updateLastMessage).toHaveBeenCalledWith(CID, 'conv_existing_from_lead', expect.objectContaining({ text: 'Hi' }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
      ExpressionAttributeValues: expect.objectContaining({ ':cv': 'conv_existing_from_lead' }),
    }));
  });

  test('resolveForLead reuses an already-claimed Contact conversation instead of creating a new one', async () => {
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK) return { promise: () => Promise.resolve({ Item: { primaryConversationId: 'conv_existing_from_inbox' } }) };
      if (params.Key.PK === LEAD_PK) return { promise: () => Promise.resolve({ Item: { leadId: 'lead_abc', name: 'Bob' } }) };
      return { promise: () => Promise.resolve({}) };
    });

    const result = await resolver.resolveForLead(CID, LEAD_PK, PHONE10, { text: 'hello', timestamp: '2026-07-08T09:46:41.000Z' });

    expect(result).toEqual({ conversationId: 'conv_existing_from_inbox' });
    expect(ConversationService.createConversation).not.toHaveBeenCalled();
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      ExpressionAttributeValues: expect.objectContaining({ ':cv': 'conv_existing_from_inbox' }),
    }));
  });

  test('Era 42 regression guard: a Contact record with primaryConversationId EXPLICITLY set to null (not absent — matching every real Contact record, since ContactService.createContact() initializes it that way) still allows a claim to succeed', async () => {
    // This is the exact real-world condition that made the original
    // if_not_exists()-based claim a permanent no-op in production: to
    // DynamoDB, an attribute holding `null` still "exists". The fix uses a
    // real ConditionExpression that explicitly treats `null` as claimable.
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK) return { promise: () => Promise.resolve({ Item: { primaryConversationId: null } }) };
      return { promise: () => Promise.resolve({}) };
    });
    ConversationService.createConversation.mockResolvedValue({ conversationId: 'conv_fresh' });

    let capturedParams = null;
    dynamodb.update.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK && params.UpdateExpression.includes('primaryConversationId')) {
        capturedParams = params;
        return { promise: () => Promise.resolve({ Attributes: { primaryConversationId: 'conv_fresh' } }) };
      }
      return { promise: () => Promise.resolve({}) };
    });

    const result = await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'Hi', timestamp: '2026-07-08T09:46:33.000Z' });

    expect(result).toEqual({ conversationId: 'conv_fresh' });
    // Guards against silently reverting to the broken if_not_exists()-only shape.
    expect(capturedParams.ConditionExpression).toMatch(/attribute_not_exists\(primaryConversationId\)/);
    expect(capturedParams.ConditionExpression).toMatch(/primaryConversationId\s*=\s*:nullval/);
    expect(capturedParams.ExpressionAttributeValues[':nullval']).toBeNull();
  });

  test('genuine concurrent race — resolveForInbox and resolveForLead fire near-simultaneously for a contact whose primaryConversationId is explicitly null, exactly ONE Conversation survives', async () => {
    let claimedConvId = null;

    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === LEAD_PK) return { promise: () => Promise.resolve({ Item: { leadId: 'lead_abc', name: 'Veer' } }) };
      // Matches a real Contact record: explicitly null, not absent, until claimed.
      if (params.Key.PK === CONTACT_PK) return { promise: () => Promise.resolve({ Item: { primaryConversationId: claimedConvId } }) };
      return { promise: () => Promise.resolve({}) };
    });

    let convCounter = 0;
    ConversationService.createConversation.mockImplementation(async () => ({ conversationId: `conv_${++convCounter}` }));

    // Real DynamoDB ConditionExpression semantics: the first UpdateItem to
    // actually execute succeeds and sets claimedConvId; the second one's
    // condition ('...OR primaryConversationId = :nullval') now fails, since
    // the stored value is no longer null — it throws, exactly as real
    // DynamoDB does, and the loser re-reads via _getPrimaryConversationId's
    // own dynamodb.get (mocked above to reflect claimedConvId dynamically).
    dynamodb.update.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK && params.UpdateExpression.includes('primaryConversationId')) {
        if (!claimedConvId) {
          claimedConvId = params.ExpressionAttributeValues[':cv'];
          return { promise: () => Promise.resolve({ Attributes: { primaryConversationId: claimedConvId } }) };
        }
        const err = new Error('The conditional request failed');
        err.code = 'ConditionalCheckFailedException';
        return { promise: () => Promise.reject(err) };
      }
      return { promise: () => Promise.resolve({}) };
    });

    const [inboxResult, leadResult] = await Promise.all([
      resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'Hi', timestamp: '2026-07-08T09:46:33.000Z' }),
      resolver.resolveForLead(CID, LEAD_PK, PHONE10, { text: 'Hi', timestamp: '2026-07-08T09:46:41.000Z' }),
    ]);

    // Exactly one conversationId survives, shared by both call paths — not two.
    expect(inboxResult.conversationId).toBe(leadResult.conversationId);
    expect(inboxResult.conversationId).toBe(claimedConvId);
    // Both paths did each create their own Conversation initially (matches the
    // real trace) — but the loser must have been discarded, leaving one live.
    expect(ConversationService.createConversation).toHaveBeenCalledTimes(2);
    expect(dynamodb.delete).toHaveBeenCalledTimes(1);
  });

  test('loser path: resolveForInbox loses the claim race (ConditionalCheckFailedException), discards its own Conversation, and reuses the winner\'s', async () => {
    ConversationService.createConversation.mockResolvedValue({ conversationId: 'conv_inbox_created_then_discarded' });

    // First read (step 2.5, before creating): nothing claimed yet. Second read
    // (inside the claim's catch-block retry, after losing): the winner is visible.
    let contactGetCalls = 0;
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK) {
        contactGetCalls++;
        if (contactGetCalls === 1) return { promise: () => Promise.resolve({ Item: { primaryConversationId: null } }) };
        return { promise: () => Promise.resolve({ Item: { primaryConversationId: 'conv_lead_won' } }) };
      }
      return { promise: () => Promise.resolve({}) }; // INBOX# CONTACT — no local convId yet
    });

    dynamodb.update.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK && params.UpdateExpression.includes('primaryConversationId')) {
        const err = new Error('The conditional request failed');
        err.code = 'ConditionalCheckFailedException';
        return { promise: () => Promise.reject(err) };
      }
      return { promise: () => Promise.resolve({}) };
    });

    const result = await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'Hi', timestamp: '2026-07-08T09:46:33.000Z' });

    expect(result).toEqual({ conversationId: 'conv_lead_won' });
    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: conversationPK(CID, 'conv_inbox_created_then_discarded'), SK: conversationSK() },
    }));
    expect(ConversationService.updateLastMessage).toHaveBeenCalledWith(CID, 'conv_lead_won', expect.objectContaining({ text: 'Hi' }));
    expect(ConversationService.incrementUnread).toHaveBeenCalledWith(CID, 'conv_lead_won', 1);
    expect(ConversationService.updateLastMessage).not.toHaveBeenCalledWith(CID, 'conv_inbox_created_then_discarded', expect.anything());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: INBOX_PK, SK: 'CONTACT' },
      ExpressionAttributeValues: expect.objectContaining({ ':cv': 'conv_lead_won' }),
    }));
  });

  test('loser path: resolveForLead loses the claim race (ConditionalCheckFailedException), discards its own Conversation, and reuses the winner\'s', async () => {
    ConversationService.createConversation.mockResolvedValue({ conversationId: 'conv_lead_created_then_discarded' });

    let contactGetCalls = 0;
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === LEAD_PK) return { promise: () => Promise.resolve({ Item: { leadId: 'lead_abc', name: 'Veer' } }) };
      if (params.Key.PK === CONTACT_PK) {
        contactGetCalls++;
        if (contactGetCalls === 1) return { promise: () => Promise.resolve({ Item: { primaryConversationId: null } }) };
        return { promise: () => Promise.resolve({ Item: { primaryConversationId: 'conv_inbox_won' } }) };
      }
      return { promise: () => Promise.resolve({}) };
    });

    dynamodb.update.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK && params.UpdateExpression.includes('primaryConversationId')) {
        const err = new Error('The conditional request failed');
        err.code = 'ConditionalCheckFailedException';
        return { promise: () => Promise.reject(err) };
      }
      return { promise: () => Promise.resolve({}) };
    });

    const result = await resolver.resolveForLead(CID, LEAD_PK, PHONE10, { text: 'hello', timestamp: '2026-07-08T09:47:54.000Z' });

    expect(result).toEqual({ conversationId: 'conv_inbox_won' });
    expect(dynamodb.delete).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: conversationPK(CID, 'conv_lead_created_then_discarded'), SK: conversationSK() },
    }));
    expect(ConversationService.updateLastMessage).toHaveBeenCalledWith(CID, 'conv_inbox_won', expect.objectContaining({ text: 'hello' }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      ExpressionAttributeValues: expect.objectContaining({ ':cv': 'conv_inbox_won' }),
    }));
  });

  test('an unexpected (non-conditional-check) error from the claim update propagates to the outer catch, not swallowed as a false win', async () => {
    ConversationService.createConversation.mockResolvedValue({ conversationId: 'conv_x' });
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { primaryConversationId: null } }) });
    dynamodb.update.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK && params.UpdateExpression.includes('primaryConversationId')) {
        return { promise: () => Promise.reject(new Error('ProvisionedThroughputExceededException')) };
      }
      return { promise: () => Promise.resolve({}) };
    });

    // The module-level try/catch still applies — resolves to undefined, never throws.
    await expect(resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK })).resolves.toBeUndefined();
  });

  test('discard failure is logged and swallowed — never surfaces to the caller', async () => {
    ConversationService.createConversation.mockResolvedValue({ conversationId: 'conv_inbox_created_then_discarded' });
    let contactGetCalls = 0;
    dynamodb.get.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK) {
        contactGetCalls++;
        if (contactGetCalls === 1) return { promise: () => Promise.resolve({ Item: { primaryConversationId: null } }) };
        return { promise: () => Promise.resolve({ Item: { primaryConversationId: 'conv_lead_won' } }) };
      }
      return { promise: () => Promise.resolve({}) };
    });
    dynamodb.update.mockImplementation((params) => {
      if (params.Key.PK === CONTACT_PK && params.UpdateExpression.includes('primaryConversationId')) {
        const err = new Error('The conditional request failed');
        err.code = 'ConditionalCheckFailedException';
        return { promise: () => Promise.reject(err) };
      }
      return { promise: () => Promise.resolve({}) };
    });
    dynamodb.delete.mockReturnValue({ promise: () => Promise.reject(new Error('delete failed')) });

    const result = await resolver.resolveForInbox(CID, PHONE10, { inboxPK: INBOX_PK, text: 'Hi', timestamp: '2026-07-08T09:46:33.000Z' });
    expect(result).toEqual({ conversationId: 'conv_lead_won' });
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
