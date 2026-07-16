'use strict';

/**
 * FlowManagementService — the single governed entry point for Meta's
 * WhatsApp Flows *Management* API (create / upload JSON / publish / preview).
 *
 * Sibling to WhatsAppSendService, not an extension of it — same relationship
 * as EmbeddingService ↔ AIService (ADR-017's "sibling, not extension"):
 * Flow authoring is a WABA-level asset-management API surface
 * (POST /{waba_id}/flows …), a different call shape from message sending
 * (POST /{phone_number_id}/messages), and ADR-012 governs sends only.
 * Sending a registered Flow to a customer remains sendRegisteredFlow() →
 * WhatsAppSendService.sendInteractive() — this module never sends messages.
 *
 * HARD RULE — every method gates on an intact WABA config (accessToken AND
 * wabaId present, detectInvalidWabaConfig clean) before any Meta call. The
 * OAuth connect path can legitimately persist wabaId:null when auto-discovery
 * fails (routes/whatsapp.js OAuth callback), and _requireConfig in the send
 * service checks only accessToken+phoneNumberId — so this gate must not be
 * relaxed or delegated. Same pattern as the template submit/sync routes.
 *
 * Meta quirk this module exists to handle correctly: the assets-upload
 * endpoint returns HTTP 200 with validation errors *in the response body*
 * ({ success, validation_errors: [...] }). HTTP success is NOT upload
 * success — callers always receive the parsed validationErrors array.
 */

const axios = require('axios');
const FormData = require('form-data');
const logger = require('../config/logger');
const {
  resolveGraphUrl,
  getWabaConfig,
  detectInvalidWabaConfig,
} = require('./graphApiHelpers');

const TIMEOUT_MS = 15000; // matches the template submit/sync Meta calls

function _err(msg, status, code, details) {
  const e = new Error(msg);
  e.status = status;
  if (code) e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

/**
 * Load and gate the company's WABA config. Throws a typed error (never
 * silently proceeds) when the config is absent, missing accessToken/wabaId,
 * or structurally invalid — same checks as the template-management routes.
 */
async function _requireWabaConfig(companyId) {
  if (!companyId) throw _err('FlowManagementService: companyId is required', 400, 'COMPANY_ID_REQUIRED');
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.wabaId) {
    throw _err(
      'WABA not connected — a connected WhatsApp Business Account with a WABA ID is required for Flow management. Reconnect via Settings → WhatsApp.',
      400,
      'WABA_NOT_CONNECTED',
    );
  }
  const cfgIssue = detectInvalidWabaConfig(cfg);
  if (cfgIssue) throw _err(cfgIssue, 400, 'INVALID_WABA_CONFIG');
  return cfg;
}

/**
 * Normalize an axios error from a Meta call into a typed error, preferring
 * Meta's end-user-facing error_user_msg — same handling (and the same
 * JSON.stringify-before-logging requirement) as the template submit route:
 * logger.error renders plain objects as "[object Object]" otherwise. Token
 * travels only in the Authorization header, so response data is safe to log.
 */
