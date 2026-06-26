const express = require('express');
const { dedupPut } = require('../utils/dedupPut');
const axios = require('axios');
const S3 = require('aws-sdk/clients/s3');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = 'https://graph.facebook.com/v19.0';
const MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET ?? '';
const s3Client = new S3({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Meta-supported MIME types
const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','video/3gpp',
  'audio/mpeg','audio/ogg','audio/aac','audio/mp4','audio/amr',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','text/csv',
]);

// Meta per-type upload limits
const META_SIZE_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

function mediaTypeFromMime(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

// ── Per-company WABA credentials ───────────────────────────────────────────────
async function getWabaConfig(companyId) {
  const result = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
  }).promise();
  return result.Item ?? null;
}

// Cache last message on lead METADATA for inbox listing
async function updateLeadLastMessage(pk, content, direction, ts) {
  try {
    let expr = 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir';
    const vals = { ':ts': ts, ':prev': String(content).slice(0, 100), ':dir': direction };
    if (direction === 'inbound') {
      expr += ', lastInboundAt = :ts';
      // Increment unread counter — cleared when agent opens the conversation
      expr += ', unreadCount = if_not_exists(unreadCount, :zero) + :one';
      vals[':zero'] = 0;
      vals[':one'] = 1;
    }
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: pk, SK: 'METADATA' },
      UpdateExpression: expr,
      ExpressionAttributeValues: vals,
    }).promise();
    // Bump company-level activity timestamp so /inbox/ping can detect new messages in O(1)
    const cid = pk.split('#')[1]; // LEAD#companyId#leadId
    if (cid) {
      dynamodb.update({
        TableName: TABLE,
        Key: { PK: `ACTIVITY#${cid}`, SK: 'WA' },
        UpdateExpression: 'SET lastActivityAt = :ts',
        ExpressionAttributeValues: { ':ts': ts },
      }).promise().catch(() => {});
    }
  } catch (e) {
    logger.warn('updateLeadLastMessage failed', e.message);
  }
}

// FIX 7: In-memory cache + DDB reverse-index to avoid full table scan on every webhook message.
// When a company connects WABA, a CONFIG#PHONEID# item is also written (see callbacks below).
// Lookup order: memory cache → DDB reverse-index → full scan fallback (old data migration).
const _phoneIdCache = new Map(); // phoneNumberId → { companyId, data, ts }
const PHONEID_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getCompanyByPhoneNumberId(phoneNumberId) {
  // 1. memory cache
  const cached = _phoneIdCache.get(phoneNumberId);
  if (cached && Date.now() - cached.ts < PHONEID_CACHE_TTL) return cached.data;

  // 2. O(1) DDB reverse-index lookup
  const fast = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#PHONEID#${phoneNumberId}`, SK: 'CURRENT' },
  }).promise();

  if (fast.Item) {
    // The reverse-index stores { companyId }; fetch the full WABA config for that company
    const full = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${fast.Item.companyId}`, SK: 'CURRENT' },
    }).promise();
    const result = full.Item ?? null;
    _phoneIdCache.set(phoneNumberId, { ts: Date.now(), data: result });
    return result;
  }

  // 3. Fallback full scan (for data written before Fix 7 went live)
  logger.warn(`getCompanyByPhoneNumberId: no reverse-index for ${phoneNumberId} — falling back to full scan`);
  const items = [];
  let lastKey;
  do {
    const result = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND phoneNumberId = :pid',
      ExpressionAttributeValues: { ':prefix': 'CONFIG#WABA#', ':sk': 'CURRENT', ':pid': phoneNumberId },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const found = items[0] ?? null;
  if (found) {
    // Write the reverse-index so next call is fast
    dynamodb.put({
      TableName: TABLE,
      Item: { PK: `CONFIG#PHONEID#${phoneNumberId}`, SK: 'CURRENT', companyId: found.companyId, phoneNumberId },
    }).promise().catch(() => {});
    _phoneIdCache.set(phoneNumberId, { ts: Date.now(), data: found });
  }
  return found;
}

function invalidatePhoneIdCache(phoneNumberId) {
  _phoneIdCache.delete(phoneNumberId);
}

// Strip non-digits and ensure Indian numbers have country code for Meta E.164
function toE164(p) {
  const d = String(p).replace(/\D/g, '');
  if (d.length === 10) return '91' + d;           // 9901251785  → 919901251785
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1); // 09901251785 → 919901251785
  return d;
}

// Normalize Meta E.164 to 10-digit for matching against stored leads
function to10Digit(p) {
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  return d;
}

async function sendTextMessage(companyId, to, body, replyToWaMessageId = null) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) {
    logger.warn(`WhatsApp not configured for company ${companyId}`);
    return null;
  }
  const phone = toE164(to);
  try {
    const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body } };
    if (replyToWaMessageId) payload.context = { message_id: replyToWaMessageId };
    const res = await axios.post(
      `${GRAPH}/${cfg.phoneNumberId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    logger.error('WhatsApp sendTextMessage failed', err?.response?.data ?? err.message);
    throw err;
  }
}

async function sendTemplateMessage(companyId, to, templateName, languageCode, bodyParams) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) {
    logger.warn(`WhatsApp not configured for company ${companyId}`);
    return null;
  }
  const phone = String(to).replace(/\D/g, '');
  const components = bodyParams?.length
    ? [{ type: 'body', parameters: bodyParams.map((v) => ({ type: 'text', text: String(v) })) }]
    : [];
  try {
    const res = await axios.post(
      `${GRAPH}/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: { name: templateName, language: { code: languageCode ?? 'en' }, components },
      },
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } }
    );
    return res.data?.messages?.[0]?.id ?? null;
  } catch (err) {
    logger.error('WhatsApp sendTemplateMessage failed', err?.response?.data ?? err.message);
    throw err;
  }
}

