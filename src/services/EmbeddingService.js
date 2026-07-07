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

async function _logUsage(companyId, { tokens, inputType, textCount }) {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `EMBEDUSAGE#${companyId}#${date}`, SK: now,
        companyId, date, tokens, inputType, textCount, model: EMBEDDING_CONFIG.model,
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

function embed({ texts, companyId, inputType }) {
  if (!companyId) throw new Error('EmbeddingService.embed(): companyId is required');
  if (!inputType || (inputType !== 'query' && inputType !== 'document')) {
    throw new Error('EmbeddingService.embed(): inputType must be "query" or "document"');
  }
  return _embed({ texts, companyId, inputType });
}

async function _embed({ texts, companyId, inputType }) {
  if (!texts || texts.length === 0) return { ok: true, data: { embeddings: [] } };

  try {
    const response = await axios.post(EMBEDDING_CONFIG.apiUrl, {
      input: texts, model: EMBEDDING_CONFIG.model, input_type: inputType,
    }, {
      headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    // Voyage returns results possibly out of input order — index is
    // authoritative, matching the documented response shape.
    const embeddings = [...response.data.data]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    await _logUsage(companyId, {
      tokens: response.data.usage?.total_tokens ?? null, inputType, textCount: texts.length,
    });

    return { ok: true, data: { embeddings } };
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    logger.error(`EmbeddingService: embed failed for ${companyId} (inputType: ${inputType}): ${JSON.stringify(detail)}`);
    return { ok: false, reason: 'embedding_failed', detail };
  }
}

module.exports = { embed };
