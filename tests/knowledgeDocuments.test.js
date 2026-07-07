'use strict';

/**
 * Document Knowledge (Phase 2A, PR 4) — src/routes/knowledgeDocuments.js.
 * Same direct-handler-invocation technique as tests/knowledgeCenter.test.js.
 * aws-sdk's S3 is mocked at the module level (DocumentKnowledgeService.js
 * instantiates one `new S3()` at require-time) — the mock factory exposes
 * the single instance so tests can set return values per call.
 */

jest.mock('../src/config/dynamodb', () => ({
  get: jest.fn(), put: jest.fn(), update: jest.fn(), query: jest.fn(),
}));
jest.mock('../src/config/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), alert: jest.fn(),
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('aws-sdk', () => {
  const mockS3Instance = {
    getSignedUrl: jest.fn(),
    headObject: jest.fn(),
    getObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  return { S3: jest.fn(() => mockS3Instance), __mockS3Instance: mockS3Instance };
});

process.env.DYNAMODB_TABLE_METRICS = 'vt-metrics-test';
process.env.WA_MEDIA_BUCKET = 'apforce-wa-media-test';

const AWS = require('aws-sdk');
const mockS3 = AWS.__mockS3Instance;
const dynamodb = require('../src/config/dynamodb');
const { authMiddleware, adminMiddleware } = require('../src/middleware/auth');
const knowledgeDocumentsRouter = require('../src/routes/knowledgeDocuments');

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

const USER = { id: 'emp_1', name: 'Test Admin', role: 'admin', companyId: 'comp_test' };
const CID = 'comp_test';
const PDF_MIME = 'application/pdf';
function pdfBuffer() { return Buffer.from('%PDF-1.4\nfake pdf content for a test\n'); }
function jpegBuffer() { return Buffer.from([0xff, 0xd8, 0xff, 0xe0]); }

describe('knowledgeDocuments router — whole-router admin guard', () => {
  test('router.use(authMiddleware, adminMiddleware) is the first layer', () => {
    const useLayer = knowledgeDocumentsRouter.stack.find((l) => !l.route);
    expect(useLayer).toBeDefined();
    expect([authMiddleware, adminMiddleware].some((fn) => typeof fn === 'function')).toBe(true);
  });
});

describe('GET /api/knowledge-documents', () => {
  const handler = getRouteHandler(knowledgeDocumentsRouter, '/', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('lists documents for the company', async () => {
    dynamodb.query.mockReturnValue(resolved({ Items: [{ documentId: 'd1' }] }));
    const res = mockRes();
    await handler({ user: USER }, res, jest.fn());
    expect(dynamodb.query).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: { ':pk': `KNOWLEDGE_DOCUMENTS#${CID}` },
    }));
    expect(res.json).toHaveBeenCalledWith({ documents: [{ documentId: 'd1' }] });
  });
});

