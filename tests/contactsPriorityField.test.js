'use strict';

/**
 * GET /api/contacts — priorityScore/priorityTier pass-through (LeadScoringScheduler
 * work). This route builds a curated field projection (normaliseLead()), not a raw
 * item spread, so a field mirrored onto LEAD# by the scheduler still needs adding
 * explicitly here or it's silently dropped from every Sales CRM list/Kanban view —
 * the same gap Item 7 fixed for the inbox intent badge. Verified here, not just
 * asserted, the same way that fix was.
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
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('GET /api/contacts — priorityScore/priorityTier pass-through', () => {
  const handler = getRouteHandler(contactsRouter, '/', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('includes priorityScore/priorityTier for a scored lead (admin view)', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead1', leadId: 'lead1', companyId: 'acme', name: 'Ravi', phone: '9876543210',
      stage: 'interested', assignedTo: 'emp_1', priorityScore: 82, priorityTier: 'hot',
    }] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    const contact = body.contacts.find((c) => c.leadId === 'lead1');
    expect(contact.priorityScore).toBe(82);
    expect(contact.priorityTier).toBe('hot');
  });

  test('defaults priorityScore/priorityTier to null for an unscored lead', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead2', leadId: 'lead2', companyId: 'acme', name: 'Priya', phone: '9000000000',
      stage: 'new_lead', assignedTo: 'emp_1',
    }] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    const contact = body.contacts.find((c) => c.leadId === 'lead2');
    expect(contact.priorityScore).toBeNull();
    expect(contact.priorityTier).toBeNull();
  });

  test('an agent scoped to their own leads still sees the priority fields on their own lead', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [
      { PK: 'LEAD#acme#mine', leadId: 'mine', companyId: 'acme', name: 'Mine', phone: '9111111111', assignedTo: 'emp_1', priorityScore: 55, priorityTier: 'warm' },
      { PK: 'LEAD#acme#other', leadId: 'other', companyId: 'acme', name: 'Other', phone: '9222222222', assignedTo: 'emp_2', priorityScore: 90, priorityTier: 'hot' },
    ] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'emp_1', role: 'telecaller' }, query: {} }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]).toMatchObject({ leadId: 'mine', priorityScore: 55, priorityTier: 'warm' });
  });
});

// 2026-07-17 — same "curated projection silently drops a field" gap as
// priorityScore above, now for stageChangedAt (the Sales Kanban board's
// "Recently moved" sort, sales/page.tsx). Covers both normaliseLead() and
// normaliseInbox() since the Kanban board mixes leads and unknown contacts.
describe('GET /api/contacts — stageChangedAt pass-through', () => {
  const handler = getRouteHandler(contactsRouter, '/', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('includes stageChangedAt for a lead that has been moved at least once', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead1', leadId: 'lead1', companyId: 'acme', name: 'Ravi', phone: '9876543210',
      stage: 'interested', assignedTo: 'emp_1', stageChangedAt: '2026-07-17T10:00:00.000Z',
    }] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const contact = res.json.mock.calls[0][0].contacts.find((c) => c.leadId === 'lead1');
    expect(contact.stageChangedAt).toBe('2026-07-17T10:00:00.000Z');
  });

  test('defaults stageChangedAt to null for a lead that predates the field', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'LEAD#acme#lead2', leadId: 'lead2', companyId: 'acme', name: 'Priya', phone: '9000000000',
      stage: 'new_lead', assignedTo: 'emp_1',
    }] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const contact = res.json.mock.calls[0][0].contacts.find((c) => c.leadId === 'lead2');
    expect(contact.stageChangedAt).toBeNull();
  });

  test('includes stageChangedAt for an unknown (INBOX#) contact too', async () => {
    dynamodb.query.mockReturnValue({ promise: () => Promise.resolve({ Items: [] }) });
    dynamodb.scan.mockReturnValue({ promise: () => Promise.resolve({ Items: [{
      PK: 'INBOX#acme#9333333333', SK: 'CONTACT', phone: '9333333333', stage: 'new_lead',
      stageChangedAt: '2026-07-17T11:00:00.000Z',
    }] }) });

    const res = mockRes();
    await handler({ user: { companyId: 'acme', id: 'admin_1', role: 'admin' }, query: {} }, res, jest.fn());

    const contact = res.json.mock.calls[0][0].contacts.find((c) => c.phone === '9333333333');
    expect(contact.stageChangedAt).toBe('2026-07-17T11:00:00.000Z');
  });
});