// ── GET /api/whatsapp/connection — WABA connection status ──────────────────────
router.get('/connection', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg) return res.json({ connected: false });
    res.json({
      connected: true,
      phoneNumber: cfg.phoneNumber,
      wabaId: cfg.wabaId,
      connectedAt: cfg.connectedAt,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/auth/init — start OAuth popup ───────────────────────────
router.get('/auth/init', authMiddleware, checkRole(['admin']), (req, res) => {
  const appId = process.env.META_APP_ID;
  if (!appId) return res.status(500).json({ error: 'META_APP_ID not configured' });

  const redirectUri = `${process.env.BACKEND_URL ?? 'http://localhost:3000'}/api/whatsapp/auth/callback`;
  const state = Buffer.from(JSON.stringify({ companyId: req.user.companyId, userId: req.user.id })).toString('base64');

  const url = new URL('https://www.facebook.com/dialog/oauth');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'whatsapp_business_management,whatsapp_business_messaging,business_management');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  res.json({ url: url.toString() });
});

// ── GET /api/whatsapp/auth/callback — OAuth callback, closes popup ─────────────
router.get('/auth/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.send(popupHtml(false, `Meta denied access: ${oauthError}`));
  }
  if (!code || !state) {
    return res.send(popupHtml(false, 'Missing code or state'));
  }

  let companyId, userId;
  try {
    ({ companyId, userId } = JSON.parse(Buffer.from(String(state), 'base64').toString()));
  } catch {
    return res.send(popupHtml(false, 'Invalid state parameter'));
  }

  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = `${process.env.BACKEND_URL ?? 'http://localhost:3000'}/api/whatsapp/auth/callback`;

    // Exchange code for access token
    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    });
    const accessToken = tokenRes.data.access_token;

    // Get WABA details
    const meRes = await axios.get(`${GRAPH}/me`, {
      params: { fields: 'id,name', access_token: accessToken },
    });

    // Fetch WhatsApp Business Accounts
    const wabaRes = await axios.get(`${GRAPH}/${meRes.data.id}/whatsapp_business_accounts`, {
      params: { access_token: accessToken },
    }).catch(() => ({ data: { data: [] } }));

    const waba = wabaRes.data?.data?.[0];
    const wabaId = waba?.id ?? null;

    // Fetch phone numbers from first WABA
    let phoneNumberId = null;
    let phoneNumber = null;
    if (wabaId) {
      const phoneRes = await axios.get(`${GRAPH}/${wabaId}/phone_numbers`, {
        params: { access_token: accessToken },
      }).catch(() => ({ data: { data: [] } }));
      const phone = phoneRes.data?.data?.[0];
      phoneNumberId = phone?.id ?? null;
      phoneNumber = phone?.display_phone_number ?? null;
    }

    const connectedAt = new Date().toISOString();

    // Store credentials per company
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#WABA#${companyId}`,
        SK: 'CURRENT',
        companyId,
        accessToken,
        wabaId,
        phoneNumberId,
        phoneNumber,
        connectedBy: userId,
        connectedAt,
      },
    }).promise();

    // FIX 7: write reverse-index so webhook routing is O(1) instead of a full scan
    if (phoneNumberId) {
      await dynamodb.put({
        TableName: TABLE,
        Item: { PK: `CONFIG#PHONEID#${phoneNumberId}`, SK: 'CURRENT', companyId, phoneNumberId },
      }).promise();
      invalidatePhoneIdCache(phoneNumberId);
    }

    logger.info(`WABA connected for company ${companyId}: ${phoneNumber}`);
    res.send(popupHtml(true, `Connected: ${phoneNumber ?? 'WhatsApp Business'}`));
  } catch (err) {
    logger.error('WABA OAuth callback error', err?.response?.data ?? err.message);
    res.send(popupHtml(false, 'Connection failed — check app credentials'));
  }
});

// ── POST /api/whatsapp/manual-connect — paste token + phone ID directly ───────
router.post('/manual-connect', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { accessToken, phoneNumberId } = req.body;
    if (!accessToken?.trim() || !phoneNumberId?.trim()) {
      return res.status(400).json({ error: 'accessToken and phoneNumberId are required' });
    }

    // Verify credentials by fetching phone number info from Meta
    let phoneNumber = null;
    let wabaId = null;
    try {
      const verifyRes = await axios.get(`${GRAPH}/${phoneNumberId.trim()}`, {
        params: { fields: 'display_phone_number,verified_name,id', access_token: accessToken.trim() },
      });
      phoneNumber = verifyRes.data?.display_phone_number ?? null;
      wabaId = verifyRes.data?.id ?? null;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid credentials — Meta rejected the token or phone number ID' });
    }

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#WABA#${req.user.companyId}`,
        SK: 'CURRENT',
        companyId: req.user.companyId,
        accessToken: accessToken.trim(),
        wabaId,
        phoneNumberId: phoneNumberId.trim(),
        phoneNumber,
        connectedBy: req.user.id,
        connectedAt: new Date().toISOString(),
        setupMethod: 'manual',
      },
    }).promise();

    // FIX 7: write reverse-index so webhook routing is O(1)
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#PHONEID#${phoneNumberId.trim()}`,
        SK: 'CURRENT',
        companyId: req.user.companyId,
        phoneNumberId: phoneNumberId.trim(),
      },
    }).promise();
    invalidatePhoneIdCache(phoneNumberId.trim());

    logger.info(`WABA manually connected for company ${req.user.companyId}: ${phoneNumber}`);
    res.json({ success: true, phoneNumber });
  } catch (err) {
    logger.error('manual-connect error', err);
    next(err);
  }
});

// ── DELETE /api/whatsapp/connection — disconnect WABA ─────────────────────────
router.delete('/connection', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/webhook — Meta verification ─────────────────────────────
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).end();
});

// Helper to store WAMID → MSG# reverse-lookup so status updates can find the right record
async function storeWamidLookup(wamid, leadPK, msgSK, companyId, extras = {}) {
  if (!wamid) return;
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: { PK: `WAMID#${wamid}`, SK: 'LOOKUP', leadPK, msgSK, companyId, ...extras },
      ConditionExpression: 'attribute_not_exists(PK)',
    }).promise();
  } catch { /* ignore duplicate */ }
}

// ── Download inbound Meta media → S3 ─────────────────────────────────────────
// Meta media IDs expire in 30 days and proxying through Lambda hits the 6 MB
// response limit. Storing to S3 at webhook time lets the browser stream directly
// via presigned URL — no Lambda in the path, no size limit.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/aac': '.aac',
  'audio/ogg; codecs=opus': '.ogg',
  'application/pdf': '.pdf',
};

async function storeInboundMedia(accessToken, mediaId, mimeType, companyId) {
  if (!MEDIA_BUCKET || !mediaId || !accessToken) return null;
  try {
    const metaRes = await axios.get(`${GRAPH}/${mediaId}`, {
      params: { access_token: accessToken },
    });
    const downloadUrl = metaRes.data?.url;
    if (!downloadUrl) return null;

    const mediaRes = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
    });

    const ext = MIME_TO_EXT[mimeType] ?? '';
    const s3Key = `inbound/${companyId}/${mediaId}${ext}`;
    await s3Client.upload({
      Bucket: MEDIA_BUCKET,
      Key: s3Key,
      Body: Buffer.from(mediaRes.data),
      ContentType: mimeType ?? 'application/octet-stream',
    }).promise();

    return s3Key;
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('storeInboundMedia failed', msg);
    // Surface S3 permission errors immediately — these cause silent media loss
    if (msg.includes('Access Denied') || msg.includes('AccessDenied') || msg.includes('403')) {
      logger.alert(`S3 inbound write denied for company <b>${companyId}</b> — check IAM policy on apforce-wa-media/inbound/*`);
    }
    return null;
  }
}

// Write a MEDIA# index item for per-contact gallery queries
function writeMediaIndex(companyId, contactKey, item) {
  dynamodb.put({
    TableName: TABLE,
    Item: {
      PK: `MEDIA#${companyId}#${contactKey}`,
      SK: `${item.timestamp}#${item.mediaId ?? item.waMessageId ?? Date.now()}`,
      ...item,
    },
  }).promise().catch(() => {});
}

