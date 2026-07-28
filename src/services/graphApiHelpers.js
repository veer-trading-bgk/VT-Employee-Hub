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
};
