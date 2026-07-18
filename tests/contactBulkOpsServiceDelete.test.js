'use strict';

/**
 * Tests for ContactBulkOpsService.deleteLead/deleteUnknownContact/deleteContact
 * (Track A5 fast-follow, 2026-07-10, docs/phase3/TECHNICAL_DEBT.md) — the
 * purge logic extracted verbatim from crm.js's DELETE /leads/:id and
 * contacts.js's DELETE /unknown/:phone so the new bulk-delete path
 * (contacts.js POST /bulk-update) goes through the exact same full purge,
 * not a shortcut that only deletes the LEAD#/INBOX# record and leaves
 * CONV#/TL# partitions orphaned.
 *
 * A stateful in-memory fake table (not static resolved-value mocks) is used
 * so query()/batchWrite()/delete() genuinely observe each other's effects —
 * the only way to prove "every item under this PK is actually gone" rather
 * than just "batchWrite was called with a plausible-looking argument".
 */

jest.mock('../src/config/dynamodb');
const dynamodb = require('../src/config/dynamodb');
const {
  deleteLead, deleteUnknownContact, deleteContact, NotFoundError,
} = require('../src/services/ContactBulkOpsService');

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const CID = 'comp_test';

function itemKey(it) { return `${it.PK}#${it.SK}`; }

