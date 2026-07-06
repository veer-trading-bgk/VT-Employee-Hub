'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/repositories/ConversationRepository');
jest.mock('../src/events/publisher', () => ({ publishEvent: jest.fn() }));

const repo         = require('../src/repositories/ConversationRepository');
const { publishEvent } = require('../src/events/publisher');
const svc          = require('../src/services/ConversationService');
const { STATUS }   = svc;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID  = 'comp_test';
const CVID = 'conv_01ABCDEFGHJKMNPQRST';
const CTID = 'contact_01ABCDEFGHJKMNPQRST';

const BASE_ITEM = Object.freeze({
  PK:             `CONV#${CID}#${CVID}`,
  SK:             'CONV#META',
  conversationId: CVID,
  companyId:      CID,
  contactId:      CTID,
  channel:        'whatsapp',
  channelAddress: '+919876543210',
  status:         STATUS.OPEN,
  assignedTo:     null,
  assignedToName: null,
  unreadCount:    0,
  lastActivityAt: '2026-06-28T00:00:00.000Z',
  version:        1,
  createdAt:      '2026-06-28T00:00:00.000Z',
  updatedAt:      '2026-06-28T00:00:00.000Z',
  createdBy:      'system',
  updatedBy:      'system',
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: most ops find the item
  repo.getById.mockResolvedValue({ ...BASE_ITEM });
  repo.putConversation.mockResolvedValue(undefined);
  repo.updateItem.mockImplementation((_cid, _cvid, patch) =>
    Promise.resolve({ ...BASE_ITEM, ...patch }));
  repo.incrementUnread.mockResolvedValue(undefined);
  repo.updateLastMessage.mockResolvedValue(undefined);
  repo.queryByCompany.mockResolvedValue({ items: [BASE_ITEM], lastKey: null });
  repo.queryByContact.mockResolvedValue({ items: [BASE_ITEM], lastKey: null });
});

// ─── createConversation ───────────────────────────────────────────────────────

