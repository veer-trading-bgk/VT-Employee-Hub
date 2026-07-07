'use strict';

const { detectFileType } = require('../src/utils/fileSignature');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOC_MIME = 'application/msword';
const XLS_MIME = 'application/vnd.ms-excel';
const PPT_MIME = 'application/vnd.ms-powerpoint';
const CSV_MIME = 'text/csv';
const TXT_MIME = 'text/plain';

function pdfBuffer() { return Buffer.from('%PDF-1.4\n%some binary junk here\n'); }
function ole2Buffer() { return Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from('padding padding padding')]); }
function zipBuffer(markerPath) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('some header bytes'),
    Buffer.from(markerPath, 'utf8'),
    Buffer.from('more content after the marker path'),
  ]);
}
function jpegBuffer() { return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]); }
function exeBuffer() { return Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); }

describe('detectFileType — PDF', () => {
  test('genuine PDF signature matches the claimed application/pdf', () => {
    const result = detectFileType(pdfBuffer(), PDF_MIME);
    expect(result).toEqual({ ok: true, detectedType: 'pdf' });
  });

  test('genuine PDF signature claimed as docx is rejected', () => {
    const result = detectFileType(pdfBuffer(), DOCX_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBe('pdf');
  });
});

describe('detectFileType — legacy OLE2 (.doc/.xls/.ppt)', () => {
  test('genuine OLE2 signature matches any of the 3 legacy claims (sub-type not distinguished)', () => {
    expect(detectFileType(ole2Buffer(), DOC_MIME)).toEqual({ ok: true, detectedType: 'ole2' });
    expect(detectFileType(ole2Buffer(), XLS_MIME)).toEqual({ ok: true, detectedType: 'ole2' });
    expect(detectFileType(ole2Buffer(), PPT_MIME)).toEqual({ ok: true, detectedType: 'ole2' });
  });

  test('OLE2 signature claimed as PDF is rejected', () => {
    const result = detectFileType(ole2Buffer(), PDF_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBe('ole2');
  });
});

describe('detectFileType — OOXML (.docx/.xlsx/.pptx)', () => {
  test('zip signature + word/ marker matches the claimed docx', () => {
    expect(detectFileType(zipBuffer('word/document.xml'), DOCX_MIME)).toEqual({ ok: true, detectedType: 'ooxml-docx' });
  });

  test('zip signature + xl/ marker matches the claimed xlsx', () => {
    expect(detectFileType(zipBuffer('xl/workbook.xml'), XLSX_MIME)).toEqual({ ok: true, detectedType: 'ooxml-xlsx' });
  });

  test('zip signature + ppt/ marker matches the claimed pptx', () => {
    expect(detectFileType(zipBuffer('ppt/presentation.xml'), PPTX_MIME)).toEqual({ ok: true, detectedType: 'ooxml-pptx' });
  });

  test('an xlsx (xl/ marker) claiming to be a docx is rejected — sub-type mismatch, not just "any zip passes"', () => {
    const result = detectFileType(zipBuffer('xl/workbook.xml'), DOCX_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBe('ooxml-xlsx');
  });

  test('a zip with no recognizable Office marker is detected as ooxml-unknown and rejected against any Office claim', () => {
    const result = detectFileType(zipBuffer('some/other/path.txt'), DOCX_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBe('ooxml-unknown');
  });
});

describe('detectFileType — disguised-extension attacks', () => {
  test('a JPEG claiming to be a PDF is rejected (no PDF/OLE2/ZIP signature at all)', () => {
    const result = detectFileType(jpegBuffer(), PDF_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBeNull();
    expect(result.reason).toMatch(/unrecognized file signature/i);
  });

  test('an EXE claiming to be a docx is rejected', () => {
    const result = detectFileType(exeBuffer(), DOCX_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBeNull();
  });
});

describe('detectFileType — plain text (CSV/TXT/MD), heuristic only', () => {
  test('genuine CSV content matches the claimed text/csv', () => {
    const csv = Buffer.from('name,age,city\nJohn,30,Mumbai\nPriya,28,Pune\n', 'utf8');
    expect(detectFileType(csv, CSV_MIME)).toEqual({ ok: true, detectedType: 'text' });
  });

  test('an empty file claiming text/plain is accepted (edge case)', () => {
    expect(detectFileType(Buffer.alloc(0), TXT_MIME)).toEqual({ ok: true, detectedType: 'text' });
  });

  test('binary garbage (random bytes, including a NUL byte) claiming text/plain is rejected', () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xfd, 0x03, 0x04, 0x00, 0x10, 0x11]);
    const result = detectFileType(garbage, TXT_MIME);
    expect(result.ok).toBe(false);
    expect(result.detectedType).toBeNull();
  });
});

describe('detectFileType — unsupported claimed mimeType', () => {
  test('a valid PDF against an unrecognized mimeType is rejected with a clear reason', () => {
    const result = detectFileType(pdfBuffer(), 'application/x-not-a-real-type');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported claimed type/i);
  });
});
