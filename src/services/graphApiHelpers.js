'use strict';

/**
 * graphApiHelpers — shared Meta Graph API config/URL helpers.
 *
 * Single home for logic that was previously duplicated between
 * WhatsAppSendService (_graphUrl/_getConfig) and routes/whatsapp.js
 * (getGraphUrl/getWabaConfig/detectInvalidWabaConfig). Pure extraction:
 * each caller keeps its original semantics —
 *   • getWabaConfig()       — always a fresh DynamoDB read (route semantics)
 *   • getCachedWabaConfig() — 10-min in-process cache (send-loop semantics;
 *                             prevents N uncached DDB reads in broadcast loops)
 * Both read the same CONFIG#WABA#{companyId}/CURRENT item.
 */

const dynamodb = require('../config/dynamodb');
const axios = require('axios');
const crypto = require('crypto');
const logger = require('../config/logger');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0'}`;

function resolveGraphUrl(cfg) {
  return cfg?.graphApiVersion
    ? `https://graph.facebook.com/${cfg.graphApiVersion}`
    : GRAPH;
}

async function getWabaConfig(companyId) {
  const result = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
  }).promise();
  return result.Item ?? null;
}

// In-process WABA config cache — null results are cached too (a company
// without config shouldn't trigger a DDB read per send attempt either).
// Invalidated on disconnect/reconnect via invalidateConfigCache().
const _cfgCache  = new Map(); // companyId → { data, ts }
const CFG_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getCachedWabaConfig(companyId) {
  const hit = _cfgCache.get(companyId);
  if (hit && Date.now() - hit.ts < CFG_TTL_MS) return hit.data;
  const data = await getWabaConfig(companyId);
  _cfgCache.set(companyId, { data, ts: Date.now() });
  return data;
}

/** Call when a company disconnects or reconnects WhatsApp so the cache is refreshed. */
function invalidateConfigCache(companyId) {
  _cfgCache.delete(companyId);
}

// Returns a human-readable issue string if the WABA config is structurally invalid, null if OK.
// Key sentinel: phoneNumberId === wabaId means manual-connect stored the wrong value as the WABA ID.
function detectInvalidWabaConfig(cfg) {
  if (!cfg) return null;
  if (!cfg.wabaId) return 'WABA ID is missing — reconnect via Settings → WhatsApp.';
  if (cfg.phoneNumberId && cfg.wabaId === cfg.phoneNumberId) {
    return 'WABA ID equals Phone Number ID — these must be different identifiers. Go to Settings → WhatsApp → Health Check and click "Repair Config" to auto-fix.';
  }
  return null;
}