// ── POST /api/whatsapp/webhook — inbound messages + delivery/read statuses ────
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    if (change?.field !== 'messages') return;

    const phoneNumberId = change.value?.metadata?.phone_number_id;
    const messages = change.value?.messages ?? [];

    // Resolve company once per webhook entry — scopes all lead lookups and inbox writes
    const wabaConfig = phoneNumberId ? await getCompanyByPhoneNumberId(phoneNumberId) : null;
    const webhookCompanyId = wabaConfig?.companyId ?? null;
    if (!webhookCompanyId) {
      logger.warn(`Webhook received for unrecognised phoneNumberId: ${phoneNumberId ?? '(none)'} — no company configured for this number`);
    }

    // ── Handle message status updates (delivered / read) ──────────────────────
    const statuses = change.value?.statuses ?? [];
    for (const statusUpdate of statuses) {
      try {
        const wamid = statusUpdate.id;
        const statusType = statusUpdate.status; // 'sent'|'delivered'|'read'|'failed'
        if (!['delivered', 'read'].includes(statusType)) continue;

        const lookup = await dynamodb.get({
          TableName: TABLE,
          Key: { PK: `WAMID#${wamid}`, SK: 'LOOKUP' },
        }).promise();
        if (!lookup.Item) continue;

        const { leadPK, msgSK, broadcastId, broadcastSK, companyId: cid } = lookup.Item;

        // Update MSG# record status (read wins over delivered)
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: msgSK },
          UpdateExpression: 'SET msgStatus = :s',
          ConditionExpression: 'attribute_not_exists(msgStatus) OR msgStatus <> :read',
          ExpressionAttributeValues: { ':s': statusType, ':read': 'read' },
        }).promise().catch(() => {});

        // Increment broadcast stats if this came from a broadcast
        if (broadcastId && broadcastSK && cid) {
          const field = statusType === 'delivered' ? 'deliveredCount' : 'readCount';
          await dynamodb.update({
            TableName: TABLE,
            Key: { PK: `BROADCAST#${cid}`, SK: broadcastSK },
            UpdateExpression: `ADD ${field} :one`,
            ExpressionAttributeValues: { ':one': 1 },
          }).promise().catch(() => {});
        }
      } catch (e) {
        logger.warn('status-update failed', e.message);
      }
    }

    for (const msg of messages) {
      const { type, from: fromPhone, id: waMessageId, timestamp: ts } = msg;
      const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];
      if (type !== 'text' && !MEDIA_TYPES.includes(type)) continue;

      const timestamp = new Date(Number(ts) * 1000).toISOString();
      const phone10 = to10Digit(fromPhone);

      // Extract content + media metadata
      let text = '';
      let mediaId = null;
      let mimeType = null;
      let filename = null;
      if (type === 'text') {
        text = msg.text?.body ?? '';
      } else {
        const m = msg[type] ?? {};
        mediaId = m.id ?? null;
        mimeType = m.mime_type ?? null;
        filename = m.filename ?? null;
        text = m.caption ?? `[${type}]`;
      }

      // Skip message if we can't determine which company owns this WhatsApp number
      if (!webhookCompanyId) continue;

      // Find lead — scoped to this company only (prevents cross-company lead contamination)
      const scanResult = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND (phone = :p1 OR phone = :p2 OR phone = :p3)',
        ExpressionAttributeValues: {
          ':prefix': `LEAD#${webhookCompanyId}#`, ':meta': 'METADATA',
          ':p1': phone10,
          ':p2': fromPhone,
          ':p3': '+91' + phone10,
        },
      }).promise();

      const lead = scanResult.Items?.[0];

      // Download inbound media to S3 so the browser can stream directly —
      // avoids Lambda 6 MB response limit and Meta 30-day media expiry.
      const s3Key = mediaId
        ? await storeInboundMedia(wabaConfig?.accessToken, mediaId, mimeType, webhookCompanyId)
        : null;

      const msgItem = {
        direction: 'inbound', content: text, type,
        timestamp, waMessageId, messageId: waMessageId,
        ...(mediaId && { mediaId, mimeType, filename }),
        ...(s3Key && { s3Key }),
      };

      if (lead) {
        // Guard all post-write side-effects on whether the MSG# was actually new.
        // Meta sometimes re-delivers webhooks; the ConditionExpression deduplicates the
        // DynamoDB write, but we must not re-run side-effects (preview update, unread
        // counter, re-open resolved chat) for a duplicate delivery.
        let isNewMsg = false;
        try {
          isNewMsg = await dedupPut(dynamodb, TABLE, { PK: lead.PK, SK: `MSG#${timestamp}#${waMessageId}`, ...msgItem });
          if (!isNewMsg) logger.warn(`Duplicate webhook ignored: ${waMessageId}`);
        } catch (e) {
          logger.error('MSG# put failed (lead)', e.message);
        }
        if (isNewMsg) {
          await updateLeadLastMessage(lead.PK, text, 'inbound', timestamp);
          if (mediaId) writeMediaIndex(webhookCompanyId, lead.PK.split('#')[2], { leadPK: lead.PK, mediaId, mimeType, filename: filename ?? null, direction: 'inbound', timestamp });
          if (lead.chatStatus === 'resolved') {
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: lead.PK, SK: 'METADATA' },
              UpdateExpression: 'SET chatStatus = :s',
              ExpressionAttributeValues: { ':s': 'open' },
            }).promise().catch(() => {});
          }
        }
      } else {
        const companyId = webhookCompanyId; // already resolved above
        const PK = `INBOX#${companyId}#${phone10}`;

        // Is this the first message from this contact?
        const existingContact = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'CONTACT' } }).promise();
        const isFirstContact = !existingContact.Item;

        let isNewMsg = false;
        try {
          isNewMsg = await dedupPut(dynamodb, TABLE, { PK, SK: `MSG#${timestamp}#${waMessageId}`, ...msgItem });
          if (!isNewMsg) logger.warn(`Duplicate webhook ignored: ${waMessageId}`);
        } catch (e) {
          logger.error('MSG# put failed (inbox)', e.message);
        }
        if (isNewMsg) {
          if (mediaId) writeMediaIndex(companyId, phone10, { leadPK: PK, mediaId, mimeType, filename: filename ?? null, direction: 'inbound', timestamp });

          await dynamodb.update({
            TableName: TABLE,
            Key: { PK, SK: 'CONTACT' },
            UpdateExpression: 'SET phone = if_not_exists(phone, :ph), companyId = if_not_exists(companyId, :cid), createdAt = if_not_exists(createdAt, :ts), lastMessageAt = :lma, lastMessagePreview = :prev, lastMessageDirection = :dir, unreadCount = if_not_exists(unreadCount, :zero) + :one',
            ExpressionAttributeValues: { ':ph': phone10, ':cid': companyId, ':ts': timestamp, ':lma': timestamp, ':prev': text.slice(0, 100), ':dir': 'inbound', ':zero': 0, ':one': 1 },
          }).promise();
          // Bump company-level activity tracker for unknown contacts too
          dynamodb.update({
            TableName: TABLE,
            Key: { PK: `ACTIVITY#${companyId}`, SK: 'WA' },
            UpdateExpression: 'SET lastActivityAt = :ts',
            ExpressionAttributeValues: { ':ts': timestamp },
          }).promise().catch(() => {});
        }

        // Send welcome message on first contact (only for genuinely new messages)
        if (isNewMsg && isFirstContact) {
          try {
            const wc = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#WELCOME#${companyId}`, SK: 'CURRENT' } }).promise();
            if (wc.Item?.enabled && wc.Item?.templateName) {
              await sendTemplateMessage(companyId, phone10, wc.Item.templateName, wc.Item.language ?? 'en', []);
              logger.info(`Welcome message sent to ${phone10} for company ${companyId}`);
            }
          } catch (e) { logger.warn('Welcome message failed: ' + e.message); }
        }
      }
    }
  } catch (err) {
    logger.error('WhatsApp webhook error', err);
  }
});

