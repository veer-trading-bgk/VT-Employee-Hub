'use strict';

/**
 * CapiService — the single governed entry point for Meta's Conversions API
 * for Business Messaging (the "Meta Signal" feature): dataset provisioning
 * and CTWA conversion-event reporting.
 *
 * Sibling to WhatsAppSendService, not an extension of it — same relationship
 * as FlowManagementService ↔ WhatsAppSendService (and EmbeddingService ↔
 * AIService, ADR-017's "sibling, not extension"): conversion reporting is a
 * dataset-level API surface (POST /{dataset_id}/events), a different call
 * shape from message sending (POST /{phone_number_id}/messages), and ADR-012
 * governs sends only. This module never sends WhatsApp messages. See ADR-019.
 *
 * HARD RULE — every method gates on an intact WABA config (accessToken AND
 * wabaId present, detectInvalidWabaConfig clean) before any Meta call, same
 * gate as FlowManagementService: the dataset hangs off the WABA, and the
 * OAuth connect path can legitimately persist wabaId:null when auto-discovery
 * fails (routes/whatsapp.js OAuth callback), so this must not be relaxed to
 * the send service's accessToken+phoneNumberId check.
 *
 * NON-NEGOTIABLE payload constants — verified against Meta's business-
 * messaging CAPI doc 2026-07-18: action_source MUST be "business_messaging"
 * and messaging_channel MUST be "whatsapp". action_source:"website" silently
 * breaks CTWA attribution (Meta's most common CAPI integration bug), and
 * ctwa_clid goes inside user_data UNHASHED ("Do not hash" — Meta's own
 * customer-information-parameters doc).
 *
 * Once-ever guarantee — Meta explicitly does NOT deduplicate business-
 * messaging events ("Meta does not assist with deduplicating events for
 * Conversions API for Business Messaging"), so event_id alone dedups
 * nothing. reportForLead() claims a permanent per-lead marker
 * (SK CAPI#{metaEventName}, conditional put, deliberately NO TTL — same
 * reasoning as StageMembershipScheduler's ENROLLED#: a TTL'd claim would let
 * DynamoDB expire it and a re-added tag would double-count the conversion at
 * Meta) before any POST. Claim-first means a post-claim send failure is never
 * auto-retried (ENROLLED# precedent) — the failure stays visible in CAPILOG#.
 */

const axios = require('axios');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const {
  resolveGraphUrl,
  getWabaConfig,
  detectInvalidWabaConfig,
  invalidateConfigCache,
} = require('./graphApiHelpers');
const { capiClaimSK, capiLogPK, capiLogSK } = require('../core/entityKeys');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const TIMEOUT_MS = 15000; // matches FlowManagementService / template Meta calls

// Meta's documented business-messaging event set (fixed — custom names are
// NOT supported on this channel; the general web-CAPI "custom event" language
// does not apply to action_source:business_messaging). Source: Conversions
// API for Business Messaging doc, fetched + verified 2026-07-18.
const SUPPORTED_EVENTS = Object.freeze([
  'Purchase', 'LeadSubmitted', 'QualifiedLead', 'InitiateCheckout', 'AddToCart',
  'ViewContent', 'OrderCreated', 'OrderShipped', 'OrderDelivered', 'OrderCanceled',
  'OrderReturned', 'CartAbandoned', 'RatingProvided', 'ReviewProvided',
]);

const ACTION_SOURCE = 'business_messaging'; // NEVER "website" — breaks CTWA attribution
const MESSAGING_CHANNEL = 'whatsapp';
const PARTNER_AGENT = 'APForce';
const DEFAULT_CURRENCY = 'INR'; // ISO 4217; single-market product, ₹ everywhere in UI

// CAPILOG# rows are observability, not the dedup mechanism (that's the no-TTL
// claim marker) — so expiry here is low-stakes and 90 days matches AUTO_EXEC#'s
// execution-history retention.
const CAPI_LOG_TTL_SECONDS = 90 * 86400;

