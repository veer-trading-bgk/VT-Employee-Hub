'use strict';

/**
 * B3 finding #11: PUT /api/auth/me (self-service profile update) and
 * GET /api/auth/me/avatar-upload-url (presigned avatar upload). Direct-
 * handler-invocation technique (see tests/automationsRoutes.test.js) —
 * exercises the final route handler, bypassing the router-level
 * authMiddleware a real request would also pass through.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), update: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/config/s3', () => ({
  s3Client: { getSignedUrl: jest.fn(() => 'https://s3.example.com/presigned-put-url') },
  MEDIA_BUCKET: 'test-media-bucket',
}));

const dynamodb = require('../src/config/dynamodb');
const { s3Client } = require('../src/config/s3');
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

const CID = 'comp_test';
const UID = 'emp_self';

describe('PUT /api/auth/me — self-service profile update', () => {
  const handler = () => getRouteHandler(authRouter, '/me', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('role: admin in payload is rejected by schema, no DB read/write', async () => {
    const next = jest.fn();
    const req = { body: { name: 'New Name', role: 'admin' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('panNumber in payload is rejected by schema (admin-only KYC field)', async () => {
    const next = jest.fn();
    const req = { body: { panNumber: 'ABCDE1234F' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('aadhaarNumber in payload is rejected by schema (admin-only KYC field)', async () => {
    const next = jest.fn();
    const req = { body: { aadhaarNumber: '123456789012' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('a client-supplied id in the payload is rejected — the route never reads a target id from the body', async () => {
    const next = jest.fn();
    const req = { body: { name: 'X', id: 'someone-else' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, next);
    expect(next.mock.calls[0][0].name).toBe('ZodError');
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('status/email/teamLeadId/baseSalary/autoAssignEnabled/autoAssignWeight are all rejected', async () => {
    for (const field of [{ status: 'inactive' }, { email: 'new@test.com' }, { teamLeadId: 'lead1' }, { baseSalary: 50000 }, { autoAssignEnabled: true }, { autoAssignWeight: 5 }]) {
      jest.clearAllMocks();
      const next = jest.fn();
      const req = { body: field, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
      const res = mockRes();
      await handler()(req, res, next);
      expect(next.mock.calls[0][0].name).toBe('ZodError');
      expect(dynamodb.update).not.toHaveBeenCalled();
    }
  });

  test('operates strictly on req.user.id, ignoring any URL/body id — allowed fields succeed', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: UID, name: 'Old Name', email: 'u@test.com', companyId: CID } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { id: UID, name: 'New Name', email: 'u@test.com', companyId: CID } }) });
    const req = { body: { name: 'New Name', mobileNumber: '9876543210', homeAddress: '1 MG Road' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(dynamodb.get).toHaveBeenCalledWith(expect.objectContaining({ Key: { id: UID } }));
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({ Key: { id: UID } }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('avatarKey alone is accepted (photo-upload-only save)', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: UID, companyId: CID } }) });
    dynamodb.update.mockReturnValue({ promise: () => Promise.resolve({ Attributes: { id: UID, avatarKey: 'uploads/comp_test/abc.jpg' } }) });
    const req = { body: { avatarKey: 'uploads/comp_test/abc.jpg' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(dynamodb.update).toHaveBeenCalledTimes(1);
  });

  test('avatarKey outside the caller\'s own company prefix is rejected — cross-tenant key forgery', async () => {
    const req = { body: { avatarKey: 'uploads/other_company/abc.jpg' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('empty payload is rejected with 400, no DB calls', async () => {
    const req = { body: {}, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dynamodb.get).not.toHaveBeenCalled();
  });

  test('non-existent user record → 404, no update attempted', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) });
    const req = { body: { name: 'X' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(dynamodb.update).not.toHaveBeenCalled();
  });

  test('response never leaks password/totpSecret/backupCodes', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { id: UID, companyId: CID } }) });
    dynamodb.update.mockReturnValue({
      promise: () => Promise.resolve({ Attributes: { id: UID, name: 'X', password: 'hash', totpSecret: 'secret', backupCodes: [] } }),
    });
    const req = { body: { name: 'X' }, user: { id: UID, email: 'u@test.com', role: 'telecaller', companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.employee).not.toHaveProperty('password');
    expect(payload.employee).not.toHaveProperty('totpSecret');
    expect(payload.employee).not.toHaveProperty('backupCodes');
  });
});

describe('GET /api/auth/me/avatar-upload-url', () => {
  const handler = () => getRouteHandler(authRouter, '/me/avatar-upload-url', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('valid image/jpeg under the size limit succeeds, key is company-scoped', async () => {
    const req = { query: { mimeType: 'image/jpeg', filename: 'photo.jpg', fileSize: String(500_000) }, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      uploadUrl: expect.any(String),
      key: expect.stringMatching(new RegExp(`^uploads/${CID}/`)),
    }));
  });

  test('image/png is also allowed', async () => {
    const req = { query: { mimeType: 'image/png', filename: 'photo.png' }, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  test('disallowed mimeType (video) is rejected — this route is image-only, unlike WhatsApp upload-url', async () => {
    const req = { query: { mimeType: 'video/mp4', filename: 'clip.mp4' }, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(s3Client.getSignedUrl).not.toHaveBeenCalled();
  });

  test('oversized fileSize (>2MB) is rejected — stricter than WhatsApp upload-url\'s 5MB', async () => {
    const req = { query: { mimeType: 'image/jpeg', filename: 'huge.jpg', fileSize: String(3 * 1024 * 1024) }, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(s3Client.getSignedUrl).not.toHaveBeenCalled();
  });

  test('missing mimeType/filename → 400', async () => {
    const req = { query: {}, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('key extension is derived from mimeType, not the filename — a mismatched filename extension is ignored', async () => {
    const req = { query: { mimeType: 'image/jpeg', filename: 'photo.png' }, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.key).toMatch(/\.jpg$/);
  });

  test('key extension is derived from mimeType even when the filename has no extension or a disallowed one', async () => {
    const req = { query: { mimeType: 'image/png', filename: 'evil.exe' }, user: { id: UID, companyId: CID } };
    const res = mockRes();
    await handler()(req, res, jest.fn());
    const payload = res.json.mock.calls[0][0];
    expect(payload.key).toMatch(/\.png$/);
  });
});
