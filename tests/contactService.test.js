'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/repositories/ContactRepository', () => ({
  getById:        jest.fn(),
  queryByPhone:   jest.fn(),
  queryByCompany: jest.fn(),
  transactCreate: jest.fn(),
  updateItem:     jest.fn(),
}));

jest.mock('../src/events/publisher', () => ({
  publishEvent: jest.fn(),
}));

// Mock logger to suppress output during tests
jest.mock('../src/config/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

const repo                    = require('../src/repositories/ContactRepository');
const { publishEvent }        = require('../src/events/publisher');
const svc                     = require('../src/services/ContactService');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID    = 'comp_test';
const CTID   = 'contact_01ABCDEFGHJKMNPQRST';
const PHONE  = '+919876543210';
const ACTOR  = 'emp_admin';

const BASE_CONTACT = {
  PK:               `CONTACT#${CID}#${CTID}`,
  SK:               'CONTACT#META',
  contactId:        CTID,
  companyId:        CID,
  phoneE164:        PHONE,
  displayName:      'Test User',
  type:             'individual',
  tags:             [],
  sourceHistory: [
    { source: 'crm_manual', sourceId: null, addedAt: '2026-06-28T00:00:00.000Z', addedBy: 'system' },
  ],
  identities: [
    { channel: 'whatsapp', value: PHONE, isPrimary: true, verified: false, addedAt: '2026-06-28T00:00:00.000Z' },
  ],
  preferredChannel:  null,
  preferredLanguage: null,
  timezone:          null,
  leadCount:        0,
  convCount:        0,
  contactCompanyPK: `CONTACT#${CID}`,
  version:          1,
  createdAt:        '2026-06-28T00:00:00.000Z',
  updatedAt:        '2026-06-28T00:00:00.000Z',
  createdBy:        'system',
  updatedBy:        'system',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── createContact ────────────────────────────────────────────────────────────

describe('createContact()', () => {
  test('creates and returns a new contact on first call', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact, created } = await svc.createContact(CID, { phone: '9876543210' }, ACTOR);
    expect(created).toBe(true);
    expect(contact.phoneE164).toBe('+919876543210');
    expect(contact.companyId).toBe(CID);
    expect(contact.contactId).toMatch(/^contact_/);
    expect(contact.version).toBe(1);
  });

  test('contact item includes GSI attribute contactCompanyPK', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, { phone: '9876543210' });
    expect(contact.contactCompanyPK).toBe(`CONTACT#${CID}`);
  });

  test('sourceHistory[0] is populated from data.source and data.sourceId', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, {
      phone:    '9876543210',
      source:   'whatsapp',
      sourceId: 'INBOX#comp_test#9876543210',
    }, ACTOR);
    expect(contact.sourceHistory).toHaveLength(1);
    expect(contact.sourceHistory[0]).toMatchObject({
      source:   'whatsapp',
      sourceId: 'INBOX#comp_test#9876543210',
      addedBy:  ACTOR,
    });
    expect(contact.sourceHistory[0].addedAt).toBeDefined();
  });

  test('sourceHistory defaults source to crm_manual when omitted', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, { phone: '9876543210' });
    expect(contact.sourceHistory[0].source).toBe('crm_manual');
    expect(contact.sourceHistory[0].sourceId).toBeNull();
  });

  test('identities[] contains primary whatsapp identity with E.164 phone', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, { phone: '9876543210' });
    expect(contact.identities).toHaveLength(1);
    expect(contact.identities[0]).toMatchObject({
      channel:   'whatsapp',
      value:     '+919876543210',
      isPrimary: true,
      verified:  false,
    });
    expect(contact.identities[0].addedAt).toBeDefined();
  });

  test('preference fields are null at creation', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, { phone: '9876543210' });
    expect(contact.preferredChannel).toBeNull();
    expect(contact.preferredLanguage).toBeNull();
    expect(contact.timezone).toBeNull();
  });

  test('no top-level source or sourceId fields on the contact item', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, { phone: '9876543210', source: 'form' });
    expect(contact).not.toHaveProperty('source');
    expect(contact).not.toHaveProperty('sourceId');
  });

  test('normalises phone to E.164 before storing', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact } = await svc.createContact(CID, { phone: '09876543210' });
    expect(contact.phoneE164).toBe('+919876543210');
  });

  test('uses displayName if provided, falls back to phone', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    const { contact: withName } = await svc.createContact(CID, { phone: '9876543210', displayName: 'Alice' });
    expect(withName.displayName).toBe('Alice');

    repo.transactCreate.mockResolvedValue(undefined);
    const { contact: withoutName } = await svc.createContact(CID, { phone: '9876543210' });
    expect(withoutName.displayName).toBe('+919876543210');
  });

  test('publishes CONTACT_CREATED event', async () => {
    repo.transactCreate.mockResolvedValue(undefined);
    await svc.createContact(CID, { phone: '9876543210' }, ACTOR);
    expect(publishEvent).toHaveBeenCalledWith('contact_created', expect.objectContaining({
      companyId:  CID,
      entityType: 'CONTACT',
      actorId:    ACTOR,
    }));
  });

  test('returns existing contact when phone is already registered (duplicate)', async () => {
    const txErr = Object.assign(new Error('tx cancelled'), { code: 'TransactionCanceledException' });
    repo.transactCreate.mockRejectedValue(txErr);
    repo.queryByPhone.mockResolvedValue(BASE_CONTACT);

    const { contact, created } = await svc.createContact(CID, { phone: '9876543210' }, ACTOR);
    expect(created).toBe(false);
    expect(contact).toEqual(BASE_CONTACT);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  test('throws invalid_phone for unparseable phone number', async () => {
    await expect(svc.createContact(CID, { phone: 'not-a-phone' })).rejects.toThrow('invalid_phone');
    expect(repo.transactCreate).not.toHaveBeenCalled();
  });

  test('throws invalid_phone when phone is missing', async () => {
    await expect(svc.createContact(CID, {})).rejects.toThrow('invalid_phone');
  });

  test('throws when companyId is missing', async () => {
    await expect(svc.createContact('', { phone: '9876543210' })).rejects.toThrow('companyId is required');
  });

  test('propagates non-duplicate transact errors', async () => {
    const err = Object.assign(new Error('provisioned throughput exceeded'), { code: 'ProvisionedThroughputExceededException' });
    repo.transactCreate.mockRejectedValue(err);
    await expect(svc.createContact(CID, { phone: '9876543210' })).rejects.toMatchObject({
      code: 'ProvisionedThroughputExceededException',
    });
  });
});

