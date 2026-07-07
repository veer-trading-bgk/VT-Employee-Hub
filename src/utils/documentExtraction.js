'use strict';

const path = require('path');
const officeParser = require('officeparser');

// officeParser's PDF support (via pdfjs-dist) defaults to loading its parser
// worker from a CDN URL (cdn.jsdelivr.net) — found during this PR's testing,
// not something to leave as a silent production dependency on a third-party
// CDN's uptime for a Lambda that otherwise has no such external asset
// dependency anywhere. Pointing it at the copy pdfjs-dist already ships in
// node_modules removes that dependency entirely (also incidentally avoids a
// dynamic-import path that fails under Jest's default CommonJS VM context).
const PDF_WORKER_SRC = `file://${path.join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs').split(path.sep).join('/')}`;

/**
 * RAG PR B — extracts plain, structure-aware text blocks from a document's
 * raw bytes. Dispatches on `detectedType` (already known from PR 4's
 * fileSignature.js — never re-detected here). Legacy OLE2 (.doc/.xls/.ppt)
 * stays explicitly out of scope, confirmed again this round (no new
 * information changes PR 4/PR A's decision).
 *
 * Returns { ok: true, blocks: string[] } or { ok: false, reason }. Never
 * throws — same { ok, ... } contract as EmbeddingService.embed() and
 * AIService.generate(), so the /publish route treats this as a definite,
 * typed result.
 *
 * officeParser's real API (verified hands-on, not just documented) returns
 * a structured AST — { content: [...] } — shaped differently per format:
 * PDF wraps paragraphs in per-page objects; DOCX is a flat paragraph array;
 * PPTX is per-slide (with separate speaker-notes); XLSX is sheet > row >
 * cell. Each gets its own flattening so retrieval-meaningful structure
 * (e.g. which cell value belongs to which column) isn't lost to naive
 * concatenation.
 */

// Maps our already-proven fileSignature.js detection onto officeParser's
// own `fileType` hint — found necessary during hands-on testing: officeParser
// otherwise runs its OWN internal auto-detection from the buffer's magic
// bytes, which is redundant with (and, on at least one malformed input,
// less reliable than) the detection we've already done and trust.
const OFFICE_FILE_TYPE_HINT = {
  pdf: 'pdf', 'ooxml-docx': 'docx', 'ooxml-xlsx': 'xlsx', 'ooxml-pptx': 'pptx',
};

async function extractText(buffer, detectedType, mimeType) {
  if (detectedType === 'ole2') {
    return { ok: false, reason: 'Legacy Office formats (.doc/.xls/.ppt) are not supported for text extraction.' };
  }

  if (detectedType === 'text') {
    const raw = buffer.toString('utf8').trim();
    if (!raw) return { ok: false, reason: 'File contains no extractable text.' };
    const blocks = mimeType === 'text/csv' ? flattenCsv(raw) : [raw];
    if (blocks.length === 0) return { ok: false, reason: 'File contains no extractable text.' };
    return { ok: true, blocks };
  }

  const fileType = OFFICE_FILE_TYPE_HINT[detectedType];
  if (!fileType) {
    return { ok: false, reason: `Unsupported document type for extraction: ${detectedType}` };
  }

  try {
    const parsed = await officeParser.parseOffice(buffer, { fileType, pdfWorkerSrc: PDF_WORKER_SRC });
    const blocks = flattenToBlocks(parsed, detectedType);
    if (blocks.length === 0) return { ok: false, reason: 'No extractable text found in this document.' };
    return { ok: true, blocks };
  } catch (err) {
    return { ok: false, reason: `Could not extract text: ${err.message ?? err}` };
  }
}

// Naive comma-split — does not handle quoted fields containing embedded
// commas (e.g. `"Smith, John",30`). Reasonable for the simple reference-data
// CSVs this feature targets (fee schedules, product lists); a known,
// documented limitation, not a silent gap.
function flattenCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  if (lines.length === 1) return [raw];

  const header = lines[0].split(',').map((h) => h.trim());
  const blocks = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const parts = cells.map((cell, idx) => `${header[idx] ?? `col${idx}`}: ${cell.trim()}`);
    if (parts.some((p) => p.trim())) blocks.push(parts.join(', '));
  }
  return blocks;
}

function flattenToBlocks(parsed, detectedType) {
  if (detectedType === 'ooxml-xlsx') return flattenSheet(parsed);
  if (detectedType === 'ooxml-pptx') return flattenSlides(parsed);
  return flattenProse(parsed); // pdf, ooxml-docx
}

// DOCX: parsed.content is a flat array of paragraph-level blocks.
// PDF: parsed.content is an array of PAGE objects, each with nested
// paragraph-level children — handled inline below rather than assuming
// one shape fits both formats.
function flattenProse(parsed) {
  const blocks = [];
  for (const item of parsed.content ?? []) {
    if (item.type === 'page') {
      for (const child of item.children ?? []) {
        if (child.text && child.text.trim()) blocks.push(child.text.trim());
      }
    } else if (item.text && item.text.trim()) {
      blocks.push(item.text.trim());
    }
  }
  return blocks;
}

// PPTX: one block per slide (title + body text joined), speaker notes (if
// any) appended as their own separate block — still useful reference
// content, but distinguishable from the slide's own visible text.
function flattenSlides(parsed) {
  const blocks = [];
  for (const slide of parsed.content ?? []) {
    const texts = (slide.children ?? []).map((c) => c.text).filter((t) => t && t.trim());
    if (texts.length) blocks.push(texts.join('\n'));

    for (const note of slide.notes ?? []) {
      const noteText = (note.children ?? []).map((c) => c.text).filter(Boolean).join('\n').trim();
      if (noteText) blocks.push(noteText);
    }
  }
  return blocks;
}

// XLSX: one block per data row, reconstructed as "{header}: {value}, ..."
// using the first row as column labels — preserves which value belongs to
// which column, instead of losing that to flat cell-text concatenation.
function flattenSheet(parsed) {
  const blocks = [];
  for (const sheet of parsed.content ?? []) {
    const rows = sheet.children ?? [];
    if (rows.length < 2) continue; // need at least a header + 1 data row

    const header = (rows[0].children ?? []).map((c) => c.text ?? '');
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r].children ?? [];
      const parts = cells.map((cell, i) => `${header[i] || `col${i}`}: ${cell.text ?? ''}`);
      if (parts.some((p) => p.trim())) blocks.push(parts.join(', '));
    }
  }
  return blocks;
}

module.exports = { extractText };