// ── POST /api/whatsapp/send ────────────────────────────────────────────────────
router.post('/send', authMiddleware, async (req, res, next) => {
  try {
    const { leadPK: pk, message, replyToWaMessageId, replyToContent, replyToDirection, replyToSenderName } = req.body;
    if (!pk || !message?.trim()) return res.status(400).json({ error: 'leadPK and message required' });

    const result = await dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: 'METADATA' } }).promise();
    const lead = result.Item;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.companyId !== req.user.companyId) return res.status(403).json({ error: 'Forbidden' });

    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && lead.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Not your lead' });
    }

    const waMessageId = await sendTextMessage(req.user.companyId, lead.phone, message.trim(), replyToWaMessageId ?? null);
    const timestamp = new Date().toISOString();
    const msgSK = `MSG#${timestamp}#${waMessageId ?? Date.now()}`;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: pk, SK: msgSK,
        messageId: waMessageId,
        direction: 'outbound',
        content: message.trim(),
        type: 'text',
        sentBy: req.user.id,
        sentByName: req.user.name,
        timestamp, waMessageId, msgStatus: 'sent',
        ...(replyToWaMessageId && {
          replyToWaMessageId,
          replyToContent: replyToContent ?? '',
          replyToDirection: replyToDirection ?? 'inbound',
          replyToSenderName: replyToSenderName ?? null,
        }),
      },
    }).promise();

    await storeWamidLookup(waMessageId, pk, msgSK, req.user.companyId);
    await updateLeadLastMessage(pk, message.trim(), 'outbound', timestamp);
    res.json({ success: true, messageId: waMessageId, timestamp });
  } catch (err) {
    logger.error('whatsapp/send error', err);
    next(err);
  }
});

// ── GET /api/whatsapp/inbox — conversations with status filter + counts ────────
router.get('/inbox', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const statusFilter = req.query.status ?? 'all'; // open | unassigned | resolved | all

    function effectiveStatus(l) {
      if (l.chatStatus) return l.chatStatus;
      return l.assignedTo ? 'open' : 'unassigned';
    }

    // Known leads with WhatsApp messages
    const leadItems = [];
    let lk1;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND attribute_exists(lastMessageAt)',
        ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
        ...(lk1 && { ExclusiveStartKey: lk1 }),
      }).promise();
      leadItems.push(...(r.Items ?? []));
      lk1 = r.LastEvaluatedKey;
    } while (lk1);

    // Unknown contacts
    const unknownItems = [];
    let lk2;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: { ':prefix': `INBOX#${companyId}#`, ':sk': 'CONTACT' },
        ...(lk2 && { ExclusiveStartKey: lk2 }),
      }).promise();
      unknownItems.push(...(r.Items ?? []));
      lk2 = r.LastEvaluatedKey;
    } while (lk2);

    // Build counts before filtering
    const counts = { open: 0, unassigned: 0, resolved: 0, unread: 0 };
    leadItems.forEach((l) => {
      const s = effectiveStatus(l);
      if (counts[s] !== undefined) counts[s]++;
      if ((l.unreadCount ?? 0) > 0) counts.unread++;
    });
    unknownItems.forEach((u) => {
      counts.unassigned++;
      if ((u.unreadCount ?? 0) > 0) counts.unread++;
    });

    const allConvs = [
      ...leadItems.map((l) => ({
        type: 'lead',
        leadId: l.leadId,
        PK: l.PK,
        name: l.name,
        phone: l.phone,
        email: l.email ?? null,
        source: l.source ?? null,
        stage: l.stage,
        tags: l.tags ?? [],
        notes: l.notes ?? '',
        assignedTo: l.assignedTo ?? null,
        assignedToName: l.assignedToName ?? null,
        pinned: l.pinned ?? false,
        chatStatus: effectiveStatus(l),
        lastMessageAt: l.lastMessageAt,
        lastMessagePreview: l.lastMessagePreview,
        lastMessageDirection: l.lastMessageDirection,
        lastInboundAt: l.lastInboundAt ?? null,
        createdAt: l.createdAt,
        unreadCount: l.unreadCount ?? 0,
      })),
      ...unknownItems.map((u) => ({
        type: 'unknown',
        phone: u.phone,
        name: u.name ?? null,
        email: null, source: null, stage: null, tags: [], notes: '',
        assignedTo: null, assignedToName: null,
        chatStatus: 'unassigned',
        lastMessageAt: u.lastMessageAt,
        lastMessagePreview: u.lastMessagePreview,
        lastMessageDirection: u.lastMessageDirection,
        lastInboundAt: u.lastMessageAt ?? null,
        createdAt: u.createdAt ?? null,
        unreadCount: u.unreadCount ?? 0,
      })),
    ].sort((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
    });

    const conversations = statusFilter === 'all'
      ? allConvs
      : statusFilter === 'unread'
        ? allConvs.filter((c) => c.unreadCount > 0)
        : allConvs.filter((c) => c.chatStatus === statusFilter);

    res.json({ success: true, conversations, counts });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/inbox/ping — lightweight activity check for real-time updates ──
// Returns {hasNew, latestAt} from a single DDB GET so the browser can poll every 2s
// without hammering the full inbox scan. Full inbox refetch only when hasNew=true.
router.get('/inbox/ping', authMiddleware, async (req, res, next) => {
  try {
    const { since } = req.query;
    const companyId = req.user.companyId;
    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `ACTIVITY#${companyId}`, SK: 'WA' },
    }).promise();
    const latestAt = r.Item?.lastActivityAt ?? null;
    const hasNew = latestAt && since ? new Date(latestAt) > new Date(since) : !!latestAt;
    res.json({ hasNew, latestAt });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/inbox/unknown/:phone/messages ───────────────────────────
