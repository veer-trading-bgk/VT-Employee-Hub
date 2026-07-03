'use strict';

/**
 * Regression test for the same zod v4 .errors→.issues bug in the shared
 * Express error-handling middleware. Unlike crm.js's three routes (which
 * call schema.safeParse() and format their own 400 response), roughly ten
 * routes across auth.js/admin.js/metrics.js call schema.parse() directly and
 * let a thrown ZodError propagate to next(err) → this middleware, which
 * previously read err.errors (undefined in zod v4) instead of err.issues.
 * That made this the single most load-bearing instance of the bug — it
 * silently dropped validation detail from login, registration, employee
 * update, TOTP/backup-code verification, company signup, and metric entry.
 */

jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const { errorHandler } = require('../src/middleware/errorHandler');
const { loginSchema, addMetricSchema } = require('../src/utils/validation');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('errorHandler — ZodError branch', () => {
  test('a real ZodError (from a failed .parse()) is formatted with real, non-empty .issues detail', () => {
    // loginSchema.parse({}) is exactly what auth.js's POST /login does on an
    // empty body — throws a genuine ZodError, the same object shape the
    // route's catch(error) { next(error); } would hand to this middleware.
    let zodError;
    try {
      loginSchema.parse({});
    } catch (e) {
      zodError = e;
    }
    expect(zodError.name).toBe('ZodError');

    const res = mockRes();
    errorHandler(zodError, {}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [jsonBody] = res.json.mock.calls[0];
    expect(jsonBody.error).toBe('Validation failed');
    expect(jsonBody.details).toBeDefined();
    expect(Array.isArray(jsonBody.details)).toBe(true);
    expect(jsonBody.details.length).toBeGreaterThan(0);
    expect(jsonBody.details[0]).toHaveProperty('message');
    expect(typeof jsonBody.details[0].message).toBe('string');
    expect(jsonBody.details[0].message.length).toBeGreaterThan(0);
  });

  test('a second real ZodError (addMetricSchema — the metrics.js /add route\'s schema) also formats correctly, not a fluke of one schema', () => {
    let zodError;
    try {
      addMetricSchema.parse({ metric_type: 'not_a_real_metric', value: -5 });
    } catch (e) {
      zodError = e;
    }
    expect(zodError.name).toBe('ZodError');

    const res = mockRes();
    errorHandler(zodError, {}, res, jest.fn());

    const [jsonBody] = res.json.mock.calls[0];
    expect(jsonBody.details.length).toBeGreaterThan(0);
    const paths = jsonBody.details.map((d) => d.path?.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['metric_type', 'value']));
  });

  test('regression guard: details must not be undefined (the exact shape of the original bug)', () => {
    let zodError;
    try {
      loginSchema.parse({ email: 'not-an-email' });
    } catch (e) {
      zodError = e;
    }
    const res = mockRes();
    errorHandler(zodError, {}, res, jest.fn());
    const [jsonBody] = res.json.mock.calls[0];
    expect(jsonBody.details).not.toBeUndefined();
  });

  test('non-Zod errors are unaffected — this fix does not change behavior for real server errors', () => {
    const res = mockRes();
    const genericError = new Error('Something else broke');
    errorHandler(genericError, { ip: '127.0.0.1' }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const [jsonBody] = res.json.mock.calls[0];
    expect(jsonBody.error).toBe('Something else broke');
    expect(jsonBody.details).toBeUndefined(); // never present outside the ZodError branch
  });
});
