'use strict';

/**
 * Regression tests for the zod v4 .errors→.issues bug found and fixed this
 * session: ZodError objects expose validation detail via `.issues` in zod v4,
 * not the v3-era `.errors` property. crm.js's three schema-validated routes
 * (POST /leads, PUT /leads/:id, POST /leads/:id/followup) all read
 * `parsed.error.errors` — silently `undefined` — for their 400 response's
 * `details` field. Fixed to `.issues`; these tests assert the 400 body
 * actually carries real, non-empty error detail, not a silently-dropped
 * field. Same direct-handler-invocation technique as the WhatsApp Flows/
 * welcome-buttons contract tests: no HTTP, no auth, dynamodb/logger mocked.
 */

jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), query: jest.fn(), update: jest.fn(), delete: jest.fn(), scan: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const crmRouter = require('../src/routes/crm');

function getRouteHandler(path, method) {
  const layer = crmRouter.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

// Shared assertion: the 400 body's `details` must be a real, populated array
// of Zod issue objects — not undefined (the exact regression this guards).
function expectRealValidationDetail(res) {
  expect(res.status).toHaveBeenCalledWith(400);
  const [jsonBody] = res.json.mock.calls[0];
  expect(jsonBody.error).toBe('Validation failed');
  expect(jsonBody.details).toBeDefined();
  expect(Array.isArray(jsonBody.details)).toBe(true);
  expect(jsonBody.details.length).toBeGreaterThan(0);
  expect(jsonBody.details[0]).toHaveProperty('message');
  expect(typeof jsonBody.details[0].message).toBe('string');
  expect(jsonBody.details[0].message.length).toBeGreaterThan(0);
  return jsonBody;
}

describe('POST /api/crm/leads — createLeadSchema validation detail', () => {
  test('missing required fields (name, phone) returns 400 with real, non-empty error detail', async () => {
    const handler = getRouteHandler('/leads', 'post');
    const req = { body: {}, user: { companyId: 'acme', id: 'emp_1' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    const jsonBody = expectRealValidationDetail(res);
    const paths = jsonBody.details.map((d) => d.path?.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'phone']));
  });

  test('invalid phone format returns 400 with detail identifying the phone field', async () => {
    const handler = getRouteHandler('/leads', 'post');
    const req = { body: { name: 'Test Lead', phone: '123' }, user: { companyId: 'acme', id: 'emp_1' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    const jsonBody = expectRealValidationDetail(res);
    expect(jsonBody.details.some((d) => d.path?.includes('phone'))).toBe(true);
  });
});

describe('PUT /api/crm/leads/:id — updateLeadSchema validation detail', () => {
  test('an invalid field value returns 400 with real, non-empty error detail', async () => {
    const handler = getRouteHandler('/leads/:id', 'put');
    const req = {
      params: { id: 'lead_123' },
      body: { phone: 'not-a-phone-number' },
      user: { companyId: 'acme', id: 'emp_1' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expectRealValidationDetail(res);
  });

  test('tags exceeding the 20-item cap returns 400 with real error detail', async () => {
    const handler = getRouteHandler('/leads/:id', 'put');
    const req = {
      params: { id: 'lead_123' },
      body: { tags: Array.from({ length: 25 }, (_, i) => `tag${i}`) },
      user: { companyId: 'acme', id: 'emp_1' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    const jsonBody = expectRealValidationDetail(res);
    expect(jsonBody.details.some((d) => d.path?.includes('tags'))).toBe(true);
  });
});

describe('POST /api/crm/leads/:id/followup — createFollowupSchema validation detail', () => {
  test('a malformed date returns 400 with real, non-empty error detail', async () => {
    const handler = getRouteHandler('/leads/:id/followup', 'post');
    const req = {
      params: { id: 'lead_123' },
      body: { date: 'not-a-date' },
      user: { companyId: 'acme', id: 'emp_1' },
    };
    const res = mockRes();
    await handler(req, res, jest.fn());

    const jsonBody = expectRealValidationDetail(res);
    expect(jsonBody.details.some((d) => d.path?.includes('date'))).toBe(true);
  });

  test('a missing date field returns 400 with real error detail', async () => {
    const handler = getRouteHandler('/leads/:id/followup', 'post');
    const req = { params: { id: 'lead_123' }, body: {}, user: { companyId: 'acme', id: 'emp_1' } };
    const res = mockRes();
    await handler(req, res, jest.fn());

    expectRealValidationDetail(res);
  });
});
