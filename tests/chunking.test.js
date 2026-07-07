'use strict';

const { chunkBlocks, TARGET_CHUNK_SIZE, CHUNK_OVERLAP } = require('../src/utils/chunking');

describe('chunkBlocks', () => {
  test('empty input produces no chunks', () => {
    expect(chunkBlocks([])).toEqual([]);
  });

  test('blank/whitespace-only blocks are skipped entirely', () => {
    expect(chunkBlocks(['', '   ', '\n\n'])).toEqual([]);
  });

  test('a single small block becomes exactly one chunk, unchanged', () => {
    expect(chunkBlocks(['hello world'])).toEqual(['hello world']);
  });

  test('several small blocks pack into a single chunk when they fit together', () => {
    const blocks = Array.from({ length: 5 }, (_, i) => `Paragraph ${i} with some reasonable filler text.`);
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBeLessThan(TARGET_CHUNK_SIZE);
    for (const block of blocks) expect(chunks[0]).toContain(block);
  });

  test('blocks that no longer fit together start a new chunk, carrying a small overlap forward', () => {
    const bigBlock1 = 'A'.repeat(600);
    const bigBlock2 = 'B'.repeat(600);
    const chunks = chunkBlocks([bigBlock1, bigBlock2]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain(bigBlock1);
    // The second chunk carries the tail of the first as overlap, then the new block.
    expect(chunks[1]).toContain(bigBlock2);
    expect(chunks[1].startsWith('A')).toBe(true);
  });

  test('a single block that alone exceeds the target size is hard-split, with overlap between pieces', () => {
    const huge = 'X'.repeat(3500);
    const chunks = chunkBlocks([huge]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TARGET_CHUNK_SIZE);
    // Overlap means total characters covered exceeds the original length.
    const totalCovered = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalCovered).toBeGreaterThan(huge.length);
  });

  test('a very large single block splits into a bounded, reasonable number of chunks without hanging', () => {
    const reallyHuge = 'Y'.repeat(100_000);
    const start = Date.now();
    const chunks = chunkBlocks([reallyHuge]);
    expect(Date.now() - start).toBeLessThan(1000);
    // ~100000 / (1000 - 150) plus one, roughly — just confirm it's bounded and non-trivial.
    expect(chunks.length).toBeGreaterThan(50);
    expect(chunks.length).toBeLessThan(200);
  });

  test('an oversized block in the middle of normal blocks does not corrupt neighboring chunks', () => {
    const before = 'Short intro paragraph.';
    const huge = 'Z'.repeat(2500);
    const after = 'Short closing paragraph.';
    const chunks = chunkBlocks([before, huge, after]);
    expect(chunks[0]).toContain(before);
    expect(chunks[chunks.length - 1]).toContain(after);
  });

  test('null/undefined entries in the blocks array are tolerated, not a crash', () => {
    expect(() => chunkBlocks([null, undefined, 'real content', ''])).not.toThrow();
    expect(chunkBlocks([null, undefined, 'real content', ''])).toEqual(['real content']);
  });

  test('CHUNK_OVERLAP is meaningfully smaller than TARGET_CHUNK_SIZE (sanity bound, avoids infinite loops)', () => {
    expect(CHUNK_OVERLAP).toBeLessThan(TARGET_CHUNK_SIZE);
  });
});
