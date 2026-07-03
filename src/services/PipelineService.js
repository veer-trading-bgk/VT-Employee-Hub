'use strict';

const dynamodb = require('../config/dynamodb');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// ─── CRM pipeline (single source of truth: CONFIG#CRM#<companyId> / PIPELINE) ──

const DEFAULT_STAGES = [
  { key: 'new_lead',   label: 'New Lead',   color: '#94a3b8', order: 0 },
  { key: 'contacted',  label: 'Contacted',  color: '#3b82f6', order: 1 },
  { key: 'interested', label: 'Interested', color: '#f59e0b', order: 2 },
  { key: 'kyc_done',   label: 'KYC Done',   color: '#8b5cf6', order: 3 },
  { key: 'demat_done', label: 'Demat Done', color: '#22c55e', order: 4 },
  { key: 'lost',       label: 'Lost',       color: '#ef4444', order: 5 },
];

/**
 * Fetch the company's CRM pipeline stages, falling back to DEFAULT_STAGES
 * when the company hasn't customized their pipeline (or on read failure).
 * @param {string} companyId
 * @returns {Promise<Array<{key: string, label: string, color: string, order: number}>>}
 */
async function getPipelineStages(companyId) {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#CRM#${companyId}`, SK: 'PIPELINE' },
    }).promise();
    return result.Item?.stages ?? DEFAULT_STAGES;
  } catch {
    return DEFAULT_STAGES;
  }
}

/**
 * Validate a stage key against the company's real pipeline. Every write path
 * that persists a `stage` value (manual stage change, lead creation, an
 * automation's change_stage action) must call this first — a stage key that
 * isn't in the live pipeline must never reach DynamoDB, since nothing else
 * downstream can resolve its label or color once it's written.
 * @param {string} companyId
 * @param {string} stageKey
 * @returns {Promise<boolean>}
 */
async function isValidStage(companyId, stageKey) {
  if (!stageKey) return false;
  const stages = await getPipelineStages(companyId);
  return stages.some((s) => s.key === stageKey);
}

module.exports = { DEFAULT_STAGES, getPipelineStages, isValidStage };
