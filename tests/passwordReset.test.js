'use strict';

/**
 * Self-service password reset — POST /api/auth/forgot-password and
 * POST /api/auth/reset-password (2026-07-25). Direct-handler-invocation
 * technique (see tests/webhookAutoSubscribe.test.js, tests/authSelfProfile.test.js)
 * — exercises the real route handlers AND the real PasswordResetService
 * (token generation/storage/claim logic runs for real), with dynamodb and
 * SES mocked only at the transport layer.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/config/ses', () => ({
  sesClient: { sendEmail: jest.fn() },
  SES_FROM_ADDRESS: 'noreply@apforce.in',
}));
jest.mock('../src/config/s3', () => ({
  s3Client: {},
  MEDIA_BUCKET: 'test-media-bucket',
}));

process.env.DYNAMODB_TABLE_EMPLOYEES = 'employees';
process.env.DYNAMODB_TABLE_METRICS = 'metrics';
process.env.DYNAMODB_TABLE_AUDIT = 'audit';

const bcrypt = require('bcryptjs');
const dynamodb = require('../src/config/dynamodb');
const { sesClient } = require('../src/config/ses');
const authRouter = require('../src/routes/auth');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }
function rejected(err) { return { promise: () => Promise.reject(err) }; }

const GENERIC_RESPONSE = { success: true, message: "If that email is registered, we've sent a reset link." };
const EMP = { id: 'emp_1', email: 'user@acme.com', name: 'Test User', companyId: 'acme', status: 'active', password: 'old-hash' };

describe('POST /api/auth/forgot-password', () => {
  const handler = () => getRouteHandler(authRouter, '/forgot-password', 'post');
  beforeEach(() => jest.clearAllMocks());

  test('existing, active email: creates a token, sends the email, returns the generic response', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [EMP] }));
    dynamodb.get.mockReturnValue(resolved({})); // rate-limiter getCount -> 0
    dynamodb.update.mockReturnValue(resolved({ Attributes: { count: 1 } })); // rate-limiter atomicIncrement
    dynamodb.put.mockReturnValue(resolved({}));
    sesClient.sendEmail.mockReturnValue(resolved({ MessageId: 'abc' }));

    const req = { body: { email: EMP.email }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(GENERIC_RESPONSE);

    const putCall = dynamodb.put.mock.calls.find((c) => c[0].Item?.PK?.startsWith('PWRESET#'));
    expect(putCall).toBeDefined();
    expect(putCall[0].Item.employeeId).toBe(EMP.id);
    expect(putCall[0].Item.token).toHaveLength(64); // 32 bytes hex-encoded
    expect(putCall[0].Item.usedAt).toBeUndefined();

    expect(sesClient.sendEmail).toHaveBeenCalledTimes(1);
    const [sesArgs] = sesClient.sendEmail.mock.calls[0];
    expect(sesArgs.Destination.ToAddresses).toEqual([EMP.email]);
    expect(sesArgs.Message.Body.Text.Data).toContain('https://app.apforce.in/reset-password?token=');
  });

  test('non-existent email: IDENTICAL response to an existing email, no token created, no email sent', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [] }));
    dynamodb.get.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({ Attributes: { count: 1 } }));

    const req = { body: { email: 'nobody@nowhere.com' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(GENERIC_RESPONSE);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(sesClient.sendEmail).not.toHaveBeenCalled();
  });

  test('inactive account: same generic response, no token created (prevents self-reactivation via reset link)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ ...EMP, status: 'inactive' }] }));
    dynamodb.get.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({ Attributes: { count: 1 } }));

    const req = { body: { email: EMP.email }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(GENERIC_RESPONSE);
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(sesClient.sendEmail).not.toHaveBeenCalled();
  });

  test('SES send failure does not change the response (sandbox-mode unverified recipient, etc.)', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [EMP] }));
    dynamodb.get.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({ Attributes: { count: 1 } }));
    dynamodb.put.mockReturnValue(resolved({}));
    sesClient.sendEmail.mockReturnValue(rejected(Object.assign(new Error('Email address is not verified'), { code: 'MessageRejected', statusCode: 400 })));

    const req = { body: { email: EMP.email }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(GENERIC_RESPONSE);
  });

  test('a DB error looking up the user does not surface as a 500 — falls through to the same generic response', async () => {
    dynamodb.query.mockReturnValue(rejected(new Error('DynamoDB unavailable')));
    dynamodb.get.mockReturnValue(resolved({}));
    dynamodb.update.mockReturnValue(resolved({ Attributes: { count: 1 } }));

    const req = { body: { email: EMP.email }, ip: '1.2.3.4' };
    const res = mockRes();
    const next = jest.fn();
    await handler()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(GENERIC_RESPONSE);
  });

  test('malformed email: 400 via ZodError — not an enumeration signal, ordinary input validation', async () => {
    const req = { body: { email: 'not-an-email' }, ip: '1.2.3.4' };
    const res = mockRes();
    const next = jest.fn();
    await handler()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(res.json).not.toHaveBeenCalled();
  });

  test('rate-limited email: still gets the identical generic response, no new token created', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { count: 3 } })); // already at MAX_RESET_REQUESTS

    const req = { body: { email: EMP.email }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(GENERIC_RESPONSE);
    expect(dynamodb.query).not.toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
    expect(sesClient.sendEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/reset-password', () => {
  const handler = () => getRouteHandler(authRouter, '/reset-password', 'post');
  beforeEach(() => jest.clearAllMocks());

  const TOKEN = 'a'.repeat(64);
  const futureExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
  const pastExpiry = new Date(Date.now() - 30 * 60_000).toISOString();

  test('valid token + strong password: hashes + updates the password, single-use-claims the token, generic success', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { employeeId: EMP.id, email: EMP.email, expiresAt: futureExpiry } }));
    dynamodb.update.mockReturnValue(resolved({}));
    dynamodb.delete.mockReturnValue(resolved({}));

    const req = { body: { token: TOKEN, newPassword: 'NewPass123' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const pwUpdateCall = dynamodb.update.mock.calls.find((c) => c[0].TableName === process.env.DYNAMODB_TABLE_EMPLOYEES);
    expect(pwUpdateCall[0].Key).toEqual({ id: EMP.id });
    const hashed = pwUpdateCall[0].ExpressionAttributeValues[':hash'];
    expect(await bcrypt.compare('NewPass123', hashed)).toBe(true);
    // status is never touched by the self-service path (unlike recover-admin.js)
    expect(pwUpdateCall[0].UpdateExpression).not.toMatch(/status/i);

    // Token was atomically claimed (SET usedAt with a conditional guard)
    const claimCall = dynamodb.update.mock.calls.find((c) => c[0].TableName === process.env.DYNAMODB_TABLE_METRICS);
    expect(claimCall[0].ConditionExpression).toBe('attribute_not_exists(usedAt)');
  });

  test('expired token: generic invalid/expired error, password never updated', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { employeeId: EMP.id, email: EMP.email, expiresAt: pastExpiry } }));

    const req = { body: { token: TOKEN, newPassword: 'NewPass123' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid or has expired/i);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('already-used token (usedAt already set): same generic error, no update attempted', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { employeeId: EMP.id, email: EMP.email, expiresAt: futureExpiry, usedAt: new Date().toISOString() } }));

    const req = { body: { token: TOKEN, newPassword: 'NewPass123' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid or has expired/i);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('already-used token via a race (concurrent claim loses the conditional update): same generic error', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { employeeId: EMP.id, email: EMP.email, expiresAt: futureExpiry } }));
    dynamodb.update.mockReturnValueOnce(rejected(Object.assign(new Error('conditional failed'), { code: 'ConditionalCheckFailedException' })));

    const req = { body: { token: TOKEN, newPassword: 'NewPass123' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid or has expired/i);
    // The password-update call never happened -- only the failed claim attempt
    const pwUpdateCall = dynamodb.update.mock.calls.find((c) => c[0].TableName === process.env.DYNAMODB_TABLE_EMPLOYEES);
    expect(pwUpdateCall).toBeUndefined();
  });

  test('invalid (non-existent) token: same generic error as expired/already-used', async () => {
    dynamodb.get.mockReturnValue(resolved({}));

    const req = { body: { token: 'totally-made-up-token', newPassword: 'NewPass123' }, ip: '1.2.3.4' };
    const res = mockRes();
    await handler()(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/invalid or has expired/i);
  });

  test('weak password (too short) rejected by schema before the token is ever looked up', async () => {
    const req = { body: { token: TOKEN, newPassword: 'weak' }, ip: '1.2.3.4' };
    const res = mockRes();
    const next = jest.fn();
    await handler()(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test('password missing an uppercase letter: rejected', async () => {
    const req = { body: { token: TOKEN, newPassword: 'lowercase123' }, ip: '1.2.3.4' };
    const res = mockRes();
    const next = jest.fn();
    await handler()(req, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  test('password missing a number: rejected', async () => {
    const req = { body: { token: TOKEN, newPassword: 'NoNumberHere' }, ip: '1.2.3.4' };
    const res = mockRes();
    const next = jest.fn();
    await handler()(req, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  test('missing token in body: rejected by schema', async () => {
    const req = { body: { newPassword: 'NewPass123' }, ip: '1.2.3.4' };
    const res = mockRes();
    const next = jest.fn();
    await handler()(req, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });
});
