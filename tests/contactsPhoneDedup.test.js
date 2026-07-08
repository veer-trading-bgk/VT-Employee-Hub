'use strict';

/**
 * Wave 1 audit — Fix 4: GET /api/contacts deduped INBOX# against LEAD# using
 * raw phone strings (l.phone / u.phone), the exact gap ADR-013's own migration
 * table calls out (item 3). Two same-subscriber numbers differing only in
 * format (e.g. a lead's phoneNorm vs. an INBOX# record's un-normalized phone)
 * both surfaced in the unified contact list instead of deduping. Fixed via
 * the ADR's own verbatim fallback: l.phoneNorm ?? to10Digit(l.phone), applied
 * to both sides of the comparison.
 */

jest.mock('../src/config/dynamodb', () => ({
  query: jest.fn(), scan: jest.fn(), get: jest.fn(),
}));
jest.mock('../src/services/TagService', () => ({
  expandTagFilter: jest.fn(), matchesTagFilter: jest.fn(),
}));
jest.mock('../src/services/PipelineService', () => ({
  getPipelineStages: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const contactsRouter = require('../src/routes/contacts');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('GET /api/contacts — LEAD#/INBOX# phone dedup (Fix 4)', () => {
  const handler = getRouteHandler(contactsRouter, '/', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('an INBOX# record is suppressed when a LEAD# with a matching phoneNorm exists in a different raw format', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead1', leadId: 'lead1', companyId: 'acme', name: 'Ravi',
      phone: '9876543210', phoneNorm: '9876543210', stage: 'new_lead', assignedTo: 'emp_1',
    }] }) });
    // Same subscriber, +91-prefixed raw format — no phoneNorm field (older/un-migrated record)
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'INBOX#acme#9876543210', phone: '919876543210', waName: 'Ravi WA',
    }] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.contacts.some((c) => c.type === 'unknown')).toBe(false);
    expect(body.contacts.find((c) => c.leadId === 'lead1')).toBeDefined();
  });

  test('an INBOX# record for a genuinely different number is NOT suppressed', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead1', leadId: 'lead1', companyId: 'acme', name: 'Ravi',
      phone: '9876543210', phoneNorm: '9876543210', stage: 'new_lead', assignedTo: 'emp_1',
    }] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'INBOX#acme#9000000000', phone: '9000000000', waName: 'Someone Else',
    }] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.contacts.some((c) => c.type === 'unknown' && c.phone === '9000000000')).toBe(true);
  });

  test('falls back to to10Digit(l.phone) for a LEAD# record with no phoneNorm field yet', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead2', leadId: 'lead2', companyId: 'acme', name: 'Priya',
      phone: '919000000000', stage: 'new_lead', assignedTo: 'emp_1', // no phoneNorm — pre-ADR-013 record
    }] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'INBOX#acme#9000000000', phone: '9000000000', waName: 'Priya WA',
    }] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.contacts.some((c) => c.type === 'unknown')).toBe(false);
  });
});