function _err(msg, status, code, details) {
  const e = new Error(msg);
  e.status = status;
  if (code) e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

/**
 * Load and gate the company's WABA config — accessToken AND wabaId required,
 * detectInvalidWabaConfig clean. Same hard rule (and same typed error codes)
 * as FlowManagementService._requireWabaConfig; kept module-private in each
 * service deliberately, matching how the template submit/sync routes carry
 * their own copy of this gate.
 */
async function _requireWabaConfig(companyId) {
  if (!companyId) throw _err('CapiService: companyId is required', 400, 'COMPANY_ID_REQUIRED');
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.wabaId) {
    throw _err(
      'WABA not connected — a connected WhatsApp Business Account with a WABA ID is required for conversion reporting. Reconnect via Settings → WhatsApp.',
      400,
      'WABA_NOT_CONNECTED',
    );
  }
  const cfgIssue = detectInvalidWabaConfig(cfg);
  if (cfgIssue) throw _err(cfgIssue, 400, 'INVALID_WABA_CONFIG');
  return cfg;
}

/**
 * Normalize an axios error from a Meta call into a typed error. Split from
 * FlowManagementService._metaError on one point, per the embed-alerting
 * precedent (EmbeddingService, fb1ddd5): an HTTP-level rejection from Meta
 * (expired token, revoked permission, bad payload — err.response present)
 * pages via logger.error; a network-level timeout/unreachable does not — it
 * logs warn, and the CAPILOG# failed row still records it either way.
 */