function _metaError(err, opName) {
  if (err.response?.data) {
    const rawError = err.response.data;
    logger.error(
      `FlowManagementService.${opName}: Meta API error (status ${err.response.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    const metaErr = rawError?.error ?? {};
    const friendly = metaErr.error_user_msg || metaErr.message || 'Meta API error';
    return _err(friendly, 400, 'META_API_ERROR', rawError);
  }
  logger.error(`FlowManagementService.${opName}: request failed`, err.message);
  return err;
}

/**
 * Create a Flow container on Meta. Returns the Meta-issued flow ID — Meta
 * issues it at creation, before any JSON is uploaded or published, which is
 * what lets CONFIG#FLOW# rows for builder drafts keep the same
 * SK: FLOW#{flowId} shape as manually-registered flows.
 */
async function createFlow(companyId, { name, categories } = {}) {
  if (!name?.trim()) throw _err('createFlow: name is required', 400, 'FLOW_NAME_REQUIRED');
  const cfg = await _requireWabaConfig(companyId);
  try {
    const res = await axios.post(
      `${resolveGraphUrl(cfg)}/${cfg.wabaId}/flows`,
      {
        name: name.trim(),
        // Meta requires ≥1 category from its fixed enum; OTHER is the
        // documented catch-all and keeps this service industry-agnostic.
        categories: Array.isArray(categories) && categories.length ? categories : ['OTHER'],
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS },
    );
    const flowId = res.data?.id;
    if (!flowId) throw _err('createFlow: Meta returned no flow id', 502, 'META_NO_FLOW_ID', res.data);
    return { flowId };
  } catch (err) {
    if (err.code === 'META_NO_FLOW_ID') throw err;
    throw _metaError(err, 'createFlow');
  }
}

/**
 * Upload a Flow JSON document to an existing (unpublished) Flow.
 *
 * Meta accepts the multipart upload at the HTTP level and reports JSON
 * problems in the response body — so this returns
 *   { success: boolean, validationErrors: [...] }
 * with success true ONLY when Meta reported success AND zero validation
 * errors. Callers must persist/surface validationErrors; never treat an
 * HTTP 200 alone as a valid upload.
 */
async function uploadFlowJson(companyId, flowId, flowJsonObj) {
  if (typeof flowId !== 'string' || !flowId.trim()) throw _err('uploadFlowJson: flowId is required', 400, 'FLOW_ID_REQUIRED');
  if (!flowJsonObj || typeof flowJsonObj !== 'object' || Array.isArray(flowJsonObj)) {
    throw _err('uploadFlowJson: flowJsonObj must be the Flow JSON document object', 400, 'FLOW_JSON_REQUIRED');
  }
  const cfg = await _requireWabaConfig(companyId);
  const form = new FormData();
  form.append('file', Buffer.from(JSON.stringify(flowJsonObj)), {
    filename: 'flow.json',
    contentType: 'application/json',
  });
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  try {
    const res = await axios.post(
      `${resolveGraphUrl(cfg)}/${flowId.trim()}/assets`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${cfg.accessToken}` }, timeout: TIMEOUT_MS },
    );
    const validationErrors = res.data?.validation_errors ?? [];
    return {
      success: res.data?.success === true && validationErrors.length === 0,
      validationErrors,
    };
  } catch (err) {
    throw _metaError(err, 'uploadFlowJson');
  }
}

/** Publish a Flow. Meta rejects this while validation errors are outstanding. */
async function publishFlow(companyId, flowId) {
  if (typeof flowId !== 'string' || !flowId.trim()) throw _err('publishFlow: flowId is required', 400, 'FLOW_ID_REQUIRED');
  const cfg = await _requireWabaConfig(companyId);
  try {
    const res = await axios.post(
      `${resolveGraphUrl(cfg)}/${flowId.trim()}/publish`,
      {},
      { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: TIMEOUT_MS },
    );
    return { success: res.data?.success === true };
  } catch (err) {
    throw _metaError(err, 'publishFlow');
  }
}

/**
 * Get a web preview URL for a Flow. Meta exposes preview as a *field* on the
 * Flow node (GET /{flow_id}?fields=preview.invalidate(false)) rather than a
 * /preview edge. invalidate(false) reuses the existing preview link instead
 * of forcibly expiring previously-issued ones.
 */
async function getPreviewUrl(companyId, flowId) {
  if (typeof flowId !== 'string' || !flowId.trim()) throw _err('getPreviewUrl: flowId is required', 400, 'FLOW_ID_REQUIRED');
  const cfg = await _requireWabaConfig(companyId);
  try {
    const res = await axios.get(
      `${resolveGraphUrl(cfg)}/${flowId.trim()}`,
      {
        params: { fields: 'preview.invalidate(false)' },
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        timeout: TIMEOUT_MS,
      },
    );
    const preview = res.data?.preview;
    if (!preview?.preview_url) throw _err('getPreviewUrl: Meta returned no preview URL', 502, 'META_NO_PREVIEW', res.data);
    return { previewUrl: preview.preview_url, expiresAt: preview.expires_at ?? null };
  } catch (err) {
    if (err.code === 'META_NO_PREVIEW') throw err;
    throw _metaError(err, 'getPreviewUrl');
  }
}

module.exports = { createFlow, uploadFlowJson, publishFlow, getPreviewUrl };
