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

async function sendTextMessage(companyId, to, body) {
  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) {
    logger.warn(`WhatsApp not configured for company ${companyId}`);
    return null;
  }
  const phone = String(to).replace(/\D/g, '');
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
        connectedAt: new Date().toISOString(),
      },
    }).promise();

    logger.info(`WABA connected for company ${companyId}: ${phoneNumber}`);
    res.send(popupHtml(true, `Connected: ${phoneNumber ?? 'WhatsApp Business'}`));
  } catch (err) {
    logger.error('WABA OAuth callback error', err?.response?.data ?? err.message);
    res.send(popupHtml(false, 'Connection failed — check app credentials'));
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

// ── POST /api/whatsapp/webhook — inbound messages ─────────────────────────────
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    if (change?.field !== 'messages') return;

    const messages = change.value?.messages ?? [];
    for (const msg of messages) {
      if (msg.type !== 'text') continue;
      const fromPhone = msg.from;
      const text = msg.text?.body ?? '';
      const waMessageId = msg.id;
      const timestamp = new Date(Number(msg.timestamp) * 1000).toISOString();

      // Find lead by phone across all companies (webhook doesn't carry companyId)
      const scanResult = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND phone = :phone',
        ExpressionAttributeValues: { ':prefix': 'LEAD#', ':meta': 'METADATA', ':phone': fromPhone },
        Limit: 1,
      }).promise();

      const lead = scanResult.Items?.[0];
      if (!lead) continue;

      await dynamodb.put({
        TableName: TABLE,
        Item: {
          PK: lead.PK,
          SK: `MSG#${timestamp}#${waMessageId}`,
          messageId: waMessageId,
          direction: 'inbound',
          content: text,
          type: 'text',
          timestamp,
          waMessageId,
        },
        ConditionExpression: 'attribute_not_exists(SK)',
      }).promise().catch(() => {});
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

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: pk,
        SK: `MSG#${timestamp}#${waMessageId ?? Date.now()}`,
        messageId: waMessageId,
        direction: 'outbound',
        content: message.trim(),
        type: 'text',
        sentBy: req.user.id,
        sentByName: req.user.name,
        timestamp,
        waMessageId,
      },
    }).promise();

    res.json({ success: true, messageId: waMessageId, timestamp });
  } catch (err) {
    logger.error('whatsapp/send error', err);
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