router.get('/inbox/unknown/:phone/messages', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const phone = req.params.phone.replace(/\D/g, '');
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `INBOX#${companyId}#${phone}`, ':sk': 'MSG#' },
    }).promise();
    res.json({ success: true, messages: (result.Items ?? []).sort((a, b) => a.SK.localeCompare(b.SK)) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/whatsapp/inbox/unknown/:phone/send ──────────────────────────────
router.post('/inbox/unknown/:phone/send', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const phone = req.params.phone.replace(/\D/g, '');
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const waMessageId = await sendTextMessage(companyId, phone, message.trim());
    const timestamp = new Date().toISOString();
    const PK = `INBOX#${companyId}#${phone}`;
    const unknownMsgSK = `MSG#${timestamp}#${waMessageId ?? Date.now()}`;

    await dynamodb.put({
      TableName: TABLE,
      Item: { PK, SK: unknownMsgSK, direction: 'outbound', content: message.trim(), type: 'text', sentBy: req.user.id, sentByName: req.user.name, timestamp, waMessageId, msgStatus: 'sent' },
    }).promise();
    await storeWamidLookup(waMessageId, PK, unknownMsgSK, companyId);

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'CONTACT' },
      UpdateExpression: 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir',
      ExpressionAttributeValues: { ':ts': timestamp, ':prev': message.trim().slice(0, 100), ':dir': 'outbound' },
    }).promise();

    res.json({ success: true, messageId: waMessageId, timestamp });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/whatsapp/inbox/:leadId/resolve ───────────────────────────────────
router.put('/inbox/:leadId/resolve', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET chatStatus = :s, resolvedAt = :ra, resolvedBy = :rb',
      ExpressionAttributeValues: { ':s': 'resolved', ':ra': new Date().toISOString(), ':rb': req.user.id },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/inbox/:leadId/reopen ─────────────────────────────────────
router.put('/inbox/:leadId/reopen', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET chatStatus = :s REMOVE resolvedAt, resolvedBy',
      ExpressionAttributeValues: { ':s': 'open' },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/inbox/:leadId/pin — toggle pinned conversation ───────────
router.put('/inbox/:leadId/pin', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    const current = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    const pinned = !(current.Item?.pinned ?? false);
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET pinned = :p',
      ExpressionAttributeValues: { ':p': pinned },
    }).promise();
    res.json({ success: true, pinned });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/inbox/:leadId/note — internal team note ─────────────────
router.post('/inbox/:leadId/note', authMiddleware, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    const timestamp = new Date().toISOString();
    const mentionNames = [...content.matchAll(/@(\w+)/g)].map((m) => m[1]);
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK, SK: `NOTE#${timestamp}`,
        content: content.trim(),
        authorId: req.user.id,
        authorName: req.user.name,
        type: 'note',
        timestamp,
        ...(mentionNames.length && { mentions: mentionNames }),
      },
    }).promise();
    if (mentionNames.length > 0) {
      logger.alert(`📌 <b>${req.user.name}</b> mentioned ${mentionNames.map((n) => `@${n}`).join(', ')} in a note\nLead: <code>${req.params.leadId}</code>`);
    }
    res.json({ success: true, timestamp });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/agent/availability — get own availability status ─────────
router.get('/agent/availability', authMiddleware, async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `AGENT#AVAIL#${req.user.companyId}#${req.user.id}`, SK: 'STATUS' },
    }).promise();
    res.json({ available: result.Item?.available ?? true });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/agent/availability — set own availability status ─────────
router.put('/agent/availability', authMiddleware, async (req, res, next) => {
  try {
    const { available } = req.body;
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `AGENT#AVAIL#${req.user.companyId}#${req.user.id}`,
        SK: 'STATUS',
        available: !!available,
        userId: req.user.id,
        companyId: req.user.companyId,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true, available: !!available });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/inbox/auto-assign — round-robin assign unassigned ───────
router.post('/inbox/auto-assign', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;

    // Get employees for this company
    const empResult = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND #r IN (:r1, :r2, :r3)',
      ExpressionAttributeNames: { '#r': 'role' },
      ExpressionAttributeValues: { ':prefix': `EMP#${companyId}#`, ':sk': 'PROFILE', ':r1': 'telecaller', ':r2': 'agent', ':r3': 'intern' },
    }).promise();
    const allEmployees = empResult.Items ?? [];
    if (allEmployees.length === 0) return res.status(400).json({ error: 'No employees available to assign' });

    // Filter to available agents; fall back to all if everyone is away
    const availChecks = await Promise.all(
      allEmployees.map((emp) =>
        dynamodb.get({
          TableName: TABLE,
          Key: { PK: `AGENT#AVAIL#${companyId}#${emp.userId ?? emp.id}`, SK: 'STATUS' },
        }).promise().then((r) => ({ ...emp, available: r.Item?.available ?? true }))
      )
    );
    const employees = availChecks.filter((e) => e.available).length > 0
      ? availChecks.filter((e) => e.available)
      : allEmployees;
    if (employees.length === 0) return res.status(400).json({ error: 'No employees available to assign' });

    // Get unassigned conversations
    const unassigned = [];
    let lk;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND attribute_exists(lastMessageAt) AND (attribute_not_exists(assignedTo) OR assignedTo = :empty)',
        ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA', ':empty': '' },
        ...(lk && { ExclusiveStartKey: lk }),
      }).promise();
      unassigned.push(...(r.Items ?? []));
      lk = r.LastEvaluatedKey;
    } while (lk);

    let assigned = 0;
    await Promise.allSettled(unassigned.map(async (lead, idx) => {
      const emp = employees[idx % employees.length];
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: lead.PK, SK: 'METADATA' },
        UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
        ExpressionAttributeValues: { ':at': emp.userId ?? emp.id, ':atn': emp.name, ':cs': 'open', ':ua': new Date().toISOString() },
      }).promise();
      assigned++;
    }));

    res.json({ success: true, assigned });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/inbox/canned — list canned responses ────────────────────
router.get('/inbox/canned', authMiddleware, async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#CANNED#${req.user.companyId}`, ':sk': 'CANNED#' },
    }).promise();
    res.json({ success: true, responses: (result.Items ?? []).sort((a, b) => a.title?.localeCompare(b.title)) });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/inbox/canned — create canned response ──────────────────
router.post('/inbox/canned', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { title, body, shortcut } = req.body;
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'title and body required' });
    const id = require('crypto').randomUUID();
    const item = {
      PK: `CONFIG#CANNED#${req.user.companyId}`,
      SK: `CANNED#${id}`,
      id, title: title.trim(), body: body.trim(),
      shortcut: shortcut?.trim().toLowerCase().replace(/\s+/g, '_') ?? null,
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.json({ success: true, response: item });
  } catch (err) { next(err); }
});

