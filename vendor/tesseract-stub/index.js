'use strict';

// Stub replacing the real tesseract.js (an OCR engine — ~46MB of WASM/
// language data via its tesseract.js-core dependency). RAG PR B's audit
// confirmed officeParser only reaches tesseract.js via a dynamic
// `import('tesseract.js')` inside its OCR code path (src: node_modules/
// officeparser/dist/utils/ocrUtils.js), which only runs when the caller
// passes `ocr: true` — this codebase never does, since we only extract
// text from text-based documents, not scanned images. Wired in via
// package.json's "overrides" field (file:./vendor/tesseract-stub) purely
// to keep this out of the deployment package; it is not required for
// correctness (see docs/bible/19_DECISION_LOG.md's RAG PR B entry).
//
// Fails loudly rather than silently if the OCR path is ever actually
// triggered (e.g. a future change accidentally passes ocr: true), instead
// of a confusing "createWorker is not a function"-style error.
function createWorker() {
  throw new Error(
    'OCR is not supported in this deployment (tesseract.js is stubbed out via package.json overrides). '
    + 'Do not pass `ocr: true` to officeParser.',
  );
}

module.exports = { createWorker };
