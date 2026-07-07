'use strict';

const crypto = require('crypto');
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const { logAudit } = require('../utils/audit');
const { knowledgeDocumentMetaSchema } = require('../utils/validation');
const { DOCUMENT_ALLOWED_MIME, MAX_DOCUMENT_SIZE_BYTES } = require('../utils/documentConstants');
const {
  listDocuments, getDocument, getUploadUrl, validateUploadedObject, createDocument,
  updateMetadata, setStatus, getDownloadUrl,
} = require('../services/DocumentKnowledgeService');

const router = express.Router();

/**
 * Document Knowledge (Phase 2A, PR 4) — file upload for a future RAG
 * pipeline. Admin-only, whole-router-guarded, same pattern as
 * aiAdmin.js/knowledgeCenter.js. Documents are immutable blobs (no version
 * history) — `status` is a schema-only forward-compat gate in this PR, no
 * ingestion job reads it yet.
 *
 * Content is NEVER trusted from the client: `/upload-url` only issues a
 * presigned PUT after validating the CLAIMED mimeType/size; the real
 * enforcement happens in POST / (finalize), which re-checks the ACTUAL
 * uploaded object's size (HeadObject) and content signature
 * (fileSignature.js, against the real bytes) before a draft record is ever
 * created — closing the two gaps found in the existing WhatsApp upload flow
 * during this PR's audit (client-reported size only, no signature check at
 * all).
 */
router.use(authMiddleware, adminMiddleware);

const UPLOAD_RATE_LIMIT = rateLimit(20, 60 * 60_000);

router.get('/', async (req, res, next) => {
  try {
    const documents = await listDocuments(req.user.companyId);
    res.json({ documents });
  } catch (err) { next(err); }
});

router.get('/upload-url', UPLOAD_RATE_LIMIT, async (req, res, next) => {
  try {
    const { mimeType, filename, fileSize } = req.query;
    if (!mimeType || !filename) return res.status(400).json({ error: 'mimeType and filename required' });
    if (!DOCUMENT_ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
    if (fileSize && Number(fileSize) > MAX_DOCUMENT_SIZE_BYTES) {
      return res.status(400).json({ error: `Files must be under ${MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024}MB` });
    }

    const documentId = crypto.randomUUID();
    const { uploadUrl, key } = getUploadUrl({ companyId: req.user.companyId, documentId, filename, mimeType });
    res.json({ success: true, uploadUrl, s3Key: key, documentId });
  } catch (err) { next(err); }
});

router.post('/', UPLOAD_RATE_LIMIT, async (req, res, next) => {
  try {
    const parsed = knowledgeDocumentMetaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });

    const companyId = req.user.companyId;
    const { documentId, s3Key, filename, mimeType, category } = parsed.data;

    // Defense in depth: the s3Key must actually belong to this company's
    // prefix — never trust a client-supplied key blindly, even though it
    // was this same client that requested it moments ago from /upload-url.
    if (!s3Key.startsWith(`knowledge-documents/${companyId}/`)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const validation = await validateUploadedObject(s3Key, mimeType);
    if (!validation.ok) {
      await logAudit(req.user.id, 'knowledge_document_upload', companyId, 'blocked', req.ip, { filename, reason: validation.reason }, companyId);
      return res.status(400).json({ error: validation.reason });
    }

    const doc = await createDocument({
      companyId, documentId, s3Key, filename, mimeType, category,
      fileSize: validation.fileSize, detectedType: validation.detectedType, userId: req.user.id,
    });

    await logAudit(req.user.id, 'knowledge_document_upload', companyId, 'success', req.ip, { documentId }, companyId);
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

router.put('/:documentId', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { filename, category } = req.body ?? {};
    await updateMetadata(companyId, documentId, {
      filename: typeof filename === 'string' && filename.trim() ? filename.trim() : doc.filename,
      category: typeof category === 'string' ? category : (doc.category ?? null),
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:documentId/publish', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await setStatus(companyId, documentId, 'published', req.user.id);
    await logAudit(req.user.id, 'knowledge_document_publish', companyId, 'success', req.ip, { documentId }, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:documentId/archive', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await setStatus(companyId, documentId, 'archived', req.user.id);
    await logAudit(req.user.id, 'knowledge_document_archive', companyId, 'success', req.ip, { documentId }, companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:documentId/unarchive', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Restores to whatever it was before archiving — published if it had
    // ever been published (publishedAt set), draft otherwise.
    const target = doc.publishedAt ? 'published' : 'draft';
    await setStatus(companyId, documentId, target, req.user.id);
    await logAudit(req.user.id, 'knowledge_document_unarchive', companyId, 'success', req.ip, { documentId, restoredTo: target }, companyId);
    res.json({ success: true, status: target });
  } catch (err) { next(err); }
});

router.get('/:documentId/download-url', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    // Company isolation: the s3Key is resolved ONLY via a DB lookup scoped
    // to this authenticated user's companyId — a documentId belonging to
    // another company simply isn't found here, S3 is never even touched.
    // Stronger than accepting a raw key from the client.
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const url = getDownloadUrl(doc.s3Key);
    res.json({ success: true, url, filename: doc.filename });
  } catch (err) { next(err); }
});

module.exports = router;