// ── DELETE /api/whatsapp/inbox/canned/:id — delete canned response ────────────
router.delete('/inbox/canned/:id', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#CANNED#${req.user.companyId}`, SK: `CANNED#${req.params.id}` },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/templates — list stored templates ───────────────────────
router.get('/templates', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#TMPL#${req.user.companyId}`, ':sk': 'TMPL#' },
    }).promise();
    res.json({ success: true, templates: (result.Items ?? []).sort((a, b) => a.name?.localeCompare(b.name)) });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/templates — create template ────────────────────────────
router.post('/templates', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { name, templateName, language, category, bodyPreview, variables } = req.body;
    if (!name?.trim() || !templateName?.trim()) {
      return res.status(400).json({ error: 'name and templateName are required' });
    }
    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();
    const item = {
      PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${id}`,
      id, companyId: req.user.companyId,
      name: name.trim(),
      templateName: templateName.trim().toLowerCase().replace(/\s+/g, '_'),
      language: language ?? 'en',
      category: category ?? 'UTILITY',
      bodyPreview: bodyPreview?.trim() ?? '',
      variables: variables ?? [],
      createdBy: req.user.id,
      createdAt: now, updatedAt: now,
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, template: item });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/templates/:id — update template ────────────────────────
router.put('/templates/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { name, templateName, language, category, bodyPreview, variables } = req.body;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
      UpdateExpression: 'SET #n = :n, templateName = :tn, #lang = :lang, category = :cat, bodyPreview = :bp, variables = :vars, updatedAt = :ua',
      ExpressionAttributeNames: { '#n': 'name', '#lang': 'language' },
      ExpressionAttributeValues: {
        ':n': name?.trim(), ':tn': templateName?.trim().toLowerCase().replace(/\s+/g, '_'),
        ':lang': language ?? 'en', ':cat': category ?? 'UTILITY',
        ':bp': bodyPreview?.trim() ?? '', ':vars': variables ?? [],
        ':ua': new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/whatsapp/templates/:id ───────────────────────────────────────
router.delete('/templates/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/send-template — send template to a lead ────────────────
router.post('/send-template', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { leadId, leadPK: leadPK0, templateId, variableValues } = req.body;
    // Accept either leadId (from TemplatePicker) or leadPK (direct)
    const pk = leadPK0 || (leadId ? `LEAD#${req.user.companyId}#${leadId}` : null);
    if (!pk || !templateId) return res.status(400).json({ error: 'leadId (or leadPK) and templateId required' });

    const [tmplResult, leadResult] = await Promise.all([
      dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${templateId}` } }).promise(),
      dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: 'METADATA' } }).promise(),
    ]);

    const tmpl = tmplResult.Item;
    const lead = leadResult.Item;
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const params = (variableValues ?? []).map(String);
    const wamid = await sendTemplateMessage(req.user.companyId, lead.phone, tmpl.templateName, tmpl.language, params);

    const ts = new Date().toISOString();
    const tmplMsgSK = `MSG#${ts}#${wamid ?? Date.now()}`;
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: pk, SK: tmplMsgSK,
        direction: 'outbound', content: `[Template: ${tmpl.name}]`,
        sentBy: req.user.id, sentByName: req.user.name ?? null,
        templateId, timestamp: ts, type: 'template', waMessageId: wamid, msgStatus: 'sent',
      },
    }).promise();
    await storeWamidLookup(wamid, pk, tmplMsgSK, req.user.companyId);
    await updateLeadLastMessage(pk, `[Template: ${tmpl.name}]`, 'outbound', ts);

    res.json({ success: true });
  } catch (err) {
    logger.error('send-template error', err?.response?.data ?? err.message);
    next(err);
  }
});

// ── POST /api/whatsapp/broadcast — send template to a lead segment ────────────
router.post('/broadcast', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { templateId, variableValues, filter } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

    const companyId = req.user.companyId;

    const tmplResult = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${companyId}`, SK: `TMPL#${templateId}` },
    }).promise();
    const tmpl = tmplResult.Item;
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });

    // Scan leads matching filter
    let items = [];
    let lastKey;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
        ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(r.Items ?? []));
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);

    // Apply filters
    if (filter?.stages?.length) items = items.filter((l) => filter.stages.includes(l.stage));
    if (filter?.tags?.length) items = items.filter((l) => filter.tags.some((t) => (l.tags ?? []).includes(t)));
    if (filter?.assignedTo) items = items.filter((l) => l.assignedTo === filter.assignedTo);
    if (filter?.source) items = items.filter((l) => l.source === filter.source);

    if (items.length === 0) return res.status(400).json({ error: 'No leads match the selected filters' });
    if (items.length > 1000) return res.status(400).json({ error: 'Broadcast limited to 1000 leads per batch. Refine your filters.' });

    const broadcastId = require('crypto').randomUUID();
    const now = new Date().toISOString();
    const broadcastSK = `${now}#${broadcastId}`;
    let sent = 0; let failed = 0;
    const errors = [];

    await Promise.allSettled(items.map(async (lead) => {
      try {
        const params = (variableValues ?? []).map((v) => {
          if (v === '{{name}}') return lead.name ?? '';
          if (v === '{{phone}}') return lead.phone ?? '';
          return String(v);
        });
        const wamid = await sendTemplateMessage(companyId, lead.phone, tmpl.templateName, tmpl.language, params);

        const ts = new Date().toISOString();
        const bMsgSK = `MSG#${ts}#${wamid ?? Date.now()}`;
        await dynamodb.put({
          TableName: TABLE,
          Item: {
            PK: lead.PK, SK: bMsgSK,
            direction: 'outbound', content: `[Broadcast: ${tmpl.name}]`,
            sentBy: req.user.id, sentByName: req.user.name ?? null,
            broadcastId, templateId, timestamp: ts, type: 'template', waMessageId: wamid, msgStatus: 'sent',
          },
        }).promise();
        await storeWamidLookup(wamid, lead.PK, bMsgSK, companyId, { broadcastId, broadcastSK });
        await updateLeadLastMessage(lead.PK, `[Broadcast: ${tmpl.name}]`, 'outbound', ts);
        sent++;
      } catch (e) {
        failed++;
        errors.push({ phone: lead.phone, error: e?.response?.data?.error?.message ?? e.message });
      }
    }));

    // Store broadcast record
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `BROADCAST#${companyId}`, SK: broadcastSK,
        id: broadcastId, companyId,
        templateId, templateName: tmpl.name,
        filter: filter ?? {},
        totalMatched: items.length, sent, failed,
        deliveredCount: 0, readCount: 0,
        createdBy: req.user.id, createdByName: req.user.name ?? null,
        createdAt: now,
      },
    }).promise();

    res.json({ success: true, sent, failed, total: items.length, errors: errors.slice(0, 20) });
  } catch (err) {
    logger.error('broadcast error', err.message);
    next(err);
  }
});

// ── GET /api/whatsapp/broadcasts — broadcast history ─────────────────────────
router.get('/broadcasts', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BROADCAST#${req.user.companyId}` },
      ScanIndexForward: false,
      Limit: 50,
    }).promise();
    res.json({ success: true, broadcasts: result.Items ?? [] });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/welcome-config ──────────────────────────────────────────
