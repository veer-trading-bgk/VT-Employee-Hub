const express = require('express');
const axios = require('axios');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = 'https://graph.facebook.com/v19.0';

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
    if (direction === 'inbound') { expr += ', lastInboundAt = :ts'; }
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: pk, SK: 'METADATA' },
      UpdateExpression: expr,
      ExpressionAttributeValues: vals,
    }).promise();
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

async function sendTextMessage(companyId, to, body) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) {
    logger.warn(`WhatsApp not configured for company ${companyId}`);
    return null;
  }
  const phone = toE164(to);
  try {
    const res = await axios.post(
      `${GRAPH}/${cfg.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body } },
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

      const msgItem = {
        direction: 'inbound', content: text, type,
        timestamp, waMessageId, messageId: waMessageId,
        ...(mediaId && { mediaId, mimeType, filename }),
      };

      if (lead) {
        await dynamodb.put({
          TableName: TABLE,
          Item: { PK: lead.PK, SK: `MSG#${timestamp}#${waMessageId}`, ...msgItem },
          ConditionExpression: 'attribute_not_exists(SK)',
        }).promise().catch(() => {});
        await updateLeadLastMessage(lead.PK, text, 'inbound', timestamp);
        if (lead.chatStatus === 'resolved') {
          await dynamodb.update({
            TableName: TABLE,
            Key: { PK: lead.PK, SK: 'METADATA' },
            UpdateExpression: 'SET chatStatus = :s',
            ExpressionAttributeValues: { ':s': 'open' },
          }).promise().catch(() => {});
        }
      } else {
        const companyId = webhookCompanyId; // already resolved above
        const PK = `INBOX#${companyId}#${phone10}`;

        // Is this the first message from this contact?
        const existingContact = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'CONTACT' } }).promise();
        const isFirstContact = !existingContact.Item;

        await dynamodb.put({
          TableName: TABLE,
          Item: { PK, SK: `MSG#${timestamp}#${waMessageId}`, ...msgItem },
          ConditionExpression: 'attribute_not_exists(SK)',
        }).promise().catch(() => {});

        await dynamodb.update({
          TableName: TABLE,
          Key: { PK, SK: 'CONTACT' },
          UpdateExpression: 'SET phone = if_not_exists(phone, :ph), companyId = if_not_exists(companyId, :cid), createdAt = if_not_exists(createdAt, :ts), lastMessageAt = :lma, lastMessagePreview = :prev, lastMessageDirection = :dir',
          ExpressionAttributeValues: { ':ph': phone10, ':cid': companyId, ':ts': timestamp, ':lma': timestamp, ':prev': text.slice(0, 100), ':dir': 'inbound' },
        }).promise();

        // Send welcome message on first contact
        if (isFirstContact) {
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
    const { leadPK: pk, message } = req.body;
    if (!pk || !message?.trim()) return res.status(400).json({ error: 'leadPK and message required' });

    const result = await dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: 'METADATA' } }).promise();
    const lead = result.Item;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.companyId !== req.user.companyId) return res.status(403).json({ error: 'Forbidden' });

    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && lead.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Not your lead' });
    }

    const waMessageId = await sendTextMessage(req.user.companyId, lead.phone, message.trim());
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
    const counts = { open: 0, unassigned: 0, resolved: 0 };
    leadItems.forEach((l) => { const s = effectiveStatus(l); if (counts[s] !== undefined) counts[s]++; });
    unknownItems.forEach(() => counts.unassigned++);

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
        chatStatus: effectiveStatus(l),
        lastMessageAt: l.lastMessageAt,
        lastMessagePreview: l.lastMessagePreview,
        lastMessageDirection: l.lastMessageDirection,
        lastInboundAt: l.lastInboundAt ?? null,
        createdAt: l.createdAt,
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
      })),
    ].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    const conversations = statusFilter === 'all'
      ? allConvs
      : allConvs.filter((c) => c.chatStatus === statusFilter);

    res.json({ success: true, conversations, counts });
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

// ── POST /api/whatsapp/inbox/:leadId/note — internal team note ─────────────────
router.post('/inbox/:leadId/note', authMiddleware, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    const timestamp = new Date().toISOString();
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK, SK: `NOTE#${timestamp}`,
        content: content.trim(),
        authorId: req.user.id,
        authorName: req.user.name,
        type: 'note',
        timestamp,
      },
    }).promise();
    res.json({ success: true, timestamp });
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
    const employees = empResult.Items ?? [];
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
router.post('/inbox/:leadId/mark-read', authMiddleware, async (req, res, next) => {
  try {
    const { lastWaMessageId } = req.body;
    if (!lastWaMessageId) return res.json({ success: true }); // nothing to mark
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg?.accessToken || !cfg?.phoneNumberId) return res.json({ success: true });
    await axios.post(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: lastWaMessageId,
    }, { headers: { Authorization: `Bearer ${cfg.accessToken}` } }).catch(() => {});
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/media/:mediaId — proxy Meta media bytes ─────────────────
router.get('/media/:mediaId', authMiddleware, async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg?.accessToken) return res.status(403).json({ error: 'WhatsApp not configured' });

    // Step 1: resolve the short-lived download URL from Meta
    const metaRes = await axios.get(`${GRAPH}/${req.params.mediaId}`, {
      params: { access_token: cfg.accessToken },
    });
    const mediaUrl = metaRes.data?.url;
    if (!mediaUrl) return res.status(404).json({ error: 'Media not found' });

    // Step 2: fetch the actual bytes — Meta requires Authorization header (redirect won't work)
    const mediaStream = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      responseType: 'stream',
    });

    res.setHeader('Content-Type', mediaStream.headers['content-type'] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    mediaStream.data.pipe(res);
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