describe('createConversation()', () => {
  test('returns a conversation item with correct shape', async () => {
    const data = { contactId: CTID, channel: 'whatsapp', channelAddress: '+919876543210' };
    const conv = await svc.createConversation(CID, data);
    expect(conv.companyId).toBe(CID);
    expect(conv.contactId).toBe(CTID);
    expect(conv.channel).toBe('whatsapp');
    expect(conv.status).toBe(STATUS.OPEN);
    expect(conv.conversationId).toBeDefined();
  });

  test('generates a conversation_-prefixed ULID id', async () => {
    const data = { contactId: CTID, channel: 'whatsapp' };
    const conv = await svc.createConversation(CID, data);
    expect(conv.conversationId).toMatch(/^conv_/);
    expect(conv.conversationId).toHaveLength(26 + 5); // 'conv_' + 26 ULID chars
  });

  test('sets all AI reserved fields to null / empty', async () => {
    const conv = await svc.createConversation(CID, { contactId: CTID, channel: 'email' });
    expect(conv.purpose).toBeNull();
    expect(conv.intent).toBeNull();
    expect(conv.confidence).toBeNull();
    expect(conv.classifiedAt).toBeNull();
    expect(conv.priority).toBeNull();
    expect(conv.labels).toEqual([]);
    expect(conv.sla).toBeNull();
    expect(conv.aiSummary).toBeNull();
    expect(conv.waitingSince).toBeNull();
  });

  test('sets conversationType to "customer" by default', async () => {
    const conv = await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    expect(conv.conversationType).toBe('customer');
  });

  test('sets isBotActive to false by default', async () => {
    const conv = await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    expect(conv.isBotActive).toBe(false);
  });

  test('sets handoffState to "human" by default', async () => {
    const conv = await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    expect(conv.handoffState).toBe('human');
  });

  test('accepts custom conversationType', async () => {
    const conv = await svc.createConversation(CID, {
      contactId: CTID, channel: 'whatsapp', conversationType: 'internal',
    });
    expect(conv.conversationType).toBe('internal');
  });

  test('accepts isBotActive: true', async () => {
    const conv = await svc.createConversation(CID, {
      contactId: CTID, channel: 'whatsapp', isBotActive: true,
    });
    expect(conv.isBotActive).toBe(true);
  });

  test('accepts custom handoffState', async () => {
    const conv = await svc.createConversation(CID, {
      contactId: CTID, channel: 'whatsapp', handoffState: 'ai',
    });
    expect(conv.handoffState).toBe('ai');
  });

  test('calls putConversation with attribute_not_exists guard (via repo)', async () => {
    await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    expect(repo.putConversation).toHaveBeenCalledTimes(1);
  });

  test('publishes CONVERSATION_CREATED event', async () => {
    await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    expect(publishEvent).toHaveBeenCalledWith(
      'conversation_created',
      expect.objectContaining({ companyId: CID, contactId: CTID }),
    );
  });

  test('fans out to contact timeline via additionalEntities', async () => {
    await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    const payload = publishEvent.mock.calls[0][1];
    expect(payload.additionalEntities).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityId: CTID })]),
    );
  });

  test('throws "companyId is required" when companyId missing', async () => {
    await expect(svc.createConversation('', { contactId: CTID, channel: 'whatsapp' }))
      .rejects.toThrow('companyId is required');
  });

  test('throws "contactId is required" when contactId missing', async () => {
    await expect(svc.createConversation(CID, { channel: 'whatsapp' }))
      .rejects.toThrow('contactId is required');
  });

  test('throws "invalid_channel" for unknown channel', async () => {
    await expect(svc.createConversation(CID, { contactId: CTID, channel: 'carrier_pigeon' }))
      .rejects.toThrow('invalid_channel');
  });

  test.each(['whatsapp', 'email', 'sms', 'telegram', 'instagram'])(
    'accepts valid channel "%s"',
    async (channel) => {
      await expect(svc.createConversation(CID, { contactId: CTID, channel })).resolves.toBeDefined();
    },
  );

  test('does NOT publish event when putConversation fails', async () => {
    repo.putConversation.mockRejectedValue(new Error('write error'));
    await expect(svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' }))
      .rejects.toThrow('write error');
    expect(publishEvent).not.toHaveBeenCalled();
  });

  test('sets convCompanyPK and convContactPK GSI attributes', async () => {
    const conv = await svc.createConversation(CID, { contactId: CTID, channel: 'whatsapp' });
    expect(conv.convCompanyPK).toBe(`CONV#${CID}`);
    expect(conv.convContactPK).toBe(`CONV_CONTACT#${CID}#${CTID}`);
  });
});

// ─── getConversation ──────────────────────────────────────────────────────────

describe('getConversation()', () => {
  test('returns item when found', async () => {
    const conv = await svc.getConversation(CID, CVID);
    expect(conv).toMatchObject({ conversationId: CVID });
  });

  test('returns null when repo returns null', async () => {
    repo.getById.mockResolvedValue(null);
    expect(await svc.getConversation(CID, CVID)).toBeNull();
  });

  test('returns null for soft-deleted conversations', async () => {
    repo.getById.mockResolvedValue({ ...BASE_ITEM, deletedAt: '2026-06-28T00:00:00.000Z' });
    expect(await svc.getConversation(CID, CVID)).toBeNull();
  });
});

// ─── assignConversation ───────────────────────────────────────────────────────

describe('assignConversation()', () => {
  test('updates assignedTo and assignedToName', async () => {
    await svc.assignConversation(CID, CVID, 'emp_abc', 'Alice', 'actor1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ assignedTo: 'emp_abc', assignedToName: 'Alice' }),
      1,
    );
  });

  test('publishes CONVERSATION_ASSIGNED event', async () => {
    await svc.assignConversation(CID, CVID, 'emp_abc', 'Alice', 'actor1');
    expect(publishEvent).toHaveBeenCalledWith(
      'conversation_assigned',
      expect.objectContaining({ companyId: CID }),
    );
  });

  test('allows unassignment by passing null', async () => {
    await svc.assignConversation(CID, CVID, null, null, 'actor1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ assignedTo: null, assignedToName: null }),
      1,
    );
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.assignConversation(CID, CVID, 'emp', 'Name')).rejects.toThrow('not_found');
  });

  test('throws "not_found" for soft-deleted conversation', async () => {
    repo.getById.mockResolvedValue({ ...BASE_ITEM, deletedAt: '2026-06-28T00:00:00.000Z' });
    await expect(svc.assignConversation(CID, CVID, 'emp', 'Name')).rejects.toThrow('not_found');
  });
});