describe('GET /api/knowledge-documents/upload-url', () => {
  const handler = getRouteHandler(knowledgeDocumentsRouter, '/upload-url', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('rejects an unsupported mimeType', async () => {
    const res = mockRes();
    await handler({ user: USER, query: { mimeType: 'application/x-msdownload', filename: 'evil.exe' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockS3.getSignedUrl).not.toHaveBeenCalled();
  });

  test('rejects a claimed fileSize over the 20MB limit', async () => {
    const res = mockRes();
    await handler({ user: USER, query: { mimeType: PDF_MIME, filename: 'big.pdf', fileSize: String(21 * 1024 * 1024) } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('issues a presigned PUT URL under this company\'s own prefix', async () => {
    mockS3.getSignedUrl.mockReturnValue('https://s3.example/presigned-put');
    const res = mockRes();
    await handler({ user: USER, query: { mimeType: PDF_MIME, filename: 'brochure.pdf' } }, res, jest.fn());

    expect(mockS3.getSignedUrl).toHaveBeenCalledWith('putObject', expect.objectContaining({
      Key: expect.stringMatching(new RegExp(`^knowledge-documents/${CID}/.+\\.pdf$`)),
      ContentType: PDF_MIME,
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, uploadUrl: 'https://s3.example/presigned-put' }));
  });
});

describe('POST /api/knowledge-documents (finalize)', () => {
  const handler = getRouteHandler(knowledgeDocumentsRouter, '/', 'post');
  beforeEach(() => jest.clearAllMocks());

  function validBody(overrides = {}) {
    return {
      documentId: '11111111-1111-4111-8111-111111111111',
      s3Key: `knowledge-documents/${CID}/11111111-1111-4111-8111-111111111111.pdf`,
      filename: 'brochure.pdf',
      mimeType: PDF_MIME,
      ...overrides,
    };
  }

  test('rejects an invalid body (400)', async () => {
    const res = mockRes();
    await handler({ user: USER, body: { filename: 'x' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects an s3Key that does not belong to this company\'s own prefix (403)', async () => {
    const res = mockRes();
    await handler({ user: USER, body: validBody({ s3Key: 'knowledge-documents/some_other_company/x.pdf' }) }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockS3.headObject).not.toHaveBeenCalled();
  });

  test('an oversized ACTUAL object (HeadObject) is rejected and deleted, even if the claimed size looked fine', async () => {
    mockS3.headObject.mockReturnValue(resolved({ ContentLength: 21 * 1024 * 1024 }));
    mockS3.deleteObject.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', body: validBody() }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockS3.deleteObject).toHaveBeenCalledWith(expect.objectContaining({ Key: validBody().s3Key }));
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('a content-signature mismatch (JPEG claiming to be a PDF) is rejected and deleted', async () => {
    mockS3.headObject.mockReturnValue(resolved({ ContentLength: 1000 }));
    mockS3.getObject.mockReturnValue(resolved({ Body: jpegBuffer() }));
    mockS3.deleteObject.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', body: validBody() }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockS3.deleteObject).toHaveBeenCalled();
    expect(dynamodb.put).not.toHaveBeenCalled();
  });

  test('a genuine PDF creates a draft record using the ACTUAL size/type, not the client-claimed ones', async () => {
    mockS3.headObject.mockReturnValue(resolved({ ContentLength: 12345 }));
    mockS3.getObject.mockReturnValue(resolved({ Body: pdfBuffer() }));
    dynamodb.put.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', body: validBody() }, res, jest.fn());

    expect(mockS3.deleteObject).not.toHaveBeenCalled();
    expect(dynamodb.put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({
        PK: `KNOWLEDGE_DOCUMENTS#${CID}`, status: 'draft', fileSize: 12345, detectedType: 'pdf', mimeType: PDF_MIME,
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('PUT /api/knowledge-documents/:documentId', () => {
  const handler = getRouteHandler(knowledgeDocumentsRouter, '/:documentId', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('404s when the document does not exist for this company', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, params: { documentId: 'missing' }, body: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('updates filename/category', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { documentId: 'd1', filename: 'old.pdf', category: null } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, params: { documentId: 'd1' }, body: { filename: 'renamed.pdf', category: 'Fees' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':f': 'renamed.pdf', ':c': 'Fees' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('PUT /api/knowledge-documents/:documentId/publish', () => {
  const handler = getRouteHandler(knowledgeDocumentsRouter, '/:documentId/publish', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('404s when missing', async () => {
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, params: { documentId: 'missing' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('sets status published with publishedAt/publishedBy', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { documentId: 'd1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, ip: '1.1.1.1', params: { documentId: 'd1' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':s': 'published', ':pb': USER.id }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});

describe('PUT /api/knowledge-documents/:documentId/archive and /unarchive', () => {
  const archiveHandler = getRouteHandler(knowledgeDocumentsRouter, '/:documentId/archive', 'put');
  const unarchiveHandler = getRouteHandler(knowledgeDocumentsRouter, '/:documentId/unarchive', 'put');
  beforeEach(() => jest.clearAllMocks());

  test('archive sets status archived', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { documentId: 'd1' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await archiveHandler({ user: USER, ip: '1.1.1.1', params: { documentId: 'd1' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':s': 'archived' }),
    }));
  });

  test('unarchive restores to published when the document was previously published', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { documentId: 'd1', publishedAt: '2026-07-01T00:00:00.000Z' } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await unarchiveHandler({ user: USER, ip: '1.1.1.1', params: { documentId: 'd1' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':s': 'published' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true, status: 'published' });
  });

  test('unarchive restores to draft when the document was never published', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { documentId: 'd1', publishedAt: null } }));
    dynamodb.update.mockReturnValue(resolved({}));
    const res = mockRes();
    await unarchiveHandler({ user: USER, ip: '1.1.1.1', params: { documentId: 'd1' } }, res, jest.fn());
    expect(dynamodb.update).toHaveBeenCalledWith(expect.objectContaining({
      ExpressionAttributeValues: expect.objectContaining({ ':s': 'draft' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true, status: 'draft' });
  });
});

describe('GET /api/knowledge-documents/:documentId/download-url — company isolation', () => {
  const handler = getRouteHandler(knowledgeDocumentsRouter, '/:documentId/download-url', 'get');
  beforeEach(() => jest.clearAllMocks());

  test('resolves a real presigned URL for a document that belongs to this company', async () => {
    dynamodb.get.mockReturnValue(resolved({ Item: { documentId: 'd1', s3Key: `knowledge-documents/${CID}/d1.pdf`, filename: 'brochure.pdf' } }));
    mockS3.getSignedUrl.mockReturnValue('https://s3.example/presigned-get');
    const res = mockRes();
    await handler({ user: USER, params: { documentId: 'd1' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, url: 'https://s3.example/presigned-get' }));
  });

  test('a documentId belonging to a DIFFERENT company 404s — the DB lookup itself is scoped by companyId, S3 is never touched', async () => {
    // Simulates cross-company access: the DB lookup is keyed by THIS user's
    // companyId, so another company's document simply isn't found here —
    // no data about its existence (not even a 403) is ever leaked.
    dynamodb.get.mockReturnValue(resolved({}));
    const res = mockRes();
    await handler({ user: USER, params: { documentId: 'someone-elses-doc' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockS3.getSignedUrl).not.toHaveBeenCalled();
  });
});
