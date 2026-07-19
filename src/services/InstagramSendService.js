'use strict';

/**
 * InstagramSendService — the single authoritative engine for outbound
 * Instagram DM sends. Sibling to WhatsAppSendService, not an extension —
 * same relationship as FlowManagementService/CapiService: a different call
 * shape (POST /{ig_business_account_id}/messages, an Instagram Login token)
 * and ADR-012 governs WhatsApp sends only. See ADR-020.
 *
 * v1 scope: plain text only. None of WhatsApp's other send concepts
 * (templates, interactive buttons/lists, media, location, Flows) have a 1:1
 * Instagram equivalent per the 2026-07-18 audit — all deliberately deferred.
 */

const axios = require('axios');
const logger = require('../config/logger');
const InstagramContactService = require('./InstagramContactService');
const igGraphApiHelpers = require('./igGraphApiHelpers');

const TIMEOUT_MS = 15000; // matches FlowManagementService/CapiService's Meta call timeout

function _err(msg, status) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// Always-fresh read (getIgConfig, not getCachedIgConfig) — same choice as
// CapiService/FlowManagementService, not WhatsAppSendService: this isn't a
// broadcast-loop send path (WhatsAppSendService's cache exists specifically
// to avoid N reads per broadcast), so there's no performance case for
// serving a stale token/business-account-id after a reconnect.
async function _requireConfig(companyId) {
  const cfg = await igGraphApiHelpers.getIgConfig(companyId);
  if (!cfg?.accessToken || !cfg?.igBusinessAccountId) {
    throw _err('Instagram not connected for this account. Reconnect via Settings → Instagram.', 400);
  }
  return cfg;
}

function _metaError(err, opName) {
  if (err.response?.data) {
    const rawError = err.response.data;
    logger.error(`InstagramSendService.${opName}: Meta API error (status ${err.response.status ?? 'n/a'})`, JSON.stringify(rawError));
    const metaErr = rawError?.error ?? {};
    return _err(metaErr.error_user_msg || metaErr.message || 'Instagram API error', 400);
  }
  logger.warn(`InstagramSendService.${opName}: request failed (no response): ${err.message}`);
  return err;
}

/**
 * Send a plain-text DM to an Instagram-scoped user (igsid). Stores the
 * outbound message on the recipient's IGCONTACT# conversation history via
 * InstagramContactService.recordMessage — the send service owns writing its
 * own message record, same division of responsibility as
 * WhatsAppSendService._storeMessage.
 */
async function sendText(companyId, igsid, text) {
  if (!igsid) throw _err('sendText: igsid is required', 400);
  if (!text?.trim()) throw _err('sendText: text is required', 400);

  const cfg = await _requireConfig(companyId);

  let res;
  try {
    res = await axios.post(
      `${igGraphApiHelpers.resolveIgGraphUrl()}/${cfg.igBusinessAccountId}/messages`,
      { recipient: { id: igsid }, message: { text } },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS },
    );
  } catch (err) {
    throw _metaError(err, 'sendText');
  }

  const mid = res.data?.message_id ?? null;
  await InstagramContactService.recordMessage(companyId, igsid, {
    direction: 'outbound', content: text, timestamp: Date.now(), mid,
  });

  return { mid };
}

/**
 * Send a private reply to an Instagram comment (Meta "Private Replies"; see
 * ADR-021). Same POST /{ig}/messages endpoint as sendText, but the recipient is
 * a { comment_id }, not an { id: igsid } — the ONLY way to DM a commenter who
 * has never messaged the business (they have no open 24h messaging window).
 *
 * Meta constraints the caller must respect: exactly ONE private reply per
 * comment, ever, and within 7 days of the comment. Enforcing "exactly one" is
 * the caller's job (instagram.js writes a per-comment idempotency claim before
 * calling this) — this method just performs the send.
 *
 * The response's `recipient_id` IS the commenter's canonical IGSID (same
 * namespace as a later inbound DM's sender.id). We resolve/record the contact
 * against THAT, not the comment webhook's from.id, and return it so the Follow
 * Gate can key its reply-wait on it and DM #2 (a normal sendText) can reach the
 * user once they reply.
 */
async function sendPrivateReply(companyId, commentId, text) {
  if (!commentId) throw _err('sendPrivateReply: commentId is required', 400);
  if (!text?.trim()) throw _err('sendPrivateReply: text is required', 400);

  const cfg = await _requireConfig(companyId);

  let res;
  try {
    res = await axios.post(
      `${igGraphApiHelpers.resolveIgGraphUrl()}/${cfg.igBusinessAccountId}/messages`,
      { recipient: { comment_id: commentId }, message: { text } },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS },
    );
  } catch (err) {
    throw _metaError(err, 'sendPrivateReply');
  }

  const mid   = res.data?.message_id ?? null;
  const igsid = res.data?.recipient_id ?? null;

  // Persist against the canonical IGSID from the response. resolveOrCreate first
  // (unlike sendText, whose callers always have a pre-existing contact) because
  // a commenter may have no IGCONTACT# yet — recordMessage's bare lastMessageAt
  // update would otherwise leave a malformed, field-less contact record. The
  // display name is fetched only when this contact is new or currently
  // name-less (never on every reply) — same conditional-fetch rule as the
  // inbound-DM webhook handler; fetchDisplayName never throws, so a lookup
  // failure just leaves the contact name-less rather than blocking the send.
  if (igsid) {
    const existingContact = await InstagramContactService.get(companyId, igsid);
    const displayName = existingContact?.displayName
      ?? await igGraphApiHelpers.fetchDisplayName(companyId, igsid);
    await InstagramContactService.resolveOrCreate(companyId, igsid, displayName);
    await InstagramContactService.recordMessage(companyId, igsid, {
      direction: 'outbound', content: text, timestamp: Date.now(), mid,
    });
  }

  return { mid, igsid };
}

module.exports = { sendText, sendPrivateReply };
