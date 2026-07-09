'use strict';

const crypto = require('crypto');
const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const { logAudit } = require('../utils/audit');
const { knowledgeDocumentMetaSchema, stripStorageMetadata } = require('../utils/validation');
const { DOCUMENT_ALLOWED_MIME, MAX_DOCUMENT_SIZE_BYTES, MAX_CHUNKS_PER_DOCUMENT } = require('../utils/documentConstants');
const {
  listDocuments, getDocument, getUploadUrl, validateUploadedObject, createDocument,
  updateMetadata, setStatus, getDownloadUrl, getObjectBuffer,
} = require('../services/DocumentKnowledgeService');
const { extractText } = require('../utils/documentExtraction');
const { chunkBlocks } = require('../utils/chunking');
const EmbeddingService = require('../services/EmbeddingService');
const { violatesGuardrail } = require('../services/ConversationalAgentService');
const {
  createChunks, deleteChunksForDocument, setChunksArchived,
} = require('../services/DocumentChunkService');

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
    // stripStorageMetadata() — listDocuments() returns raw DynamoDB items
    // (PK/SK/companyId/updatedAt). No round-trip risk (updateDocumentMeta()
    // always sends a fresh {filename, category} body, never a fetched
    // document — see docs/phase3/TECHNICAL_DEBT.md's repo-wide sweep), but
    // no reason to hand internal storage keys to the client either.
    res.json({ documents: documents.map(stripStorageMetadata) });
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
    res.status(201).json(stripStorageMetadata(doc));
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

// RAG PR B — publish now does real work: extract, chunk, run a non-blocking
// compliance advisory scan, embed, store. Extraction failure blocks publish
// (a document with no extractable text has no fallback, unlike an entry
// without an embedding, which still has keyword-matchable content) — same
// for a chunk-count over MAX_CHUNKS_PER_DOCUMENT or a failed embed call.
router.put('/:documentId/publish', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const buffer = await getObjectBuffer(doc.s3Key);
    const extraction = await extractText(buffer, doc.detectedType, doc.mimeType);
    if (!extraction.ok) {
      await logAudit(req.user.id, 'knowledge_document_publish', companyId, 'blocked', req.ip, { documentId, reason: extraction.reason }, companyId);
      return res.status(422).json({ error: extraction.reason });
    }

    const chunks = chunkBlocks(extraction.blocks);
    if (chunks.length === 0) {
      return res.status(422).json({ error: 'No extractable text found in this document.' });
    }
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      return res.status(422).json({
        error: `This document would produce ${chunks.length} chunks, over the ${MAX_CHUNKS_PER_DOCUMENT} limit — try splitting it into smaller documents.`,
      });
    }

    // Non-blocking advisory: reuses the real, unchanged violatesGuardrail()
    // — no new compliance engine. Never blocks publish; the admin sees it
    // and judges for themselves, same "known issue, not a hard fail"
    // philosophy as PromptTestService's exemption UI.
    const complianceAdvisory = chunks
      .map((text, chunkIndex) => ({ chunkIndex, text, flagged: violatesGuardrail(text) }))
      .filter((r) => r.flagged)
      .map(({ chunkIndex, text }) => ({ chunkIndex, text }));

    const embedResult = await EmbeddingService.embed({
      texts: chunks, companyId, inputType: 'document',
      entityType: 'document', entityId: documentId,
    });
    if (!embedResult.ok) {
      await logAudit(req.user.id, 'knowledge_document_publish', companyId, 'blocked', req.ip, { documentId, reason: embedResult.reason }, companyId);
      return res.status(422).json({ error: 'Could not generate embeddings for this document — try again.' });
    }

    // Replace any existing chunks (e.g. a retry after a previously failed
    // publish attempt) rather than appending duplicates.
    await deleteChunksForDocument(companyId, documentId);
    await createChunks(companyId, documentId, chunks, embedResult.data.embeddings);

    await setStatus(companyId, documentId, 'published', req.user.id);
    await logAudit(req.user.id, 'knowledge_document_publish', companyId, 'success', req.ip, {
      documentId, chunkCount: chunks.length, complianceAdvisoryCount: complianceAdvisory.length,
    }, companyId);
    res.json({ success: true, chunkCount: chunks.length, complianceAdvisory });
  } catch (err) { next(err); }
});

router.put('/:documentId/archive', async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { documentId } = req.params;
    const doc = await getDocument(companyId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await setStatus(companyId, documentId, 'archived', req.user.id);
    await setChunksArchived(companyId, documentId, true);
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
    await setChunksArchived(companyId, documentId, false);
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
