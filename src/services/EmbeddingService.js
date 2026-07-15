'use strict';

const axios = require('axios');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { EMBEDDING_CONFIG } = require('../config/embeddingConfig');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

/**
 * EmbeddingService — the single governed entry point for every embedding
 * call APForce makes (ADR-017). No route, component, or other service may
 * call an embedding provider directly; every consumer calls embed() here.
 *
 * HARD BOUNDARY — this module has NO dependency on WhatsAppSendService and
 * never sends or injects anything itself. It returns vectors; ranking,
 * storage, and prompt injection are the caller's job (KnowledgeService.js
 * today) — mirrors ADR-015 Rule 5's boundary, adapted to this service.
 *
 * Deliberately never throws for expected runtime conditions (provider
 * error, timeout, missing key) — always an { ok, ... } result, same
 * contract shape as AIService.generate(), so callers can degrade
 * gracefully (fall back to keyword matching) rather than crash a turn.
 */

async function _logUsage(companyId, { tokens, inputType, textCount, entityType, entityId }) {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `EMBEDUSAGE#${companyId}#${date}`, SK: now,
        companyId, date, tokens, inputType, textCount, model: EMBEDDING_CONFIG.model,
        // Optional, additive (2026-07-08, cost-audit Part 5) — omitted
        // entirely when a caller doesn't have one, same "never write
        // undefined into an item" stance as AIService's own _logUsage.
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
      },
    }).promise();
  } catch (err) {
    // Usage-logging failure must never fail the actual embed call it's
    // describing — same "never let audit/usage logging break the real
    // operation" stance used throughout this codebase (e.g. logAudit call
    // sites), just inlined here since this is the only writer of this ledger.
    logger.error(`EmbeddingService: usage log FAILED for ${companyId}: ${err.message}`);
  }
}

function embed({ texts, companyId, inputType, entityType, entityId }) {
  if (!companyId) throw new Error('EmbeddingService.embed(): companyId is required');
  if (!inputType || (inputType !== 'query' && inputType !== 'document')) {
    throw new Error('EmbeddingService.embed(): inputType must be "query" or "document"');
  }
  return _embed({ texts, companyId, inputType, entityType, entityId });
}

async function _embed({ texts, companyId, inputType, entityType, entityId }) {
  if (!texts || texts.length === 0) return { ok: true, data: { embeddings: [] } };

  try {
    const response = await axios.post(EMBEDDING_CONFIG.apiUrl, {
      input: texts, model: EMBEDDING_CONFIG.model, input_type: inputType,
    }, {
      headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: EMBEDDING_CONFIG.timeoutMs,
    });

    // Voyage returns results possibly out of input order — index is
    // authoritative, matching the documented response shape.
    const embeddings = [...response.data.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    await _logUsage(companyId, {
      tokens: response.data.usage?.total_tokens ?? null, inputType, textCount: texts.length,
      entityType, entityId,
    });

    return { ok: true, data: { embeddings } };
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    // Classify by ERROR CLASS, not volume (2026-07-15). Both callers
    // (KnowledgeService / DocumentChunkRetrievalService) degrade to keyword
    // matching on any failure, so the customer turn always still replies — but
    // whether a human should be PAGED depends on which kind of failure this is:
    //
    //  - Voyage answered with an HTTP error (err.response present: 401 bad/rotated
    //    key, 403, 429 rate-limit, 5xx server fault) → a real, actionable fault a
    //    human must see. logger.error → Telegram page, exactly as before this
    //    change. These page on the FIRST occurrence; no volume threshold to reach.
    //  - No response at all (a timeout — err.code ECONNABORTED/ETIMEDOUT — or a
    //    connection-level failure) → the transient case that (a) recovers on its
    //    own, (b) was spamming the alert channel, and (c) degrades gracefully.
    //    logger.warn → CloudWatch only, no page.
    //
    // This replaces the earlier in-memory "5-failures-in-10-min" tripwire, which
    // an adversarial review showed can essentially never fire at this service's
    // real traffic (~1-2 embeds/hour, per-warm-container counter) — so it would
    // have silently swallowed exactly the hard failures (bad key/config) the old
    // logger.error used to page on. Known residual gap: a pure connection-level
    // Voyage OUTAGE (no HTTP response) only warns; the correct cross-container
    // signal for that is a CloudWatch metric-filter alarm on this warn line, not
    // in-process state. See docs/phase3/TECHNICAL_DEBT.md.
    if (err.response) {
      logger.error(`EmbeddingService: embed failed for ${companyId} (inputType: ${inputType}) — Voyage returned HTTP ${err.response.status}: ${JSON.stringify(detail)}`);
    } else {
      logger.warn(`EmbeddingService: embed timed out / unreachable for ${companyId} (inputType: ${inputType}): ${JSON.stringify(detail)} — degraded to keyword fallback`);
    }
    return { ok: false, reason: 'embedding_failed', detail };
  }
}

module.exports = { embed };