// ─── getContact ──────────────────────────────────────────────────────────────

describe('getContact()', () => {
  test('returns the contact when found and not deleted', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    const result = await svc.getContact(CID, CTID);
    expect(result).toEqual(BASE_CONTACT);
  });

  test('returns null when contact not found', async () => {
    repo.getById.mockResolvedValue(null);
    expect(await svc.getContact(CID, CTID)).toBeNull();
  });

  test('returns null for soft-deleted contacts', async () => {
    repo.getById.mockResolvedValue({ ...BASE_CONTACT, deletedAt: '2026-06-29T00:00:00.000Z' });
    expect(await svc.getContact(CID, CTID)).toBeNull();
  });
});

// ─── findContactByPhone ───────────────────────────────────────────────────────

describe('findContactByPhone()', () => {
  test('normalises phone and queries by phone', async () => {
    repo.queryByPhone.mockResolvedValue(BASE_CONTACT);
    const result = await svc.findContactByPhone(CID, '9876543210');
    expect(repo.queryByPhone).toHaveBeenCalledWith(CID, '+919876543210');
    expect(result).toEqual(BASE_CONTACT);
  });

  test('returns null when not found', async () => {
    repo.queryByPhone.mockResolvedValue(null);
    expect(await svc.findContactByPhone(CID, '9876543210')).toBeNull();
  });

  test('throws invalid_phone for bad phone', async () => {
    await expect(svc.findContactByPhone(CID, 'bad')).rejects.toThrow('invalid_phone');
    expect(repo.queryByPhone).not.toHaveBeenCalled();
  });
});

