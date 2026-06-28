'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/config/dynamodb', () => ({
  get:    jest.fn(),
  update: jest.fn(),
}));
jest.mock('../src/services/ContactService');

const dynamodb       = require('../src/config/dynamodb');
const ContactService = require('../src/services/ContactService');
const LeadService    = require('../src/services/LeadService');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID      = 'comp_test';
const PHONE10  = '9901251785';
const LEAD_PK  = `LEAD#${CID}#lead_001`;
const CONTACT  = Object.freeze({ contactId: 'contact_abc', phoneE164: '+919901251785' });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

  // Default: no existing contactId on METADATA item
  dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
  dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({}) });

  // ContactService defaults
  ContactService.findContactByPhone.mockResolvedValue(null);
  ContactService.createContact.mockResolvedValue({ contact: CONTACT, created: true });
});

afterEach(() => { delete process.env.DYNAMODB_TABLE_METRICS; });

// ─── linkContactToLead ────────────────────────────────────────────────────────

describe('linkContactToLead()', () => {
  test('creates Contact and writes contactId when no Contact exists', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    expect(ContactService.findContactByPhone).toHaveBeenCalledWith(CID, PHONE10);
    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ phone: PHONE10, source: 'lead' }),
      'system',
    );
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
      ExpressionAttributeValues: expect.objectContaining({ ':ctid': CONTACT.contactId }),
    }));
  });

  test('reuses existing Contact and skips createContact', async () => {
    ContactService.findContactByPhone.mockResolvedValue(CONTACT);

    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    expect(ContactService.findContactByPhone).toHaveBeenCalledWith(CID, PHONE10);
    expect(ContactService.createContact).not.toHaveBeenCalled();
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':ctid': CONTACT.contactId }),
    }));
  });

  test('writes contactId with if_not_exists guard (race-safe)', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    const call = dynamodb.update.mock.calls[0][0];
    expect(call.UpdateExpression).toMatch(/if_not_exists\(contactId/);
  });

  test('is idempotent — skips all work when contactId already set on Lead', async () => {
    dynamodb.get.mockReturnValue({
      promise: () => Promise.resolve({ Item: { contactId: 'contact_existing' } }),
    });

    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    expect(ContactService.findContactByPhone).not.toHaveBeenCalled();
    expect(ContactService.createContact).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('passes leadName as displayName when creating Contact', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Ramesh Kumar');

    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ displayName: 'Ramesh Kumar' }),
      'system',
    );
  });

  test('falls back to phone as displayName when leadName is undefined', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, undefined);

    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ displayName: PHONE10 }),
      'system',
    );
  });

  test('passes source="lead" to createContact', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    expect(ContactService.createContact).toHaveBeenCalledWith(
      CID,
      expect.objectContaining({ source: 'lead' }),
      'system',
    );
  });

  test('uses the metrics table from environment variable', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'vt-metrics-test',
    }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'vt-metrics-test',
    }));
  });

  test('checks METADATA SK on initial get', async () => {
    await LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice');

    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: LEAD_PK, SK: 'METADATA' },
    }));
  });

  test('never throws — catches ContactService.findContactByPhone error', async () => {
    ContactService.findContactByPhone.mockRejectedValue(new Error('GSI timeout'));
    await expect(LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice')).resolves.toBeUndefined();
  });

  test('never throws — catches ContactService.createContact error', async () => {
    ContactService.createContact.mockRejectedValue(new Error('DDB throttle'));
    await expect(LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice')).resolves.toBeUndefined();
  });

  test('never throws — catches DynamoDB get error', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.reject(new Error('connection refused')) });
    await expect(LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice')).resolves.toBeUndefined();
  });

  test('never throws — catches DynamoDB update error', async () => {
    dynamodb.update.mockReturnValue({ promise: () => Promise.reject(new Error('write failed')) });
    await expect(LeadService.linkContactToLead(CID, LEAD_PK, PHONE10, 'Alice')).resolves.toBeUndefined();
  });
});