// Subscribe the app to receive Meta webhooks (messages/status updates) for a
// WABA. Meta requires this call (POST /{waba-id}/subscribed_apps) separately
// from storing credentials -- without it, inbound messages/status updates
// silently never arrive. Called at connect time from both manual-connect and
// the OAuth callback. Never throws -- a subscribe failure must never fail the
// connect itself, since the WABA config write already succeeded and should stand.
async function subscribeWabaWebhooks(cfg) {
  try {
    const url = `${resolveGraphUrl(cfg)}/${cfg.wabaId}/subscribed_apps`;
    await axios.post(url, null, { params: { access_token: cfg.accessToken }, timeout: 10000 });
    return { subscribed: true };
  } catch (e) {
    // Never log e.config/e.request here -- they carry the raw access_token in
    // the request params. Only e.response.data (Meta's own error body) and
    // e.response.status are safe; neither ever echoes the token back.
    const rawError = e.response?.data ?? { message: e.message };
    logger.error(
      `subscribeWabaWebhooks: failed to subscribe wabaId=${cfg.wabaId} (status ${e.response?.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    return { subscribed: false, error: rawError?.error?.message ?? e.message ?? 'Webhook subscription failed', rawError };
  }
}

// Meta rate-limits /register to 10 calls/72h/number (error 133016 if exceeded).
// Every caller here is human-triggered (connect, edit-config, repair button),
// not a loop, but this cooldown stops a user mashing a button from wasting
// that budget while a transient failure is being retried.
const REGISTER_COOLDOWN_MS = 5 * 60 * 1000;

function generatePin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function markRegisterAttempt(companyId, field, value) {
  if (!companyId) return;
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
      UpdateExpression: `SET ${field} = :v`,
      ExpressionAttributeValues: { ':v': value },
    }).promise();
    invalidateConfigCache(companyId);
  } catch { /* non-fatal -- the register call itself already succeeded/failed independently */ }
}

// Completes the Cloud API registration handshake (POST /{phone-number-id}/register),
// which also sets the two-step-verification PIN. Cloud API messaging works without
// ever calling this, but WhatsApp Manager's 2FA toggle -- and full Cloud API
// "registered" status -- requires it; skipping it produces "Account does not exist
// in Cloud API" (found live 2026-07-28, WABA 1024855430389913). Never calls
// /register if is_pin_enabled is already true -- required by Meta's 10-calls/72h
// rate limit and by explicit product requirement (never re-register an
// already-registered number). The generated PIN is returned once, never stored --
// only the fact that registration happened (pinRegisteredAt) is persisted.
async function registerPhoneNumber(cfg) {
  const graph = resolveGraphUrl(cfg);
  try {
    const pinRes = await axios.get(`${graph}/${cfg.phoneNumberId}`, {
      params: { fields: 'is_pin_enabled', access_token: cfg.accessToken },
      timeout: 10000,
    });
    if (pinRes.data?.is_pin_enabled) return { alreadyRegistered: true, registered: false };
  } catch (e) {
    const rawError = e.response?.data ?? { message: e.message };
    logger.error(
      `registerPhoneNumber: is_pin_enabled check failed for phoneNumberId=${cfg.phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    return { alreadyRegistered: false, registered: false, error: rawError?.error?.message ?? e.message ?? 'Could not check registration status' };
  }

  if (cfg.lastRegisterAttemptAt && Date.now() - new Date(cfg.lastRegisterAttemptAt).getTime() < REGISTER_COOLDOWN_MS) {
    return { alreadyRegistered: false, registered: false, skipped: true, error: 'A registration attempt was made in the last 5 minutes — please wait before retrying.' };
  }

  const now = new Date().toISOString();
  await markRegisterAttempt(cfg.companyId, 'lastRegisterAttemptAt', now);

  const pin = generatePin();
  try {
    await axios.post(
      `${graph}/${cfg.phoneNumberId}/register`,
      { messaging_product: 'whatsapp', pin },
      { headers: { 'Content-Type': 'application/json' }, params: { access_token: cfg.accessToken }, timeout: 15000 },
    );
    await markRegisterAttempt(cfg.companyId, 'pinRegisteredAt', now);
    return { alreadyRegistered: false, registered: true, pin };
  } catch (e) {
    // Never log e.config/e.request -- they carry the raw access_token and the
    // PIN itself in the request params/body. Only e.response.data is safe.
    const rawError = e.response?.data ?? { message: e.message };
    logger.error(
      `registerPhoneNumber: /register failed for phoneNumberId=${cfg.phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    return { alreadyRegistered: false, registered: false, error: rawError?.error?.message ?? e.message ?? 'Registration failed', rawError };
  }
}

// Read-only pull of the WhatsApp Business Profile (about/address/description/
// email/websites/vertical/profile picture). This is a Graph API *connection*,
// not a flat node -- responses come back as {data: [{...}]}, one element,
// unlike the phone-number-id node's flat object shape (verified live against
// a real WABA, 2026-07-28). Fields Meta has never had set are simply absent
// from the response rather than null, so every field is defaulted here.
async function getBusinessProfile(cfg) {
  try {
    const res = await axios.get(`${resolveGraphUrl(cfg)}/${cfg.phoneNumberId}/whatsapp_business_profile`, {
      params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical', access_token: cfg.accessToken },
      timeout: 10000,
    });
    const p = res.data?.data?.[0] ?? {};
    return {
      accessible: true,
      about: p.about ?? null,
      address: p.address ?? null,
      description: p.description ?? null,
      email: p.email ?? null,
      profilePictureUrl: p.profile_picture_url ?? null,
      websites: p.websites ?? [],
      vertical: p.vertical ?? null,
    };
  } catch (e) {
    const rawError = e.response?.data ?? { message: e.message };
    logger.error(
      `getBusinessProfile: failed for phoneNumberId=${cfg.phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    return {
      accessible: false, about: null, address: null, description: null, email: null,
      profilePictureUrl: null, websites: [], vertical: null,
      error: rawError?.error?.message ?? e.message ?? 'Could not read business profile',
    };
  }
}

// Pushes a partial set of Business Profile fields to Meta. `fields` should
// already be validated by the caller (route-level, against Meta's documented
// per-field constraints) -- this just performs the write and reports the
// outcome, same shape as every other write helper here.
async function updateBusinessProfile(cfg, fields) {
  try {
    await axios.post(
      `${resolveGraphUrl(cfg)}/${cfg.phoneNumberId}/whatsapp_business_profile`,
      { messaging_product: 'whatsapp', ...fields },
      { headers: { 'Content-Type': 'application/json' }, params: { access_token: cfg.accessToken }, timeout: 15000 },
    );
    return { updated: true };
  } catch (e) {
    const rawError = e.response?.data ?? { message: e.message };
    logger.error(
      `updateBusinessProfile: failed for phoneNumberId=${cfg.phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    return { updated: false, error: rawError?.error?.message ?? e.message ?? 'Profile update failed', rawError };
  }
}

// Uploads a new profile photo via Meta's Resumable Upload API (verified
// against Meta's own docs, 2026-07-28 -- easy to get wrong, two gotchas):
//  1. The session id Meta returns from step 1 already includes the
//     "upload:" prefix (e.g. "upload:ABC123") -- used as-is as the next
//     URL's path segment, never re-prefixed.
//  2. Step 2's auth is a header, "Authorization: OAuth <token>" -- NOT the
//     query-string access_token convention every other call in this file
//     uses, and NOT a Bearer scheme.
// Requires META_APP_ID (the session-start endpoint is scoped to an app id,
// not a WABA/phone id).
async function uploadProfilePhoto(cfg, buffer, mimeType, filename) {
  const appId = process.env.META_APP_ID;
  if (!appId) return { uploaded: false, error: 'META_APP_ID is not configured — required for photo upload.' };
  const graph = resolveGraphUrl(cfg);

  try {
    const sessionRes = await axios.post(`${graph}/${appId}/uploads`, null, {
      params: { file_name: filename ?? 'profile-photo', file_length: buffer.length, file_type: mimeType, access_token: cfg.accessToken },
      timeout: 15000,
    });
    const sessionId = sessionRes.data?.id;
    if (!sessionId) return { uploaded: false, error: 'Meta did not return an upload session id.' };

    const uploadRes = await axios.post(`${graph}/${sessionId}`, buffer, {
      headers: { Authorization: `OAuth ${cfg.accessToken}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const handle = uploadRes.data?.h;
    if (!handle) return { uploaded: false, error: 'Meta did not return a file handle.' };

    return updateBusinessProfile(cfg, { profile_picture_handle: handle }).then((r) =>
      r.updated ? { uploaded: true } : { uploaded: false, error: r.error, rawError: r.rawError },
    );
  } catch (e) {
    // Never log e.config/e.request -- step 2 carries the raw access_token in
    // an Authorization header, not even in params this time.
    const rawError = e.response?.data ?? { message: e.message };
    logger.error(
      `uploadProfilePhoto: failed for phoneNumberId=${cfg.phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
      JSON.stringify(rawError),
    );
    return { uploaded: false, error: rawError?.error?.message ?? e.message ?? 'Photo upload failed', rawError };
  }
}

// Compute a plain-English root cause from health-check state (shown in UI and logs).
// Moved here from routes/whatsapp.js, 2026-07-28, so computeHealthSnapshot (and
// autoRepair, which needs the same snapshot) can share one implementation
// instead of the route and the repair orchestrator each computing it differently.
function computeRootCause(cfg, token, waba, webhooks, pin) {
  if (!cfg) return 'No WhatsApp configuration stored. Connect via Settings → WhatsApp.';
  if (!cfg.configValid) {
    if (cfg.wabaId && cfg.phoneNumberId && cfg.wabaId === cfg.phoneNumberId) {
      if (!waba?.accessible) {
        return 'The WABA ID stored during initial setup equals the Phone Number ID — a known bug in the original connection code. Auto-repair requires the whatsapp_business_management permission, which the stored token does not have. Either grant that permission to your System User and regenerate the token, or enter your WABA ID manually using the field in the repair section.';
      }
      return 'The WABA ID stored during initial setup equals the Phone Number ID. Click "Repair Config Automatically" to correct it, or enter your WABA ID manually.';
    }
    if (!cfg.wabaId) return 'No WABA ID is stored. Reconnect via Settings → WhatsApp.';
  }
  if (token && token.valid === false) {
    return 'The stored access token is invalid or expired. Generate a new permanent token in Meta Business Suite → System Users → Generate Token.';
  }
  if (token?.valid && !waba?.accessible) {
    const scopesMissing = token.scopes?.length > 0 && !token.scopes.includes('whatsapp_business_management');
    const scopesUnknown = !token.scopes?.length;
    if (scopesMissing || scopesUnknown) {
      return 'The access token does not have the whatsapp_business_management permission. This permission is required for template management and WABA configuration. Messaging works without it (whatsapp_business_messaging is present), but templates will fail until this permission is granted.';
    }
    return 'The stored WABA ID is not accessible from Meta — it may be incorrect or your account may have changed.';
  }
  if (webhooks && webhooks.subscribed === false) {
    return 'This WABA is not subscribed to receive Meta webhooks — inbound messages and status updates will not arrive. Click "Auto Repair" to subscribe automatically.';
  }
  if (pin && pin.enabled === false) {
    return 'Two-step verification has not been set up for this number — Meta\'s Cloud API registration handshake was never completed. This also blocks the Two-Step Verification toggle in WhatsApp Manager ("Account does not exist in Cloud API"). Click "Auto Repair" to complete it automatically.';
  }
  return null;
}

// Compute ordered remediation steps for the UI "Recommended Fix" section.
function computeRecommendedFix(cfg, token, waba, webhooks, pin) {
  if (!cfg) return ['Connect WhatsApp via Settings → WhatsApp.'];
  if (!cfg.configValid && cfg.wabaId === cfg.phoneNumberId) {
    if (!waba?.accessible) {
      return [
        'In Meta Business Suite → System Users: select your system user → Edit → Add Permissions → enable whatsapp_business_management.',
        'After adding the permission, generate a new permanent access token for this system user.',
        'In APForce: Settings → WhatsApp → Disconnect, then reconnect. Your WABA ID will be auto-detected with the new token.',
        'If you prefer not to change the token now: find your WABA ID in Meta Business Suite → WhatsApp Accounts (15–16 digit number next to your account name, different from the Phone Number ID in API Setup) and use "Apply Manual Override" in the repair section.',
      ];
    }
    return ['Click "Repair Config Automatically" to auto-detect and correct your WABA ID.'];
  }
  if (token && token.valid === false) {
    return [
      'In Meta Business Suite → System Users: select your system user → Generate New Token.',
      'Ensure both whatsapp_business_messaging AND whatsapp_business_management are enabled for the system user.',
      'In APForce: Settings → WhatsApp → Disconnect, then reconnect with the new token.',
    ];
  }
  if (token?.valid && !waba?.accessible) {
    return [
      'Verify your WABA ID is correct in Meta Business Suite → WhatsApp Accounts.',
      'If your token lacks whatsapp_business_management: Meta Business Suite → System Users → Edit → Add Permissions.',
    ];
  }
  if (webhooks && webhooks.subscribed === false) {
    return ['Click "Auto Repair" (or re-save your WhatsApp config) to subscribe to Meta webhooks automatically.'];
  }
  if (pin && pin.enabled === false) {
    return ['Click "Auto Repair" (or re-save your WhatsApp config) to complete Cloud API registration and set a two-step-verification PIN automatically.'];
  }
  return [];
}

// Computes the full WABA health diagnostic: config validity, token, phone,
// WABA, webhook subscription, PIN/registration status, business profile, and
// derived capabilities/root-cause/recommended-fix. Single implementation
// shared by GET /connection/health and autoRepair() (which needs the exact
// same before/after picture) -- extracted 2026-07-28 so the two never drift.
async function computeHealthSnapshot(cfg) {
  const graphApiVersion = cfg?.graphApiVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0';

  if (!cfg) {
    return {
      connected: false, graphApiVersion,
      config: null, token: null, waba: null, phone: null, webhooks: null, pin: null, profile: null, capabilities: null,
      issues: ['No WABA configuration — connect via Settings → WhatsApp.'],
      rootCause: 'No WhatsApp configuration stored. Connect via Settings → WhatsApp.',
      recommendedFix: ['Connect WhatsApp via Settings → WhatsApp.'],
    };
  }

  const graph = resolveGraphUrl(cfg);
  const configIssue = detectInvalidWabaConfig(cfg);
  const config = {
    wabaId: cfg.wabaId ?? null,
    phoneNumberId: cfg.phoneNumberId ?? null,
    displayNumber: cfg.phoneNumber ?? null,
    connectedAt: cfg.connectedAt ?? null,
    setupMethod: cfg.setupMethod ?? 'oauth',
    configValid: !configIssue,
    ...(configIssue && { configIssue }),
  };
  const issues = configIssue ? [configIssue] : [];

  // ── Token validity ───────────────────────────────────────────────────────
  let token = { valid: false, scopes: [], scopesConfirmed: false, type: null, appId: null, expiresAt: null };
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (cfg.accessToken) {
    try {
      if (appId && appSecret) {
        const debugRes = await axios.get(`${graph}/debug_token`, {
          params: { input_token: cfg.accessToken, access_token: `${appId}|${appSecret}` },
          timeout: 10000,
        });
        const d = debugRes.data?.data ?? {};
        token = {
          valid: d.is_valid ?? false,
          scopes: d.scopes ?? [],
          scopesConfirmed: true,
          type: d.type ?? null,
          appId: String(d.app_id ?? appId ?? ''),
          expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
        };
      } else {
        const meRes = await axios.get(`${graph}/me`, {
          params: { fields: 'id,name', access_token: cfg.accessToken },
          timeout: 10000,
        });
        token = { valid: !!meRes.data?.id, scopes: [], scopesConfirmed: false, type: null, appId: appId ?? null, expiresAt: null };
      }
      if (!token.valid) issues.push('Access token is invalid or expired.');
    } catch {
      issues.push('Access token validation failed — token may be expired or revoked.');
    }
  } else {
    issues.push('No access token stored.');
  }

  // ── Phone number check ───────────────────────────────────────────────────
  let phone = { accessible: false, id: cfg.phoneNumberId, displayNumber: cfg.phoneNumber, verifiedName: null, qualityRating: null, verificationStatus: null, status: null };
  let pin = { enabled: false, registeredAt: cfg.pinRegisteredAt ?? null };
  if (cfg.phoneNumberId && cfg.accessToken) {
    try {
      const phoneRes = await axios.get(`${graph}/${cfg.phoneNumberId}`, {
        params: { fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,is_pin_enabled', access_token: cfg.accessToken },
        timeout: 10000,
      });
      const p = phoneRes.data ?? {};
      phone = {
        accessible: true, id: p.id ?? cfg.phoneNumberId,
        displayNumber: p.display_phone_number ?? cfg.phoneNumber,
        verifiedName: p.verified_name ?? null,
        qualityRating: p.quality_rating ?? null,
        verificationStatus: p.code_verification_status ?? null,
        status: p.name_status ?? null,
      };
      pin = { enabled: p.is_pin_enabled ?? false, registeredAt: cfg.pinRegisteredAt ?? null };
      if (!pin.enabled) issues.push('Two-step verification PIN is not set — Cloud API registration is incomplete.');
    } catch {
      issues.push('Phone Number ID is inaccessible — check token permissions (whatsapp_business_messaging).');
    }
  }

  // ── Business profile (best-effort, non-fatal) ───────────────────────────
  let profile = { accessible: false, about: null, address: null, description: null, email: null, profilePictureUrl: null, websites: [], vertical: null };
  if (phone.accessible) {
    profile = await getBusinessProfile(cfg);
  }

  // ── WABA check (skip if config is known-invalid) ────────────────────────
  let waba = { accessible: false, id: cfg.wabaId, name: null, reviewStatus: null, currency: null, templateNamespace: null, businessId: null };
  let webhooks = { subscribed: false, appId: null };
  if (cfg.wabaId && cfg.accessToken && !configIssue) {
    try {
      const wabaRes = await axios.get(`${graph}/${cfg.wabaId}`, {
        params: { fields: 'id,name,account_review_status,currency,message_template_namespace,on_behalf_of_business_info', access_token: cfg.accessToken },
        timeout: 10000,
      });
      const w = wabaRes.data ?? {};
      waba = {
        accessible: true, id: w.id ?? cfg.wabaId,
        name: w.name ?? null,
        reviewStatus: w.account_review_status ?? null,
        currency: w.currency ?? null,
        templateNamespace: w.message_template_namespace ?? null,
        businessId: w.on_behalf_of_business_info?.id ?? null,
      };
      try {
        const whRes = await axios.get(`${graph}/${cfg.wabaId}/subscribed_apps`, {
          params: { access_token: cfg.accessToken },
          timeout: 8000,
        });
        const apps = whRes.data?.data ?? [];
        webhooks = { subscribed: apps.length > 0, appId: apps[0]?.id ?? null };
        // Previously only reflected in rootCause/recommendedFix, never in the
        // flat `issues` list -- meant autoRepair's remainingIssues (= after.issues)
        // could silently omit a still-broken webhook subscription. Found while
        // building PR 4, 2026-07-28.
        if (!webhooks.subscribed) issues.push('WABA is not subscribed to receive Meta webhooks — inbound messages and status updates will not arrive.');
      } catch { /* non-fatal: webhooks check is best-effort */ }
    } catch {
      issues.push('WABA ID is inaccessible — the ID may be incorrect or the token lacks whatsapp_business_management permission.');
    }
  } else if (configIssue) {
    issues.push('WABA check skipped — configuration is invalid (WABA ID equals Phone Number ID).');
  }

  if (!token.scopesConfirmed) {
    if (waba.accessible) {
      token.scopes = ['whatsapp_business_messaging (inferred)', 'whatsapp_business_management (inferred)'];
    } else if (phone.accessible) {
      token.scopes = ['whatsapp_business_messaging (inferred)'];
      issues.push('Token likely lacks whatsapp_business_management — WABA is inaccessible while Phone is accessible. Set META_APP_ID and META_APP_SECRET in Lambda env vars to confirm exact scopes.');
    }
  }

  const capabilities = {
    messaging: phone.accessible && token.valid,
    templates: waba.accessible && token.valid && !configIssue,
    webhooks: webhooks.subscribed,
    mediaUpload: phone.accessible && token.valid,
  };

  return {
    connected: true, graphApiVersion,
    config, token, waba, phone, webhooks, pin, profile, capabilities,
    issues: [...new Set(issues)],
    rootCause: computeRootCause(config, token, waba, webhooks, pin),
    recommendedFix: computeRecommendedFix(config, token, waba, webhooks, pin),
  };
}

// Structured, secret-free audit line for every repair action autoRepair takes
// (requirement: log every repair action -- timestamp/companyId/action/result/
// duration -- never tokens/PINs/secrets). logger.info, not .error: most
// outcomes here are routine (fixed/already-healthy), not incidents; the
// underlying helpers (subscribeWabaWebhooks/registerPhoneNumber) already
// logger.error their own Meta failures with full redacted detail.
function logRepairAction(companyId, action, result, durationMs) {
  logger.info(`autoRepair: company=${companyId} action=${action} result=${result} durationMs=${durationMs}`);
}

// Repair actions autoRepair can take -- each only runs if isHealthy() says no
// and canRepair() says the prerequisite for attempting it is met. Order
// matters only for readability here; each is independent (subscribing
// webhooks doesn't depend on PIN state or vice versa).
const REPAIR_CHECKS = [
  {
    key: 'webhooks',
    label: 'Subscribe webhook',
    isHealthy: (before) => before.webhooks?.subscribed === true,
    canRepair: (before) => before.waba?.accessible === true,
    repair: async (cfg) => {
      const r = await subscribeWabaWebhooks(cfg);
      return r.subscribed
        ? { status: 'fixed', detail: 'Subscribed to Meta webhooks.' }
        : { status: 'failed', detail: r.error };
    },
  },
  {
    key: 'pin',
    label: 'Register Cloud API & enable PIN',
    isHealthy: (before) => before.pin?.enabled === true,
    canRepair: (before) => before.phone?.accessible === true,
    repair: async (cfg) => {
      const r = await registerPhoneNumber(cfg);
      if (r.alreadyRegistered) return { status: 'skipped', reason: 'already_healthy', detail: 'Already registered.' };
      if (r.skipped) return { status: 'skipped', reason: 'cooldown_active', detail: r.error };
      return r.registered
        ? { status: 'fixed', detail: 'Cloud API registration completed and two-step PIN set.' }
        : { status: 'failed', detail: r.error };
    },
  },
];

// Read-only checks with no corresponding write action -- reported as
// "already healthy" when passing; when failing, they're already reflected in
// the snapshot's own `issues` array (surfaced via `remainingIssues` in the
// repair report), not duplicated into a separate taxonomy here.
const READONLY_CHECKS = [
  { key: 'token', label: 'Access token', isHealthy: (before) => before.token?.valid === true },
  { key: 'waba', label: 'WABA access', isHealthy: (before) => before.waba?.accessible === true },
  { key: 'phone', label: 'Phone access', isHealthy: (before) => before.phone?.accessible === true },
  { key: 'messaging', label: 'Messaging capability', isHealthy: (before) => before.capabilities?.messaging === true },
  { key: 'templates', label: 'Templates capability', isHealthy: (before) => before.capabilities?.templates === true },
  { key: 'mediaUpload', label: 'Media upload capability', isHealthy: (before) => before.capabilities?.mediaUpload === true },
];

// Detects and repairs only what's actually broken. Never touches anything
// already healthy (each repair action gates on isHealthy() first, computed
// from a fresh health snapshot) -- running this twice on an already-healthy
// account makes zero Meta write calls the second time. Never destructive:
// the only writes possible are subscribeWabaWebhooks (idempotent per Meta)
// and registerPhoneNumber (which itself refuses to re-register an
// already-registered number). Business profile content is never auto-edited
// here -- that's a human decision (PR 3's endpoints exist for it), so
// "Refresh Business Profile" means re-reading current data, not changing it.
async function autoRepair(cfg) {
  const startedAt = Date.now();
  const before = await computeHealthSnapshot(cfg);

  if (!before.connected) {
    return {
      success: true,
      before, repairPlan: [], executed: [], skipped: [], after: before,
      remainingIssues: before.issues,
      summary: { fixed: 0, failed: 0, alreadyHealthy: 0, otherSkipped: 0 },
      durationMs: Date.now() - startedAt,
    };
  }

  const repairPlan = [];
  const executed = [];
  const skipped = [];

  for (const check of REPAIR_CHECKS) {
    if (check.isHealthy(before)) {
      skipped.push({ action: check.key, label: check.label, reason: 'already_healthy' });
      logRepairAction(cfg.companyId, check.key, 'already_healthy', 0);
    } else if (!check.canRepair(before)) {
      skipped.push({ action: check.key, label: check.label, reason: 'prerequisite_not_met' });
      logRepairAction(cfg.companyId, check.key, 'prerequisite_not_met', 0);
    } else {
      repairPlan.push({ action: check.key, label: check.label });
    }
  }

  for (const check of REPAIR_CHECKS) {
    if (!repairPlan.some((p) => p.action === check.key)) continue;
    const stepStart = Date.now();
    let result;
    try {
      result = await check.repair(cfg);
    } catch (e) {
      result = { status: 'failed', detail: e.message ?? 'Unexpected error' };
    }
    const durationMs = Date.now() - stepStart;
    logRepairAction(cfg.companyId, check.key, result.status, durationMs);
    if (result.status === 'skipped') {
      skipped.push({ action: check.key, label: check.label, reason: result.reason, detail: result.detail });
    } else {
      executed.push({ action: check.key, label: check.label, status: result.status, detail: result.detail, durationMs });
    }
  }

  for (const check of READONLY_CHECKS) {
    if (check.isHealthy(before)) {
      skipped.push({ action: check.key, label: check.label, reason: 'already_healthy' });
    }
  }

  // Profile refresh is read-only (no field/photo is ever auto-edited) -- the
  // `after` snapshot below already re-reads it, so this is a reporting entry,
  // not a second API call.
  executed.push({ action: 'refresh_profile', label: 'Refresh business profile', status: 'fixed', detail: 'Profile data refreshed from Meta.', durationMs: 0 });

  const after = await computeHealthSnapshot(cfg);

  const summary = {
    fixed: executed.filter((e) => e.status === 'fixed').length,
    failed: executed.filter((e) => e.status === 'failed').length,
    alreadyHealthy: skipped.filter((s) => s.reason === 'already_healthy').length,
    otherSkipped: skipped.filter((s) => s.reason !== 'already_healthy').length,
  };

  return {
    success: true,
    before, repairPlan, executed, skipped, after,
    remainingIssues: after.issues,
    summary,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  GRAPH,
  resolveGraphUrl,
  getWabaConfig,
  getCachedWabaConfig,
  invalidateConfigCache,
  detectInvalidWabaConfig,
  subscribeWabaWebhooks,
  registerPhoneNumber,
  getBusinessProfile,
  updateBusinessProfile,
  uploadProfilePhoto,
  computeHealthSnapshot,
  autoRepair,
};
