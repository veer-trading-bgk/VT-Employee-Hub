'use strict';

/**
 * Tests for the 2026-07-28 Meta Health PR 3: business profile push edits +
 * photo upload. graphApiHelpers.updateBusinessProfile() pushes a validated
 * subset of about/address/description/email/websites/vertical to Meta's
 * whatsapp_business_profile endpoint. graphApiHelpers.uploadProfilePhoto()
 * drives Meta's two-step Resumable Upload API (session start -> byte upload
 * -> profile_picture_handle) -- verified live against Meta's own docs during
 * planning: the session id already includes an "upload:" prefix (used as-is,
 * never re-prefixed), and step 2's auth is a header ("Authorization: OAuth
 * <token>"), not the query-param access_token convention used everywhere
 * else in this codebase.
 *
 * Same direct-handler-invocation technique as tests/webhookAutoSubscribe.test.js.
 */

jest.mock('axios');
jest.mock('../src/config/dynamodb', () => ({
  put: jest.fn(), get: jest.fn(), update: jest.fn(), delete: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/services/WhatsAppSendService', () => ({
  sendInteractive: jest.fn(), sendTemplate: jest.fn(), sendText: jest.fn(), sendMedia: jest.fn(),
}));
jest.mock('../src/config/s3', () => ({
  s3Client: { getSignedUrl: jest.fn(), getObject: jest.fn() },
  MEDIA_BUCKET: 'test-media-bucket',
}));

process.env.WA_MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'test-bucket';
process.env.META_APP_ID = process.env.META_APP_ID || 'app_123';

const axios = require('axios');
const dynamodb = require('../src/config/dynamodb');
const { s3Client } = require('../src/config/s3');
const { updateBusinessProfile, uploadProfilePhoto } = require('../src/services/graphApiHelpers');
const whatsappRouter = require('../src/routes/whatsapp');

function getRouteHandler(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  if (!layer) return null;
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
}

function resolved(value) { return { promise: () => Promise.resolve(value) }; }

const USER = { id: 'emp_1', role: 'admin', companyId: 'acme' };
const CFG = { wabaId: 'waba_1', phoneNumberId: 'pid_1', accessToken: 'token_1' };

describe('graphApiHelpers.updateBusinessProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  test('success', async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true } });
    const result = await updateBusinessProfile(CFG, { about: 'Hello' });
    expect(result).toEqual({ updated: true });
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('pid_1/whatsapp_business_profile');
    expect(body).toEqual({ messaging_product: 'whatsapp', about: 'Hello' });
  });

  test('Meta rejection returns updated:false with an error, never throws', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'Invalid vertical' } } } });
    const result = await updateBusinessProfile(CFG, { vertical: 'BOGUS' });
    expect(result.updated).toBe(false);
    expect(result.error).toBe('Invalid vertical');
  });
});

describe('graphApiHelpers.uploadProfilePhoto', () => {
  beforeEach(() => jest.clearAllMocks());

  test('full 3-step success: session -> bytes -> profile update', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { id: 'upload:SESSION123' } }) // step 1
      .mockResolvedValueOnce({ data: { h: 'handle_abc' } }) // step 2
      .mockResolvedValueOnce({ data: { success: true } }); // step 3 (updateBusinessProfile)

    const result = await uploadProfilePhoto(CFG, Buffer.from('fake-jpeg-bytes'), 'image/jpeg', 'photo.jpg');

    expect(result).toEqual({ uploaded: true });
    const [sessionUrl, , sessionOpts] = axios.post.mock.calls[0];
    expect(sessionUrl).toContain('app_123/uploads');
    expect(sessionOpts.params).toEqual(expect.objectContaining({ file_type: 'image/jpeg', file_name: 'photo.jpg' }));

    const [uploadUrl, uploadBody, uploadOpts] = axios.post.mock.calls[1];
    expect(uploadUrl).toContain('upload:SESSION123'); // session id used as-is, not re-prefixed
    expect(uploadBody).toBeInstanceOf(Buffer);
    expect(uploadOpts.headers.Authorization).toBe('OAuth token_1'); // header auth, not query param
    expect(uploadOpts.headers.file_offset).toBe('0');

    const [profileUrl, profileBody] = axios.post.mock.calls[2];
    expect(profileUrl).toContain('pid_1/whatsapp_business_profile');
    expect(profileBody).toEqual({ messaging_product: 'whatsapp', profile_picture_handle: 'handle_abc' });
  });

  test('session-start failure: returns error, never attempts the byte upload', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: { message: 'Invalid file_type' } } } });
    const result = await uploadProfilePhoto(CFG, Buffer.from('x'), 'image/jpeg', 'p.jpg');
    expect(result.uploaded).toBe(false);
    expect(result.error).toBe('Invalid file_type');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('missing META_APP_ID: returns a clear error, makes no Meta call at all', async () => {
    delete process.env.META_APP_ID;
    const result = await uploadProfilePhoto(CFG, Buffer.from('x'), 'image/jpeg', 'p.jpg');
    expect(result.uploaded).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
    process.env.META_APP_ID = 'app_123';
  });
});