router.get('/welcome-config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#WELCOME#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    res.json({ success: true, config: result.Item ?? { enabled: false, templateName: '', language: 'en' } });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/welcome-config ──────────────────────────────────────────
router.put('/welcome-config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { enabled, templateName, language } = req.body;
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#WELCOME#${req.user.companyId}`, SK: 'CURRENT',
        companyId: req.user.companyId,
        enabled: !!enabled,
        templateName: templateName?.trim() ?? '',
        language: language?.trim() ?? 'en',
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/inbox/:leadId/mark-read ────────────────────────────────
// Resets unreadCount to 0 in DynamoDB AND sends a read receipt to Meta (blue ticks)
router.post('/inbox/:leadId/mark-read', authMiddleware, async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const companyId = req.user.companyId;
    const { lastWaMessageId } = req.body;

    // Reset unread count — fire-and-forget
    dynamodb.update({
      TableName: TABLE,
      Key: { PK: `LEAD#${companyId}#${leadId}`, SK: 'METADATA' },
      UpdateExpression: 'SET unreadCount = :zero',
      ExpressionAttributeValues: { ':zero': 0 },
    }).promise().catch(() => {});

    // Send read receipt to Meta (shows blue ticks on customer's phone)
    if (lastWaMessageId) {
      const cfg = await getWabaConfig(companyId);
      if (cfg?.accessToken && cfg?.phoneNumberId) {
        await axios.post(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: lastWaMessageId,
        }, { headers: { Authorization: `Bearer ${cfg.accessToken}` } }).catch(() => {});
      }
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/inbox/unknown/:phone/mark-read ─────────────────────────
// Resets unreadCount to 0 for unknown (pre-CRM) contacts
router.post('/inbox/unknown/:phone/mark-read', authMiddleware, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const phone = req.params.phone.replace(/\D/g, '');
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `INBOX#${companyId}#${phone}`, SK: 'CONTACT' },
      UpdateExpression: 'SET unreadCount = :zero',
      ExpressionAttributeValues: { ':zero': 0 },
    }).promise().catch(() => {});
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/upload-url — generate presigned S3 PUT URL ──────────────
// Browser uploads directly to S3 — Lambda is never in the file path.
router.get('/upload-url', authMiddleware, async (req, res, next) => {
  try {
    const { mimeType, filename, fileSize } = req.query;
    if (!mimeType || !filename) return res.status(400).json({ error: 'mimeType and filename required' });
    if (!MEDIA_BUCKET) return res.status(500).json({ error: 'WA_MEDIA_BUCKET env var not set' });
    if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });

    const mediaType = mediaTypeFromMime(mimeType);
    const limit = META_SIZE_LIMITS[mediaType];
    if (fileSize && Number(fileSize) > limit) {
      return res.status(400).json({ error: `${mediaType} files must be under ${limit / 1024 / 1024} MB (Meta limit)` });
    }

    const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
    const key = `uploads/${req.user.companyId}/${require('crypto').randomUUID()}.${ext}`;

    const uploadUrl = s3Client.getSignedUrl('putObject', {
      Bucket: MEDIA_BUCKET,
      Key: key,
      ContentType: mimeType,
      Expires: 300,
    });

    res.json({ success: true, uploadUrl, key });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/s3-url — presigned GET URL for outbound S3 media ────────
// Browser streams directly from S3 — no Lambda in the path, no 6 MB limit.
// Only works for media uploaded via the S3 flow (has s3Key stored in message).
router.get('/s3-url', authMiddleware, async (req, res, next) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key required' });
    if (!MEDIA_BUCKET) return res.status(500).json({ error: 'WA_MEDIA_BUCKET not configured' });
    const cid = req.user.companyId;
    if (!key.startsWith(`uploads/${cid}/`) && !key.startsWith(`inbound/${cid}/`)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const url = s3Client.getSignedUrl('getObject', {
      Bucket: MEDIA_BUCKET,
      Key: key,
      Expires: 3600, // 1 hour — browser can cache + stream range requests
    });
    res.json({ success: true, url });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/media/:mediaId — proxy Meta media bytes ─────────────────
router.get('/media/:mediaId', authMiddleware, async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg?.accessToken) return res.status(403).json({ error: 'WhatsApp not configured' });

    // Step 1: resolve the short-lived download URL from Meta
    // phone_number_id is required for media uploaded by us (outbound); harmless for inbound
    const metaRes = await axios.get(`${GRAPH}/${req.params.mediaId}`, {
      params: { access_token: cfg.accessToken, phone_number_id: cfg.phoneNumberId },
    });
    const mediaUrl = metaRes.data?.url;
    if (!mediaUrl) return res.status(404).json({ error: 'Media not found' });

    // Step 2: fetch the actual bytes — buffer fully (streaming breaks on Lambda)
    const mediaRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      responseType: 'arraybuffer',
    });

    res.setHeader('Content-Type', mediaRes.headers['content-type'] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(mediaRes.data));
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/send-media — send image/document to lead ───────────────
router.post('/send-media', authMiddleware, async (req, res, next) => {
  try {
    const { leadPK: pk, mediaType, mediaUrl, caption, filename } = req.body;
    if (!pk || !mediaType || !mediaUrl) return res.status(400).json({ error: 'leadPK, mediaType, and mediaUrl are required' });

    const result = await dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: 'METADATA' } }).promise();
    const lead = result.Item;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.companyId !== req.user.companyId) return res.status(403).json({ error: 'Forbidden' });

    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg?.accessToken || !cfg?.phoneNumberId) return res.status(400).json({ error: 'WhatsApp not configured' });

    const phone = toE164(lead.phone);
    const mediaPayload = { link: mediaUrl };
    if (caption) mediaPayload.caption = caption;
    if (filename && mediaType === 'document') mediaPayload.filename = filename;

    const sendRes = await axios.post(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: mediaType,
      [mediaType]: mediaPayload,
    }, { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } });

    const waMessageId = sendRes.data?.messages?.[0]?.id ?? null;
    const timestamp = new Date().toISOString();
    const msgSK = `MSG#${timestamp}#${waMessageId ?? Date.now()}`;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: pk, SK: msgSK,
        messageId: waMessageId, waMessageId,
        direction: 'outbound', type: mediaType,
        content: caption ?? `[${mediaType}]`,
        mediaUrl, filename: filename ?? null,
        sentBy: req.user.id, sentByName: req.user.name,
        timestamp, msgStatus: 'sent',
      },
    }).promise();

    await storeWamidLookup(waMessageId, pk, msgSK, req.user.companyId);
    res.json({ success: true, messageId: waMessageId, timestamp });
  } catch (err) {
    logger.error('send-media error', err?.response?.data ?? err.message);
    next(err);
  }
});

