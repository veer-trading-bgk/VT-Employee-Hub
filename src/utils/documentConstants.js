// Structured Knowledge Center's Document Knowledge half (Phase 2A, PR 4).
// Deliberately its own allowlist/limit, NOT WhatsApp's ALLOWED_MIME/
// META_SIZE_LIMITS (mediaConstants.js) — different scope (adds PPT/PPTX/MD,
// which Meta doesn't support for WhatsApp media) and a flat size cap instead
// of Meta's per-media-type limits.
const DOCUMENT_ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/csv',
  'text/plain',
  'text/markdown',
]);

const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

// RAG PR B — caps chunk count per document at publish time. Comfortably
// inside Voyage's confirmed batch limits for voyage-finance-2 (1,000 texts /
// 120K tokens per request), generous for any realistic reference document.
// A document that would exceed this is rejected at publish with a clear
// error rather than risking a Lambda timeout or exceeding Voyage's batch
// limits mid-request.
const MAX_CHUNKS_PER_DOCUMENT = 300;

module.exports = { DOCUMENT_ALLOWED_MIME, MAX_DOCUMENT_SIZE_BYTES, MAX_CHUNKS_PER_DOCUMENT };
