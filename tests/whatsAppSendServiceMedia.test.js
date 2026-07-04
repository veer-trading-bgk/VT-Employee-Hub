'use strict';

// Focused coverage for WhatsAppSendService.resolveMediaId() — the S3→Meta media
// upload + 29-day dedup cache extracted from whatsapp.js's POST /upload-send route
// so AutomationEngine's send_document action can reuse it. Not a full test suite
// for WhatsAppSendService.js (that's a separate, pre-existing gap) — scoped to the
// one method this session added.

const mockGetObject = jest.fn();
jest.mock('aws-sdk/clients/s3', () => jest.fn().mockImplementation(() => ({ getObject: mockGetObject })));

jest.mock('../src/config/dynamodb', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));

const dynamodb = require('../src/config/dynamodb');
const service = require('../src/services/WhatsAppSendService');

const CID = 'comp_test';
const FAKE_CFG = { accessToken: 'token123', phoneNumberId: 'PNID1' };

describe('WhatsAppSendService.resolveMediaId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WA_MEDIA_BUCKET = 'test-bucket';
    jest.spyOn(service, '_requireConfig').mockResolvedValue(FAKE_CFG);
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({}) }); // no cache hit by default
    dynamodb.put.mockReturnValue({ promise: () => Promise.resolve({}) });
    mockGetObject.mockReturnValue({ promise: () => Promise.resolve({ Body: Buffer.from('file-bytes') }) });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('cache hit — returns the cached mediaId without touching S3 or Meta', async () => {
    dynamodb.get.mockReturnValue({ promise: () => Promise.resolve({ Item: { mediaId: 'CACHED_ID' } }) });

    const result = await service.resolveMediaId(CID, { s3Key: 'uploads/comp_test/a.pdf', mimeType: 'application/pdf', fileHash: 'hash1' });

    expect(result).toBe('CACHED_ID');
    expect(mockGetObject).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('cache miss — downloads from S3, uploads to Meta, caches the result', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'NEW_META_ID' }) });

    const result = await service.resolveMediaId(CID, { s3Key: 'uploads/comp_test/a.pdf', mimeType: 'application/pdf', filename: 'a.pdf', fileHash: 'hash2' });

    expect(mockGetObject).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'uploads/comp_test/a.pdf' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/PNID1/media'),
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer token123' } }),
    );
    expect(result).toBe('NEW_META_ID');
    // Dedup cache write for next time
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ PK: `MEDIACACHE#${CID}`, SK: 'hash2', mediaId: 'NEW_META_ID' }),
    }));
  });

  test('works without a fileHash — no cache read or write, still resolves a mediaId', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'NO_HASH_ID' }) });

    const result = await service.resolveMediaId(CID, { s3Key: 'uploads/comp_test/a.pdf', mimeType: 'application/pdf' });

    expect(dynamodb.get).not.toHaveBeenCalled();
    expect(result).toBe('NO_HASH_ID');
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('Meta upload rejection throws a 400 with the real error body attached', async () => {
    global.fetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: { message: 'Unsupported file type' } }) });

    await expect(
      service.resolveMediaId(CID, { s3Key: 'uploads/comp_test/a.exe', mimeType: 'application/x-msdownload' }),
    ).rejects.toMatchObject({ status: 400, message: 'Media upload to Meta failed' });
  });

  test('Meta accepting the upload but returning no id throws a 500', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await expect(
      service.resolveMediaId(CID, { s3Key: 'uploads/comp_test/a.pdf', mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ status: 500, message: 'Meta did not return a media_id' });
  });

  test('missing WA_MEDIA_BUCKET env var fails fast with a 500, before touching S3', async () => {
    delete process.env.WA_MEDIA_BUCKET;

    await expect(
      service.resolveMediaId(CID, { s3Key: 'uploads/comp_test/a.pdf', mimeType: 'application/pdf' }),
    ).rejects.toMatchObject({ status: 500, message: 'WA_MEDIA_BUCKET env var not set' });
    expect(mockGetObject).not.toHaveBeenCalled();
  });
});
