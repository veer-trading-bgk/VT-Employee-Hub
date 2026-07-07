'use strict';

/**
 * documentExtraction.js (RAG PR B) — tested against real, committed binary
 * fixture files (tests/fixtures/sample.{docx,pptx,xlsx,pdf}), not mocks.
 * These were generated with known text content during this PR's audit and
 * verified hands-on against the real officeParser library before being
 * committed — same "prove it against the real thing" bar as every
 * extraction/detection module this session (fileSignature.js's disguised-
 * file tests, PR 4's live S3 verification).
 */

const fs = require('fs');
const path = require('path');
const { extractText } = require('../src/utils/documentExtraction');

const FIXTURES = path.join(__dirname, 'fixtures');
const KNOWN_TEXT = 'What are your account opening fees? There is no account opening fee, and AMC is waived for the first year.';

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name));
}

describe('extractText — real fixture files', () => {
  test('DOCX: extracts both paragraphs verbatim', async () => {
    const result = await extractText(fixture('sample.docx'), 'ooxml-docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.ok).toBe(true);
    expect(result.blocks).toContain('Fees & Charges');
    expect(result.blocks.join(' ')).toContain(KNOWN_TEXT);
  });

  test('PPTX: extracts slide text (title + body)', async () => {
    const result = await extractText(fixture('sample.pptx'), 'ooxml-pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(result.ok).toBe(true);
    expect(result.blocks.join(' ')).toContain('Fees & Charges');
    expect(result.blocks.join(' ')).toContain(KNOWN_TEXT);
  });

  test('XLSX: reconstructs rows as "header: value" pairs, not flat concatenation', async () => {
    const result = await extractText(fixture('sample.xlsx'), 'ooxml-xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(result.ok).toBe(true);
    expect(result.blocks).toContain('Product: Demat Account, Fee Type: Account Opening Fee, Amount: 0');
    // The header row itself never appears as a standalone "data" block.
    expect(result.blocks.some((b) => b === 'Product: Product, Fee Type: Fee Type, Amount: Amount')).toBe(false);
  });

  test('PDF: extracts heading and body text', async () => {
    const result = await extractText(fixture('sample.pdf'), 'pdf', 'application/pdf');
    expect(result.ok).toBe(true);
    expect(result.blocks.join(' ')).toContain('Fees & Charges');
    expect(result.blocks.join(' ')).toContain('account opening fee');
  });

  test('a corrupted file (valid extension, garbage bytes) fails cleanly, never throws', async () => {
    const garbage = Buffer.from('this is not a real docx file, just garbage bytes');
    const result = await extractText(garbage, 'ooxml-docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/could not extract text/i);
  });
});

describe('extractText — legacy formats and plain text', () => {
  test('legacy OLE2 (.doc/.xls/.ppt) short-circuits — no extraction attempted, still out of scope', async () => {
    const result = await extractText(Buffer.from('irrelevant'), 'ole2', 'application/msword');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/legacy office formats/i);
  });

  test('plain TXT/MD is read directly as one block', async () => {
    const result = await extractText(Buffer.from('Just plain text content.'), 'text', 'text/plain');
    expect(result).toEqual({ ok: true, blocks: ['Just plain text content.'] });
  });

  test('empty text file fails with a clear reason', async () => {
    const result = await extractText(Buffer.from('   \n  '), 'text', 'text/plain');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no extractable text/i);
  });

  test('CSV is reconstructed as "header: value" rows, same as XLSX', async () => {
    const csv = 'Product,Fee Type,Amount\nDemat Account,Account Opening Fee,0\nDemat Account,AMC,450';
    const result = await extractText(Buffer.from(csv), 'text', 'text/csv');
    expect(result.ok).toBe(true);
    expect(result.blocks).toEqual([
      'Product: Demat Account, Fee Type: Account Opening Fee, Amount: 0',
      'Product: Demat Account, Fee Type: AMC, Amount: 450',
    ]);
  });

  test('a single-line CSV (header only, no data rows) is treated as plain text rather than producing zero blocks', async () => {
    const result = await extractText(Buffer.from('just one line, no header structure'), 'text', 'text/csv');
    expect(result.ok).toBe(true);
    expect(result.blocks).toEqual(['just one line, no header structure']);
  });

  test('an unrecognized detectedType fails clearly', async () => {
    const result = await extractText(Buffer.from('x'), 'ooxml-unknown', 'application/zip');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported document type/i);
  });
});