// ─── updateContact ────────────────────────────────────────────────────────────

describe('updateContact()', () => {
  const UPDATED = { ...BASE_CONTACT, displayName: 'New Name', version: 2 };

  test('updates allowed fields and returns the updated contact', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    repo.updateItem.mockResolvedValue(UPDATED);
    const result = await svc.updateContact(CID, CTID, { displayName: 'New Name' }, ACTOR);
    expect(result).toEqual(UPDATED);
    expect(repo.updateItem).toHaveBeenCalledWith(CID, CTID, expect.objectContaining({
      displayName: 'New Name',
      version:     2,
    }), 1);
  });

  test('publishes CONTACT_UPDATED event', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    repo.updateItem.mockResolvedValue(UPDATED);
    await svc.updateContact(CID, CTID, { displayName: 'New Name' }, ACTOR);
    expect(publishEvent).toHaveBeenCalledWith('contact_updated', expect.objectContaining({
      companyId:  CID,
      entityType: 'CONTACT',
      actorId:    ACTOR,
    }));
  });

  test('throws not_found when contact does not exist', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.updateContact(CID, CTID, { displayName: 'x' })).rejects.toThrow('not_found');
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  test('throws not_found when contact is soft-deleted', async () => {
    repo.getById.mockResolvedValue({ ...BASE_CONTACT, deletedAt: '2026-06-29T00:00:00.000Z' });
    await expect(svc.updateContact(CID, CTID, { displayName: 'x' })).rejects.toThrow('not_found');
  });

  test('ignores non-allowed fields (e.g. phoneE164, PK, SK, sourceHistory)', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    repo.updateItem.mockResolvedValue(UPDATED);
    await svc.updateContact(CID, CTID, {
      phoneE164:     '+911111111111',
      PK:            'HACK',
      sourceHistory: [{ source: 'injected' }],
      identities:    [{ channel: 'evil' }],
      displayName:   'Safe',
    }, ACTOR);
    const patchArg = repo.updateItem.mock.calls[0][2];
    expect(patchArg).not.toHaveProperty('phoneE164');
    expect(patchArg).not.toHaveProperty('PK');
    expect(patchArg).not.toHaveProperty('sourceHistory');
    expect(patchArg).not.toHaveProperty('identities');
    expect(patchArg).toHaveProperty('displayName', 'Safe');
  });

  test('allows updating preference fields', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    repo.updateItem.mockResolvedValue({ ...UPDATED, preferredChannel: 'whatsapp', timezone: 'Asia/Kolkata' });
    await svc.updateContact(CID, CTID, {
      preferredChannel:  'whatsapp',
      preferredLanguage: 'hi',
      timezone:          'Asia/Kolkata',
    }, ACTOR);
    const patchArg = repo.updateItem.mock.calls[0][2];
    expect(patchArg).toHaveProperty('preferredChannel',  'whatsapp');
    expect(patchArg).toHaveProperty('preferredLanguage', 'hi');
    expect(patchArg).toHaveProperty('timezone',          'Asia/Kolkata');
  });
});

// ─── softDeleteContact ───────────────────────────────────────────────────────