function _metaError(err, opName) {
  if (err.response?.data) {
    const rawError = err.response.data;
    logger.error(
      `CapiService.${opName}: Meta API error (status ${err.response.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    const metaErr = rawError?.error ?? {};
    return _err(metaErr.error_user_msg || metaErr.message || 'Meta API error', 400, 'META_API_ERROR', rawError);
  }
  logger.warn(`CapiService.${opName}: request failed (no response): ${err.message}`);
  return err;
}

/**
 * Resolve (and lazily provision) the company's Meta dataset. Meta's
 * POST /{waba_id}/dataset is create-or-return — "If there is already an
 * existing dataset_id associated with the Whatsapp Business Account, it will
 * return that ID" — which makes this safe to call any number of times and
 * makes the stored capiDatasetId a pure cache: an OAuth reconnect that
 * rewrites CONFIG#WABA# (full put, dropping the field) simply re-provisions
 * to the SAME dataset on the next event. A manually-written capiDatasetId
 * (the approved fallback when auto-provisioning fails) is honored verbatim
 * by the cache check, no separate code path.
 */
async function _ensureDatasetForCfg(companyId, cfg) {
  if (cfg.capiDatasetId) return { datasetId: cfg.capiDatasetId };

  let res;
  try {
    res = await axios.post(
      `${resolveGraphUrl(cfg)}/${cfg.wabaId}/dataset`,
      {},
      { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: TIMEOUT_MS },
    );
  } catch (err) {
    throw _metaError(err, 'ensureDataset');
  }
  const datasetId = res.data?.id;
  if (!datasetId) throw _err('ensureDataset: Meta returned no dataset id', 502, 'META_NO_DATASET_ID', res.data);

  // Best-effort cache — a targeted SET (not a full put) so it composes with
  // routes/whatsapp.js's full-item writes, and survives PUT /config's
  // {...cfg} spread. If this write fails we still return the datasetId: the
  // event still sends this run, and create-or-return re-resolves next run.
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
      UpdateExpression: 'SET capiDatasetId = :d',
      ExpressionAttributeValues: { ':d': datasetId },
    }).promise();
    // ADR-012's standing rule: any write to CONFIG#WABA#{companyId} invalidates
    // the shared in-process config cache.
    invalidateConfigCache(companyId);
  } catch (e) {
    logger.warn(`CapiService.ensureDataset: capiDatasetId cache write failed for ${companyId}: ${e.message}`);
  }
  return { datasetId };
}

/** Public wrapper — gate + lazy provisioning. Returns { datasetId }. */
async function ensureDataset(companyId) {
  const cfg = await _requireWabaConfig(companyId);
  return _ensureDatasetForCfg(companyId, cfg);
}

// The one place the /events payload is built and POSTed — cfg/datasetId
// already resolved and gated by the caller, inputs already validated.
async function _postEvent(cfg, datasetId, { metaEventName, ctwaClid, eventId, value, currency }) {
  const event = {
    event_name: metaEventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: ACTION_SOURCE,
    messaging_channel: MESSAGING_CHANNEL,
    event_id: eventId,
    user_data: {
      whatsapp_business_account_id: cfg.wabaId,
      ctwa_clid: ctwaClid, // unhashed — Meta: "Do not hash"
    },
  };
  if (typeof value === 'number' && value > 0) {
    event.custom_data = { value, currency: currency || DEFAULT_CURRENCY };
  }

  try {
    const res = await axios.post(
      `${resolveGraphUrl(cfg)}/${datasetId}/events`,
      { data: [event], partner_agent: PARTNER_AGENT },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS },
    );
    return res.data ?? {};
  } catch (err) {
    throw _metaError(err, 'sendConversion');
  }
}

function _validateEventInputs({ metaEventName, ctwaClid, eventId }) {
  if (!SUPPORTED_EVENTS.includes(metaEventName)) {
    throw _err(
      `sendConversion: "${metaEventName}" is not a supported business-messaging event (Meta's fixed list: ${SUPPORTED_EVENTS.join(', ')})`,
      400,
      'UNSUPPORTED_EVENT_NAME',
    );
  }
  if (typeof ctwaClid !== 'string' || !ctwaClid.trim()) throw _err('sendConversion: ctwaClid is required', 400, 'CTWA_CLID_REQUIRED');
  if (typeof eventId !== 'string' || !eventId.trim()) throw _err('sendConversion: eventId is required', 400, 'EVENT_ID_REQUIRED');
}

/**
 * POST one conversion event to the company's dataset. Low-level — callers
 * own dedup (see reportForLead); this method owns the payload contract.
 * Returns Meta's response body (e.g. { events_received: 1, ... }).
 */
async function sendConversion(companyId, { metaEventName, ctwaClid, eventId, value, currency } = {}) {
  _validateEventInputs({ metaEventName, ctwaClid, eventId });
  const cfg = await _requireWabaConfig(companyId);
  const { datasetId } = await _ensureDatasetForCfg(companyId, cfg);
  return _postEvent(cfg, datasetId, { metaEventName, ctwaClid, eventId, value, currency });
}

// Best-effort CAPILOG# row — observability only, must never fail the caller
// (same posture as the PENDINGFLOW# marker write).
async function _writeLog(companyId, { leadId, metaEventName, status, reason, ctwaClidPresent, eventId, value, currency, metaResponse, error }) {
  try {
    const now = new Date();
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: capiLogPK(companyId),
        SK: capiLogSK(now.toISOString(), leadId, metaEventName),
        companyId,
        leadId,
        metaEventName,
        status,
        ...(reason ? { reason } : {}),
        ctwaClidPresent: !!ctwaClidPresent,
        ...(eventId ? { eventId } : {}),
        ...(typeof value === 'number' ? { value, currency } : {}),
        ...(metaResponse !== undefined ? { metaResponse } : {}),
        ...(error ? { error } : {}),
        timestamp: now.toISOString(),
        ttl: Math.floor(now.getTime() / 1000) + CAPI_LOG_TTL_SECONDS,
      },
    }).promise();
  } catch (e) {
    logger.warn(`CapiService: CAPILOG# write failed for ${companyId}/${leadId}: ${e.message}`);
  }
}

