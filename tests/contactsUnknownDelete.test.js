'use strict';

/**
 * Route-level regression test for DELETE /api/contacts/unknown/:phone —
 * added alongside Track A5's bulk-delete fast-follow (2026-07-10) when this
 * route's purge logic was extracted into
 * ContactBulkOpsService.deleteUnknownContact() so the new bulk-delete path
 * reuses it. No route-level test existed for this endpoint before; the
 * service function itself is covered in tests/contactBulkOpsServiceDelete.test.js
 * — this file only checks the route's own responsibilities (validation,
 * NotFoundError -> 404, success -> 200), same split as contactsBulkUpdate.test.js.
 */

jest.mock('../src/config/dynamodb', () => ({}));
jest.mock('../src/services/TagService', () => ({}));
jest.mock('../src/services/PipelineService', () => ({ isValidStage: jest.fn() }));
jest.mock('../src/services/ContactBulkOpsService', () => ({
  deleteUnknownContact: jest.fn(),
  NotFoundError: class NotFoundError extends Error {},
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';

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
const handler = getRouteHandler('/unknown/:phone', 'delete');

beforeEach(() => jest.clearAllMocks());

describe('DELETE /api/contacts/unknown/:phone', () => {
  test('rejects a phone that normalizes to nothing', async () => {
    const res = mockRes();
    await handler({ user: USER, params: { phone: 'not-a-phone' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ContactBulkOps.deleteUnknownContact).not.toHaveBeenCalled();
  });

  test('404s when the service reports the contact does not exist', async () => {
    ContactBulkOps.deleteUnknownContact.mockRejectedValueOnce(new ContactBulkOps.NotFoundError('Unknown contact not found'));
    const res = mockRes();
    await handler({ user: USER, params: { phone: '9000000000' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('deletes successfully and calls the service with the normalized phone', async () => {
    ContactBulkOps.deleteUnknownContact.mockResolvedValueOnce({});
    const res = mockRes();
    await handler({ user: USER, params: { phone: '900-000-0000' } }, res, jest.fn());
    expect(ContactBulkOps.deleteUnknownContact).toHaveBeenCalledWith('comp_test', '9000000000');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('an unexpected error propagates to next() rather than being swallowed', async () => {
    ContactBulkOps.deleteUnknownContact.mockRejectedValueOnce(new Error('DynamoDB unavailable'));
    const res = mockRes();
    const next = jest.fn();
    await handler({ user: USER, params: { phone: '9000000000' } }, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