describe('softDeleteContact()', () => {
  test('adds deletedAt and deletedBy to the contact', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    const deletedItem = { ...BASE_CONTACT, deletedAt: '2026-06-29T00:00:00.000Z', deletedBy: ACTOR, version: 2 };
    repo.updateItem.mockResolvedValue(deletedItem);

    const result = await svc.softDeleteContact(CID, CTID, ACTOR);
    expect(result.deletedAt).toBeDefined();
    const patchArg = repo.updateItem.mock.calls[0][2];
    expect(patchArg).toHaveProperty('deletedAt');
    expect(patchArg).toHaveProperty('deletedBy', ACTOR);
  });

  test('publishes CONTACT_ARCHIVED event', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT);
    repo.updateItem.mockResolvedValue({ ...BASE_CONTACT, deletedAt: '2026-06-29T00:00:00.000Z', version: 2 });
    await svc.softDeleteContact(CID, CTID, ACTOR);
    expect(publishEvent).toHaveBeenCalledWith('contact_archived', expect.objectContaining({
      companyId:  CID,
      entityType: 'CONTACT',
    }));
  });

  test('throws not_found when contact is already deleted', async () => {
    repo.getById.mockResolvedValue({ ...BASE_CONTACT, deletedAt: '2026-06-29T00:00:00.000Z' });
    await expect(svc.softDeleteContact(CID, CTID)).rejects.toThrow('not_found');
    expect(repo.updateItem).not.toHaveBeenCalled();
  });
});

// ─── restoreContact ───────────────────────────────────────────────────────────

describe('restoreContact()', () => {
  const DELETED_CONTACT = { ...BASE_CONTACT, deletedAt: '2026-06-29T00:00:00.000Z', deletedBy: ACTOR, version: 2 };

  test('calls updateItem with _removeAttrs signal', async () => {
    repo.getById.mockResolvedValue(DELETED_CONTACT);
    repo.updateItem.mockResolvedValue({ ...BASE_CONTACT, version: 3 });
    await svc.restoreContact(CID, CTID, ACTOR);
    const patchArg = repo.updateItem.mock.calls[0][2];
    expect(patchArg._removeAttrs).toEqual(['deletedAt', 'deletedBy']);
  });

  test('publishes CONTACT_UPDATED event on restore', async () => {
    repo.getById.mockResolvedValue(DELETED_CONTACT);
    repo.updateItem.mockResolvedValue({ ...BASE_CONTACT, version: 3 });
    await svc.restoreContact(CID, CTID, ACTOR);
    expect(publishEvent).toHaveBeenCalledWith('contact_updated', expect.objectContaining({
      companyId: CID,
    }));
  });

  test('throws not_found when contact does not exist', async () => {
    repo.getById.mockResolvedValue(null);
    await expect(svc.restoreContact(CID, CTID)).rejects.toThrow('not_found');
  });

  test('throws not_deleted when contact is not soft-deleted', async () => {
    repo.getById.mockResolvedValue(BASE_CONTACT); // no deletedAt
    await expect(svc.restoreContact(CID, CTID)).rejects.toThrow('not_deleted');
    expect(repo.updateItem).not.toHaveBeenCalled();
  });
});

// ─── listContacts ─────────────────────────────────────────────────────────────

describe('listContacts()', () => {
  test('returns contacts and lastKey from the repository', async () => {
    const cursor = { PK: 'CONTACT#comp_test#x', SK: 'CONTACT#META' };
    repo.queryByCompany.mockResolvedValue({ items: [BASE_CONTACT], lastKey: cursor });
    const result = await svc.listContacts(CID, { limit: 10 });
    expect(result.contacts).toEqual([BASE_CONTACT]);
    expect(result.lastKey).toEqual(cursor);
  });

  test('passes opts to repository', async () => {
    repo.queryByCompany.mockResolvedValue({ items: [], lastKey: null });
    const cursor = { PK: 'x', SK: 'y' };
    await svc.listContacts(CID, { limit: 25, lastKey: cursor });
    expect(repo.queryByCompany).toHaveBeenCalledWith(CID, { limit: 25, lastKey: cursor });
  });

  test('returns empty contacts array when none found', async () => {
    repo.queryByCompany.mockResolvedValue({ items: [], lastKey: null });
    const result = await svc.listContacts(CID);
    expect(result.contacts).toEqual([]);
    expect(result.lastKey).toBeNull();
  });
});
