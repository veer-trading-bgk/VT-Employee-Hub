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
const { igConfigPK, igConfigSK, igIdConfigPK, igIdConfigSK, igCommentClaimPK, igCommentClaimSK, igContactPK, igContactSK, igPostPK, igPostMetaSK } = require('../core/entityKeys');
const { dedupPut } = require('../utils/dedupPut');
const { notifyCompany } = require('../utils/wsNotify');
const igGraphApiHelpers = require('../services/igGraphApiHelpers');
const InstagramContactService = require('../services/InstagramContactService');
const AutomationEngine = require('../services/AutomationEngine');

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

// ── GET /api/instagram/media — recent posts/Reels for the comment-automation picker (admin only) ──
// Data source for the future comment_received mediaId picker (ADR-021, v2 is
// backend-only for now). Read-only passthrough to the connected account's own
// media; 400s cleanly on an unconnected account rather than 500ing.
router.get('/media', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await igGraphApiHelpers.getIgConfig(req.user.companyId);
    if (!cfg?.accessToken || !cfg?.igBusinessAccountId) {
      return res.status(400).json({ error: 'Instagram not connected. Reconnect via Settings → Instagram.' });
    }
    const r = await axios.get(`${igGraphApiHelpers.resolveIgGraphUrl()}/${cfg.igBusinessAccountId}/media`, {
      params: {
        fields: 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp',
        limit: 50,
        access_token: cfg.accessToken,
      },
      timeout: 15000,
    });
    res.json({ media: r.data?.data ?? [], paging: r.data?.paging ?? null });
  } catch (err) {
    if (err.response?.data) {
      logger.error('Instagram media list error', JSON.stringify(err.response.data));
      return res.status(400).json({ error: err.response.data?.error?.message ?? 'Failed to fetch Instagram media' });
    }
    next(err);
  }
});

// ── Instagram page read APIs (v3, PR2) — all admin-only, matching every v1 IG
// data route. Multi-tenant safe by construction: the companyId is baked into
// every PK/prefix, so a company can only ever read its own IGCONTACT#/IGPOST#
// partitions. See ADR-022 (interim Scan for the two list views; direct
// PK-Query for the two per-entity views).

// GET /api/instagram/contacts — DM contact list for the Messages tab. Interim
// Scan of this company's IGCONTACT# CURRENT items (ADR-022 D2.1), drained + sorted
// by lastMessageAt (ISO, sorts lexically), paginated in-memory. Each contact
// carries a pendingFollowGate flag from a single AUTO_WAIT#{companyId} read.
router.get('/contacts', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const items = [];
    let lek;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pfx) AND SK = :sk',
        ExpressionAttributeValues: { ':pfx': igContactPK(companyId, ''), ':sk': igContactSK() },
        ...(lek && { ExclusiveStartKey: lek }),
      }).promise();
      items.push(...(r.Items ?? []));
      lek = r.LastEvaluatedKey;
    } while (lek);

    items.sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')));

    const pending = await AutomationEngine.pendingInstagramReplyIgsids(companyId);

    const contacts = items.slice(offset, offset + limit).map((c) => ({
      igsid: c.igsid,
      igUsername: c.igUsername ?? null,
      tags: c.tags ?? [],
      lastMessageAt: c.lastMessageAt ?? null,
      createdAt: c.createdAt ?? null,
      pendingFollowGate: pending.has(c.igsid),
    }));

    res.json({ contacts, total: items.length, hasMore: offset + limit < items.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/instagram/contacts/:igsid/messages — one contact's DM history. Direct
// PK-Query on IGCONTACT#{companyId}#{igsid}, MSG# items only, newest-first then
// reversed to chronological (oldest→newest) for a thread view.
router.get('/contacts/:igsid/messages', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { igsid } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);

    const r = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :msg)',
      ExpressionAttributeValues: { ':pk': igContactPK(companyId, igsid), ':msg': 'MSG#' },
      ScanIndexForward: false, // newest first, so Limit keeps the latest N…
      Limit: limit,
    }).promise();

    const messages = (r.Items ?? []).map((m) => ({
      mid: m.igMid ?? null,
      direction: m.direction,
      content: m.content,
      timestamp: m.timestamp,
      type: m.type ?? 'text',
    })).reverse(); // …then reverse to chronological for display

    res.json({ igsid, messages });
  } catch (err) {
    next(err);
  }
});