// ── Stateful fake table — real query-by-PK / real batch-delete / real
// single-item delete, all against the same shared Map, so a purge that
// misses a partition is actually observable (leftover keys), not just
// "the right calls happened to fire".
function makeFakeStore(items) {
  const store = new Map(items.map((it) => [itemKey(it), it]));

  dynamodb.get.mockImplementation(({ Key }) => ({
    promise: () => Promise.resolve({ Item: store.get(`${Key.PK}#${Key.SK}`) }),
  }));

  dynamodb.query.mockImplementation(({ ExpressionAttributeValues }) => {
    const pk = ExpressionAttributeValues[':pk'];
    const matched = [...store.values()].filter((it) => it.PK === pk);
    return { promise: () => Promise.resolve({ Items: matched }) };
  });

  dynamodb.batchWrite.mockImplementation(({ RequestItems }) => {
    const table = Object.keys(RequestItems)[0];
    RequestItems[table].forEach((req) => {
      if (req.DeleteRequest) store.delete(`${req.DeleteRequest.Key.PK}#${req.DeleteRequest.Key.SK}`);
    });
    return { promise: () => Promise.resolve({}) };
  });

  dynamodb.delete.mockImplementation(({ Key }) => {
    store.delete(`${Key.PK}#${Key.SK}`);
    return { promise: () => Promise.resolve({}) };
  });

  return {
    has: (pk, sk) => store.has(`${pk}#${sk}`),
    anyUnderPK: (pk) => [...store.values()].some((it) => it.PK === pk),
    size: () => store.size,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('ContactBulkOpsService.deleteLead() — full hard purge', () => {
  test('throws NotFoundError when the lead does not exist', async () => {
    makeFakeStore([]);
    await expect(deleteLead(CID, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  test('purges LEAD#, INBOX#, TL#LEAD, linked CONV#/TL#CONV, and the phone lock — nothing left behind', async () => {
    const phone = '9998887771';
    const leadId = 'lead1';
    const convId = 'conv1';
    const store = makeFakeStore([
      { PK: `LEAD#${CID}#${leadId}`, SK: 'METADATA', leadId, phone, phoneNorm: phone, convId },
      { PK: `LEAD#${CID}#${leadId}`, SK: 'MSG#2026-07-10T00:00:00.000Z#m1' },
      { PK: `LEAD#${CID}#${leadId}`, SK: 'NOTE#2026-07-10T00:00:00.000Z' },
      { PK: `INBOX#${CID}#${phone}`, SK: 'CONTACT', convId },
      { PK: `INBOX#${CID}#${phone}`, SK: 'MSG#2026-07-09T00:00:00.000Z#m0' },
      { PK: `TL#${CID}#LEAD#${leadId}`, SK: '2026-07-10T00:00:00.000Z#touch_received#e1' },
      { PK: `CONV#${CID}#${convId}`, SK: 'CONV#META' },
      { PK: `TL#${CID}#CONV#${convId}`, SK: '2026-07-10T00:00:00.000Z#msg_in#e2' },
      { PK: `LEAD_PHONE#${CID}#${phone}`, SK: 'LOCK' },
      // A DIFFERENT lead's data — must survive untouched.
      { PK: `LEAD#${CID}#lead-other`, SK: 'METADATA', leadId: 'lead-other' },
    ]);

    const result = await deleteLead(CID, leadId);

    expect(store.anyUnderPK(`LEAD#${CID}#${leadId}`)).toBe(false);
    expect(store.anyUnderPK(`INBOX#${CID}#${phone}`)).toBe(false);
    expect(store.anyUnderPK(`TL#${CID}#LEAD#${leadId}`)).toBe(false);
    expect(store.anyUnderPK(`CONV#${CID}#${convId}`)).toBe(false);
    expect(store.anyUnderPK(`TL#${CID}#CONV#${convId}`)).toBe(false);
    expect(store.has(`LEAD_PHONE#${CID}#${phone}`, 'LOCK')).toBe(false);
    // Unrelated lead untouched.
    expect(store.has(`LEAD#${CID}#lead-other`, 'METADATA')).toBe(true);

    expect(result.phone).toBe(phone);
    expect(result.convId).toBe(convId);
    expect(result.convTlPartialFailure).toBe(false);
  });

  test('Era 41: an INBOX#-linked convId different from the lead\'s own convId is ALSO purged as an orphan', async () => {
    const phone = '9998887772';
    const leadId = 'lead2';
    const leadConvId = 'conv-lead';
    const inboxConvId = 'conv-inbox-orphan';
    const store = makeFakeStore([
      { PK: `LEAD#${CID}#${leadId}`, SK: 'METADATA', leadId, phone, convId: leadConvId },
      { PK: `INBOX#${CID}#${phone}`, SK: 'CONTACT', convId: inboxConvId },
      { PK: `CONV#${CID}#${leadConvId}`, SK: 'CONV#META' },
      { PK: `TL#${CID}#CONV#${leadConvId}`, SK: '2026-07-10T00:00:00.000Z#e1' },
      { PK: `CONV#${CID}#${inboxConvId}`, SK: 'CONV#META' },
      { PK: `TL#${CID}#CONV#${inboxConvId}`, SK: '2026-07-10T00:00:00.000Z#e2' },
    ]);

    const result = await deleteLead(CID, leadId);

    // Both conversations purged, not just the lead's own one — the exact
    // orphan this route exists to close (see Era 41 in the source comments).
    expect(store.anyUnderPK(`CONV#${CID}#${leadConvId}`)).toBe(false);
    expect(store.anyUnderPK(`TL#${CID}#CONV#${leadConvId}`)).toBe(false);
    expect(store.anyUnderPK(`CONV#${CID}#${inboxConvId}`)).toBe(false);
    expect(store.anyUnderPK(`TL#${CID}#CONV#${inboxConvId}`)).toBe(false);
    expect(result.inboxConvId).toBe(inboxConvId);
    expect(result.convTlPurge.inboxConv).toBe(true);
    expect(result.convTlPurge.tlInboxConv).toBe(true);
  });

  test('a lead with no convId and no phone lock purges cleanly with conv/tlConv left null (not applicable, not failed)', async () => {
    const leadId = 'lead3';
    makeFakeStore([
      { PK: `LEAD#${CID}#${leadId}`, SK: 'METADATA', leadId },
    ]);

    const result = await deleteLead(CID, leadId);
    expect(result.convId).toBeNull();
    expect(result.convTlPurge.conv).toBeNull();
    expect(result.convTlPurge.tlConv).toBeNull();
    expect(result.convTlPartialFailure).toBe(false);
  });
});

describe('ContactBulkOpsService.deleteUnknownContact() — INBOX# partition purge', () => {
  test('throws NotFoundError when the unknown contact does not exist', async () => {
    makeFakeStore([]);
    await expect(deleteUnknownContact(CID, '9000000000')).rejects.toBeInstanceOf(NotFoundError);
  });

  test('purges the entire INBOX# partition (CONTACT + pre-promotion MSG#*)', async () => {
    const phone = '9000000001';
    const store = makeFakeStore([
      { PK: `INBOX#${CID}#${phone}`, SK: 'CONTACT' },
      { PK: `INBOX#${CID}#${phone}`, SK: 'MSG#2026-07-10T00:00:00.000Z#m1' },
      { PK: `INBOX#${CID}#other`, SK: 'CONTACT' },
    ]);

    await deleteUnknownContact(CID, phone);

    expect(store.anyUnderPK(`INBOX#${CID}#${phone}`)).toBe(false);
    expect(store.has(`INBOX#${CID}#other`, 'CONTACT')).toBe(true);
  });

  // Stage 5 (2026-07-17 360° audit fix plan, finding #6): an unknown contact
  // that ever received an inbound message has a real CONV#/TL#CONV# pair
  // (resolveForInbox()), with convId stamped onto the same INBOX# CONTACT
  // item deleted above. Confirms that pair no longer survives the delete.
  test('purges a linked CONV#/TL#CONV# too, when the INBOX# CONTACT item has a convId', async () => {
    const phone = '9000000003';
    const convId = 'conv-unknown-1';
    const store = makeFakeStore([
      { PK: `INBOX#${CID}#${phone}`, SK: 'CONTACT', convId },
      { PK: `INBOX#${CID}#${phone}`, SK: 'MSG#2026-07-10T00:00:00.000Z#m1' },
      { PK: `CONV#${CID}#${convId}`, SK: 'CONV#META', lastMessageText: 'hi', aiSummary: 'greeting' },
      { PK: `TL#${CID}#CONV#${convId}`, SK: '2026-07-10T00:00:00.000Z#msg_in#e1' },
      // A different, unrelated conversation — must survive untouched.
      { PK: `CONV#${CID}#other-conv`, SK: 'CONV#META' },
    ]);

    const result = await deleteUnknownContact(CID, phone);

    expect(store.anyUnderPK(`INBOX#${CID}#${phone}`)).toBe(false);
    expect(store.anyUnderPK(`CONV#${CID}#${convId}`)).toBe(false);
    expect(store.anyUnderPK(`TL#${CID}#CONV#${convId}`)).toBe(false);
    expect(store.has(`CONV#${CID}#other-conv`, 'CONV#META')).toBe(true);

    expect(result.convId).toBe(convId);
    expect(result.convTlPurge).toEqual({ conv: true, tlConv: true });
    expect(result.convTlPartialFailure).toBe(false);
  });

  test('no convId (never messaged) — INBOX# purge still succeeds cleanly, no CONV#/TL# purge attempted', async () => {
    const phone = '9000000004';
    const store = makeFakeStore([
      { PK: `INBOX#${CID}#${phone}`, SK: 'CONTACT' },
    ]);

    const result = await deleteUnknownContact(CID, phone);

    expect(store.anyUnderPK(`INBOX#${CID}#${phone}`)).toBe(false);
    expect(result.convId).toBeNull();
    expect(result.convTlPurge).toEqual({ conv: null, tlConv: null });
    expect(result.convTlPartialFailure).toBe(false);
  });
});

describe('ContactBulkOpsService.deleteContact() — bulk-delete dispatcher', () => {
  test('routes to deleteLead when leadId is present', async () => {
    const leadId = 'lead4';
    const store = makeFakeStore([{ PK: `LEAD#${CID}#${leadId}`, SK: 'METADATA', leadId }]);
    const result = await deleteContact(CID, { leadId });
    expect(result.isLead).toBe(true);
    expect(store.has(`LEAD#${CID}#${leadId}`, 'METADATA')).toBe(false);
  });

  test('routes to deleteUnknownContact when only phone is present', async () => {
    const phone = '9000000002';
    const store = makeFakeStore([{ PK: `INBOX#${CID}#${phone}`, SK: 'CONTACT' }]);
    const result = await deleteContact(CID, { phone });
    expect(result.isLead).toBe(false);
    expect(store.has(`INBOX#${CID}#${phone}`, 'CONTACT')).toBe(false);
  });

  test('throws when neither leadId nor phone is provided', async () => {
    makeFakeStore([]);
    await expect(deleteContact(CID, {})).rejects.toThrow('leadId or phone required');
  });
});