/**
 * The meta_signal node's whole business capability: given a freshly-fetched
 * lead item, report its conversion once-ever. Never rejects on Meta/config
 * problems — those come back as status:'failed' with a CAPILOG# row, so the
 * automation node stays best-effort.
 *
 *   skipped — no ctwaClid on the lead (organic — nothing to attribute), or
 *             this lead+event was already reported (claim exists).
 *   sent    — claimed + POSTed + logged.
 *   failed  — logged with the error. Ordering matters here: the config gate
 *             and dataset provisioning run BEFORE the claim, so a pre-claim
 *             failure (WABA disconnected, provisioning error) does NOT burn
 *             the once-ever claim — fixing Settings lets a future fire
 *             report. Only a post-claim /events POST failure is terminal:
 *             the claim is deliberately NOT released (once-ever wins over
 *             auto-retry — ENROLLED#'s "a post-claim failure is deliberately
 *             not retried").
 *
 * eventId is the approved deterministic identity {companyId}:{leadId}:
 * {metaEventName} — carried in the payload for hygiene, while the claim
 * marker (same identity) is what actually guarantees once-ever.
 */
async function reportForLead(companyId, { lead, metaEventName, valueField } = {}) {
  if (!lead?.PK || !lead?.leadId) throw _err('reportForLead: a lead item with PK and leadId is required', 400, 'LEAD_REQUIRED');
  if (!SUPPORTED_EVENTS.includes(metaEventName)) {
    throw _err(`reportForLead: "${metaEventName}" is not a supported business-messaging event`, 400, 'UNSUPPORTED_EVENT_NAME');
  }
  const { leadId } = lead;

  if (typeof lead.ctwaClid !== 'string' || !lead.ctwaClid.trim()) {
    await _writeLog(companyId, { leadId, metaEventName, status: 'skipped', reason: 'no_ctwa_clid', ctwaClidPresent: false });
    return { status: 'skipped', reason: 'no_ctwa_clid' };
  }

  const eventId = `${companyId}:${leadId}:${metaEventName}`;

  // Gate + dataset BEFORE the claim (see docblock — a config failure here
  // must stay retryable on a future fire, so no claim may exist yet).
  let cfg;
  let datasetId;
  try {
    cfg = await _requireWabaConfig(companyId);
    ({ datasetId } = await _ensureDatasetForCfg(companyId, cfg));
  } catch (e) {
    await _writeLog(companyId, { leadId, metaEventName, status: 'failed', ctwaClidPresent: true, eventId, error: e.message });
    return { status: 'failed', error: e.message, eventId };
  }

  // Once-ever claim — written BEFORE the POST (claim-first, at-most-once), so
  // every duplicate-fire path (multi-tag PUT double-fire, remove-then-re-add,
  // concurrent-PUT race, wait-resume replay) collapses to one send.
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: lead.PK,
        SK: capiClaimSK(metaEventName),
        companyId,
        leadId,
        metaEventName,
        eventId,
        claimedAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }).promise();
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException') {
      await _writeLog(companyId, { leadId, metaEventName, status: 'skipped', reason: 'already_reported', ctwaClidPresent: true, eventId });
      return { status: 'skipped', reason: 'already_reported', eventId };
    }
    throw e;
  }

  // Optional conversion value from a named numeric lead field (today the only
  // meaningful one is expectedValue) — absent/non-positive → omitted cleanly.
  let value;
  let currency;
  if (valueField && typeof lead[valueField] === 'number' && lead[valueField] > 0) {
    value = lead[valueField];
    currency = DEFAULT_CURRENCY;
  }

  try {
    const metaResponse = await _postEvent(cfg, datasetId, { metaEventName, ctwaClid: lead.ctwaClid, eventId, value, currency });
    await _writeLog(companyId, { leadId, metaEventName, status: 'sent', ctwaClidPresent: true, eventId, value, currency, metaResponse });
    return { status: 'sent', eventId };
  } catch (e) {
    await _writeLog(companyId, { leadId, metaEventName, status: 'failed', ctwaClidPresent: true, eventId, value, currency, error: e.message });
    return { status: 'failed', error: e.message, eventId };
  }
}

module.exports = {
  SUPPORTED_EVENTS,
  ensureDataset,
  sendConversion,
  reportForLead,
};