describe('POST /api/whatsapp/profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
  });

  test('valid subset of fields: pushes to Meta, returns refreshed profile', async () => {
    axios.post.mockResolvedValueOnce({ data: { success: true } });
    axios.get.mockResolvedValueOnce({ data: { data: [{ about: 'Hello', vertical: 'FINANCE' }] } });

    const handler = getRouteHandler(whatsappRouter, '/profile', 'post');
    const res = mockRes();
    await handler({ body: { about: 'Hello', vertical: 'FINANCE' }, user: USER }, res, jest.fn());

    const [body] = res.json.mock.calls[0];
    expect(body.success).toBe(true);
    expect(body.profile.about).toBe('Hello');
  });

  test.each([
    ['about', 'a'.repeat(140), 'about must be 1-139 characters'],
    ['address', 'a'.repeat(257), 'address must be under 256 characters'],
    ['description', 'a'.repeat(513), 'description must be under 512 characters'],
    ['email', 'not-an-email', 'email must be a valid address under 128 characters'],
    ['vertical', 'NOT_A_REAL_VERTICAL', 'vertical must be one of'],
  ])('rejects invalid %s locally, without calling Meta', async (field, value, expectedErrorSubstring) => {
    const handler = getRouteHandler(whatsappRouter, '/profile', 'post');
    const res = mockRes();
    await handler({ body: { [field]: value }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const [body] = res.json.mock.calls[0];
    expect(body.error).toContain(expectedErrorSubstring);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('websites must be http(s):// URLs', async () => {
    const handler = getRouteHandler(whatsappRouter, '/profile', 'post');
    const res = mockRes();
    await handler({ body: { websites: ['not-a-url'] }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('no fields provided: 400, no Meta call', async () => {
    const handler = getRouteHandler(whatsappRouter, '/profile', 'post');
    const res = mockRes();
    await handler({ body: {}, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('no WhatsApp config: 400, no Meta call', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: null }));
    const handler = getRouteHandler(whatsappRouter, '/profile', 'post');
    const res = mockRes();
    await handler({ body: { about: 'Hello' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp/profile/photo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dynamodb.get.mockReturnValue(resolved({ Item: CFG }));
  });

  test('success: reads from S3 (company-scoped key), uploads to Meta', async () => {
    s3Client.getObject.mockReturnValue(resolved({ Body: Buffer.from('jpeg-bytes'), ContentLength: 1024 }));
    axios.post
      .mockResolvedValueOnce({ data: { id: 'upload:S1' } })
      .mockResolvedValueOnce({ data: { h: 'handle_1' } })
      .mockResolvedValueOnce({ data: { success: true } });
    axios.get.mockResolvedValueOnce({ data: { data: [{ profile_picture_url: 'https://x.com/p.jpg' }] } });

    const handler = getRouteHandler(whatsappRouter, '/profile/photo', 'post');
    const res = mockRes();
    await handler({ body: { s3Key: 'uploads/acme/photo.jpg', mimeType: 'image/jpeg', filename: 'photo.jpg' }, user: USER }, res, jest.fn());

    expect(s3Client.getObject).toHaveBeenCalledWith(expect.objectContaining({ Key: 'uploads/acme/photo.jpg' }));
    const [body] = res.json.mock.calls[0];
    expect(body.success).toBe(true);
  });

  test('rejects a key not scoped to this company (403), never reads S3', async () => {
    const handler = getRouteHandler(whatsappRouter, '/profile/photo', 'post');
    const res = mockRes();
    await handler({ body: { s3Key: 'uploads/other-company/photo.jpg', mimeType: 'image/jpeg' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(s3Client.getObject).not.toHaveBeenCalled();
  });

  test('rejects a non jpeg/png mime type before touching S3 or Meta', async () => {
    const handler = getRouteHandler(whatsappRouter, '/profile/photo', 'post');
    const res = mockRes();
    await handler({ body: { s3Key: 'uploads/acme/photo.gif', mimeType: 'image/gif' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(s3Client.getObject).not.toHaveBeenCalled();
  });

  test('rejects an oversized file after reading its size from S3, never calls Meta', async () => {
    s3Client.getObject.mockReturnValue(resolved({ Body: Buffer.from('x'), ContentLength: 10 * 1024 * 1024 }));

    const handler = getRouteHandler(whatsappRouter, '/profile/photo', 'post');
    const res = mockRes();
    await handler({ body: { s3Key: 'uploads/acme/photo.jpg', mimeType: 'image/jpeg' }, user: USER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
