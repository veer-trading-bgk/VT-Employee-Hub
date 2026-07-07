'use strict';

// Content-signature validation for Document Knowledge uploads (Phase 2A,
// PR 4) — the browser uploads straight to S3 via a presigned PUT (Lambda
// never sees the bytes in flight), so "don't trust the extension" can only
// be enforced as a follow-up read of the first few KB after the object
// lands. No `file-type` npm dependency: the format list here is small and
// fixed, and every current major version of that package is ESM-only,
// which doesn't `require()` cleanly in this CommonJS Lambda bundle.
//
// Deliberately dependency-free, deliberately not a full parser:
// - OOXML (docx/xlsx/pptx) sub-type detection is a substring scan for a
//   marker path (`word/`, `xl/`, `ppt/`) within the sampled bytes, not a
//   real ZIP central-directory parse. This closes the realistic attack this
//   control exists for (a renamed .exe/.jpg claiming to be a .docx has no
//   ZIP signature at all and is rejected outright) but a deliberately
//   crafted ZIP could in theory fake the marker path without being a valid
//   OOXML document. Documented limitation, not treated as cryptographic proof.
// - Legacy OLE2 formats (.doc/.xls/.ppt) are validated as "genuinely an
//   OLE2 compound file" only — the three legacy formats share the same
//   container signature, and telling them apart requires parsing the CFBF
//   directory stream, which this does not do. Any of the three claimed
//   legacy types is accepted against a valid OLE2 signature.
// - Plain text (CSV/TXT/MD) has no real magic number. Validated only by a
//   "does this look like text" heuristic (no NUL bytes, low proportion of
//   non-printable bytes) — this cannot distinguish a CSV from a TXT from a
//   Markdown file, only "binary garbage" from "plausible text."

const PDF_SIGNATURE = Buffer.from('%PDF', 'ascii');
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]), // normal zip
  Buffer.from([0x50, 0x4b, 0x05, 0x06]), // empty zip
];

const MIME_TO_FAMILY = {
  'application/pdf': 'pdf',
  'application/msword': 'ole2',
  'application/vnd.ms-excel': 'ole2',
  'application/vnd.ms-powerpoint': 'ole2',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'ooxml-docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'ooxml-xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ooxml-pptx',
  'text/csv': 'text',
  'text/plain': 'text',
  'text/markdown': 'text',
};

function looksLikeText(buffer) {
  if (buffer.length === 0) return true;
  let suspicious = 0;
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (b === 0x00) return false; // a NUL byte essentially never appears in genuine text
    const isPrintableAscii = b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
    const isUtf8Continuation = b >= 0x80; // loosely tolerate UTF-8 multi-byte sequences
    if (!isPrintableAscii && !isUtf8Continuation) suspicious++;
  }
  return suspicious / buffer.length < 0.05;
}

function detectZipSubType(buffer) {
  const text = buffer.toString('latin1');
  if (text.includes('word/')) return 'ooxml-docx';
  if (text.includes('xl/')) return 'ooxml-xlsx';
  if (text.includes('ppt/')) return 'ooxml-pptx';
  return 'ooxml-unknown';
}

function rawDetect(buffer, claimedMimeType) {
  if (buffer.slice(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) return 'pdf';
  if (buffer.slice(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) return 'ole2';
  if (ZIP_SIGNATURES.some((sig) => buffer.slice(0, sig.length).equals(sig))) return detectZipSubType(buffer);
  if (MIME_TO_FAMILY[claimedMimeType] === 'text' && looksLikeText(buffer)) return 'text';
  return null;
}

// Returns { ok, detectedType, reason? }. Fails closed: any signature this
// doesn't recognize, or that doesn't match the family the claimed mimeType
// belongs to, is rejected — never exempted just because parsing didn't
// crash.
function detectFileType(buffer, claimedMimeType) {
  const expectedFamily = MIME_TO_FAMILY[claimedMimeType];
  const detected = rawDetect(buffer, claimedMimeType);

  if (!detected) {
    return { ok: false, detectedType: null, reason: 'Unrecognized file signature — the file\'s actual content does not match a known format.' };
  }
  if (!expectedFamily) {
    return { ok: false, detectedType: detected, reason: `Unsupported claimed type: ${claimedMimeType}` };
  }
  if (detected !== expectedFamily) {
    return {
      ok: false, detectedType: detected,
      reason: `File content doesn't match its claimed type — expected ${expectedFamily}, detected ${detected}.`,
    };
  }
  return { ok: true, detectedType: detected };
}

module.exports = { detectFileType, MIME_TO_FAMILY };