// ─── resolveConversation ──────────────────────────────────────────────────────

describe('resolveConversation()', () => {
  test('sets status to "resolved" and clears waitingSince', async () => {
    await svc.resolveConversation(CID, CVID, 'actor1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ status: STATUS.RESOLVED, waitingSince: null }),
      1,
    );
  });

  test('publishes CONVERSATION_RESOLVED event', async () => {
    await svc.resolveConversation(CID, CVID, 'actor1');
    expect(publishEvent).toHaveBeenCalledWith('conversation_resolved', expect.any(Object));
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.resolveConversation(CID, CVID)).rejects.toThrow('not_found');
  });
});

// ─── reopenConversation ───────────────────────────────────────────────────────

describe('reopenConversation()', () => {
  test('sets status to "open" and clears waitingSince', async () => {
    repo.getById.mockResolvedValue({ ...BASE_ITEM, status: STATUS.RESOLVED });
    await svc.reopenConversation(CID, CVID, 'actor1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ status: STATUS.OPEN, waitingSince: null }),
      1,
    );
  });

  test('publishes CONVERSATION_REOPENED event with previousStatus', async () => {
    repo.getById.mockResolvedValue({ ...BASE_ITEM, status: STATUS.RESOLVED });
    await svc.reopenConversation(CID, CVID, 'actor1');
    const payload = publishEvent.mock.calls[0][1];
    expect(payload.metadata.previousStatus).toBe(STATUS.RESOLVED);
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.reopenConversation(CID, CVID)).rejects.toThrow('not_found');
  });
});

// ─── snoozeConversation ───────────────────────────────────────────────────────

describe('snoozeConversation()', () => {
  test('sets status to "snoozed"', async () => {
    await svc.snoozeConversation(CID, CVID, 'actor1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ status: STATUS.SNOOZED }),
      1,
    );
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.snoozeConversation(CID, CVID)).rejects.toThrow('not_found');
  });
});

// ─── pendConversation ─────────────────────────────────────────────────────────

describe('pendConversation()', () => {
  test('sets status to "pending" and records waitingSince', async () => {
    await svc.pendConversation(CID, CVID, 'actor1');
    const call = repo.updateItem.mock.calls[0];
    const patch = call[2];
    expect(patch.status).toBe(STATUS.PENDING);
    expect(patch.waitingSince).toBeDefined();
    expect(new Date(patch.waitingSince).toISOString()).toBe(patch.waitingSince);
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.pendConversation(CID, CVID)).rejects.toThrow('not_found');
  });
});

// ─── markRead ─────────────────────────────────────────────────────────────────

describe('markRead()', () => {
  test('sets unreadCount to 0 with version lock', async () => {
    await svc.markRead(CID, CVID, 'actor1');
    expect(repo.updateItem).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ unreadCount: 0 }),
      1,
    );
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.markRead(CID, CVID)).rejects.toThrow('not_found');
  });
});

// ─── incrementUnread ──────────────────────────────────────────────────────────

describe('incrementUnread()', () => {
  test('delegates to repo.incrementUnread with default delta 1', async () => {
    await svc.incrementUnread(CID, CVID);
    expect(repo.incrementUnread).toHaveBeenCalledWith(CID, CVID, 1);
  });

  test('passes custom delta', async () => {
    await svc.incrementUnread(CID, CVID, 3);
    expect(repo.incrementUnread).toHaveBeenCalledWith(CID, CVID, 3);
  });

  test('does NOT call getById (no version lock, atomic)', async () => {
    await svc.incrementUnread(CID, CVID);
    expect(repo.getById).not.toHaveBeenCalled();
  });
});

// ─── updateLastMessage ────────────────────────────────────────────────────────

