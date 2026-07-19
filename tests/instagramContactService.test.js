'use strict';

/**
 * Contract tests for InstagramContactService — lightweight, non-CRM contact
 * storage for Instagram DM automation (the "lightweight, no CRM" decision,
 * 2026-07-18). The property under test throughout: an Instagram contact is
 * NEVER a LEAD# record — no CustomerIdentityService/ADR-013 involvement,
 * no pipeline/CRM shape, just a plain get-or-create keyed on IGSID.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const logger = require('../src/config/logger');
const InstagramContactService = require('../src/services/InstagramContactService');

const CID = 'comp_test';
const IGSID = 'ig_17841400000000000';

function okPromise(v = {}) { return { promise: () => Promise.resolve(v) }; }

describe('InstagramContactService.resolveOrCreate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws without companyId or igsid — no silent no-op', async () => {
    await expect(InstagramContactService.resolveOrCreate(null, IGSID, null)).rejects.toThrow(/companyId is required/);
    await expect(InstagramContactService.resolveOrCreate(CID, null, null)).rejects.toThrow(/igsid is required/);
  });

  test('first message: creates a plain IGCONTACT# item — no LEAD#, no stage, no assignedTo, no CRM fields of any kind', async () => {
    dynamodb.get.mockReturnValue(okPromise({})); // no existing record
    dynamodb.put.mockReturnValue(okPromise());

    const { contact, created } = await InstagramContactService.resolveOrCreate(CID, IGSID, null);

    expect(created).toBe(true);
    expect(contact).toMatchObject({
      PK: `IGCONTACT#${CID}#${IGSID}`, SK: 'CURRENT', companyId: CID, igsid: IGSID, tags: [],
    });
    // The explicit negative — confirms this is genuinely not a lead item.
    expect(contact).not.toHaveProperty('stage');
    expect(contact).not.toHaveProperty('assignedTo');
    expect(contact).not.toHaveProperty('pipelineId');
    expect(contact).not.toHaveProperty('phone');
    const putCall = dynamodb.put.mock.calls[0][0];
    expect(putCall.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect(putCall.TableName).toBe(process.env.DYNAMODB_TABLE_METRICS);
  });

  test('second message from the same igsid: returns the existing record, does not create a duplicate', async () => {
    const existing = { PK: `IGCONTACT#${CID}#${IGSID}`, SK: 'CURRENT', companyId: CID, igsid: IGSID, displayName: null, tags: [] };
    dynamodb.get.mockReturnValue(okPromise({ Item: existing }));

    const { contact, created } = await InstagramContactService.resolveOrCreate(CID, IGSID, null);

    expect(created).toBe(false);
    expect(contact).toEqual(existing);
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('a new displayName on an existing contact refreshes it via a targeted SET, not a full overwrite', async () => {
    const existing = { PK: `IGCONTACT#${CID}#${IGSID}`, SK: 'CURRENT', companyId: CID, igsid: IGSID, displayName: 'Old Name', tags: ['vip'] };
    dynamodb.get.mockReturnValue(okPromise({ Item: existing }));
    dynamodb.update.mockReturnValue(okPromise());

    const { contact } = await InstagramContactService.resolveOrCreate(CID, IGSID, 'New Name');

    expect(contact.displayName).toBe('New Name');
    expect(contact.tags).toEqual(['vip']); // untouched by the name refresh
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `IGCONTACT#${CID}#${IGSID}`, SK: 'CURRENT' },
      UpdateExpression: 'SET displayName = :n, updatedAt = :ua',
      ExpressionAttributeValues: { ':n': 'New Name', ':ua': expect.any(String) },
    }));
  });

  test('concurrent first-message race: the create loses to a conditional-put conflict, so it reads and returns the winner instead of a phantom draft', async () => {
    dynamodb.get
      .mockReturnValueOnce(okPromise({})) // no existing record on the first check
      .mockReturnValueOnce(okPromise({ Item: { PK: `IGCONTACT#${CID}#${IGSID}`, SK: 'CURRENT', companyId: CID, igsid: IGSID, displayName: null, tags: [] } })); // the winner's record
    dynamodb.put.mockReturnValue({
      promise: () => Promise.reject(Object.assign(new Error('conditional'), { code: 'ConditionalCheckFailedException' })),
    });

    const { contact, created } = await InstagramContactService.resolveOrCreate(CID, IGSID, null);

    expect(created).toBe(false);
    expect(contact.igsid).toBe(IGSID);
    expect(dynamodb.get).toHaveBeenCalledTimes(2);
  });
});

describe('InstagramContactService.recordMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writes a MSG# item under the contact\'s own IGCONTACT# partition (never a LEAD# partition) and bumps lastMessageAt', async () => {
    dynamodb.put.mockReturnValue(okPromise());
    dynamodb.update.mockReturnValue(okPromise());

    await InstagramContactService.recordMessage(CID, IGSID, {
      direction: 'inbound', content: 'hi there', timestamp: 1732000000000, mid: 'mid_abc',
    });

    const putItem = dynamodb.put.mock.calls[0][0].Item;
    expect(putItem.PK).toBe(`IGCONTACT#${CID}#${IGSID}`);
    expect(putItem.SK).toBe('MSG#1732000000000#mid_abc');
    expect(putItem).toMatchObject({ direction: 'inbound', content: 'hi there', type: 'text', igMid: 'mid_abc' });

    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      Key: { PK: `IGCONTACT#${CID}#${IGSID}`, SK: 'CURRENT' },
      UpdateExpression: 'SET lastMessageAt = :t',
    }));
  });

  test('best-effort: a write failure is logged and swallowed, never thrown — must not block the webhook handler or a send', async () => {
    dynamodb.put.mockReturnValue({ promise: () => Promise.reject(new Error('ddb down')) });

    await expect(InstagramContactService.recordMessage(CID, IGSID, {
      direction: 'outbound', content: 'reply', timestamp: Date.now(),
    })).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('recordMessage'));
  });
});