// ── POST /api/whatsapp/upload-send — read from S3, upload to Meta, send ───────
// Called after the browser has PUT the file directly to S3 via presigned URL.
// Works for both known leads (leadPK) and unknown contacts (phone).
router.post('/upload-send', authMiddleware, async (req, res, next) => {
  try {
    const { leadPK, phone: rawPhone, s3Key, mimeType, filename, caption, fileHash } = req.body;
    if ((!leadPK && !rawPhone) || !s3Key || !mimeType) {
      return res.status(400).json({ error: 'leadPK or phone, s3Key, and mimeType required' });
    }
    if (!MEDIA_BUCKET) return res.status(500).json({ error: 'WA_MEDIA_BUCKET env var not set' });

    const companyId = req.user.companyId;

    // Security: key must be scoped to this company
    if (!s3Key.startsWith(`uploads/${companyId}/`)) {
      return res.status(403).json({ error: 'Invalid S3 key' });
    }

    const cfg = await getWabaConfig(companyId);
    if (!cfg?.accessToken || !cfg?.phoneNumberId) return res.status(400).json({ error: 'WhatsApp not configured' });

    const mediaType = mediaTypeFromMime(mimeType);
    const safeFilename = filename ?? s3Key.split('/').pop() ?? 'file';

    // Resolve contact — lead or unknown
    let pk, phone, leadItem = null;
    if (leadPK) {
      const r = await dynamodb.get({ TableName: TABLE, Key: { PK: leadPK, SK: 'METADATA' } }).promise();
      leadItem = r.Item;
      if (!leadItem) return res.status(404).json({ error: 'Lead not found' });
      if (leadItem.companyId !== companyId) return res.status(403).json({ error: 'Forbidden' });
      pk = leadPK;
      phone = leadItem.phone;
    } else {
      phone = rawPhone.replace(/\D/g, '');
      pk = `INBOX#${companyId}#${phone}`;
    }

    // Dedup: if we've uploaded this exact file to Meta recently, reuse the media_id
    let mediaId = null;
    if (fileHash) {
      const cached = await dynamodb.get({
        TableName: TABLE,
        Key: { PK: `MEDIACACHE#${companyId}`, SK: fileHash },
      }).promise();
      if (cached.Item?.mediaId) {
        mediaId = cached.Item.mediaId;
        logger.info(`Media dedup hit: reusing mediaId ${mediaId}`);
      }
    }

    if (!mediaId) {
      // Download from S3 (internal AWS network — fast, no Lambda payload limit)
      const s3Obj = await s3Client.getObject({ Bucket: MEDIA_BUCKET, Key: s3Key }).promise();

      // Upload bytes to Meta's media storage
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', mimeType);
      formData.append('file', new Blob([s3Obj.Body], { type: mimeType }), safeFilename);

      const uploadRes = await fetch(`${GRAPH}/${cfg.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        body: formData,
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.json().catch(() => ({}));
        logger.error('Meta media upload failed', errBody);
        return res.status(400).json({ error: 'Media upload to Meta failed', details: errBody });
      }
      ({ id: mediaId } = await uploadRes.json());
      if (!mediaId) return res.status(500).json({ error: 'Meta did not return a media_id' });

      // Cache for 29 days (Meta media_id valid 30 days)
      if (fileHash) {
        dynamodb.put({
          TableName: TABLE,
          Item: {
            PK: `MEDIACACHE#${companyId}`, SK: fileHash,
            mediaId, mimeType, filename: safeFilename,
            ttl: Math.floor(Date.now() / 1000) + 29 * 24 * 3600,
          },
        }).promise().catch(() => {});
      }
    }

    // Do NOT delete S3 object — kept for direct presigned GET streaming (video/large files).
    // Lifecycle rule handles cleanup after 30 days (matches Meta's media_id expiry).

    // Send via media_id — no public hosting required
    const phoneE164 = toE164(phone);
    const mediaPayload = { id: mediaId };
    if (caption) mediaPayload.caption = caption;
    if (mediaType === 'document') mediaPayload.filename = safeFilename;

    const sendRes = await axios.post(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phoneE164,
      type: mediaType,
      [mediaType]: mediaPayload,
    }, { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' } });

    const waMessageId = sendRes.data?.messages?.[0]?.id ?? null;
    const timestamp = new Date().toISOString();
    const msgSK = `MSG#${timestamp}#${waMessageId ?? Date.now()}`;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: pk, SK: msgSK,
        messageId: waMessageId, waMessageId,
        direction: 'outbound', type: mediaType,
        content: caption ?? `[${mediaType}]`,
        mediaId, s3Key, filename: safeFilename, mimeType,
        sentBy: req.user.id, sentByName: req.user.name,
        timestamp, msgStatus: 'sent',
      },
    }).promise();

    await storeWamidLookup(waMessageId, pk, msgSK, companyId);

    // MEDIA# index — enables per-contact media gallery
    const contactKey = leadItem ? pk.split('#')[2] : phone;
    writeMediaIndex(companyId, contactKey, {
      leadPK: pk, mediaId, mimeType,
      filename: safeFilename, caption: caption ?? null,
      direction: 'outbound', sentBy: req.user.id, timestamp,
    });

    // Update last message preview
    if (leadItem) {
      await updateLeadLastMessage(pk, caption ?? `[${mediaType}]`, 'outbound', timestamp);
    } else {
      dynamodb.update({
        TableName: TABLE,
        Key: { PK: pk, SK: 'CONTACT' },
        UpdateExpression: 'SET lastMessageAt = :ts, lastMessagePreview = :prev, lastMessageDirection = :dir',
        ExpressionAttributeValues: { ':ts': timestamp, ':prev': (caption ?? `[${mediaType}]`).slice(0, 100), ':dir': 'outbound' },
      }).promise().catch(() => {});
    }

    res.json({ success: true, messageId: waMessageId, timestamp });
  } catch (err) {
    logger.error('upload-send error', err?.response?.data ?? err.message);
    next(err);
  }
});

// HTML page returned to popup after OAuth completes
function popupHtml(success, message) {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html><html><head><title>WhatsApp ${success ? 'Connected' : 'Failed'}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;}
.box{text-align:center;padding:32px;border-radius:16px;border:2px solid ${color};max-width:360px;}
h2{color:${color};margin:0 0 8px;} p{color:#64748b;margin:0 0 16px;font-size:14px;}
button{background:${color};color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;}</style></head>
<body><div class="box"><div style="font-size:48px">${icon}</div><h2>${success ? 'Connected!' : 'Failed'}</h2>
<p>${message}</p><button onclick="window.opener&&window.opener.postMessage({type:'waba_${success ? 'connected' : 'failed'}',message:'${message}'},'*');window.close()">
${success ? 'Done — Close Window' : 'Close & Retry'}</button></div></body></html>`;
}

module.exports = router;
module.exports.sendTextMessage = sendTextMessage;
module.exports.sendTemplateMessage = sendTemplateMessage;
module.exports.storeInboundMedia = storeInboundMedia;