describe('updateLastMessage()', () => {
  test('truncates text to 200 characters', async () => {
    const longText = 'A'.repeat(300);
    await svc.updateLastMessage(CID, CVID, { text: longText, timestamp: '2026-06-28T12:00:00.000Z' });
    const fields = repo.updateLastMessage.mock.calls[0][2];
    expect(fields.lastMessageText.length).toBe(200);
  });

  test('uses provided timestamp as lastMessageAt and lastActivityAt', async () => {
    const ts = '2026-06-28T12:00:00.000Z';
    await svc.updateLastMessage(CID, CVID, { text: 'Hi', timestamp: ts });
    const fields = repo.updateLastMessage.mock.calls[0][2];
    expect(fields.lastMessageAt).toBe(ts);
    expect(fields.lastActivityAt).toBe(ts);
  });

  test('falls back to current time when no timestamp provided', async () => {
    await svc.updateLastMessage(CID, CVID, { text: 'Hi' });
    const fields = repo.updateLastMessage.mock.calls[0][2];
    expect(fields.lastMessageAt).toBeDefined();
    expect(new Date(fields.lastMessageAt).toISOString()).toBe(fields.lastMessageAt);
  });
});

// ─── softDeleteConversation ───────────────────────────────────────────────────

describe('softDeleteConversation()', () => {
  test('adds deletedAt and deletedBy to the item', async () => {
    await svc.softDeleteConversation(CID, CVID, 'actor1');
    const patch = repo.updateItem.mock.calls[0][2];
    expect(patch.deletedAt).toBeDefined();
    expect(patch.deletedBy).toBe('actor1');
  });

  test('uses optimistic locking with current version', async () => {
    await svc.softDeleteConversation(CID, CVID, 'actor1');
    const versionArg = repo.updateItem.mock.calls[0][3];
    expect(versionArg).toBe(1);
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.softDeleteConversation(CID, CVID)).rejects.toThrow('not_found');
  });

  test('throws "not_found" when already soft-deleted', async () => {
    repo.getById.mockResolvedValue({ ...BASE_ITEM, deletedAt: '2026-06-28T00:00:00.000Z' });
    await expect(svc.softDeleteConversation(CID, CVID)).rejects.toThrow('not_found');
  });
});

// ─── restoreConversation ──────────────────────────────────────────────────────

describe('restoreConversation()', () => {
  const DELETED_ITEM = { ...BASE_ITEM, deletedAt: '2026-06-28T00:00:00.000Z', deletedBy: 'actor0' };

  test('signals removal of deletedAt and deletedBy via _removeAttrs', async () => {
    repo.getById.mockResolvedValue({ ...DELETED_ITEM });
    await svc.restoreConversation(CID, CVID, 'actor1');
    const patch = repo.updateItem.mock.calls[0][2];
    expect(patch._removeAttrs).toContain('deletedAt');
    expect(patch._removeAttrs).toContain('deletedBy');
  });

  test('throws "not_found" when conversation missing', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.restoreConversation(CID, CVID)).rejects.toThrow('not_found');
  });

  test('throws "not_deleted" when conversation is not soft-deleted', async () => {
    repo.getById.mockResolvedValue({ ...BASE_ITEM }); // no deletedAt
    await expect(svc.restoreConversation(CID, CVID)).rejects.toThrow('not_deleted');
  });
});

// ─── listByCompany ────────────────────────────────────────────────────────────

describe('listByCompany()', () => {
  test('returns { conversations, lastKey } from repo', async () => {
    const result = await svc.listByCompany(CID, { status: 'open' });
    expect(result.conversations).toEqual([BASE_ITEM]);
    expect(result.lastKey).toBeNull();
    expect(repo.queryByCompany).toHaveBeenCalledWith(CID, { status: 'open' });
  });
});

// ─── listByContact ────────────────────────────────────────────────────────────

describe('listByContact()', () => {
  test('returns { conversations, lastKey } from repo', async () => {
    const result = await svc.listByContact(CID, CTID, { limit: 10 });
    expect(result.conversations).toEqual([BASE_ITEM]);
    expect(result.lastKey).toBeNull();
    expect(repo.queryByContact).toHaveBeenCalledWith(CID, CTID, { limit: 10 });
  });
});

// ─── STATUS + VALID_CHANNELS + CONVERSATION_TYPE + HANDOFF_STATE exports ──────