// GET /api/instagram/posts — post list for the Comments tab. Interim Scan of this
// company's IGPOST# META summaries (ADR-022 D2.1), sorted by lastCommentAt, each
// carrying the best-effort total/unreplied badge counts.
router.get('/posts', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;

    const items = [];
    let lek;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pfx) AND SK = :sk',
        ExpressionAttributeValues: { ':pfx': igPostPK(companyId, ''), ':sk': igPostMetaSK() },
        ...(lek && { ExclusiveStartKey: lek }),
      }).promise();
      items.push(...(r.Items ?? []));
      lek = r.LastEvaluatedKey;
    } while (lek);

    items.sort((a, b) => String(b.lastCommentAt ?? '').localeCompare(String(a.lastCommentAt ?? '')));

    const posts = items.map((p) => ({
      mediaId: p.mediaId,
      mediaProductType: p.mediaProductType ?? null,
      totalComments: p.totalComments ?? 0,
      unrepliedComments: p.unrepliedComments ?? 0,
      firstCommentAt: p.firstCommentAt ?? null,
      lastCommentAt: p.lastCommentAt ?? null,
    }));

    res.json({ posts });
  } catch (err) {
    next(err);
  }
});

// GET /api/instagram/posts/:mediaId/comments — one post's comments. Direct
// PK-Query on IGPOST#{companyId}#{mediaId}, CMT# items only (the META summary is
// excluded by the begins_with), newest-first.
router.get('/posts/:mediaId/comments', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { mediaId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);

    const r = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :cmt)',
      ExpressionAttributeValues: { ':pk': igPostPK(companyId, mediaId), ':cmt': 'CMT#' },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }).promise();

    const comments = (r.Items ?? []).map((c) => ({
      commentId: c.commentId,
      commenterIgsid: c.commenterIgsid ?? null,
      fromUsername: c.fromUsername ?? null,
      commentText: c.commentText,
      timestamp: c.timestamp,
      replyStatus: c.replyStatus ?? 'unreplied',
      repliedAt: c.repliedAt ?? null,
    }));

    res.json({ mediaId, comments });
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

