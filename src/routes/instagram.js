'use strict';

/**
 * Instagram DM automation — a dedicated route, deliberately separate from
 * whatsapp.js's /webhook (2026-07-18 validation-pass decision: a dedicated
 * route branching internally on entry.changes vs entry.messaging, not a
 * shared-route object check — avoids the silent-200-no-op gap a shared
 * route would have for a wrong-shaped payload hitting the wrong parser).
 *
 * v1 scope (the "lightweight, no CRM" decision — see
 * docs/bible/19_DECISION_LOG.md Era 54): plain-text DM keyword auto-reply
 * only. Comments/story-reply/story-mention are structurally stubbed here
 * (logged, 200'd, not processed) so the route doesn't need a redesign when
 * those ship in v2. Instagram contacts are IGCONTACT# records
 * (InstagramContactService), never LEAD#/CustomerIdentityService — no
 * pipeline, no assignedTo, no CRM triggers besides keyword_message. v1 is
 * genuinely headless: no dashboard surface reads conversation history yet.
 *
 * Permission family: Instagram API with Instagram Login
 * (instagram_business_basic + instagram_business_manage_messages) — the
 * simpler of the two live families (no linked Facebook Page dependency),
 * matching the reference implementation cross-checked this session. Uses
 * its own INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET — deliberately NOT
 * META_APP_ID/META_APP_SECRET, which are scoped to the Facebook-Login-style
 * WABA Tech Provider app.
 *
 * The /oauth/authorize dialog URL/params below are the standard documented
 * shape for this login family; the token-exchange URLs (short-lived code
 * exchange, then ig_exchange_token → 60-day long-lived token) are confirmed
 * against a real working reference implementation read this session. The
 * authorize step specifically should be smoke-tested against the live Meta
 * App Dashboard config for this app before this goes to production.
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { verifyMetaWebhookSignature } = require('../utils/verifyMetaWebhookSignature');
const { igConfigPK, igConfigSK, igIdConfigPK, igIdConfigSK } = require('../core/entityKeys');
const igGraphApiHelpers = require('../services/igGraphApiHelpers');
const InstagramContactService = require('../services/InstagramContactService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const IG_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN_EXCHANGE = 'https://api.instagram.com/oauth/access_token';
const IG_LONG_LIVED_EXCHANGE = 'https://graph.instagram.com/access_token';
const LONG_LIVED_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days — Meta's documented default, used only if expires_in is absent

// Mirrors whatsapp.js's popupHtml exactly — same postMessage type convention
// (waba_connected/waba_failed → ig_connected/ig_failed), same click-to-close
// button (not auto-close on load).
function popupHtml(success, message) {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html><html><head><title>Instagram ${success ? 'Connected' : 'Failed'}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;}
.box{text-align:center;padding:32px;border-radius:16px;border:2px solid ${color};max-width:360px;}
h2{color:${color};margin:0 0 8px;} p{color:#64748b;margin:0 0 16px;font-size:14px;}
button{background:${color};color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;}</style></head>
<body><div class="box"><div style="font-size:48px">${icon}</div><h2>${success ? 'Connected!' : 'Failed'}</h2>
<p>${message ?? ''}<\p><button onclick="window.opener&&window.opener.postMessage({type:'ig_${success ? 'connected' : 'failed'}',message:'${(message ?? '').replace(/'/g, "\\'")}'},'*');window.close()">
${success ? 'Done — Close Window' : 'Close & Retry'}</button></div></body></html>`;
}

// ── GET /api/instagram/config — connection status (admin only) ────────────────
router.get('/config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await igGraphApiHelpers.getIgConfig(req.user.companyId);
    res.json({
      connected: !!(cfg?.accessToken && cfg?.igBusinessAccountId),
      igUsername: cfg?.igUsername ?? null,
      igBusinessAccountId: cfg?.igBusinessAccountId ?? null,
      connectedAt: cfg?.connectedAt ?? null,
      tokenExpiresAt: cfg?.tokenExpiresAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/instagram/auth/init — start OAuth popup ───────────────────────────
router.get('/auth/init', authMiddleware, checkRole(['admin']), (req, res) => {
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) return res.status(500).json({ error: 'INSTAGRAM_APP_ID not configured' });

  const redirectUri = `${process.env.BACKEND_URL ?? 'http://localhost:3000'}/api/instagram/auth/callback`;
  const state = Buffer.from(JSON.stringify({ companyId: req.user.companyId, userId: req.user.id })).toString('base64');

  const url = new URL(IG_AUTHORIZE);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  // Instagram API with Instagram Login's two documented business-messaging
  // scopes (doc-verified 2026-07-18) — NOT the Facebook-Login-family scope
  // names (instagram_manage_messages/pages_show_list); a genuinely different
  // permission set under this login family.
  url.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_messages');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  res.json({ url: url.toString() });
});

// ── GET /api/instagram/auth/callback — OAuth callback, closes popup ────────────
router.get('/auth/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) return res.send(popupHtml(false, `Meta denied access: ${oauthError}`));
  if (!code || !state) return res.send(popupHtml(false, 'Missing code or state'));

  let companyId, userId;
  try {
    ({ companyId, userId } = JSON.parse(Buffer.from(String(state), 'base64').toString()));
  } catch {
    return res.send(popupHtml(false, 'Invalid state parameter'));
  }

  try {
    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    const redirectUri = `${process.env.BACKEND_URL ?? 'http://localhost:3000'}/api/instagram/auth/callback`;

    // Short-lived token (code exchange)
    const shortRes = await axios.post(IG_TOKEN_EXCHANGE, new URLSearchParams({
      client_id: appId, client_secret: appSecret, grant_type: 'authorization_code',
      redirect_uri: redirectUri, code,
    }));
    const shortToken = shortRes.data?.access_token;
    const igsidSelf = shortRes.data?.user_id;
    if (!shortToken) return res.send(popupHtml(false, 'Instagram did not return an access token'));

    // Upgrade to a long-lived (60-day) token
    const longRes = await axios.get(IG_LONG_LIVED_EXCHANGE, {
      params: { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken },
    });
    const accessToken = longRes.data?.access_token ?? shortToken;
    const expiresInSeconds = longRes.data?.expires_in ?? LONG_LIVED_TTL_SECONDS;

    // Fetch the connected account's own profile (username + confirm the business account id)
    const meRes = await axios.get(`${igGraphApiHelpers.resolveIgGraphUrl()}/me`, {
      params: { fields: 'user_id,username', access_token: accessToken },
    }).catch(() => ({ data: {} }));
    const igBusinessAccountId = meRes.data?.user_id ?? igsidSelf ?? null;
    const igUsername = meRes.data?.username ?? null;

    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: igConfigPK(companyId), SK: igConfigSK(),
        companyId, accessToken, tokenExpiresAt,
        igBusinessAccountId, igUsername,
        connectedBy: userId, connectedAt: now.toISOString(),
      },
    }).promise();

    // Reverse index so the webhook can resolve companyId in O(1) — same
    // idiom as WhatsApp's CONFIG#PHONEID#.
    if (igBusinessAccountId) {
      await dynamodb.put({
        TableName: TABLE,
        Item: { PK: igIdConfigPK(igBusinessAccountId), SK: igIdConfigSK(), companyId },
      }).promise();
    }
    igGraphApiHelpers.invalidateIgConfigCache(companyId);

    res.send(popupHtml(true));
  } catch (err) {
    logger.error('Instagram OAuth callback error', JSON.stringify(err?.response?.data ?? { message: err.message }));
    res.send(popupHtml(false, 'Connection failed — please try again.'));
  }
});

// ── DELETE /api/instagram/connection — disconnect ──────────────────────────────
router.delete('/connection', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const cfg = await igGraphApiHelpers.getIgConfig(companyId);
    await dynamodb.delete({ TableName: TABLE, Key: { PK: igConfigPK(companyId), SK: igConfigSK() } }).promise();
    if (cfg?.igBusinessAccountId) {
      await dynamodb.delete({ TableName: TABLE, Key: { PK: igIdConfigPK(cfg.igBusinessAccountId), SK: igIdConfigSK() } }).promise();
    }
    igGraphApiHelpers.invalidateIgConfigCache(companyId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/instagram/webhook — subscription handshake ────────────────────────
// Dedicated verify token (META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN), deliberately
// not shared with WhatsApp's META_WEBHOOK_VERIFY_TOKEN — decouples the two
// products' webhook subscriptions and lets either be rotated independently.
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).end();
});

// ── POST /api/instagram/webhook — inbound events ────────────────────────────────
router.post('/webhook', async (req, res) => {
  // Instagram DMs are delivered by a SEPARATE Meta app (Instagram Login), so
  // Meta signs them with INSTAGRAM_APP_SECRET — NOT META_APP_SECRET (the
  // WhatsApp/Facebook Tech Provider app). Verifying against the default
  // (WhatsApp) secret rejected every real delivery with 401 (2026-07-18
  // production incident; see verifyMetaWebhookSignature + DECISION_LOG Era 54).
  const sigIg = verifyMetaWebhookSignature(req, process.env.INSTAGRAM_APP_SECRET);
  if (!sigIg) {
    logger.warn('Instagram webhook signature verification failed');
    return res.sendStatus(401);
  }

  try {
    const entry = req.body?.entry?.[0];
    const igBusinessAccountId = entry?.id;

    // Comments arrive under entry.changes[] (WhatsApp-Cloud-API-shaped);
    // DMs/story-events arrive under entry.messaging[] (Messenger-Platform-
    // shaped) — confirmed by direct reference-implementation code read
    // 2026-07-18. v1 stub: logged, not processed, so this branch doesn't
    // need a redesign when comment-to-DM ships in v2.
    if (Array.isArray(entry?.changes)) {
      logger.info(`Instagram webhook: comments field received, deferred (v1 stub), igId=${igBusinessAccountId}`);
      return res.sendStatus(200);
    }

    if (!Array.isArray(entry?.messaging)) {
      return res.sendStatus(200);
    }

    const companyId = igBusinessAccountId
      ? await igGraphApiHelpers.getCompanyByIgBusinessId(igBusinessAccountId)
      : null;
    if (!companyId) {
      logger.warn(`Instagram webhook: no company mapped for igId=${igBusinessAccountId}`);
      return res.sendStatus(200);
    }

    for (const event of entry.messaging) {
      const igsid = event.sender?.id;
      if (!igsid) continue;

      // Echo of an outbound message (message_echo). Meta delivers one for
      // EVERY DM the business sends — including the ones this automation itself
      // sends via InstagramSendService. An echo's sender.id is the BUSINESS
      // account, not a user, and it carries message.text, so without this guard
      // it slips past the empty-text filter below, gets mis-keyed as an inbound
      // from igsid=<our own business id>, and fires keyword_message — which then
      // tries to DM our own account id and gets Meta error 100 / subcode
      // 2534014 "The requested user cannot be found" (2026-07-19 production
      // incident). The outbound message is already persisted by
      // InstagramSendService.recordMessage, so an echo has nothing to do in v1.
      if (event.message?.is_echo) continue;

      // v1 stubs — logged, not processed, structurally ready for v2.
      if (event.message?.reply_to?.story) {
        logger.info(`Instagram webhook: story reply received, deferred (v1 stub), igsid=${igsid}`);
        continue;
      }
      if (event.message?.attachments?.[0]?.type === 'story_mention') {
        logger.info(`Instagram webhook: story mention received, deferred (v1 stub), igsid=${igsid}`);
        continue;
      }

      const messageText = event.message?.text;
      if (typeof messageText !== 'string' || !messageText.trim()) continue; // postbacks/reactions — not v1 (echoes already skipped above)

      // Meta's plain messaging event carries no username (confirmed against
      // the official payload example) — igUsername stays null until a
      // future profile-lookup enhancement; not built in v1.
      const { contact } = await InstagramContactService.resolveOrCreate(companyId, igsid, null);
      await InstagramContactService.recordMessage(companyId, igsid, {
        direction: 'inbound', content: messageText, timestamp: event.timestamp ?? Date.now(), mid: event.message?.mid,
      });

      const { runAutomations } = require('./automations');
      await runAutomations(companyId, 'keyword_message', {
        contactId: igsid, igsid, igUsername: contact.igUsername, messageText, tags: contact.tags ?? [],
      }).catch((e) => logger.warn('Instagram automation error: ' + e.message));
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error('Instagram webhook processing error', err);
    res.sendStatus(200); // Always ACK Meta, even on error — mirrors whatsapp.js's stance
  }
});

module.exports = router;