describe('module exports', () => {
  test('exports STATUS constants', () => {
    expect(svc.STATUS).toEqual({
      OPEN: 'open', RESOLVED: 'resolved', PENDING: 'pending', SNOOZED: 'snoozed',
    });
  });

  test('exports VALID_CHANNELS', () => {
    expect(svc.VALID_CHANNELS).toEqual(
      expect.arrayContaining(['whatsapp', 'email', 'sms', 'telegram', 'instagram']),
    );
  });

  test('exports CONVERSATION_TYPE with all 6 values', () => {
    expect(svc.CONVERSATION_TYPE).toEqual(expect.objectContaining({
      CUSTOMER:  'customer',
      INTERNAL:  'internal',
      GROUP:     'group',
      BROADCAST: 'broadcast',
      BOT:       'bot',
      SYSTEM:    'system',
    }));
  });

  test('exports HANDOFF_STATE with all 4 values', () => {
    expect(svc.HANDOFF_STATE).toEqual(expect.objectContaining({
      HUMAN:         'human',
      AI:            'ai',
      PENDING_HUMAN: 'pending_human',
      AI_RESUMED:    'ai_resumed',
    }));
  });
});

// ─── classifyIntent ───────────────────────────────────────────────────────────

describe('classifyIntent()', () => {
  beforeEach(() => {
    repo.updateClassification.mockResolvedValue(undefined);
  });

  test('writes intent/confidence via repo.updateClassification, no version lock (repo.updateItem not used)', async () => {
    await svc.classifyIntent(CID, CVID, { intent: 'kyc_query', confidence: 0.82 });
    expect(repo.updateClassification).toHaveBeenCalledWith(
      CID, CVID,
      expect.objectContaining({ intent: 'kyc_query', confidence: 0.82, classifiedAt: expect.any(String) }),
    );
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  test('stamps classifiedAt as a real ISO timestamp', async () => {
    await svc.classifyIntent(CID, CVID, { intent: 'other', confidence: 0.5 });
    const patch = repo.updateClassification.mock.calls[0][2];
    expect(new Date(patch.classifiedAt).toISOString()).toBe(patch.classifiedAt);
  });

  test('returns the classification (intent, confidence, classifiedAt)', async () => {
    const result = await svc.classifyIntent(CID, CVID, { intent: 'complaint', confidence: 0.91 });
    expect(result).toEqual(expect.objectContaining({ intent: 'complaint', confidence: 0.91, classifiedAt: expect.any(String) }));
  });
});

// ─── Bot handoff state machine (2026-07-06, Era 22) ───────────────────────────
// isBotActive/handoffState/aiTurnCount were reserved-but-inert since Phase 2
// scaffolding — these are the first real read/write paths for them anywhere
// in the codebase, via ConversationRepository's new updateBotState().

describe('startBotHandling()', () => {
  beforeEach(() => {
    repo.updateBotState = jest.fn().mockResolvedValue(undefined);
  });

  test('sets isBotActive: true, handoffState: ai, aiTurnCount: 0', async () => {
    await svc.startBotHandling(CID, CVID);
    expect(repo.updateBotState).toHaveBeenCalledWith(CID, CVID, {
      isBotActive: true, handoffState: 'ai', aiTurnCount: 0,
    });
  });

  test('throws not_found for a nonexistent conversation, same as every other mutator', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.startBotHandling(CID, 'does-not-exist')).rejects.toThrow('not_found');
    expect(repo.updateBotState).not.toHaveBeenCalled();
  });
});

describe('incrementAiTurn()', () => {
  beforeEach(() => {
    repo.updateBotState = jest.fn().mockResolvedValue(undefined);
  });

  test('writes currentTurnCount + 1', async () => {
    await svc.incrementAiTurn(CID, CVID, 3);
    expect(repo.updateBotState).toHaveBeenCalledWith(CID, CVID, { aiTurnCount: 4 });
  });
});

describe('handoffToHuman()', () => {
  beforeEach(() => {
    repo.updateBotState = jest.fn().mockResolvedValue(undefined);
  });

  test('sets isBotActive: false, handoffState: pending_human', async () => {
    await svc.handoffToHuman(CID, CVID);
    expect(repo.updateBotState).toHaveBeenCalledWith(CID, CVID, {
      isBotActive: false, handoffState: 'pending_human',
    });
  });
});
