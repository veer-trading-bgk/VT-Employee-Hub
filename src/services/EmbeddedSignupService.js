'use strict';

/**
 * EmbeddedSignupService — orchestrates Meta's WhatsApp Embedded Signup flow
 * (ADR-024): exchanging the authorization code Meta's hosted UI hands back
 * for an access token, then running the same automatic-configuration steps
 * Auto Repair already performs (subscribe webhooks, register phone/PIN, sync
 * business profile, sync templates, health check) against the newly created
 * WABA -- so a brand-new customer never has to press a single "configure"
 * button themselves.
 *
 * Kept separate from graphApiHelpers.js: that module is the shared home for
 * generic, reusable Meta Graph helpers called by all three connect methods
 * (embedded signup, classic OAuth, manual). This file owns orchestration --
 * the step-tracking/resume state machine -- which is specific to Embedded
 * Signup's zero-manual-configuration requirement.
 *
 * There is no automatic "send a test message" step in this pipeline -- it
 * has no destination phone number to send to. Messaging capability is
 * covered by the healthCheck step's own capabilities.messaging/token.valid
 * fields; the already-shipped Send Test Message button (PR 5,
 * POST /send-test) is what a user clicks after onboarding to prove sending
 * end-to-end, per this feature's own acceptance criteria.
 */

const axios = require('axios');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { encrypt } = require('../utils/encryption');
const {
  GRAPH,
  getWabaConfig,
  invalidateConfigCache,
  subscribeWabaWebhooks,
  registerPhoneNumber,
  getBusinessProfile,
  syncTemplatesFromMeta,
  computeHealthSnapshot,
} = require('./graphApiHelpers');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// persistConfig has no runner here -- it's handled specially by
// runOnboardingPipeline (it's what creates the DDB item every other step
// reads back) and is never re-run by resume (the item already exists by the
// time resume is reachable at all).
const STEP_KEYS = ['persistConfig', 'subscribeWebhooks', 'registerPhone', 'syncBusinessProfile', 'syncTemplates', 'healthCheck'];

const STEP_RUNNERS = {
  subscribeWebhooks: async (cfg) => {
    const r = await subscribeWabaWebhooks(cfg);
    return r.subscribed ? { status: 'done' } : { status: 'failed', error: r.error };
  },
  registerPhone: async (cfg) => {
    const r = await registerPhoneNumber(cfg);
    if (r.alreadyRegistered) return { status: 'done', detail: 'already_registered' };
    if (r.skipped) return { status: 'failed', error: r.error };
    return r.registered ? { status: 'done', pinGenerated: r.pin } : { status: 'failed', error: r.error };
  },
  syncBusinessProfile: async (cfg) => {
    const r = await getBusinessProfile(cfg);
    return r.accessible ? { status: 'done' } : { status: 'failed', error: r.error };
  },
  syncTemplates: async (cfg, companyId) => {
    const r = await syncTemplatesFromMeta(cfg, companyId);
    return { status: 'done', synced: r.synced, imported: r.imported };
  },
  healthCheck: async (cfg) => {
    const snapshot = await computeHealthSnapshot(cfg);
    return { status: 'done', issues: snapshot.issues };
  },
};

function emptySteps() {
  return Object.fromEntries(STEP_KEYS.map((k) => [k, { status: 'pending' }]));
}

function markStep(status, key, result) {
  status.steps[key] = { ...result, at: new Date().toISOString() };
}

async function persistOnboardingStatus(companyId, status) {
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
      UpdateExpression: 'SET onboardingStatus = :v',
      ExpressionAttributeValues: { ':v': status },
    }).promise();
  } catch (e) {
    // Best-effort -- a failed status write must not crash the pipeline run
    // itself; the in-memory `status` returned to the caller is still accurate.
    logger.error(`persistOnboardingStatus: failed to persist for company=${companyId}`, e.message);
  }
}

// Runs every STEP_RUNNERS entry not already `done` in status.steps,
// persisting the status to DDB after each one -- this is what makes a
// partial failure safe and resumable: if a step throws, everything before it
// is already durably recorded, and the failing step is marked `failed` with
// its error rather than the whole item being left in an ambiguous state.
// Shared by the initial pipeline run (called after persistConfig succeeds)
// and resumeOnboardingPipeline (which never touches persistConfig at all).
async function runRemainingSteps(companyId, status) {
  for (const key of STEP_KEYS) {
    const run = STEP_RUNNERS[key];
    if (!run) continue; // persistConfig: no entry here, handled by its own caller
    if (status.steps[key]?.status === 'done') continue;
    const cfg = await getWabaConfig(companyId);
    try {
      markStep(status, key, await run(cfg, companyId));
    } catch (e) {
      markStep(status, key, { status: 'failed', error: e.message });
    }
    await persistOnboardingStatus(companyId, status);
  }
  if (STEP_KEYS.every((k) => status.steps[k]?.status === 'done')) {
    status.completedAt = new Date().toISOString();
    await persistOnboardingStatus(companyId, status);
  }
  return status;
}

/** Whether Embedded Signup is usable in this environment (both env vars set). */
function getEmbeddedSignupConfig() {
  const appId = process.env.META_APP_ID;
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
  if (!appId || !configId) return { available: false };
  return {
    available: true,
    appId,
    configId,
    graphApiVersion: process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0',
  };
}

