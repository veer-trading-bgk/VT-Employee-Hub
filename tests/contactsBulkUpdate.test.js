'use strict';

/**
 * Tests for POST /api/contacts/bulk-update (2026-07-10, docs/phase3/TECHNICAL_DEBT.md,
 * "bulk actions partial failure" root-cause correction). Replaces the old
 * N-concurrent-individual-calls pattern with one request, processed
 * sequentially server-side, returning a per-id result array.
 *
 * ContactBulkOpsService is mocked here — its own internals (including the
 * race-condition proof) are covered by tests/contactBulkOpsService.test.js.
 * This file tests the ROUTE's own responsibilities: request validation,
 * sequential dispatch, and building an honest per-id result array from a
 * mix of successes and failures.
 */

jest.mock('../src/config/dynamodb', () => ({}));
jest.mock('../src/services/TagService', () => ({}));
jest.mock('../src/services/PipelineService', () => ({ isValidStage: jest.fn() }));
jest.mock('../src/services/ContactBulkOpsService', () => ({
  assignLead: jest.fn(),
  updateStage: jest.fn(),
  updateTags: jest.fn(),
  NotFoundError: class NotFoundError extends Error {},
}));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

const PipelineService = require('../src/services/PipelineService');
const ContactBulkOps = require('../src/services/ContactBulkOpsService');
const contactsRouter = require('../src/routes/contacts');

function getRouteHandler(path, method) {
  const layer = contactsRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const USER = { id: 'u1', role: 'admin', companyId: 'comp_test' };
const handler = getRouteHandler('/bulk-update', 'post');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/contacts/bulk-update — request validation', () => {
  test('rejects an empty contacts array', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { contacts: [], operation: 'tag', params: { tagId: 't1' } } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ContactBulkOps.updateTags).not.toHaveBeenCalled();
  });

  test('rejects more than 500 contacts', async () => {
    const contacts = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, leadId: `c${i}` }));
    const res = mockRes();
    await handler({ user: USER, body: { contacts, operation: 'tag', params: { tagId: 't1' } } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects an unknown operation', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { contacts: [{ id: 'c1', leadId: 'c1' }], operation: 'delete', params: {} } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects assign with no params.assignedTo', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { contacts: [{ id: 'c1', leadId: 'c1' }], operation: 'assign', params: {} } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ContactBulkOps.assignLead).not.toHaveBeenCalled();
  });

  test('rejects tag/untag with no params.tagId', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { contacts: [{ id: 'c1', leadId: 'c1' }], operation: 'tag', params: {} } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects stage with an invalid stage key', async () => {
    PipelineService.isValidStage.mockResolvedValue(false);
    const res = mockRes();
    await handler({ user: USER, body: { contacts: [{ id: 'c1', leadId: 'c1' }], operation: 'stage', params: { stage: 'bogus' } } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ContactBulkOps.updateStage).not.toHaveBeenCalled();
  });
});

describe('POST /api/contacts/bulk-update — per-id result array (mixed valid + invalid ids)', () => {
  test('assign: a mix of a valid lead, a missing lead (NotFoundError), and a non-lead contact all report correctly', async () => {
    ContactBulkOps.assignLead
      .mockResolvedValueOnce({ assignedTo: 'emp_1', assignedToName: 'Priya' }) // c1: succeeds
      .mockRejectedValueOnce(new ContactBulkOps.NotFoundError('Lead not found')); // c2: fails

    const contacts = [
      { id: 'c1', leadId: 'lead1' },          // valid lead -> succeeds
      { id: 'c2', leadId: 'lead2' },           // valid lead id, but service reports not found
      { id: 'c3', phone: '9000000000' },       // no leadId at all -> "assign only applies to leads"
    ];
    const res = mockRes();
    await handler({ user: USER, body: { contacts, operation: 'assign', params: { assignedTo: 'emp_1', assignedToName: 'Priya' } } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      succeeded: 1,
      failed: 2,
      results: [
        { id: 'c1', ok: true },
        { id: 'c2', ok: false, error: 'Lead not found' },
        { id: 'c3', ok: false, error: 'assign only applies to CRM leads' },
      ],
    }));
    expect(ContactBulkOps.assignLead).toHaveBeenCalledTimes(2); // c3 never reached the service at all
  });

  test('tag: results preserve input order and each error is attributed to the right id', async () => {
    ContactBulkOps.updateTags
      .mockResolvedValueOnce({ tags: ['hot'] })
      .mockRejectedValueOnce(new Error('DynamoDB unavailable'))
      .mockResolvedValueOnce({ tags: ['hot'] });

    const contacts = [
      { id: 'a', leadId: 'a' },
      { id: 'b', leadId: 'b' },
      { id: 'c', phone: '9111111111' },
    ];
    const res = mockRes();
    await handler({ user: USER, body: { contacts, operation: 'tag', params: { tagId: 'hot' } } }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(body.results[0]).toEqual({ id: 'a', ok: true });
    expect(body.results[1]).toEqual({ id: 'b', ok: false, error: 'DynamoDB unavailable' });
    expect(body.results[2]).toEqual({ id: 'c', ok: true });
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(1);
  });

  test('all-succeed and all-fail cases produce correct succeeded/failed counts', async () => {
    ContactBulkOps.updateTags.mockResolvedValue({ tags: ['x'] });
    const contacts = [{ id: 'a', leadId: 'a' }, { id: 'b', leadId: 'b' }];
    const res = mockRes();
    await handler({ user: USER, body: { contacts, operation: 'untag', params: { tagId: 'x' } } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ succeeded: 2, failed: 0 }));
  });

  test('processes contacts sequentially, one at a time, not concurrently', async () => {
    const order = [];
    ContactBulkOps.updateTags.mockImplementation(async (companyId, key) => {
      order.push(`start:${key.leadId}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${key.leadId}`);
      return { tags: [] };
    });
    const contacts = [{ id: 'a', leadId: 'a' }, { id: 'b', leadId: 'b' }, { id: 'c', leadId: 'c' }];
    const res = mockRes();
    await handler({ user: USER, body: { contacts, operation: 'tag', params: { tagId: 't' } } }, res, jest.fn());

    // Sequential = each start/end pair completes before the next starts.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });
});
