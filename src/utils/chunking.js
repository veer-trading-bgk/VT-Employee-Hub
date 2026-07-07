'use strict';

/**
 * RAG PR B — structure-aware fixed-size chunking. Chunk boundaries prefer
 * the extraction step's own block boundaries (paragraph/slide/row) — only
 * splitting mid-block when a single block alone exceeds the target chunk
 * size. Pure and deterministic — no mocking needed to test it.
 */

const TARGET_CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

function hardSplit(text) {
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + TARGET_CHUNK_SIZE, text.length);
    pieces.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return pieces;
}

function chunkBlocks(blocks) {
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const rawBlock of blocks) {
    const block = (rawBlock ?? '').trim();
    if (!block) continue;

    if (block.length > TARGET_CHUNK_SIZE) {
      // This single block alone exceeds the target — flush whatever's
      // accumulated, hard-split this oversized block on its own, then keep
      // accumulating fresh after it (not carrying its tail forward, to
      // keep the boundary behavior simple and easy to reason about).
      flush();
      current = '';
      chunks.push(...hardSplit(block));
      continue;
    }

    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= TARGET_CHUNK_SIZE) {
      current = candidate;
    } else {
      flush();
      // Carry a small overlap from the end of the just-flushed chunk into
      // the next one, so retrieval context isn't lost right at a boundary.
      const overlapTail = current.slice(-CHUNK_OVERLAP).trim();
      current = overlapTail ? `${overlapTail}\n\n${block}` : block;
    }
  }
  flush();
  return chunks;
}

module.exports = { chunkBlocks, TARGET_CHUNK_SIZE, CHUNK_OVERLAP };
