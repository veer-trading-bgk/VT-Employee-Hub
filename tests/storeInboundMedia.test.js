'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: (...a) => mockAxiosGet(...a) }));

const mockS3UploadPromise = jest.fn();
const mockS3Upload = jest.fn().mockReturnValue({ promise: mockS3UploadPromise });
jest.mock('aws-sdk/clients/s3', () =>
  jest.fn().mockImplementation(() => ({
    upload: (...a) => mockS3Upload(...a),
    getSignedUrl: jest.fn().mockReturnValue('https://signed-url'),
  }))
);

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), alert: jest.fn() };
jest.mock('../src/config/logger', () => mockLogger);
jest.mock('../src/config/dynamodb');
jest.mock('../src/utils/dedupPut', () => ({ dedupPut: jest.fn() }));

process.env.WA_MEDIA_BUCKET = 'apforce-wa-media';
process.env.DYNAMODB_TABLE_METRICS = 'business_metrics';

const {
  storeInboundMedia,
  isTransientNetworkError,
  isAuthError,
  isAccessDeniedError,
  GRAPH_TIMEOUT_MS,
  CDN_TIMEOUT_MS,
} = require('../src/services/InboundMediaArchiveService');

// whatsapp.js must re-export the same function (shared implementation)
const whatsapp = require('../src/routes/whatsapp');

// ─────────────────────────────────────────────────────────────────────────────
describe('InboundMediaArchiveService.storeInboundMedia', () => {
  beforeEach(() => jest.clearAllMocks());

  test('whatsapp.js re-exports the same storeInboundMedia reference', () => {
    expect(whatsapp.storeInboundMedia).toBe(storeInboundMedia);
  });

  test('returns null when accessToken is missing', async () => {
    const result = await storeInboundMedia(null, 'mediaId123', 'image/jpeg', 'acme');
    expect(result).toBeNull();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('returns null when mediaId is missing', async () => {
    const result = await storeInboundMedia('token', null, 'image/jpeg', 'acme');
    expect(result).toBeNull();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('returns null when Meta returns no download URL', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: {} });
    const result = await storeInboundMedia('tok', 'mid1', 'image/jpeg', 'acme');
    expect(result).toBeNull();
    expect(mockS3Upload).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('graph_lookup_ok but no download url'));
  });

  test('happy path: downloads from Meta, uploads to S3, hop logs include company/media/mime', async () => {
    mockAxiosGet
      .mockResolvedValueOnce({ data: { url: 'https://meta.cdn/file123' } })
      .mockResolvedValueOnce({ data: Buffer.from('image bytes') });
    mockS3UploadPromise.mockResolvedValue({});

    const result = await storeInboundMedia('tok', 'mid1', 'image/jpeg', 'acme');
    expect(result).toBe('inbound/acme/mid1.jpg');
    expect(mockAxiosGet).toHaveBeenNthCalledWith(1, expect.stringContaining('/mid1'), expect.objectContaining({
      timeout: GRAPH_TIMEOUT_MS,
    }));
    expect(mockAxiosGet).toHaveBeenNthCalledWith(2, 'https://meta.cdn/file123', expect.objectContaining({
      timeout: CDN_TIMEOUT_MS,
      responseType: 'arraybuffer',
    }));
    expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({
      Bucket: 'apforce-wa-media',
      Key: 'inbound/acme/mid1.jpg',
      ContentType: 'image/jpeg',
    }));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/graph_lookup_ok.*companyId=acme.*mediaId=mid1.*mimeType=image\/jpeg/));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/cdn_download_ok bytes=11.*companyId=acme/));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/s3_upload_ok s3Key=inbound\/acme\/mid1\.jpg/));
  });

  test('video mime type gets .mp4 extension', async () => {
    mockAxiosGet
      .mockResolvedValueOnce({ data: { url: 'https://meta.cdn/vid' } })
      .mockResolvedValueOnce({ data: Buffer.from('video bytes') });
    mockS3UploadPromise.mockResolvedValue({});

    const result = await storeInboundMedia('tok', 'vid1', 'video/mp4', 'acme');
    expect(result).toBe('inbound/acme/vid1.mp4');
  });

  test('S3 AccessDenied → hop s3_upload_failed + alert, no retry', async () => {
    mockAxiosGet
      .mockResolvedValueOnce({ data: { url: 'https://meta.cdn/file' } })
      .mockResolvedValueOnce({ data: Buffer.from('bytes') });
    mockS3UploadPromise.mockRejectedValue(new Error('Access Denied'));

    const result = await storeInboundMedia('tok', 'mid2', 'image/jpeg', 'acme');
    expect(result).toBeNull();
    expect(mockS3Upload).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('s3_upload_failed'),
      expect.stringContaining('Access Denied'),
    );
    expect(mockLogger.alert).toHaveBeenCalledWith(expect.stringContaining('IAM policy'));
  });

  test('401 on Graph → graph_lookup_failed, no retry, no alert', async () => {
    const err = new Error('Request failed with status code 401');
    err.response = { status: 401 };
    mockAxiosGet.mockRejectedValue(err);

    const result = await storeInboundMedia('tok', 'mid3', 'image/jpeg', 'acme');
    expect(result).toBeNull();
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockS3Upload).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('graph_lookup_failed'),
      expect.stringContaining('401'),
    );
    expect(mockLogger.alert).not.toHaveBeenCalled();
  });

  test('socket hang up on CDN → one retry then success', async () => {
    mockAxiosGet
      .mockResolvedValueOnce({ data: { url: 'https://meta.cdn/file' } })
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ data: Buffer.from('retry-ok') });
    mockS3UploadPromise.mockResolvedValue({});

    const result = await storeInboundMedia('tok', 'mid4', 'image/jpeg', 'acme');
    expect(result).toBe('inbound/acme/mid4.jpg');
    // graph once + CDN fail + CDN retry = 3
    expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cdn_download transient failure'),
      expect.stringContaining('socket hang up'),
    );
  });

  test('socket hang up exhausted → cdn_download_failed, no alert', async () => {
    mockAxiosGet
      .mockResolvedValueOnce({ data: { url: 'https://meta.cdn/file' } })
      .mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    const result = await storeInboundMedia('tok', 'mid5', 'image/jpeg', 'acme');
    expect(result).toBeNull();
    expect(mockAxiosGet).toHaveBeenCalledTimes(3); // graph + 2 CDN attempts
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('cdn_download_failed'),
      expect.stringContaining('socket hang up'),
    );
    expect(mockLogger.alert).not.toHaveBeenCalled();
  });
});

describe('error classifiers', () => {
  test('transient vs auth vs access-denied', () => {
    expect(isTransientNetworkError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientNetworkError(new Error('stream has been aborted'))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }))).toBe(true);

    const auth = new Error('Request failed with status code 401');
    auth.response = { status: 401 };
    expect(isAuthError(auth)).toBe(true);
    expect(isTransientNetworkError(auth)).toBe(false);

    expect(isAccessDeniedError(new Error('AccessDenied'))).toBe(true);
    expect(isTransientNetworkError(new Error('Access Denied'))).toBe(false);
  });
});