// Exchanges Meta's authorization `code` (returned by FB.login's Embedded
// Signup callback) for an access token.
//
// VERIFY DURING IMPLEMENTATION / BEFORE LIVE TESTING: this mirrors
// /auth/callback's classic-OAuth code exchange (routes/whatsapp.js) as the
// closest existing precedent in this codebase -- neither a redirect_uri
// param nor a long-lived-token exchange hop (grant_type=fb_exchange_token)
// is included here, matching that precedent. Embedded Signup's documented
// behavior may differ from classic OAuth's on either point; confirm against
// Meta's current Embedded Signup docs once a real config_id exists and
// adjust if Meta rejects or mishandles this call.
async function exchangeSignupCode({ code }) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  try {
    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, code },
      timeout: 15000,
    });
    const accessToken = tokenRes.data?.access_token;
    if (!accessToken) throw new Error('Meta did not return an access token');
    return { accessToken };
  } catch (e) {
    // Never log e.config/e.request -- they carry the app secret and the code
    // itself (as sensitive as a token: directly exchangeable for one) in
    // request params. Only e.response.data (Meta's own error body) is safe.
    const rawError = e.response?.data ?? { message: e.message };
    logger.error('exchangeSignupCode: code exchange failed', JSON.stringify(rawError));
    const err = new Error(rawError?.error?.message ?? 'Meta rejected the signup code — it may be expired or already used. Please try connecting again.');
    err.code = 'CODE_EXCHANGE_FAILED';
    err.retryable = false;
    throw err;
  }
}

/**
 * Runs the automatic configuration pipeline for a freshly-signed-up WABA.
 * Step 1 (persistConfig) encrypts and writes the WABA config -- the only
 * setupMethod that does; classic OAuth/manual-connect keep writing plaintext,
 * untouched (see ADR-024). Steps 2-6 each re-read the just-persisted config
 * fresh via getWabaConfig(), exercising the decrypt-on-read path exactly as
 * every other real caller (WhatsAppSendService, health checks, etc.) will.
 */
async function runOnboardingPipeline({ companyId, userId, accessToken, wabaId, phoneNumberId, businessId }) {
  const startedAt = new Date().toISOString();
  const status = { startedAt, completedAt: null, steps: emptySteps() };

  // A phone number can only route webhooks to one company at a time (the
  // CONFIG#PHONEID# reverse index is global, not per-company) -- writing
  // over an existing entry owned by a DIFFERENT company would silently
  // steal that company's inbound messages. This is a pre-existing gap in
  // the classic manual/OAuth connect paths too (neither checks before
  // overwriting), but Embedded Signup is new code in this PR, so it gets
  // the guard: reject outright rather than reproduce the same gap.
  // Reconnecting the SAME company's own existing number is allowed --
  // that's just a legitimate re-run of onboarding.
  try {
    const existing = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#PHONEID#${phoneNumberId}`, SK: 'CURRENT' },
    }).promise();
    if (existing.Item && existing.Item.companyId !== companyId) {
      markStep(status, 'persistConfig', {
        status: 'failed',
        error: 'This phone number is already connected to a different APForce company. Disconnect it there first, or use a different phone number.',
        code: 'DUPLICATE_PHONE_NUMBER',
      });
      return status;
    }
  } catch (e) {
    // A failed pre-check must not silently allow an unsafe write through --
    // fail closed, same as every other step here.
    markStep(status, 'persistConfig', { status: 'failed', error: e.message });
    logger.error(`runOnboardingPipeline: duplicate-phone pre-check failed for company=${companyId}`, e.message);
    return status;
  }

  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#WABA#${companyId}`,
        SK: 'CURRENT',
        companyId,
        accessToken: encrypt(accessToken),
        accessTokenEncrypted: true,
        wabaId,
        phoneNumberId,
        metaBusinessId: businessId ?? null,
        connectedBy: userId,
        connectedAt: startedAt,
        setupMethod: 'embedded_signup',
        onboardingStatus: status,
      },
    }).promise();
    await dynamodb.put({
      TableName: TABLE,
      Item: { PK: `CONFIG#PHONEID#${phoneNumberId}`, SK: 'CURRENT', companyId, phoneNumberId },
    }).promise();
    invalidateConfigCache(companyId);
    markStep(status, 'persistConfig', { status: 'done' });
  } catch (e) {
    // Nothing was persisted -- there is no DDB item yet to attach this status
    // to, so it's only returned to the caller, not written to DDB.
    markStep(status, 'persistConfig', { status: 'failed', error: e.message });
    logger.error(`runOnboardingPipeline: persistConfig failed for company=${companyId}`, e.message);
    return status;
  }
  await persistOnboardingStatus(companyId, status);

  return runRemainingSteps(companyId, status);
}

/**
 * Re-runs only steps not already `done` for a company with an incomplete
 * onboardingStatus -- e.g. the user closed the tab mid-pipeline, or a
 * transient Meta error failed one step. Idempotent no-op if already complete.
 */
async function resumeOnboardingPipeline({ companyId }) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg) {
    const err = new Error('No WhatsApp configuration found for this company — start onboarding from Settings → WhatsApp.');
    err.code = 'NO_CONFIG';
    throw err;
  }
  const status = cfg.onboardingStatus ?? { startedAt: new Date().toISOString(), completedAt: null, steps: emptySteps() };
  if (status.completedAt) return status;

  return runRemainingSteps(companyId, status);
}

module.exports = {
  getEmbeddedSignupConfig,
  exchangeSignupCode,
  runOnboardingPipeline,
  resumeOnboardingPipeline,
};
