'use strict';

// Focused coverage for WhatsAppSendService.uploadTemplateHeaderHandle() —
// the Resumable Upload API integration added 2026-07-10
// (docs/phase3/TECHNICAL_DEBT.md) to fix template media headers being
// rejected by Meta ("Missing Sample Parameter for Title Type"). A different
// Meta API surface from resolveMediaId()'s /media endpoint (own test file,
// whatsAppSendServiceMedia.test.js) — this one is the two-step
// POST /{app-id}/uploads -> POST /{session_id} flow, used only to produce a
// template HEADER's example.header_handle, never for sending a message.

const mockGetObject = jest.fn();
jest.mock('aws-sdk/clients/s3', () => jest.fn().mockImplementation(() => ({ getObject: mockGetObject })));
jest.mock('axios');

jest.mock('../src/config/dynamodb', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const axios = require('axios');
const logger = require('../src/config/logger');
const service = require('../src/services/WhatsAppSendService');

const CID = 'comp_test';
const FAKE_CFG = { accessToken: 'token123', phoneNumberId: 'PNID1', wabaId: 'WABA1' };

describe('WhatsAppSendService.uploadTemplateHeaderHandle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WA_MEDIA_BUCKET = 'test-bucket';
    process.env.META_APP_ID = '1669745754311284';
    jest.spyOn(service, '_requireConfig').mockResolvedValue(FAKE_CFG);
    mockGetObject.mockReturnValue({ promise: () => Promise.resolve({ Body: Buffer.from('fake-image-bytes') }) });
  });

  afterEach(() => {
    delete process.env.META_APP_ID;
  });

  test('throws 500 when META_APP_ID is not set — the exact blocker this feature was gated on', async () => {
    delete process.env.META_APP_ID;
    await expect(service.uploadTemplateHeaderHandle(CID, { s3Key: 'uploads/comp_test/a.png', mimeType: 'image/png' }))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining('META_APP_ID') });
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  test('happy path: downloads from S3, creates an upload session, uploads the bytes, returns the handle', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { id: 'upload:SESSION123' } }) // step 1
      .mockResolvedValueOnce({ data: { h: '4::aW5zZXJ0' } });       // step 2

    const handle = await service.uploadTemplateHeaderHandle(CID, { s3Key: 'uploads/comp_test/a.png', mimeType: 'image/png', filename: 'a.png' });

    expect(mockGetObject).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'uploads/comp_test/a.png' });
    expect(handle).toBe('4::aW5zZXJ0');

    // Step 1: app-id/uploads with access_token as a QUERY param.
    const [url1, body1, config1] = axios.post.mock.calls[0];
    expect(url1).toContain('/1669745754311284/uploads');
    expect(body1).toBeNull();
    expect(config1.params).toEqual({
      file_length: Buffer.from('fake-image-bytes').length,
      file_type: 'image/png',
      file_name: 'a.png',
      access_token: 'token123',
    });

    // Step 2: POST to the returned session id, Authorization: OAuth (not
    // Bearer — every other Graph call in this file uses Bearer).
    const [url2, body2, config2] = axios.post.mock.calls[1];
    expect(url2).toContain('/upload:SESSION123');
    expect(body2).toEqual(Buffer.from('fake-image-bytes'));
    expect(config2.headers.Authorization).toBe('OAuth token123');
    expect(config2.headers.file_offset).toBe('0');
  });

  test('session-creation failure: logs the real Meta error (not [object Object]) and throws with details', async () => {
    const metaError = { error: { message: 'Invalid OAuth access token', code: 190 } };
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: metaError } });

    await expect(service.uploadTemplateHeaderHandle(CID, { s3Key: 'uploads/comp_test/a.png', mimeType: 'image/png' }))
      .rejects.toMatchObject({ status: 401, details: metaError });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, logDetail] = logger.error.mock.calls[0];
    expect(logDetail).not.toBe('[object Object]');
    expect(logDetail).toContain('Invalid OAuth access token');
  });

  test('byte-upload failure: logs the real Meta error and throws with details, distinct from a session-creation failure', async () => {
    const metaError = { error: { message: 'File too large', code: 100 } };
    axios.post
      .mockResolvedValueOnce({ data: { id: 'upload:SESSION123' } })
      .mockRejectedValueOnce({ response: { status: 400, data: metaError } });

    await expect(service.uploadTemplateHeaderHandle(CID, { s3Key: 'uploads/comp_test/a.png', mimeType: 'image/png' }))
      .rejects.toMatchObject({ status: 400, details: metaError });

    const [, logDetail] = logger.error.mock.calls[0];
    expect(logDetail).toContain('File too large');
  });

  test('throws 500 when Meta returns no handle in the step-2 response', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { id: 'upload:SESSION123' } })
      .mockResolvedValueOnce({ data: {} }); // no `h`

    await expect(service.uploadTemplateHeaderHandle(CID, { s3Key: 'uploads/comp_test/a.png', mimeType: 'image/png' }))
      .rejects.toMatchObject({ status: 500 });
  });
});