// ── Comment-to-DM — process one entry.changes[] comment event ──────────────────
// Fires the comment_received trigger for a top-level comment on a targeted post/
// Reel (see ADR-021), and — since ADR-022 — persists the comment as a readable,
// post-grouped record for the Instagram page's Comments tab. Guards, in order:
// shape (id/from/mediaId/text — mediaId is now required: a comment with no post
// can neither be stored post-grouped nor match a mediaId-scoped trigger) →
// self-comment (our own comment must never trigger an auto-reply to ourselves;
// the comment-side analog of the DM is_echo guard) → top-level-only (skip
// parent_id replies-to-comments) → per-comment idempotency claim (Meta retries
// webhooks but allows exactly ONE private reply per comment). The commenter is
// NOT resolved to an IGCONTACT# here — the private-reply send owns that, keyed on
// the response's canonical IGSID (ADR-021 R8).
async function processCommentEvent(companyId, igBusinessAccountId, value) {
  const commentId      = value?.id;
  const commenterIgsid = value?.from?.id;
  const mediaId        = value?.media?.id;
  const commentText    = value?.text;
  if (!commentId || !commenterIgsid || !mediaId || typeof commentText !== 'string' || !commentText.trim()) return;

  if (commenterIgsid === igBusinessAccountId) {
    logger.info(`Instagram webhook: self-comment ${commentId} skipped (from.id is the business account)`);
    return;
  }
  if (value.parent_id) return; // reply-to-comment thread — targets top-level comments only

  const claimed = await dedupPut(dynamodb, TABLE, {
    PK: igCommentClaimPK(companyId, commentId),
    SK: igCommentClaimSK(),
    companyId, commentId, mediaId,
    createdAt: new Date().toISOString(),
    TTL: Math.floor(Date.now() / 1000) + 30 * 86400, // 30-day claim, past Meta's 7-day private-reply deadline
  });
  if (!claimed) {
    logger.info(`Instagram webhook: duplicate comment ${commentId} ignored (already claimed)`);
    return;
  }

  // Persist the comment as a readable, post-grouped record (ADR-022 D1). Gated by
  // the claim above, so once-per-comment. Best-effort: a store failure must never
  // block automation dispatch (the automation still fired). commentTs is the
  // stored sort timestamp, threaded into the automation context so the
  // private-reply node can later flip this same record to 'replied'.
  const commentTs = Date.now();
  const InstagramCommentService = require('../services/InstagramCommentService');
  await InstagramCommentService.recordComment(companyId, {
    mediaId, commentId, commenterIgsid,
    fromUsername: value.from?.username ?? null,
    commentText, timestamp: commentTs,
    mediaProductType: value.media?.media_product_type ?? null,
  }).catch((e) => logger.warn('Instagram comment store failed: ' + e.message));

  // Live push for the Instagram page's Comments tab (PR2). Awaited before the
  // webhook's res.sendStatus(200) so it fires inside this Lambda invocation
  // (same freeze-avoidance reason as whatsapp.js). Best-effort — a WS failure
  // must never block automation dispatch.
  await notifyCompany(companyId, {
    event: 'instagram_comment',
    mediaId, commentId,
    username: value.from?.username ?? null,
    preview: commentText.slice(0, 100),
  }).catch((e) => logger.warn('Instagram comment WS push failed: ' + e.message));

  const { runAutomations } = require('./automations');
  await runAutomations(companyId, 'comment_received', {
    contactId: commenterIgsid, igsid: commenterIgsid, commentId, mediaId, commentTs,
    commentText, igUsername: value.from?.username ?? null, tags: [],
  });
}

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
    // Meta batches webhook deliveries at the entry[] level and explicitly does
    // NOT guarantee batching shape ("batching cannot be guaranteed... handle
    // each Webhook individually" — Instagram Platform Webhooks docs), nor does
    // it document that a single entry's comments (entry.changes[]) and
    // DMs/story-events (entry.messaging[]) are mutually exclusive. So we process
    // EVERY entry, and BOTH branches within each entry independently — never an
    // if/else that returns after comments and silently drops the other half.
    // Company is resolved per entry (a batch can, in principle, span accounts),
    // from entry.id — same phone_number_id→companyId idiom as WhatsApp. Each
    // entry is isolated in its own try so one bad entry never drops its
    // siblings; the handler always ACKs 200 (Meta retries non-200s).
    for (const entry of req.body?.entry ?? []) {
      try {
        const igBusinessAccountId = entry?.id;
        const hasComments  = Array.isArray(entry?.changes);
        const hasMessaging = Array.isArray(entry?.messaging);
        if (!hasComments && !hasMessaging) continue;

        const companyId = igBusinessAccountId
          ? await igGraphApiHelpers.getCompanyByIgBusinessId(igBusinessAccountId)
          : null;
        if (!companyId) {
          logger.warn(`Instagram webhook: no company mapped for igId=${igBusinessAccountId}`);
          continue;
        }

        // Comments (entry.changes[]) — only the comments field is handled in v2;
        // any other changes field is logged and skipped. Each comment is
        // isolated so one failure never drops the rest of the batch.
        if (hasComments) {
          for (const change of entry.changes) {
            if (change?.field !== 'comments') {
              logger.info(`Instagram webhook: non-comments changes field '${change?.field}' received, skipped, igId=${igBusinessAccountId}`);
              continue;
            }
            await processCommentEvent(companyId, igBusinessAccountId, change.value)
              .catch((e) => logger.warn('Instagram comment processing error: ' + e.message));
          }
        }

        // DMs/story-events (entry.messaging[]) — processed independently of the
        // comments branch above, so a delivery carrying both loses neither.
        if (hasMessaging) {
          for (const event of entry.messaging) {
            const igsid = event.sender?.id;
            if (!igsid) continue;

            // Echo of an outbound message (message_echo). Meta delivers one for
            // EVERY DM the business sends — including the ones this automation
            // itself sends via InstagramSendService. An echo's sender.id is the
            // BUSINESS account, not a user, and it carries message.text, so
            // without this guard it slips past the empty-text filter below, gets
            // mis-keyed as an inbound from igsid=<our own business id>, and fires
            // keyword_message — which then tries to DM our own account id and gets
            // Meta error 100 / subcode 2534014 "The requested user cannot be
            // found" (2026-07-19 production incident). The outbound message is
            // already persisted by InstagramSendService.recordMessage, so an echo
            // has nothing to do in v1.
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

            // Live push for the Instagram page's Messages tab (PR2). Fires for
            // every inbound DM — including one that resumes a Follow Gate below —
            // since the message should appear in the thread live regardless.
            // Awaited before the handler's res.sendStatus(200) (Lambda-freeze
            // avoidance); best-effort so a WS failure never blocks processing.
            await notifyCompany(companyId, {
              event: 'instagram_message',
              igsid,
              username: contact.igUsername ?? null,
              preview: messageText.slice(0, 100),
              direction: 'inbound',
            }).catch((e) => logger.warn('Instagram message WS push failed: ' + e.message));

            // A DM that resumes a paused Follow Gate (the user replied to DM #1)
            // is CONSUMED by that gate: it sends DM #2 and must NOT also fire
            // keyword_message (locked v2 decision — mirrors WhatsApp's
            // cancelButtonReplyWaits stance). The inbound was still recorded above.
            const resumed = await AutomationEngine.resumeOnInstagramReply(companyId, igsid)
              .catch((e) => { logger.warn('Instagram follow-gate resume error: ' + e.message); return 0; });
            if (resumed > 0) continue;

            const { runAutomations } = require('./automations');
            await runAutomations(companyId, 'keyword_message', {
              contactId: igsid, igsid, igUsername: contact.igUsername, messageText, tags: contact.tags ?? [],
            }).catch((e) => logger.warn('Instagram automation error: ' + e.message));
          }
        }
      } catch (e) {
        // One entry's failure never drops its siblings. Same log message the
        // outer backstop uses, so observable behavior is identical to v1.
        logger.error('Instagram webhook processing error', e);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error('Instagram webhook processing error', err);
    res.sendStatus(200); // Always ACK Meta, even on error — mirrors whatsapp.js's stance
  }
});

module.exports = router;
