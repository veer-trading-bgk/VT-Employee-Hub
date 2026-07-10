const express = require('express');
const { randomUUID } = require('crypto');
const { dedupPut } = require('../utils/dedupPut');
const axios = require('axios');
const S3 = require('aws-sdk/clients/s3');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { rateLimit } = require('../middleware/rateLimiter');
const { to10Digit } = require('../utils/phone');
const { ALLOWED_MIME, META_SIZE_LIMITS } = require('../utils/mediaConstants');
const { notifyCompany } = require('../utils/wsNotify');
const { resolveForInbox, resolveForLead, syncConvStatus, syncMarkRead } = require('../utils/conversationResolver');
const ConversationService  = require('../services/ConversationService');
const IntentDetectionService = require('../services/IntentDetectionService');
const AIService = require('../services/AIService');
const { sendAIError } = require('./ai');
const WASendSvc            = require('../services/WhatsAppSendService');
const TagService           = require('../services/TagService');
const ContactService       = require('../services/ContactService');
const { verifyMetaWebhookSignature } = require('../utils/verifyMetaWebhookSignature');
const { welcomeConfigSchema, delayedResponseConfigSchema, workingHoursConfigSchema, oooConfigSchema, branchSchema, stripStorageMetadata } = require('../utils/validation');
const { resolveWelcomeVariables, resolveTemplateParams } = require('../utils/welcomeVariables');
const { logAudit } = require('../utils/audit');
const { updateLeadLastMessage } = require('../utils/updateLeadLastMessage');
const ConversationalAgentService = require('../services/ConversationalAgentService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0'}`;
function getGraphUrl(cfg) {
  if (cfg?.graphApiVersion) return `https://graph.facebook.com/${cfg.graphApiVersion}`;
  return GRAPH;
}
const MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET;
if (!MEDIA_BUCKET) {
  throw new Error('WA_MEDIA_BUCKET env var is required but not set — refusing to start');
}
const s3Client = new S3({ region: process.env.AWS_REGION ?? 'ap-south-1' });

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

// Compute a plain-English root cause from health-check state (shown in UI and logs).
function computeRootCause(cfg, token, waba) {
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
  return null;
}

// Compute ordered remediation steps for the UI "Recommended Fix" section.
function computeRecommendedFix(cfg, token, waba) {
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
  return [];
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


// ── GET /api/whatsapp/connection — WABA connection status ──────────────────────
router.get('/connection', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg) return res.json({ connected: false });
    const configIssue = detectInvalidWabaConfig(cfg);
    res.json({
      connected: true,
      phoneNumber: cfg.phoneNumber,
      phoneNumberId: cfg.phoneNumberId,
      wabaId: cfg.wabaId,
      connectedAt: cfg.connectedAt,
      setupMethod: cfg.setupMethod ?? 'oauth',
      configValid: !configIssue,
      ...(configIssue && { configIssue }),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/config/full — full editable config for settings UI ─────
router.get('/config/full', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    const backendUrl = process.env.BACKEND_URL ?? '';
    const webhookCallbackUrl = `${backendUrl}/api/whatsapp/webhook`;
    if (!cfg) {
      return res.json({
        connected: false,
        accessTokenSet: false,
        accessTokenPreview: null,
        phoneNumberId: null,
        wabaId: null,
        phoneNumber: null,
        businessManagerId: null,
        graphApiVersion: cfg?.graphApiVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0',
        webhookVerifyTokenSet: !!(process.env.META_WEBHOOK_VERIFY_TOKEN),
        webhookCallbackUrl,
        connectedAt: null,
        setupMethod: null,
        configValid: false,
        configIssue: null,
      });
    }
    const configIssue = detectInvalidWabaConfig(cfg);
    const tok = cfg.accessToken ?? '';
    res.json({
      connected: true,
      accessTokenSet: !!tok,
      accessTokenPreview: tok ? `••••••${tok.slice(-6)}` : null,
      phoneNumberId: cfg.phoneNumberId ?? null,
      wabaId: cfg.wabaId ?? null,
      phoneNumber: cfg.phoneNumber ?? null,
      businessManagerId: cfg.businessManagerId ?? null,
      graphApiVersion: cfg.graphApiVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0',
      webhookVerifyTokenSet: !!(cfg.webhookVerifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN),
      webhookCallbackUrl,
      connectedAt: cfg.connectedAt ?? null,
      setupMethod: cfg.setupMethod ?? 'oauth',
      configValid: !configIssue,
      configIssue: configIssue ?? null,
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
  // Only the two WhatsApp-specific scopes this app is actually approved for —
  // a third, bare `business_management` (missing the whatsapp_ prefix; not the
  // same permission as whatsapp_business_management) was here too and made
  // Meta's OAuth dialog reject the whole request with "Invalid Scopes:
  // business_management" (2026-07-10). Confirmed against the two scope names
  // that already work for the manual System User token connect flow.
  url.searchParams.set('scope', 'whatsapp_business_management,whatsapp_business_messaging');
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
    // logger.error only extracts .message from Error instances — passing
    // err.response.data (a plain object) straight through renders as
    // "[object Object]" in CloudWatch. JSON.stringify it so the actual Meta
    // error is readable. Never logs err.config/err.request (carry the raw
    // access_token in the request params) — only response.data/message.
    logger.error('WABA OAuth callback error', JSON.stringify(err?.response?.data ?? { message: err.message }));
    res.send(popupHtml(false, 'Connection failed — check app credentials'));
  }
});

// ── POST /api/whatsapp/manual-connect — paste token + phone ID directly ───────
router.post('/manual-connect', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { accessToken, phoneNumberId, wabaId: explicitWabaId } = req.body;
    if (!accessToken?.trim() || !phoneNumberId?.trim()) {
      return res.status(400).json({ error: 'accessToken and phoneNumberId are required' });
    }

    // Fetch phone number details from Meta. whatsapp_business_account used to be
    // requested here to auto-detect the WABA ID, but it's not a field Meta's Graph
    // API actually supports on the phone number node -- requesting it throws
    // "(#100) Tried accessing nonexisting field" and fails the whole call (found
    // 2026-07-09 debugging a live reconnect failure). The settings form already
    // requires an explicit wabaId (page.tsx), and Path 2 below auto-discovers one
    // when it's absent, so this field was pure redundancy blocking every connect.
    let phoneNumber = null;
    try {
      const verifyRes = await axios.get(`${GRAPH}/${phoneNumberId.trim()}`, {
        params: { fields: 'display_phone_number,verified_name,id', access_token: accessToken.trim() },
      });
      phoneNumber = verifyRes.data?.display_phone_number ?? null;
    } catch (e) {
      // Never log e.config/e.request here — they carry the raw access_token in
      // the request params. Only e.response.data (Meta's own error body) and
      // e.response.status are safe; neither ever echoes the token back.
      const rawError = e.response?.data ?? { message: e.message };
      logger.error(
        `manual-connect: Meta rejected the phone-node lookup for phoneNumberId=${phoneNumberId.trim()} (status ${e.response?.status ?? 'n/a'})`,
        JSON.stringify(rawError),
      );
      return res.status(400).json({ error: 'Invalid credentials — Meta rejected the token or phone number ID', rawError });
    }

    // Resolve: explicit entry takes precedence; Path 2 below auto-discovers if absent
    let wabaId = explicitWabaId?.trim() || null;

    // Path 2: /me/whatsapp_business_accounts auto-discovery if no explicit WABA ID given
    if (!wabaId || wabaId === phoneNumberId.trim()) {
      try {
        const meRes = await axios.get(`${GRAPH}/me`, {
          params: {
            fields: 'id,name,whatsapp_business_accounts{id,name,phone_numbers{id}}',
            access_token: accessToken.trim(),
          },
          timeout: 10000,
        });
        const wabas = meRes.data?.whatsapp_business_accounts?.data ?? [];
        let meWabaId = null;
        for (const waba of wabas) {
          const phones = waba.phone_numbers?.data ?? [];
          if (phones.some((p) => p.id === phoneNumberId.trim())) { meWabaId = waba.id; break; }
        }
        if (!meWabaId && wabas.length === 1) meWabaId = wabas[0].id;
        if (meWabaId && meWabaId !== phoneNumberId.trim()) wabaId = meWabaId;
      } catch { /* silent — explicit wabaId still available if user provided it */ }
    }

    if (!wabaId) {
      return res.status(400).json({
        error: 'Could not determine your WABA ID automatically — the token may lack whatsapp_business_management permission. Click "Start Over" and enter your WABA ID manually (find it in Meta Business Suite → WhatsApp Accounts, not the API Setup page).',
        requiresManualWabaId: true,
      });
    }
    if (wabaId === phoneNumberId.trim()) {
      return res.status(400).json({
        error: 'WABA ID cannot equal Phone Number ID — these are different Meta identifiers. Your WABA ID is in Meta Business Suite → WhatsApp Accounts. Your Phone Number ID is in Meta Business Suite → API Setup.',
        requiresManualWabaId: true,
      });
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

// ── PUT /api/whatsapp/config — update existing WABA configuration ────────────
// Accepts all editable config fields. accessToken is optional (empty = keep stored value).
// If phoneNumberId or accessToken changed, validates the new pair against Meta before saving.
router.put('/config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg) {
      return res.status(400).json({ error: 'No existing configuration — connect first via Settings → WhatsApp.' });
    }

    const { accessToken: newToken, phoneNumberId: newPhoneId, wabaId: newWabaId, businessManagerId, graphApiVersion, webhookVerifyToken } = req.body;

    const phoneNumberId = (newPhoneId?.trim() || cfg.phoneNumberId)?.trim();
    const wabaId = (newWabaId?.trim() || cfg.wabaId)?.trim();
    if (!phoneNumberId) return res.status(400).json({ error: 'phoneNumberId is required' });
    if (!wabaId) return res.status(400).json({ error: 'wabaId is required' });
    if (phoneNumberId === wabaId) {
      return res.status(400).json({ error: 'phoneNumberId and wabaId must be different Meta identifiers. Check Meta Business Suite: Phone Number ID is in API Setup; WABA ID is in WhatsApp Accounts tab.' });
    }
    if (graphApiVersion?.trim() && !/^v\d+\.\d+$/.test(graphApiVersion.trim())) {
      return res.status(400).json({ error: 'graphApiVersion must be in format vNN.N (e.g. v25.0)' });
    }

    const resolvedToken = newToken?.trim() || cfg.accessToken;
    if (!resolvedToken) return res.status(400).json({ error: 'accessToken is required' });

    // Validate changed credentials against Meta
    const tokenChanged = !!(newToken?.trim()) && newToken.trim() !== cfg.accessToken;
    const phoneChanged = phoneNumberId !== cfg.phoneNumberId;
    if (tokenChanged || phoneChanged) {
      try {
        await axios.get(`${GRAPH}/${phoneNumberId}`, {
          params: { fields: 'id', access_token: resolvedToken },
          timeout: 10000,
        });
      } catch (e) {
        // Never log e.config/e.request — they carry the raw access_token in
        // the request params. Only e.response.data/status are safe.
        const rawError = e.response?.data ?? { message: e.message };
        logger.error(
          `PUT /config: Meta rejected credential verification for phoneNumberId=${phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
          JSON.stringify(rawError),
        );
        return res.status(400).json({ error: 'Could not verify credentials with Meta — check that the Phone Number ID and Access Token are correct and valid.', rawError });
      }
    }

    const now = new Date().toISOString();
    const updatedItem = {
      ...cfg,
      phoneNumberId,
      wabaId,
      accessToken: resolvedToken,
      updatedAt: now,
      updatedBy: req.user.id,
    };
    if (businessManagerId !== undefined) updatedItem.businessManagerId = businessManagerId?.trim() || null;
    if (graphApiVersion !== undefined) updatedItem.graphApiVersion = graphApiVersion?.trim() || null;
    if (webhookVerifyToken?.trim()) updatedItem.webhookVerifyToken = webhookVerifyToken.trim();

    await dynamodb.put({ TableName: TABLE, Item: updatedItem }).promise();

    // Update reverse-index if phone number ID changed
    if (phoneChanged) {
      await dynamodb.put({
        TableName: TABLE,
        Item: { PK: `CONFIG#PHONEID#${phoneNumberId}`, SK: 'CURRENT', companyId: req.user.companyId, phoneNumberId },
      }).promise();
      invalidatePhoneIdCache(cfg.phoneNumberId);
      invalidatePhoneIdCache(phoneNumberId);
    }

    logger.info(`WABA config updated for company ${req.user.companyId}`);
    res.json({ success: true, message: 'Configuration updated successfully.' });
  } catch (err) {
    logger.error('PUT /config error', err);
    next(err);
  }
});

// ── POST /api/whatsapp/connection/probe — pre-flight: validate token + auto-discover WABA ID ──
// Read-only (no DynamoDB writes). Verifies the phone node, then discovers the WABA ID via
// GET /me?fields=...,whatsapp_business_accounts{...} (requires whatsapp_business_management).
// (A prior "phone node whatsapp_business_account" discovery path was removed 2026-07-09 --
// Meta's Graph API doesn't support that field on the phone number node; requesting it threw
// "(#100) Tried accessing nonexisting field" and failed the whole call. See TECHNICAL_DEBT.md.)
// Returns { autoDiscovered, wabaId, phoneNumber, verifiedName, reason, rawError, requiresManualWabaId }
router.post('/connection/probe', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { accessToken, phoneNumberId } = req.body;
    if (!accessToken?.trim() || !phoneNumberId?.trim()) {
      return res.status(400).json({ error: 'accessToken and phoneNumberId are required' });
    }
    const pid = phoneNumberId.trim();
    const token = accessToken.trim();

    // ── Path 1: verify the phone node is reachable with this token ────────────
    let phoneData = null;
    let phoneError = null;
    try {
      const r = await axios.get(`${GRAPH}/${pid}`, {
        params: {
          fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating',
          access_token: token,
        },
        timeout: 10000,
      });
      phoneData = r.data;
    } catch (e) {
      phoneError = e.response?.data ?? { message: e.message };
      return res.json({
        phoneValid: false,
        autoDiscovered: false,
        wabaId: null,
        phoneNumber: null,
        verifiedName: null,
        reason: 'The Phone Number ID is invalid or this token cannot access it. Verify both values in Meta Business Suite → API Setup.',
        rawError: phoneError,
        requiresManualWabaId: false,
      });
    }

    // ── Path 2: /me/whatsapp_business_accounts — the only supported discovery path ─
    let meWabaId = null;
    let meError = null;
    try {
      const meRes = await axios.get(`${GRAPH}/me`, {
        params: {
          fields: 'id,name,whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number}}',
          access_token: token,
        },
        timeout: 10000,
      });
      const wabas = meRes.data?.whatsapp_business_accounts?.data ?? [];
      for (const waba of wabas) {
        const phones = waba.phone_numbers?.data ?? [];
        if (phones.some((p) => p.id === pid)) { meWabaId = waba.id; break; }
      }
      if (!meWabaId && wabas.length === 1) meWabaId = wabas[0].id;
    } catch (e) {
      meError = e.response?.data ?? { message: e.message };
    }

    if (meWabaId && meWabaId !== pid) {
      return res.json({
        phoneValid: true,
        autoDiscovered: true,
        discoveryMethod: 'user_waba_list',
        wabaId: meWabaId,
        phoneNumber: phoneData.display_phone_number ?? null,
        verifiedName: phoneData.verified_name ?? null,
        reason: null,
        rawError: null,
        requiresManualWabaId: false,
      });
    }

    // ── Discovery failed — diagnose why ───────────────────────────────────────
    let reason, rawError;
    if (meError) {
      reason = 'Your access token does not have the whatsapp_business_management permission. This permission is required to manage templates. You can (1) grant it to your System User in Meta Business Suite → System Users → Edit → Add Permissions, then regenerate the token; or (2) enter your WABA ID manually below — find it in Meta Business Suite → WhatsApp Accounts (the 15–16 digit number, different from the Phone Number ID in API Setup).';
      rawError = { code: 'MISSING_PERMISSION', missingPermission: 'whatsapp_business_management', phoneNodeResponse: phoneData, meApiError: meError };
    } else {
      reason = 'Could not determine WABA ID automatically. Enter it manually below — find it in Meta Business Suite → WhatsApp Accounts.';
      rawError = { phoneData, meError };
    }

    return res.json({
      phoneValid: true,
      autoDiscovered: false,
      wabaId: null,
      phoneNumber: phoneData.display_phone_number ?? null,
      verifiedName: phoneData.verified_name ?? null,
      reason,
      rawError,
      requiresManualWabaId: true,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/whatsapp/connection/repair — auto-fix or manually override wabaId ───────────────
// Body (optional): { wabaId: "..." } — explicit override skips auto-discovery.
// Without body: tries two auto-discovery paths (phone node, then /me).
// Both paths require whatsapp_business_management; if absent, returns requiresManualWabaId: true.
router.post('/connection/repair', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg) return res.status(400).json({ error: 'No WABA configuration to repair — connect first via Settings → WhatsApp.' });

    const explicitWabaId = req.body?.wabaId?.trim() ?? null;
    const oldWabaId = cfg.wabaId;

    // ── Path A: explicit manual override ──────────────────────────────────────
    if (explicitWabaId) {
      if (explicitWabaId === cfg.phoneNumberId) {
        return res.status(400).json({ error: 'WABA ID cannot equal Phone Number ID — enter the correct WABA ID from Meta Business Suite → WhatsApp Accounts.' });
      }
      const now = new Date().toISOString();
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `CONFIG#WABA#${req.user.companyId}`, SK: 'CURRENT' },
        UpdateExpression: 'SET wabaId = :wid, repairedAt = :ra, repairedBy = :rb, repairMethod = :rm',
        ExpressionAttributeValues: { ':wid': explicitWabaId, ':ra': now, ':rb': req.user.id, ':rm': 'manual' },
      }).promise();
      logger.info(`WABA config manually overridden for company ${req.user.companyId}: ${oldWabaId} → ${explicitWabaId}`);
      return res.json({ success: true, oldWabaId, newWabaId: explicitWabaId, method: 'manual', message: 'WABA ID manually corrected. Template submission will now use the correct ID.' });
    }

    // ── Path B1: verify the phone node is reachable, refresh its display data ──
    // whatsapp_business_account used to be requested here for WABA-ID auto-discovery,
    // but Meta's Graph API doesn't support it as a field on the phone number node --
    // requesting it threw "(#100) Tried accessing nonexisting field" and failed the
    // whole call before Path B2 ever ran (found 2026-07-09). Path B2 below is now the
    // sole auto-discovery path. See TECHNICAL_DEBT.md.
    let newWabaId = null;
    let phoneNumber = cfg.phoneNumber;
    let phoneData = null;
    try {
      const verifyRes = await axios.get(`${getGraphUrl(cfg)}/${cfg.phoneNumberId}`, {
        params: { fields: 'display_phone_number,verified_name,id', access_token: cfg.accessToken },
        timeout: 10000,
      });
      phoneData = verifyRes.data;
      phoneNumber = phoneData?.display_phone_number ?? phoneNumber;
    } catch (e) {
      // Never log e.config/e.request — they carry the raw access_token in
      // the request params. Only e.response.data/status are safe.
      const rawError = e.response?.data ?? { message: e.message };
      logger.error(
        `connection/repair: Meta rejected the phone-node lookup for phoneNumberId=${cfg.phoneNumberId} (status ${e.response?.status ?? 'n/a'})`,
        JSON.stringify(rawError),
      );
      return res.status(400).json({ error: 'Failed to reach Meta API — check that the stored access token is still valid.', requiresManualWabaId: true, rawError });
    }

    // ── Path B2: /me/whatsapp_business_accounts — the only supported discovery path ─
    if (!newWabaId || newWabaId === cfg.phoneNumberId) {
      try {
        const meRes = await axios.get(`${getGraphUrl(cfg)}/me`, {
          params: { fields: 'id,whatsapp_business_accounts{id,phone_numbers{id}}', access_token: cfg.accessToken },
          timeout: 10000,
        });
        const wabas = meRes.data?.whatsapp_business_accounts?.data ?? [];
        for (const waba of wabas) {
          const phones = waba.phone_numbers?.data ?? [];
          if (phones.some((p) => p.id === cfg.phoneNumberId)) { newWabaId = waba.id; break; }
        }
        if (!newWabaId && wabas.length === 1) newWabaId = wabas[0].id;
      } catch { /* silent */ }
    }

    if (!newWabaId) {
      return res.status(400).json({
        error: 'Auto-repair failed: the access token lacks whatsapp_business_management permission — Meta did not return a WABA ID. Enter your WABA ID manually using the field in the repair section, or grant the permission and regenerate the token.',
        requiresManualWabaId: true,
        rawPhoneResponse: phoneData,
      });
    }
    if (newWabaId === cfg.phoneNumberId) {
      return res.status(400).json({
        error: 'Auto-repair failed: Meta returned the Phone Number ID as the WABA ID. Enter your correct WABA ID manually using the field in the repair section.',
        requiresManualWabaId: true,
      });
    }

    const now = new Date().toISOString();
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#WABA#${req.user.companyId}`, SK: 'CURRENT' },
      UpdateExpression: 'SET wabaId = :wid, phoneNumber = :pn, repairedAt = :ra, repairedBy = :rb, repairMethod = :rm',
      ExpressionAttributeValues: { ':wid': newWabaId, ':pn': phoneNumber, ':ra': now, ':rb': req.user.id, ':rm': 'auto' },
    }).promise();

    logger.info(`WABA config auto-repaired for company ${req.user.companyId}: ${oldWabaId} → ${newWabaId}`);
    res.json({ success: true, oldWabaId, newWabaId, method: 'auto', message: 'WABA ID corrected automatically. Template submission and sync will now use the correct ID.' });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/connection/health — comprehensive WABA diagnostic ────────
router.get('/connection/health', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    const now = new Date().toISOString();
    const graphApiVersion = cfg?.graphApiVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0';

    if (!cfg) {
      return res.json({ success: true, connected: false, graphApiVersion, lastChecked: now, issues: ['No WABA configuration — connect via Settings → WhatsApp.'], rootCause: 'No WhatsApp configuration stored. Connect via Settings → WhatsApp.', recommendedFix: ['Connect WhatsApp via Settings → WhatsApp.'] });
    }

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

    // ── Token validity ─────────────────────────────────────────────────────────
    let token = { valid: false, scopes: [], scopesConfirmed: false, type: null, appId: null, expiresAt: null };
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (cfg.accessToken) {
      try {
        if (appId && appSecret) {
          const debugRes = await axios.get(`${getGraphUrl(cfg)}/debug_token`, {
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
          const meRes = await axios.get(`${getGraphUrl(cfg)}/me`, {
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

    // ── Phone number check ─────────────────────────────────────────────────────
    let phone = { accessible: false, id: cfg.phoneNumberId, displayNumber: cfg.phoneNumber, verifiedName: null, qualityRating: null, verificationStatus: null, status: null };
    if (cfg.phoneNumberId && cfg.accessToken) {
      try {
        const phoneRes = await axios.get(`${getGraphUrl(cfg)}/${cfg.phoneNumberId}`, {
          params: { fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status', access_token: cfg.accessToken },
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
      } catch {
        issues.push('Phone Number ID is inaccessible — check token permissions (whatsapp_business_messaging).');
      }
    }

    // ── WABA check (skip if config is known-invalid) ───────────────────────────
    let waba = { accessible: false, id: cfg.wabaId, name: null, reviewStatus: null, currency: null, templateNamespace: null, businessId: null };
    let webhooks = { subscribed: false, appId: null };
    if (cfg.wabaId && cfg.accessToken && !configIssue) {
      try {
        const wabaRes = await axios.get(`${getGraphUrl(cfg)}/${cfg.wabaId}`, {
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
        // ── Webhook subscription check (only if WABA is accessible) ───────────
        try {
          const whRes = await axios.get(`${getGraphUrl(cfg)}/${cfg.wabaId}/subscribed_apps`, {
            params: { access_token: cfg.accessToken },
            timeout: 8000,
          });
          const apps = whRes.data?.data ?? [];
          webhooks = { subscribed: apps.length > 0, appId: apps[0]?.id ?? null };
        } catch { /* non-fatal: webhooks check is best-effort */ }
      } catch {
        issues.push('WABA ID is inaccessible — the ID may be incorrect or the token lacks whatsapp_business_management permission.');
      }
    } else if (configIssue) {
      issues.push('WABA check skipped — configuration is invalid (WABA ID equals Phone Number ID).');
    }

    // ── Scope inference when debug_token is unavailable ────────────────────────
    // If scopes were not confirmed (no META_APP_ID/SECRET), infer from WABA accessibility.
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

    const rootCause = computeRootCause(config, token, waba);
    const recommendedFix = computeRecommendedFix(config, token, waba);

    res.json({
      success: true, connected: true,
      config, graphApiVersion, lastChecked: now,
      token, waba, phone, webhooks, capabilities,
      issues: [...new Set(issues)],
      rootCause,
      recommendedFix,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/whatsapp/connection/diagnose — raw Meta API responses for debugging ──────────────
// Returns unfiltered Graph API responses for all connection-related nodes.
// Use this when the health check shows issues and you need to see exactly what Meta returns.
router.get('/connection/diagnose', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg) return res.status(400).json({ error: 'No WABA configuration to diagnose.' });

    const results = {};

    // debug_token (requires META_APP_ID + META_APP_SECRET in Lambda env vars)
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret) {
      try {
        const r = await axios.get(`${getGraphUrl(cfg)}/debug_token`, {
          params: { input_token: cfg.accessToken, access_token: `${appId}|${appSecret}` },
          timeout: 10000,
        });
        results.debugToken = { status: 200, data: r.data };
      } catch (e) {
        results.debugToken = { status: e.response?.status ?? 0, data: e.response?.data ?? { message: e.message } };
      }
    } else {
      results.debugToken = { skipped: true, reason: 'META_APP_ID or META_APP_SECRET not set in Lambda env vars' };
    }

    // /me (token identity + business accounts)
    try {
      const r = await axios.get(`${getGraphUrl(cfg)}/me`, {
        params: { fields: 'id,name,whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number}}', access_token: cfg.accessToken },
        timeout: 10000,
      });
      results.me = { status: 200, data: r.data };
    } catch (e) {
      results.me = { status: e.response?.status ?? 0, data: e.response?.data };
    }

    // Phone number node (all available fields including whatsapp_business_account)
    if (cfg.phoneNumberId) {
      try {
        const r = await axios.get(`${getGraphUrl(cfg)}/${cfg.phoneNumberId}`, {
          params: {
            fields: 'id,display_phone_number,verified_name,code_verification_status,quality_rating,name_status,whatsapp_business_account',
            access_token: cfg.accessToken,
          },
          timeout: 10000,
        });
        results.phoneNode = { status: 200, nodeId: cfg.phoneNumberId, data: r.data };
      } catch (e) {
        results.phoneNode = { status: e.response?.status ?? 0, nodeId: cfg.phoneNumberId, data: e.response?.data };
      }
    }

    // WABA node (only if different from phone number ID)
    if (cfg.wabaId && cfg.wabaId !== cfg.phoneNumberId) {
      try {
        const r = await axios.get(`${getGraphUrl(cfg)}/${cfg.wabaId}`, {
          params: {
            fields: 'id,name,account_review_status,currency,message_template_namespace,on_behalf_of_business_info',
            access_token: cfg.accessToken,
          },
          timeout: 10000,
        });
        results.wabaNode = { status: 200, nodeId: cfg.wabaId, data: r.data };
      } catch (e) {
        results.wabaNode = { status: e.response?.status ?? 0, nodeId: cfg.wabaId, data: e.response?.data };
      }
    } else {
      results.wabaNode = { skipped: true, reason: cfg.wabaId === cfg.phoneNumberId ? 'wabaId === phoneNumberId (invalid config — both IDs are the same)' : 'No wabaId stored' };
    }

    res.json({
      success: true,
      graphApiVersion: cfg?.graphApiVersion ?? process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0',
      storedConfig: {
        wabaId: cfg.wabaId,
        phoneNumberId: cfg.phoneNumberId,
        phoneNumber: cfg.phoneNumber,
        setupMethod: cfg.setupMethod ?? 'oauth',
        connectedAt: cfg.connectedAt,
        repairedAt: cfg.repairedAt ?? null,
        repairMethod: cfg.repairMethod ?? null,
      },
      results,
    });
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

// Meta delivers a completed WhatsApp Flow answer as an inbound message with
// type: 'interactive', interactive.type: 'nfm_reply' — a distinct shape from
// a plain text reply, and from button_reply/list_reply (see isListReply below).
function isFlowResponse(msg) {
  return msg.type === 'interactive' && msg.interactive?.type === 'nfm_reply';
}

// nfm_reply.response_json is a JSON *string* of the flow's field answers,
// keyed by the field names the Flow JSON's screen components used — APForce
// doesn't have that Flow JSON (no in-app Flow builder, by design), so field
// keys are humanised best-effort rather than mapped to true labels.
function parseFlowResponse(msg) {
  const nfm = msg.interactive.nfm_reply;
  let fields = [];
  try {
    const parsed = JSON.parse(nfm.response_json ?? '{}');
    fields = Object.entries(parsed).map(([key, value]) => ({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  } catch (e) {
    logger.warn('flow_response JSON parse failed', e.message);
  }
  const summary = fields.length
    ? fields.map((f) => `${f.label}: ${f.value}`).join('\n')
    : (nfm.body || '[Flow response]');
  return { flowName: nfm.name ?? null, fields, summary };
}

// A tap on a welcome-message reply button (max 3, quick-reply type) arrives
// as type: 'interactive', interactive.type: 'button_reply'. This is the ONLY
// button tap Meta reports via webhook — CTA buttons (url/phone, sent as
// interactive.type: 'cta_url' or via a template's button component) generate
// NO webhook event when tapped at all. That is a Meta platform limitation,
// not a gap in this handler: there is no event to parse, ever, for a CTA tap.
function isButtonReply(msg) {
  return msg.type === 'interactive' && msg.interactive?.type === 'button_reply';
}

function parseButtonReply(msg) {
  const br = msg.interactive.button_reply;
  return { id: br?.id ?? null, title: br?.title || '[Button reply]' };
}

// A tap on a Message+List row (the send_list automation node's Interactive List
// message) arrives as type: 'interactive', interactive.type: 'list_reply' — a
// separate shape from button_reply above, with an extra optional `description`
// field. Previously unhandled entirely: silently dropped by the type guard
// below (not stored, no WS push) since no feature sent list messages before
// tonight's Message+List node existed.
function isListReply(msg) {
  return msg.type === 'interactive' && msg.interactive?.type === 'list_reply';
}

function parseListReply(msg) {
  const lr = msg.interactive.list_reply;
  return { id: lr?.id ?? null, title: lr?.title || '[List selection]', description: lr?.description ?? null };
}

// Sends the configured welcome message on first contact — exactly one of
// three shapes, never combined in one message (Meta platform rule): a
// template, reply buttons (max 3, trackable via isButtonReply above), or a
// single URL CTA button (untrackable — see isButtonReply's comment).
//
// waName (optional): the contact's WhatsApp profile name, if Meta sent one
// on this webhook. Used only to resolve {{name}}/{{phone}}/{{source}} in the
// free-text reply_buttons/cta_buttons bodyText — see utils/welcomeVariables.js.
// The templateName branch does NOT need this: real Meta templates substitute
// {{n}} server-side via sendTemplate()'s own variables array, an entirely
// different, already-correct mechanism.
// source: always 'whatsapp' in practice — this function is only ever reached
// from the inbound-WhatsApp-webhook first-contact branch (see its one call
// site below), which is the sole channel welcome messages fire on.
async function sendWelcomeMessage(companyId, phone10, cfg, systemUser, waName = null, source = 'whatsapp') {
  if (cfg.messageType === 'reply_buttons' && cfg.bodyText && (cfg.buttons ?? []).length > 0) {
    const interactive = {
      type: 'button',
      body: { text: resolveWelcomeVariables(cfg.bodyText, { name: waName, phone: phone10, source }) },
      action: { buttons: cfg.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
    };
    return WASendSvc.sendInteractive(companyId, { phone: phone10 }, interactive, systemUser);
  }
  if (cfg.messageType === 'cta_buttons' && cfg.bodyText && (cfg.ctaButtons ?? []).length > 0) {
    const cta = cfg.ctaButtons[0]; // schema caps ctaButtons at 1 — see validation.js comment
    const interactive = {
      type: 'cta_url',
      body: { text: resolveWelcomeVariables(cfg.bodyText, { name: waName, phone: phone10, source }) },
      action: { name: 'cta_url', parameters: { display_text: cta.text, url: cta.value } },
    };
    return WASendSvc.sendInteractive(companyId, { phone: phone10 }, interactive, systemUser);
  }
  if (cfg.templateName) {
    // messageType === 'template', or a legacy pre-messageType config (backward compatible)
    return WASendSvc.sendTemplate(companyId, { phone: phone10 }, { templateName: cfg.templateName, language: cfg.language ?? 'en' }, [], systemUser);
  }
  return null;
}

// Fires the configured follow-up (if any) for a tapped welcome-message reply
// button. Looked up live from the CURRENT CONFIG#WELCOME record by button id
// — if the admin edited the welcome message's buttons after it was sent to
// this customer, an id that no longer matches simply fires no follow-up
// (same as followUp.type === 'none') rather than guessing at stale config.
async function fireButtonFollowUp(companyId, target, buttonId, systemUser) {
  try {
    const wc = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#WELCOME#${companyId}`, SK: 'CURRENT' } }).promise();
    const button = (wc.Item?.buttons ?? []).find((b) => b.id === buttonId);
    const followUp = button?.followUp;
    if (!followUp || followUp.type === 'none') return;

    switch (followUp.type) {
      case 'text':
        await WASendSvc.sendText(companyId, target, followUp.content?.message ?? '', systemUser);
        break;
      case 'image':
        await WASendSvc.sendMedia(companyId, target, {
          mediaType: 'image',
          mediaId: followUp.content?.mediaId,
          url: followUp.content?.url,
          caption: followUp.content?.caption,
        }, systemUser);
        break;
      case 'url_button': {
        // Its own separate message — legal per the platform rule, since it is
        // not combined with the reply buttons that triggered it.
        const interactive = {
          type: 'cta_url',
          body: { text: followUp.content?.message ?? '' },
          action: {
            name: 'cta_url',
            parameters: { display_text: followUp.content?.buttonText ?? 'Open', url: followUp.content?.url },
          },
        };
        await WASendSvc.sendInteractive(companyId, target, interactive, systemUser);
        break;
      }
      case 'flow':
        await sendRegisteredFlow(companyId, target, followUp.content?.flowId, systemUser);
        break;
    }
  } catch (e) {
    logger.warn('welcome button follow-up failed: ' + e.message);
  }
}

// Bounds an awaited automation dispatch inside the webhook handler so one slow
// user-configured action can never push this invocation toward the hard ceiling
// both Lambda's own configured Timeout and API Gateway's HTTP API integration
// TimeoutInMillis share (30000ms, confirmed 2026-07-06 via `aws lambda
// get-function-configuration` / `aws apigatewayv2 get-integrations`) — neither
// Meta's Graph API Webhooks docs nor the WhatsApp Cloud API webhook-setup docs
// publish a response-time SLA to plan against instead, so our own infra ceiling
// is the binding constraint. 5s is a wide margin over a single Graph API
// round-trip while leaving ~20s of headroom even if more than one at-risk call
// applies to the same inbound message. On timeout this resolves (not rejects)
// so the webhook proceeds — falling back to the pre-fix behavior for just that
// one slow call, rather than blocking every message behind it.
const AUTOMATION_DISPATCH_TIMEOUT_MS = 5000;
function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger.warn(`webhook: ${label} exceeded ${AUTOMATION_DISPATCH_TIMEOUT_MS}ms budget — continuing without waiting further`);
      resolve();
    }, AUTOMATION_DISPATCH_TIMEOUT_MS);
    timer.unref?.(); // never keep the process alive on this timer alone (Lambda or test runner)
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── POST /api/whatsapp/webhook — inbound messages + delivery/read statuses ────
router.post('/webhook', async (req, res) => {
  if (!verifyMetaWebhookSignature(req)) {
    logger.warn('WhatsApp webhook signature verification failed');
    return res.sendStatus(401);
  }
  logger.info(`webhook recv field=${req.body?.entry?.[0]?.changes?.[0]?.field} msgs=${req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.length ?? 0} statuses=${req.body?.entry?.[0]?.changes?.[0]?.value?.statuses?.length ?? 0}`);
  // res.sendStatus(200) is called at the END of this handler so that
  // notifyCompany() (WS push) fires inside the active Lambda invocation.
  // Resolving serverless-http's response earlier freezes the execution
  // context and suspends all async work until the next warm request.
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];

    // ── Template status update webhook ────────────────────────────────────────
    if (change?.field === 'message_template_status_update') {
      const ev = change.value ?? {};
      const { message_template_id, message_template_name, event, reason } = ev;
      if (message_template_id && event) {
        const statusMap = {
          APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING: 'PENDING',
          PAUSED: 'PAUSED', DISABLED: 'DISABLED', FLAGGED: 'FLAGGED',
          IN_APPEAL: 'IN_APPEAL', REINSTATED: 'REINSTATED',
          PENDING_DELETION: 'PENDING_DELETION',
        };
        const newStatus = statusMap[event] ?? event;
        const now = new Date().toISOString();
        const wabaId = entry?.id;
        let companyId = null;
        if (wabaId) {
          // WABA config is keyed by companyId (CONFIG#WABA#${companyId}), not by wabaId.
          // Scan WABA config items and match by wabaId attribute.
          const scan = await dynamodb.scan({
            TableName: TABLE,
            FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND wabaId = :wid',
            ExpressionAttributeValues: { ':prefix': 'CONFIG#WABA#', ':sk': 'CURRENT', ':wid': wabaId },
          }).promise().catch(() => ({ Items: [] }));
          companyId = scan.Items?.[0]?.companyId ?? null;
        }
        if (companyId && message_template_name) {
          const tmplScan = await dynamodb.query({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            FilterExpression: 'templateName = :tn',
            ExpressionAttributeValues: {
              ':pk': `CONFIG#TMPL#${companyId}`, ':sk': 'TMPL#', ':tn': message_template_name,
            },
          }).promise().catch(() => ({ Items: [] }));
          const tmpl = tmplScan.Items?.[0];
          if (tmpl) {
            const historyEntry = { status: newStatus, ts: now, reason: reason ?? null };
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: tmpl.PK, SK: tmpl.SK },
              UpdateExpression: 'SET #s = :s, rejectedReason = :r, updatedAt = :ua, statusHistory = list_append(if_not_exists(statusHistory, :empty), :h)',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':s': newStatus, ':r': reason ?? null,
                ':ua': now, ':h': [historyEntry], ':empty': [],
              },
            }).promise().catch((e) => logger.warn('template status webhook DDB update failed', e.message));
          }
        }
      }
      res.sendStatus(200);
      return;
    }

    if (change?.field !== 'messages') { res.sendStatus(200); return; }

    const phoneNumberId = change.value?.metadata?.phone_number_id;
    const messages = change.value?.messages ?? [];
    // Meta includes contacts[].profile.name alongside messages — build a lookup by phone
    const waNameByPhone = Object.fromEntries(
      (change.value?.contacts ?? [])
        .filter((c) => c.wa_id && c.profile?.name)
        .flatMap((c) => [[c.wa_id, c.profile.name], [to10Digit(c.wa_id), c.profile.name]])
    );

    // Resolve company once per webhook entry — scopes all lead lookups and inbox writes
    const wabaConfig = phoneNumberId ? await getCompanyByPhoneNumberId(phoneNumberId) : null;
    const webhookCompanyId = wabaConfig?.companyId ?? null;
    logger.info(`webhook resolved companyId=${webhookCompanyId ?? 'UNRESOLVED'} phoneNumberId=${phoneNumberId ?? 'NONE'}`);
    if (!webhookCompanyId) {
      logger.warn(`Webhook received for unrecognised phoneNumberId: ${phoneNumberId ?? '(none)'} — no company configured for this number`);
    }

    // ── Handle message status updates (delivered / read) ──────────────────────
    const statuses = change.value?.statuses ?? [];
    for (const statusUpdate of statuses) {
      try {
        const wamid = statusUpdate.id;
        const statusType = statusUpdate.status; // 'sent'|'delivered'|'read'|'failed'
        if (!['delivered', 'read', 'failed'].includes(statusType)) continue;

        const lookup = await dynamodb.get({
          TableName: TABLE,
          Key: { PK: `WAMID#${wamid}`, SK: 'LOOKUP' },
        }).promise();
        if (!lookup.Item) continue;

        const { leadPK, msgSK, broadcastId, broadcastSK, campaignId, companyId: cid } = lookup.Item;

        // Update MSG# record — priority order: failed < sent < delivered < read
        // 'failed' always overwrites (message can't recover); read can't be downgraded
        const priorityOrder = { failed: 0, sent: 1, delivered: 2, read: 3 };
        const conditionExpr = statusType === 'failed'
          ? 'attribute_not_exists(msgStatus) OR msgStatus <> :read'
          : 'attribute_not_exists(msgStatus) OR msgStatus <> :read';
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: msgSK },
          UpdateExpression: 'SET msgStatus = :s',
          ConditionExpression: conditionExpr,
          ExpressionAttributeValues: { ':s': statusType, ':read': 'read' },
        }).promise().catch(() => {});

        // Increment broadcast stats if this came from a broadcast
        if (broadcastId && broadcastSK && cid) {
          const field = statusType === 'delivered' ? 'deliveredCount'
            : statusType === 'read' ? 'readCount'
            : statusType === 'failed' ? 'failedCount'
            : null;
          if (field) {
            // #f aliases the dynamic field name — never interpolate it raw into the
            // UpdateExpression. Today's 3 possible values aren't DynamoDB reserved
            // words, but a future addition to this map silently could be (see
            // AutomationEngine.js's _finalizeExecution() 'path' incident, 2026-07-06).
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: `BROADCAST#${cid}`, SK: broadcastSK },
              UpdateExpression: 'ADD #f :one',
              ExpressionAttributeNames: { '#f': field },
              ExpressionAttributeValues: { ':one': 1 },
            }).promise().catch(() => {});
          }
        }

        // Increment campaign stats if this came from a campaign send
        if (campaignId && cid) {
          const campField = statusType === 'delivered' ? 'stats.delivered'
            : statusType === 'read' ? 'stats.read'
            : statusType === 'failed' ? 'stats.failed'
            : null;
          if (campField) {
            // Same #-alias discipline as the broadcast-stats update above — campField
            // is always a two-segment "stats.X" document path, both segments aliased.
            const [outerField, innerField] = campField.split('.');
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: `CONFIG#CAMP#${cid}`, SK: `CAMP#${campaignId}` },
              UpdateExpression: 'ADD #o.#i :one',
              ExpressionAttributeNames: { '#o': outerField, '#i': innerField },
              ExpressionAttributeValues: { ':one': 1 },
            }).promise().catch(() => {});
          }
        }
      } catch (e) {
        logger.warn('status-update failed', e.message);
      }
    }

    // Eagerly write ACTIVITY# with server-time BEFORE the slow lead-scan +
    // media-download chain.  The 2 s ping detects new messages in ≤2 s instead
    // of the previous 15–20 s that storeInboundMedia was adding to the delay.
    const INBOUND_MSG_TYPES = ['text', 'image', 'document', 'audio', 'video', 'sticker'];
    if (webhookCompanyId && messages.some((m) => INBOUND_MSG_TYPES.includes(m.type) || isFlowResponse(m) || isButtonReply(m) || isListReply(m))) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `ACTIVITY#${webhookCompanyId}`, SK: 'WA' },
        UpdateExpression: 'SET lastActivityAt = :now',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      }).promise().catch(() => {});
    }

    for (const msg of messages) {
      const { type, from: fromPhone, id: waMessageId, timestamp: ts } = msg;
      const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];
      const flowResp = isFlowResponse(msg) ? parseFlowResponse(msg) : null;
      const buttonReply = isButtonReply(msg) ? parseButtonReply(msg) : null;
      const listReply = isListReply(msg) ? parseListReply(msg) : null;
      if (type !== 'text' && !MEDIA_TYPES.includes(type) && !flowResp && !buttonReply && !listReply) continue;

      const timestamp = new Date(Number(ts) * 1000).toISOString();
      const phone10 = to10Digit(fromPhone);
      const waName = waNameByPhone[phone10] ?? waNameByPhone[fromPhone] ?? null;

      // Extract content + media metadata
      let text = '';
      let mediaId = null;
      let mimeType = null;
      let filename = null;
      if (type === 'text') {
        text = msg.text?.body ?? '';
      } else if (flowResp) {
        text = flowResp.summary;
      } else if (buttonReply) {
        text = buttonReply.title;
      } else if (listReply) {
        text = listReply.title;
      } else {
        const m = msg[type] ?? {};
        mediaId = m.id ?? null;
        mimeType = m.mime_type ?? null;
        filename = m.filename ?? null;
        text = m.caption ?? `[${type}]`;
      }

      // Skip message if we can't determine which company owns this WhatsApp number
      if (!webhookCompanyId) continue;

      // Find lead by normalised phone via GSI — O(1) instead of full-table Scan.
      // phoneNorm = to10Digit(phone) is written to every lead METADATA item by the
      // CRM routes. The company-phone-index GSI lets us look up by companyId + phoneNorm.
      const t0 = Date.now();
      const queryResult = await dynamodb.query({
        TableName: TABLE,
        IndexName: 'company-phone-index',
        KeyConditionExpression: 'companyId = :cid AND phoneNorm = :p',
        ExpressionAttributeValues: {
          ':cid': webhookCompanyId,
          ':p': phone10,
        },
        Limit: 1,
      }).promise();
      const lead = queryResult.Items?.[0];
      logger.info(`[wh:${waMessageId}] gsi-query=${Date.now()-t0}ms lead=${!!lead}`);

      // s3Key is patched onto the MSG# record asynchronously after notifyCompany fires,
      // so media download does not block the WS push.
      const msgItem = {
        direction: 'inbound', content: text,
        type: flowResp ? 'flow_response' : buttonReply ? 'button_reply' : listReply ? 'list_reply' : type,
        timestamp, waMessageId, messageId: waMessageId,
        ...(mediaId && { mediaId, mimeType, filename }),
        ...(flowResp && { flowName: flowResp.flowName, flowFields: flowResp.fields }),
        ...(buttonReply && { buttonId: buttonReply.id }),
        ...(listReply && { listReplyId: listReply.id, ...(listReply.description && { listReplyDescription: listReply.description }) }),
      };

      if (lead) {
        // ── Campaign reply tracking ────────────────────────────────────────────
        // If the most recent message on this thread was an outbound campaign send
        // still awaiting a reply, this inbound message satisfies it. The guarded
        // update on the MSG# record ensures Meta's webhook retries never double-count.
        try {
          const lastMsgQuery = await dynamodb.query({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
            ExpressionAttributeValues: { ':pk': lead.PK, ':pfx': 'MSG#' },
            ScanIndexForward: false,
            Limit: 1,
          }).promise();
          const lastMsg = lastMsgQuery.Items?.[0];
          if (lastMsg?.direction === 'outbound' && lastMsg.campaignId && !lastMsg.repliedCounted) {
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: lead.PK, SK: lastMsg.SK },
              UpdateExpression: 'SET repliedCounted = :t',
              ConditionExpression: 'attribute_not_exists(repliedCounted)',
              ExpressionAttributeValues: { ':t': true },
            }).promise();
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: `CONFIG#CAMP#${webhookCompanyId}`, SK: `CAMP#${lastMsg.campaignId}` },
              UpdateExpression: 'ADD stats.replied :one',
              ExpressionAttributeValues: { ':one': 1 },
            }).promise();
          }
        } catch (e) {
          if (e.code !== 'ConditionalCheckFailedException') logger.warn('campaign reply tracking failed', e.message);
        }

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
          if (waName) {
            dynamodb.update({
              TableName: TABLE,
              Key: { PK: lead.PK, SK: 'METADATA' },
              UpdateExpression: 'SET waName = :wn',
              ExpressionAttributeValues: { ':wn': waName },
            }).promise().catch(() => {});
          }
          if (mediaId) writeMediaIndex(webhookCompanyId, lead.PK.split('#')[2], { leadPK: lead.PK, mediaId, mimeType, filename: filename ?? null, direction: 'inbound', timestamp });
          if (lead.chatStatus === 'resolved') {
            await dynamodb.update({
              TableName: TABLE,
              Key: { PK: lead.PK, SK: 'METADATA' },
              UpdateExpression: 'SET chatStatus = :s',
              ExpressionAttributeValues: { ':s': 'open' },
            }).promise().catch(() => {});
          }
          logger.info(`[wh:${waMessageId}] notifyCompany firing companyId=${webhookCompanyId}`);
          await notifyCompany(webhookCompanyId, {
            event: 'whatsapp_message',
            conversationId: lead.leadId,
            from: fromPhone,
            preview: text.slice(0, 100),
            message: { SK: `MSG#${timestamp}#${waMessageId}`, ...msgItem },
          }).catch(() => {});
          logger.info(`[wh:${waMessageId}] notified (lead) total=${Date.now()-t0}ms`);
          // S3 media archive is fire-and-forget — does not block the response or the
          // WS push. The MSG# item is already visible to the browser; s3Key is patched
          // in asynchronously. If Lambda freezes before this completes, it resumes on
          // the next warm invocation (the item already exists so dedupPut is a no-op).
          if (mediaId) {
            storeInboundMedia(wabaConfig?.accessToken, mediaId, mimeType, webhookCompanyId)
              .then((s3Key) => {
                if (!s3Key) return;
                return dynamodb.update({
                  TableName: TABLE,
                  Key: { PK: lead.PK, SK: `MSG#${timestamp}#${waMessageId}` },
                  UpdateExpression: 'SET s3Key = :sk',
                  ExpressionAttributeValues: { ':sk': s3Key },
                }).promise();
              })
              .catch(() => {});
          }
          // Fire-and-forget: create/update CONV# entity for this WhatsApp thread.
          // Chained (not a second independent call) so intent classification only
          // ever runs once conversation resolution has actually completed and we
          // have a real conversationId — still never awaited, so it can never delay
          // this response. Plain 'text' only: media/button-reply/flow-response
          // either have no meaningful free text to classify or already carry
          // unambiguous structured intent.
          resolveForLead(webhookCompanyId, lead.PK, phone10, { text, timestamp })
            .then((conv) => {
              if (conv?.conversationId && type === 'text') {
                return IntentDetectionService.classifyIfNeededForLead(webhookCompanyId, conv.conversationId, lead.PK, text);
              }
            })
            .catch(() => {});
          // "Delayed Response Message" (Item 3) — independent of the CONV#/intent
          // chain above, since it doesn't need a conversationId. Reuses
          // AutomationEngine's AUTO_WAIT# timer infra; no-ops if disabled or
          // already pending (see DelayedResponseService.scheduleIfEnabled).
          require('../services/DelayedResponseService')
            .scheduleIfEnabled(webhookCompanyId, { phone: phone10, leadPK: lead.PK, name: lead.name, source: lead.source })
            .catch(() => {});
          // Autonomous AI conversation (2026-07-06, Era 22) — continues an
          // already-bot-active conversation (no-ops for every other lead: a
          // human-handled one, or one never started, or already handed off).
          // Checked BEFORE OOO/keyword_message so a conversation the AI is
          // actively carrying doesn't also get a second, unrelated automated
          // reply stacked on top of the same inbound message. Awaited — same
          // Era 20 discipline as everything else in this handler.
          let botHandled = false;
          if (type === 'text') {
            botHandled = await ConversationalAgentService.continueTurn(webhookCompanyId, {
              leadPK: lead.PK, lead, phone10, text, timestamp,
            });
          }
          // Out of Office (Item 2) — a known lead never gets a Welcome message
          // (that's first-contact only, see the INBOX# branch below), so there
          // is no precedence conflict to resolve on this path: OOO just fires
          // on its own terms whenever the business is closed, UNLESS the AI
          // conversation agent already handled this message — the AI operates
          // 24/7 and doesn't need an office-hours message stacked on top of its
          // own reply. Awaited + try/catch, matching the existing
          // Welcome-message block's own style.
          if (!botHandled) {
            try {
              const WorkingHoursService = require('../services/WorkingHoursService');
              if (await WorkingHoursService.shouldSendOOO(webhookCompanyId, { leadPK: lead.PK })) {
                await WorkingHoursService.sendOOO(webhookCompanyId, { leadPK: lead.PK, phone: phone10, name: lead.name, source: lead.source });
              }
            } catch (e) { logger.warn('OOO message failed: ' + e.message); }
          }
          // A tap on a welcome-message reply button — fire its configured
          // follow-up, if any (see fireButtonFollowUp's own internal try/catch).
          if (buttonReply) {
            await fireButtonFollowUp(webhookCompanyId, { leadPK: lead.PK }, buttonReply.id, { id: 'system', role: 'admin', name: 'System' });
            // Independent of welcome-message follow-ups: resume any paused automation
            // graph execution whose button_reply condition node is waiting on this exact
            // tap (branching automation builder, Phase 1 — see AutomationEngine.js).
            // Awaited (bounded) since 2026-07-06 — see 19_DECISION_LOG.md Era 20: an
            // un-awaited resume can freeze mid-flight when the Lambda execution context
            // suspends right after this response resolves.
            await withTimeout(
              require('../services/AutomationEngine')
                .resumeOnButtonReply(webhookCompanyId, phone10, buttonReply.id)
                .catch((e) => logger.warn('automation button-reply resume failed: ' + e.message)),
              'resumeOnButtonReply',
            );
          }
          // Keyword / button-tap trigger — fires on EVERY inbound text message or
          // button/list tap (unlike whatsapp_conversation_started below, which only
          // fires once ever). fireTrigger() itself no-ops cheaply when no active
          // workflow uses this trigger type. `text` already holds the right string
          // for all three cases: the typed body, or the tapped button/row title.
          // Skipped when the AI conversation agent already handled this message —
          // same reasoning as the OOO gate just above. Awaited (bounded) since
          // 2026-07-06 — see the resumeOnButtonReply comment above; same freeze
          // risk, same fix.
          if (!botHandled && text && (type === 'text' || buttonReply || listReply)) {
            await withTimeout(
              require('../services/AutomationEngine').fireTrigger(webhookCompanyId, 'keyword_message', {
                leadId: lead.leadId, leadPK: lead.PK, phone: phone10, name: lead.name,
                stage: lead.stage, tags: lead.tags ?? [], assignedTo: lead.assignedTo,
                source: 'whatsapp', messageText: text,
              }).catch((e) => logger.warn('keyword trigger fire failed: ' + e.message)),
              'fireTrigger(keyword_message)',
            );
          }
        }
      } else {
        const companyId = webhookCompanyId; // already resolved above
        const PK = `INBOX#${companyId}#${phone10}`;

        // Is this the first message from this contact?
        const existingContact = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'CONTACT' } }).promise();
        const isFirstContact = !existingContact.Item;

        let isNewMsg = false;
        let botEngaged = false;
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
            UpdateExpression: 'SET phone = if_not_exists(phone, :ph), companyId = if_not_exists(companyId, :cid), createdAt = if_not_exists(createdAt, :ts), lastMessageAt = :lma, lastMessagePreview = :prev, lastMessageDirection = :dir, unreadCount = if_not_exists(unreadCount, :zero) + :one'
              + (waName ? ', waName = :wn' : ''),
            ExpressionAttributeValues: {
              ':ph': phone10, ':cid': companyId, ':ts': timestamp, ':lma': timestamp,
              ':prev': text.slice(0, 100), ':dir': 'inbound', ':zero': 0, ':one': 1,
              ...(waName && { ':wn': waName }),
            },
          }).promise();
          // Keep ACTIVITY# current (use server time to stay ahead of WhatsApp ts).
          await dynamodb.update({
            TableName: TABLE,
            Key: { PK: `ACTIVITY#${companyId}`, SK: 'WA' },
            UpdateExpression: 'SET lastActivityAt = :now',
            ExpressionAttributeValues: { ':now': new Date().toISOString() },
          }).promise().catch(() => {});
          logger.info(`[wh:${waMessageId}] notifyCompany firing companyId=${companyId} (inbox path)`);
          await notifyCompany(companyId, {
            event: 'whatsapp_message',
            conversationId: null,
            from: fromPhone,
            phone: phone10,
            preview: text.slice(0, 100),
            isUnknown: true,
            message: { SK: `MSG#${timestamp}#${waMessageId}`, ...msgItem },
          }).catch(() => {});
          logger.info(`[wh:${waMessageId}] notified (inbox) total=${Date.now()-t0}ms`);
          if (mediaId) {
            storeInboundMedia(wabaConfig?.accessToken, mediaId, mimeType, webhookCompanyId)
              .then((s3Key) => {
                if (!s3Key) return;
                return dynamodb.update({
                  TableName: TABLE,
                  Key: { PK, SK: `MSG#${timestamp}#${waMessageId}` },
                  UpdateExpression: 'SET s3Key = :sk',
                  ExpressionAttributeValues: { ':sk': s3Key },
                }).promise();
              })
              .catch(() => {});
          }
          // Fire-and-forget: create/update CONV# entity for this unknown-contact thread.
          // Chained the same way as the lead path above — see that comment.
          resolveForInbox(companyId, phone10, { inboxPK: PK, text, timestamp, waName })
            .then((conv) => {
              if (conv?.conversationId && type === 'text') {
                return IntentDetectionService.classifyIfNeededForInbox(companyId, conv.conversationId, PK, text);
              }
            })
            .catch(() => {});
          // "Delayed Response Message" (Item 3) — see the lead-path comment above.
          require('../services/DelayedResponseService')
            .scheduleIfEnabled(companyId, { phone: phone10, inboxPK: PK, name: waName, source: 'whatsapp' })
            .catch(() => {});
          // Autonomous AI conversation (2026-07-06, Era 22) — the ONLY entry
          // point that starts one, and only on a genuinely first-ever message.
          // Internally resolves-or-creates a real CRM lead (CIS, ADR-013) and
          // only actually engages if that lead comes back unassigned — see
          // ConversationalAgentService.maybeStart()'s own doc comment for why
          // "new/unassigned" is checked against the real post-creation state,
          // not assumed. Checked BEFORE OOO/Welcome/keyword_message/
          // whatsapp_conversation_started so none of them stack a second,
          // unrelated automated reply on top of the AI's own first turn.
          if (isFirstContact && type === 'text') {
            botEngaged = await ConversationalAgentService.maybeStart(companyId, {
              phone10, waName, text, timestamp, waMessageId,
            });
          }
          // A tap on a welcome-message reply button — fire its configured
          // follow-up, if any. Still possible here: the customer may still be
          // an unknown (INBOX#) contact when they tap, if no lead was created
          // between the welcome send and the reply.
          if (!botEngaged && buttonReply) {
            await fireButtonFollowUp(companyId, { phone: phone10 }, buttonReply.id, { id: 'system', role: 'admin', name: 'System' });
            // Independent of welcome-message follow-ups: resume any paused automation
            // graph execution whose button_reply condition node is waiting on this exact
            // tap (branching automation builder, Phase 1 — see AutomationEngine.js).
            // Awaited (bounded) since 2026-07-06 — see 19_DECISION_LOG.md Era 20.
            await withTimeout(
              require('../services/AutomationEngine')
                .resumeOnButtonReply(companyId, phone10, buttonReply.id)
                .catch((e) => logger.warn('automation button-reply resume failed: ' + e.message)),
              'resumeOnButtonReply',
            );
          }
          // Keyword / button-tap trigger — see the identical lead-path block above
          // for the full comment; same trigger, same matching rules, unknown-contact
          // context shape (no leadId/leadPK) instead. Skipped when the AI
          // conversation agent already handled this message — same reasoning as
          // the OOO/Welcome gates below. Awaited (bounded) since 2026-07-06 —
          // same freeze risk, same fix.
          if (!botEngaged && text && (type === 'text' || buttonReply || listReply)) {
            await withTimeout(
              require('../services/AutomationEngine').fireTrigger(companyId, 'keyword_message', {
                phone: phone10, name: waName ?? null, source: 'whatsapp', tags: [],
                messageText: text,
              }).catch((e) => logger.warn('keyword trigger fire failed: ' + e.message)),
              'fireTrigger(keyword_message)',
            );
          }
        }

        // Out of Office (Item 2) — checked on EVERY new message (not just
        // first contact), unlike Welcome. PRECEDENCE RULE: if OOO fires here,
        // Welcome is skipped entirely for this message, even on a contact's
        // very first message — see WorkingHoursService.js's own doc comment
        // for the full reasoning. The two can never both fire for the same
        // inbound message. Also skipped entirely when the AI conversation
        // agent already handled this message (2026-07-06) — the AI operates
        // 24/7 and doesn't need an office-hours message stacked on its own reply.
        let oooSent = false;
        if (isNewMsg && !botEngaged) {
          try {
            const WorkingHoursService = require('../services/WorkingHoursService');
            if (await WorkingHoursService.shouldSendOOO(companyId, { inboxPK: PK })) {
              await WorkingHoursService.sendOOO(companyId, { inboxPK: PK, phone: phone10, name: waName, source: 'whatsapp' });
              oooSent = true;
            }
          } catch (e) { logger.warn('OOO message failed: ' + e.message); }
        }

        // Send welcome message on first contact (only for genuinely new
        // messages, and only when OOO didn't already respond to this one) —
        // the automation trigger below is a separate concern (a new contact
        // arrived) and fires regardless of which auto-reply, if any, fired.
        // Also skipped when the AI conversation agent already engaged — its
        // own first reply already serves as the greeting.
        if (isNewMsg && isFirstContact && !oooSent && !botEngaged) {
          try {
            const wc = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#WELCOME#${companyId}`, SK: 'CURRENT' } }).promise();
            if (wc.Item?.enabled) {
              const sent = await sendWelcomeMessage(companyId, phone10, wc.Item, { id: 'system', role: 'admin', name: 'System' }, waName, 'whatsapp');
              if (sent) logger.info(`Welcome message (${wc.Item.messageType ?? 'template'}) sent to ${phone10} for company ${companyId}`);
            }
          } catch (e) { logger.warn('Welcome message failed: ' + e.message); }
        }
        if (isNewMsg && isFirstContact && !botEngaged) {
          // Fire automation trigger for brand-new WhatsApp contact. Awaited
          // (bounded) since 2026-07-06 — same freeze risk/fix as
          // resumeOnButtonReply()/fireTrigger() above; runAutomations() is a
          // thin wrapper around the same AutomationEngine.fireTrigger().
          const { runAutomations } = require('./automations');
          await withTimeout(
            runAutomations(companyId, 'whatsapp_conversation_started', {
              phone: phone10, name: waName ?? null, source: 'whatsapp', tags: [],
            }).catch((e2) => logger.warn('automation error: ' + e2.message)),
            'runAutomations(whatsapp_conversation_started)',
          );
        }
      }
    }
  } catch (err) {
    logger.error('WhatsApp webhook error', err);
  }
  // Always ACK Meta — even on error, so Meta does not retry.
  // Placed here so notifyCompany() fires inside the active Lambda invocation
  // before serverless-http resolves and Lambda freezes the execution context.
  res.sendStatus(200);
});

// ── POST /api/whatsapp/send ────────────────────────────────────────────────────
router.post('/send', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { leadPK, message, replyToWaMessageId, replyToContent, replyToDirection, replyToSenderName } = req.body;
    if (!leadPK || !message?.trim()) return res.status(400).json({ error: 'leadPK and message required' });

    const result = await WASendSvc.sendText(
      req.user.companyId,
      { leadPK },
      message.trim(),
      req.user,
      { replyToWaMessageId: replyToWaMessageId ?? null, replyToContent, replyToDirection, replyToSenderName },
    );
    res.json({ success: true, messageId: result.waMessageId, timestamp: result.timestamp });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('whatsapp/send error', err);
    next(err);
  }
});

// ── GET /api/whatsapp/inbox — conversations with status filter + counts ────────
router.get('/inbox', authMiddleware, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const canViewAll = ['admin', 'superadmin', 'manager'].includes(req.user.role);
    const statusFilter = req.query.status ?? 'all'; // open | unassigned | resolved | all

    function effectiveStatus(l) {
      if (l.chatStatus) return l.chatStatus;
      return l.assignedTo ? 'open' : 'unassigned';
    }

    // All CRM leads — used for dedup (must include leads with no WhatsApp history yet)
    const allLeadItems = [];
    let lk1;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
        ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
        ...(lk1 && { ExclusiveStartKey: lk1 }),
      }).promise();
      allLeadItems.push(...(r.Items ?? []));
      lk1 = r.LastEvaluatedKey;
    } while (lk1);

    // Only leads with WhatsApp message history appear in the inbox conversation list
    const leadItems = allLeadItems.filter((l) => l.lastMessageAt);

    // Unknown contacts — admin/manager sees unassigned inbox contacts
    const unknownItems = [];
    if (canViewAll) {
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
    }

    // Admin/manager/superadmin see all leads; other roles see only their own assigned leads
    const visibleLeads = canViewAll ? leadItems : leadItems.filter((l) => l.assignedTo === req.user.id);

    // Dedup: suppress unknown contacts whose phoneNorm already exists as ANY CRM lead.
    // Uses phoneNorm (canonical 10-digit) on both sides so cross-format matches are caught:
    // a lead stored as 919866141993 will suppress an INBOX record keyed as 9866141993.
    // u.phone is already phone10 (to10Digit output from the webhook receive path).
    const leadPhones = new Set(allLeadItems.map((l) => l.phoneNorm || to10Digit(l.phone)).filter(Boolean));
    const dedupedUnknown = unknownItems.filter((u) => !leadPhones.has(u.phone));

    // Build counts before filtering
    const counts = { open: 0, unassigned: 0, resolved: 0, unread: 0 };
    visibleLeads.forEach((l) => {
      const s = effectiveStatus(l);
      if (counts[s] !== undefined) counts[s]++;
      if ((l.unreadCount ?? 0) > 0) counts.unread++;
    });
    dedupedUnknown.forEach((u) => {
      counts.unassigned++;
      if ((u.unreadCount ?? 0) > 0) counts.unread++;
    });

    const allConvs = [
      ...visibleLeads.map((l) => ({
        type: 'lead',
        leadId: l.leadId,
        PK: l.PK,
        name: l.name,
        waName: l.waName ?? null,
        displayName: l.name ?? l.waName ?? l.phone,
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
        intent: l.intent ?? null,
        confidence: l.confidence ?? null,
      })),
      ...dedupedUnknown.map((u) => ({
        type: 'unknown',
        phone: u.phone,
        name: u.agentName ?? u.waName ?? null,
        waName: u.waName ?? null,
        agentName: u.agentName ?? null,
        displayName: u.agentName ?? u.waName ?? u.phone,
        email: null, source: null, stage: null, tags: u.tags ?? [], notes: '',
        assignedTo: null, assignedToName: null,
        chatStatus: 'unassigned',
        lastMessageAt: u.lastMessageAt,
        lastMessagePreview: u.lastMessagePreview,
        lastMessageDirection: u.lastMessageDirection,
        lastInboundAt: u.lastMessageAt ?? null,
        createdAt: u.createdAt ?? null,
        unreadCount: u.unreadCount ?? 0,
        intent: u.intent ?? null,
        confidence: u.confidence ?? null,
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
router.post('/inbox/unknown/:phone/send', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const result = await WASendSvc.sendText(
      req.user.companyId,
      { phone: req.params.phone },
      message.trim(),
      req.user,
    );
    res.json({ success: true, messageId: result.waMessageId, timestamp: result.timestamp });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── PUT /api/whatsapp/inbox/:leadId/resolve ───────────────────────────────────
router.put('/inbox/:leadId/resolve', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET chatStatus = :s, resolvedAt = :ra, resolvedBy = :rb',
      ExpressionAttributeValues: { ':s': 'resolved', ':ra': new Date().toISOString(), ':rb': req.user.id },
    }).promise();
    // Fire-and-forget: mirror status change to CONV# entity
    syncConvStatus(req.user.companyId, PK, 'resolved', req.user.id).catch(() => {});
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/inbox/:leadId/reopen ─────────────────────────────────────
router.put('/inbox/:leadId/reopen', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET chatStatus = :s REMOVE resolvedAt, resolvedBy',
      ExpressionAttributeValues: { ':s': 'open' },
    }).promise();
    // Fire-and-forget: mirror status change to CONV# entity
    syncConvStatus(req.user.companyId, PK, 'open', req.user.id).catch(() => {});
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/inbox/:leadId/pin — toggle pinned conversation ───────────
router.put('/inbox/:leadId/pin', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
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

// Looks up a registered Flow and sends it via sendInteractive() unmodified
// (ADR-012) — the single place that builds the Meta Flow-send payload, shared
// by the manual /inbox/:leadId/send-flow route below and welcome-message
// button follow-ups with followUp.type === 'flow' (see fireButtonFollowUp).
async function sendRegisteredFlow(companyId, target, flowId, user) {
  const flowCfg = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#FLOW#${companyId}`, SK: `FLOW#${flowId}` },
  }).promise();
  if (!flowCfg.Item) {
    const err = new Error('Flow not found — register it in Settings first');
    err.status = 404;
    throw err;
  }

  const { bodyText, ctaLabel, screenId } = flowCfg.Item;
  const interactive = {
    type: 'flow',
    body: { text: bodyText },
    action: {
      name: 'flow',
      parameters: {
        flow_message_version: '3',
        flow_token: randomUUID(),
        flow_id: flowId,
        flow_cta: ctaLabel,
        flow_action: 'navigate',
        ...(screenId && { flow_action_payload: { screen: screenId } }),
      },
    },
  };
  return WASendSvc.sendInteractive(companyId, target, interactive, user);
}

// ── POST /api/whatsapp/inbox/:leadId/send-flow — trigger a registered WhatsApp Flow ─
router.post('/inbox/:leadId/send-flow', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { flowId } = req.body;
    if (!flowId) return res.status(400).json({ error: 'flowId required' });
    const result = await sendRegisteredFlow(req.user.companyId, { leadId: req.params.leadId }, flowId, req.user);
    res.json({ success: true, messageId: result.wamid, timestamp: result.timestamp });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('send-flow error', err);
    next(err);
  }
});

// ── PUT /api/whatsapp/contact/name — set/edit contact display name ────────────
router.put('/contact/name', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { leadId, phone, name } = req.body;
    const companyId = req.user.companyId;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    if (leadId) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `LEAD#${companyId}#${leadId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #n = :n',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':n': name.trim() },
      }).promise();
    } else if (phone) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: `INBOX#${companyId}#${to10Digit(phone)}`, SK: 'CONTACT' },
        UpdateExpression: 'SET agentName = :n',
        ExpressionAttributeValues: { ':n': name.trim() },
      }).promise();
    } else {
      return res.status(400).json({ error: 'leadId or phone required' });
    }

    res.json({ success: true, name: name.trim() });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/inbox/:leadId/note — internal team note ─────────────────
router.post('/inbox/:leadId/note', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    const timestamp = new Date().toISOString();
    const mentionNames = [...content.matchAll(/@(\w+)/g)].map((m) => m[1]);
    // Built as its own variable (not inline in the put()) so the same object
    // that's persisted is also returned to the caller — Track A5 Fix 2: the
    // frontend needs the real note (real SK/authorName) to reconcile its
    // optimistic placeholder, not just a bare timestamp.
    const note = {
      PK, SK: `NOTE#${timestamp}`,
      content: content.trim(),
      authorId: req.user.id,
      authorName: req.user.name,
      type: 'note',
      timestamp,
      ...(mentionNames.length && { mentions: mentionNames }),
    };
    await dynamodb.put({ TableName: TABLE, Item: note }).promise();
    if (mentionNames.length > 0) {
      logger.alert(`📌 <b>${req.user.name}</b> mentioned ${mentionNames.map((n) => `@${n}`).join(', ')} in a note\nLead: <code>${req.params.leadId}</code>`);
    }
    res.json({ success: true, timestamp, note });
  } catch (err) { next(err); }
});

// Only the note's author or an admin/manager/superadmin may edit or delete it.
function canModifyNote(note, user) {
  return note.authorId === user.id || ['admin', 'manager', 'superadmin'].includes(user.role);
}

// ── PUT /api/whatsapp/inbox/:leadId/note/:timestamp — edit an internal note ────
router.put('/inbox/:leadId/note/:timestamp', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    const SK = `NOTE#${req.params.timestamp}`;

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Note not found' });
    if (!canModifyNote(existing.Item, req.user)) {
      return res.status(403).json({ error: 'Only the author or a manager can edit this note' });
    }

    const mentionNames = [...content.matchAll(/@(\w+)/g)].map((m) => m[1]);
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK },
      // ExpressionAttributeNames used for every target attribute — several
      // ordinary-looking words (timestamp, count, ttl elsewhere in this repo)
      // turn out to be reserved in DynamoDB's UpdateExpression grammar, so
      // aliasing everything here avoids re-litigating that per attribute.
      UpdateExpression: mentionNames.length
        ? 'SET #content = :c, #editedAt = :e, #mentions = :m'
        : 'SET #content = :c, #editedAt = :e REMOVE #mentions',
      ExpressionAttributeNames: { '#content': 'content', '#editedAt': 'editedAt', '#mentions': 'mentions' },
      ExpressionAttributeValues: {
        ':c': content.trim(),
        ':e': new Date().toISOString(),
        ...(mentionNames.length && { ':m': mentionNames }),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/whatsapp/inbox/:leadId/note/:timestamp — delete an internal note ─
router.delete('/inbox/:leadId/note/:timestamp', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const PK = `LEAD#${req.user.companyId}#${req.params.leadId}`;
    const SK = `NOTE#${req.params.timestamp}`;

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Note not found' });
    if (!canModifyNote(existing.Item, req.user)) {
      return res.status(403).json({ error: 'Only the author or a manager can delete this note' });
    }

    await dynamodb.delete({ TableName: TABLE, Key: { PK, SK } }).promise();
    res.json({ success: true });
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
router.put('/agent/availability', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
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
router.post('/inbox/auto-assign', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
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
router.post('/inbox/canned', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { title, body, shortcut } = req.body;
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'title and body required' });

    const normShortcut = shortcut?.trim().toLowerCase().replace(/\s+/g, '_') ?? null;

    // Enforce shortcut uniqueness within the company
    if (normShortcut) {
      const existing = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: 'shortcut = :sh',
        ExpressionAttributeValues: {
          ':pk': `CONFIG#CANNED#${req.user.companyId}`,
          ':sk': 'CANNED#',
          ':sh': normShortcut,
        },
      }).promise();
      if ((existing.Items?.length ?? 0) > 0) {
        return res.status(409).json({ error: `Shortcut "${normShortcut}" is already used by another canned response` });
      }
    }

    const id = randomUUID();
    const item = {
      PK: `CONFIG#CANNED#${req.user.companyId}`,
      SK: `CANNED#${id}`,
      id, title: title.trim(), body: body.trim(),
      shortcut: normShortcut,
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.json({ success: true, response: item });
  } catch (err) { next(err); }
});

// ── DELETE /api/whatsapp/inbox/canned/:id — delete canned response ────────────
router.delete('/inbox/canned/:id', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#CANNED#${req.user.companyId}`, SK: `CANNED#${req.params.id}` },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/flows — list registered WhatsApp Flows ──────────────────
// Flows are Meta-created (Flow Builder in WhatsApp Manager) — APForce only
// references them by flow_id to trigger a send. Not related to CONFIG#FORM
// (forms.js), the public embeddable web lead-capture forms — separate system.
router.get('/flows', authMiddleware, async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#FLOW#${req.user.companyId}`, ':sk': 'FLOW#' },
    }).promise();
    res.json({ success: true, flows: (result.Items ?? []).sort((a, b) => a.name?.localeCompare(b.name)) });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/flows — register a Meta-created Flow by its Flow ID ────
router.post('/flows', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { flowId, name, bodyText, ctaLabel, screenId } = req.body;
    if (!flowId?.trim())    return res.status(400).json({ error: 'flowId required — copy it from WhatsApp Manager → Flows' });
    if (!name?.trim())      return res.status(400).json({ error: 'name required' });
    if (!bodyText?.trim())  return res.status(400).json({ error: 'bodyText required — shown to the customer above the Flow button' });
    if (!ctaLabel?.trim())  return res.status(400).json({ error: 'ctaLabel required — the Flow button text' });
    if (ctaLabel.trim().length > 20) return res.status(400).json({ error: 'ctaLabel must be 20 characters or fewer (Meta limit)' });

    const item = {
      PK: `CONFIG#FLOW#${req.user.companyId}`,
      SK: `FLOW#${flowId.trim()}`,
      companyId: req.user.companyId,
      flowId: flowId.trim(),
      name: name.trim(),
      bodyText: bodyText.trim(),
      ctaLabel: ctaLabel.trim(),
      screenId: screenId?.trim() || null,
      // Reserved for future welcome-message auto-trigger wiring — only
      // manual send-from-Inbox is implemented today (see ADR context in
      // docs/bible/08_MODULES.md's CONFIG#FLOW entry before changing this).
      context: 'manual',
      createdBy: req.user.id,
      createdByName: req.user.name ?? null,
      createdAt: new Date().toISOString(),
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.json({ success: true, flow: item });
  } catch (err) { next(err); }
});

// ── DELETE /api/whatsapp/flows/:flowId — unregister a Flow ────────────────────
router.delete('/flows/:flowId', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#FLOW#${req.user.companyId}`, SK: `FLOW#${req.params.flowId}` },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/templates — list stored templates ───────────────────────
router.get('/templates', authMiddleware, async (req, res, next) => {
  try {
    const items = [];
    let lastKey;
    do {
      const result = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CONFIG#TMPL#${req.user.companyId}`, ':sk': 'TMPL#' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    res.json({ success: true, templates: items.sort((a, b) => a.name?.localeCompare(b.name)) });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/templates — create template ────────────────────────────
router.post('/templates', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { name, templateName, language, category, bodyPreview, variables,
            components, allowCategoryChange, metaTemplateId, headerMediaRef } = req.body;
    if (!name?.trim() || !templateName?.trim()) {
      return res.status(400).json({ error: 'name and templateName are required' });
    }
    const normName = templateName.trim().toLowerCase().replace(/\s+/g, '_');
    const dupCheck = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'templateName = :tn',
      ExpressionAttributeValues: {
        ':pk': `CONFIG#TMPL#${req.user.companyId}`,
        ':sk': 'TMPL#',
        ':tn': normName,
      },
      Limit: 1,
    }).promise();
    if ((dupCheck.Items?.length ?? 0) > 0) {
      return res.status(409).json({ error: `Template name "${normName}" already exists — choose a different name` });
    }
    const id = randomUUID();
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
      components: components ?? null,
      // S3 reference for a media (IMAGE/VIDEO/DOCUMENT) HEADER's example, if
      // any — { s3Key, mimeType, filename }. Deliberately NOT resolved to a
      // real example.header_handle here: Meta's Resumable Upload handles
      // expire in ~24h, and drafts routinely sit far longer than that before
      // submission. POST /templates/:id/submit resolves this fresh, right
      // before building the Meta payload, every time (see that route).
      headerMediaRef: headerMediaRef ?? null,
      status: 'DRAFT',
      qualityScore: 'UNKNOWN',
      allowCategoryChange: allowCategoryChange ?? true,
      metaTemplateId: metaTemplateId ?? null,
      createdBy: req.user.id,
      createdByName: req.user.name ?? null,
      createdAt: now, updatedAt: now,
      statusHistory: [{ status: 'DRAFT', ts: now, reason: null }],
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, template: item });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/templates/:id — update template ────────────────────────
router.put('/templates/:id', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { name, templateName, language, category, bodyPreview, variables,
            components, status, allowCategoryChange, headerMediaRef } = req.body;
    const now = new Date().toISOString();
    let updateExpr = 'SET #n = :n, templateName = :tn, #lang = :lang, category = :cat, bodyPreview = :bp, variables = :vars, updatedAt = :ua, allowCategoryChange = :acc';
    const exprNames = { '#n': 'name', '#lang': 'language' };
    const exprVals = {
      ':n': name?.trim(), ':tn': templateName?.trim().toLowerCase().replace(/\s+/g, '_'),
      ':lang': language ?? 'en', ':cat': category ?? 'UTILITY',
      ':bp': bodyPreview?.trim() ?? '', ':vars': variables ?? [],
      ':ua': now, ':acc': allowCategoryChange ?? true,
    };
    if (components !== undefined) {
      updateExpr += ', components = :comp';
      exprVals[':comp'] = components;
    }
    // See POST /templates for why this is a separate S3-reference field, not
    // resolved into example.header_handle here.
    if (headerMediaRef !== undefined) {
      updateExpr += ', headerMediaRef = :hmr';
      exprVals[':hmr'] = headerMediaRef;
    }
    if (status !== undefined) {
      updateExpr += ', #s = :s, statusHistory = list_append(if_not_exists(statusHistory, :empty), :h)';
      exprNames['#s'] = 'status';
      exprVals[':s'] = status;
      exprVals[':empty'] = [];
      exprVals[':h'] = [{ status, ts: now, reason: null }];
    }
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
      ConditionExpression: 'attribute_exists(PK)',
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprVals,
    }).promise();
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      return res.status(404).json({ error: 'Template not found' });
    }
    next(err);
  }
});

// ── DELETE /api/whatsapp/templates/:id ───────────────────────────────────────
router.delete('/templates/:id', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const tmplResult = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
    }).promise();
    const tmpl = tmplResult.Item;
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });

    let warning = null;
    if (tmpl.metaTemplateId) {
      const cfg = await getWabaConfig(req.user.companyId).catch(() => null);
      if (cfg?.accessToken && cfg?.wabaId) {
        try {
          await axios.delete(`${GRAPH}/${cfg.wabaId}/message_templates`, {
            params: { name: tmpl.templateName },
            headers: { Authorization: `Bearer ${cfg.accessToken}` },
            timeout: 15000,
          });
        } catch (metaErr) {
          if (metaErr.response?.status !== 404) {
            logger.warn('delete template from Meta failed — deleting locally only', metaErr.response?.data);
            warning = metaErr.response?.data?.error?.message ?? 'Meta deletion failed — remove manually from Meta Business Suite';
          }
        }
      }
    }

    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
    }).promise();
    res.json({ success: true, ...(warning && { warning }) });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/templates/:id/submit — push draft to Meta for review ──
router.post('/templates/:id/submit', authMiddleware, checkRole(['admin']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg?.accessToken || !cfg?.wabaId) {
      return res.status(400).json({ error: 'WABA not connected' });
    }
    const cfgIssue = detectInvalidWabaConfig(cfg);
    if (cfgIssue) return res.status(400).json({ error: cfgIssue, code: 'INVALID_WABA_CONFIG' });

    const tmplResult = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
    }).promise();
    const tmpl = tmplResult.Item;
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });
    if (!tmpl.components) return res.status(400).json({ error: 'Template has no components — save via builder first' });
    if (!['DRAFT', 'REJECTED'].includes(tmpl.status ?? 'DRAFT')) {
      return res.status(400).json({ error: `Template status is ${tmpl.status} — only DRAFT or REJECTED can be submitted` });
    }

    // Resolve a fresh Meta media handle for a media HEADER right before
    // submission — never at draft-save time (see headerMediaRef's own
    // comment on POST /templates above: handles expire in ~24h, drafts
    // routinely don't). Builds a COPY of tmpl.components — the stored
    // DynamoDB record is never mutated — so every submit/resubmit attempt
    // (including resubmitting a REJECTED template, possibly days after the
    // first attempt) re-resolves a brand new handle from the same stable S3
    // reference instead of ever reusing a possibly-expired one.
    let components = tmpl.components;
    if (tmpl.headerMediaRef?.s3Key) {
      let handle;
      try {
        handle = await WASendSvc.uploadTemplateHeaderHandle(req.user.companyId, tmpl.headerMediaRef);
      } catch (e) {
        logger.error(
          `templates/:id/submit: header media upload to Meta failed for templateId=${req.params.id} (status ${e.status ?? 'n/a'})`,
          JSON.stringify(e.details ?? { message: e.message }),
        );
        return res.status(e.status ?? 400).json({ error: e.message, rawError: e.details });
      }
      components = tmpl.components.map((c) =>
        c.type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(c.format)
          ? { ...c, example: { ...c.example, header_handle: [handle] } }
          : c,
      );
    }

    const payload = {
      name: tmpl.templateName,
      language: tmpl.language,
      category: tmpl.category,
      components,
      allow_category_change: tmpl.allowCategoryChange ?? true,
    };

    const metaRes = await axios.post(
      `${GRAPH}/${cfg.wabaId}/message_templates`,
      payload,
      { headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' }, timeout: 15000 },
    );
    const metaTemplateId = metaRes.data?.id ?? null;
    const now = new Date().toISOString();
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
      UpdateExpression: 'SET #s = :s, metaTemplateId = :mid, updatedAt = :ua, statusHistory = list_append(if_not_exists(statusHistory, :empty), :h)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': 'PENDING', ':mid': metaTemplateId,
        ':ua': now, ':h': [{ status: 'PENDING', ts: now, reason: null }], ':empty': [],
      },
    }).promise();
    res.json({ success: true, metaTemplateId, status: 'PENDING' });
  } catch (err) {
    if (err.response?.data) {
      // logger.error only extracts .message from Error instances — passing
      // err.response.data (a plain object) straight through renders as
      // "[object Object]" in CloudWatch/Telegram (docs/phase3/TECHNICAL_DEBT.md,
      // same defect already fixed for the connect/config routes in 101d190).
      // JSON.stringify it so Meta's actual rejection reason is readable. This
      // route's axios call carries the token only in the Authorization
      // header (not request params), so err.response.data alone is safe to
      // log/return in full — no err.config/err.request needed or logged.
      const rawError = err.response.data;
      logger.error(
        `submit template to Meta failed for templateId=${req.params.id} (status ${err.response.status ?? 'n/a'})`,
        JSON.stringify(rawError),
      );
      // error_user_msg/error_user_title are Meta's own end-user-facing error
      // fields — usually far more specific than the generic .message (e.g.
      // naming exactly which button/component was rejected and why), so
      // prefer them when Meta includes them.
      const metaErr = rawError?.error ?? {};
      const friendlyMessage = metaErr.error_user_msg || metaErr.message || 'Meta API error';
      return res.status(400).json({ error: friendlyMessage, rawError });
    }
    next(err);
  }
});

// ── POST /api/whatsapp/templates/sync — pull latest status from Meta ──────────
router.post('/templates/sync', authMiddleware, checkRole(['admin', 'manager']), rateLimit(5, 60_000), async (req, res, next) => {
  try {
    const cfg = await getWabaConfig(req.user.companyId);
    if (!cfg?.accessToken || !cfg?.wabaId) {
      return res.status(400).json({ error: 'WABA not connected' });
    }
    const cfgIssue = detectInvalidWabaConfig(cfg);
    if (cfgIssue) return res.status(400).json({ error: cfgIssue, code: 'INVALID_WABA_CONFIG' });

    // Fetch ALL templates from Meta with cursor pagination
    const fields = 'id,name,status,quality_score,category,rejected_reason,language,components';
    const metaTemplates = [];
    let nextUrl = `${GRAPH}/${cfg.wabaId}/message_templates?fields=${fields}&limit=100`;
    while (nextUrl) {
      const metaRes = await axios.get(nextUrl, { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 15000 });
      metaTemplates.push(...(metaRes.data?.data ?? []));
      nextUrl = metaRes.data?.paging?.next ?? null;
    }

    // Fetch our local templates
    const localItems = [];
    let localLastKey;
    do {
      const localPage = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CONFIG#TMPL#${req.user.companyId}`, ':sk': 'TMPL#' },
        ...(localLastKey && { ExclusiveStartKey: localLastKey }),
      }).promise();
      localItems.push(...(localPage.Items ?? []));
      localLastKey = localPage.LastEvaluatedKey;
    } while (localLastKey);
    const localByName = Object.fromEntries(localItems.map((t) => [t.templateName, t]));

    const statusMap = {
      APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING: 'PENDING',
      PAUSED: 'PAUSED', DISABLED: 'DISABLED', FLAGGED: 'FLAGGED',
      IN_APPEAL: 'IN_APPEAL', REINSTATED: 'REINSTATED', PENDING_DELETION: 'PENDING_DELETION',
    };
    const qualityMap = { GREEN: 'HIGH', YELLOW: 'MEDIUM', RED: 'LOW', UNKNOWN: 'UNKNOWN' };

    const now = new Date().toISOString();
    let synced = 0;
    let imported = 0;
    for (const mt of metaTemplates) {
      const local = localByName[mt.name];
      const newStatus = statusMap[mt.status] ?? mt.status;
      const newQuality = qualityMap[mt.quality_score?.score ?? 'UNKNOWN'] ?? 'UNKNOWN';

      if (!local) {
        // Import Meta-native template not yet in our database
        const bodyComp = (mt.components ?? []).find((c) => c.type === 'BODY');
        const newId = randomUUID();
        await dynamodb.put({
          TableName: TABLE,
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: {
            PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${newId}`,
            id: newId, companyId: req.user.companyId,
            name: mt.name, templateName: mt.name,
            language: mt.language ?? 'en', category: mt.category,
            bodyPreview: (bodyComp?.text ?? '').slice(0, 100),
            variables: [],
            components: mt.components ?? null,
            status: newStatus, qualityScore: newQuality,
            allowCategoryChange: true, metaTemplateId: mt.id,
            rejectedReason: mt.rejected_reason ?? null,
            createdAt: now, updatedAt: now,
            statusHistory: [{ status: newStatus, ts: now, reason: null }],
          },
        }).promise().catch(() => {}); // skip on duplicate race
        imported++;
        continue;
      }

      if (local.status === newStatus && local.qualityScore === newQuality) continue;
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: local.PK, SK: local.SK },
        UpdateExpression: 'SET #s = :s, qualityScore = :q, metaTemplateId = :mid, rejectedReason = :r, updatedAt = :ua, statusHistory = list_append(if_not_exists(statusHistory, :empty), :h)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':s': newStatus, ':q': newQuality, ':mid': mt.id,
          ':r': mt.rejected_reason ?? null, ':ua': now,
          ':empty': [], ':h': [{ status: newStatus, ts: now, reason: mt.rejected_reason ?? null }],
        },
      }).promise();
      synced++;
    }
    res.json({ success: true, synced, imported, total: metaTemplates.length });
  } catch (err) {
    if (err.response?.data) {
      logger.error('sync templates from Meta failed', err.response.data);
      return res.status(400).json({ error: err.response.data?.error?.message ?? 'Meta API error' });
    }
    next(err);
  }
});

// ── POST /api/whatsapp/templates/ai-draft — AI-assisted template drafting ────
// customerFacing: false (aiConfig.js) — this returns a draft for the admin to
// review/edit/save; nothing here saves, submits to Meta, or sends anything.
// Same middleware chain and rate-limit cadence as /templates/:id/submit below
// (a deliberate, infrequent admin action, not per-message traffic).
router.post('/templates/ai-draft', authMiddleware, checkRole(['admin']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { description, language } = req.body;
    if (!description?.trim()) {
      return res.status(400).json({ error: 'description is required' });
    }

    const result = await AIService.generate({
      useCase: 'template-creation',
      companyId: req.user.companyId,
      context: { description: description.trim(), language: language ?? 'en' },
      user: req.user,
      entityType: 'admin_action',
      entityId: req.user.id,
    });

    if (!result.ok) return sendAIError(res, result);

    res.json({ success: true, draft: result.data });
  } catch (err) {
    logger.error('templates/ai-draft error', err.message);
    next(err);
  }
});

// ── GET /api/whatsapp/templates/:id/history — status history ─────────────────
router.get('/templates/:id/history', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${req.user.companyId}`, SK: `TMPL#${req.params.id}` },
    }).promise();
    if (!result.Item) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true, history: result.Item.statusHistory ?? [] });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/send-template — send template to a lead or phone ───────
router.post('/send-template', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { leadId, leadPK: leadPK0, phone, templateId, variableValues, headerVariableValue } = req.body;
    // Resolve target — leadPK > leadId > phone (supports CRM leads AND unknown contacts)
    const target = leadPK0 ? { leadPK: leadPK0 }
                 : leadId  ? { leadId }
                 : phone   ? { phone }
                 : null;
    if (!target || !templateId) {
      return res.status(400).json({ error: 'leadId, leadPK, or phone — and templateId — are required' });
    }

    await WASendSvc.sendTemplate(
      req.user.companyId,
      target,
      templateId,
      variableValues ?? [],
      req.user,
      { headerVariableValue: headerVariableValue ?? null },
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('send-template error', err?.response?.data ?? err.message);
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Converts a raw MSG# item into text for AIService's conversationHistory —
// non-text message types get a bracketed summary rather than raw/empty content.
function _messageSummary(m) {
  if (!m.type || m.type === 'text') return m.content ?? '';
  if (m.type === 'template') return `[Template sent: ${m.content || m.templateId || ''}]`.trim();
  if (m.type === 'interactive') return `[Interactive message: ${m.content ?? ''}]`.trim();
  return `[${m.type}]`;
}

// ── POST /api/whatsapp/inbox/suggest-reply — AI Template Suggestions in Chat ──
// customerFacing: true (aiConfig.js). Sends directly via WhatsAppSendService —
// no human review step of any kind since 2026-07-06 (19_DECISION_LOG.md: the
// prior approval-queue/agent-send-click gate was removed at the business
// owner's explicit, informed direction, having weighed the SEBI-compliance risk
// of an unreviewed AI reply against wanting zero-latency customer responses).
// Every send here is logAudit()-tagged as AI-originated (action:
// 'ai_customer_reply_sent') specifically because no human touched it — this is
// the only record that one went out at all. Same leadPK > leadId > phone
// target-resolution shape as /send-template above, reusing
// WhatsAppSendService.resolveContact() rather than a second lookup.
router.post('/inbox/suggest-reply', authMiddleware, rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const { leadId, leadPK: leadPK0, phone } = req.body;
    const target = leadPK0 ? { leadPK: leadPK0 }
                 : leadId  ? { leadId }
                 : phone   ? { phone }
                 : null;
    if (!target) {
      return res.status(400).json({ error: 'leadId, leadPK, or phone is required' });
    }

    const companyId = req.user.companyId;
    const contact = await WASendSvc.resolveContact(companyId, target);

    // Same RBAC rule WhatsAppSendService's own _assertSendPermission enforces
    // for actually sending — telecaller/agent/intern may only act on leads
    // assigned to them. Inlined rather than reaching into that private method.
    const RESTRICTED_ROLES = new Set(['telecaller', 'agent', 'intern']);
    if (RESTRICTED_ROLES.has(req.user.role) && contact.isLead && contact.leadItem?.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Not your lead' });
    }

    // Intent/confidence — already mirrored onto LEAD#/INBOX# by
    // IntentDetectionService; reused as a soft signal in the prompt, never
    // reclassified here.
    let priorIntent = null;
    let priorIntentConfidence = null;
    if (contact.isLead) {
      priorIntent = contact.leadItem?.intent ?? null;
      priorIntentConfidence = contact.leadItem?.confidence ?? null;
    } else {
      const inboxRes = await dynamodb.get({ TableName: TABLE, Key: { PK: contact.pk, SK: 'CONTACT' } }).promise();
      priorIntent = inboxRes.Item?.intent ?? null;
      priorIntentConfidence = inboxRes.Item?.confidence ?? null;
    }

    // preferredLanguage lives on the separate, Phase-2 unified CONTACT# entity
    // — only fetch it when this lead is actually linked to one (contactId is
    // null for most leads today, per crm.js's own comment on background
    // linkage), rather than forcing a lookup that will usually miss.
    let preferredLanguage = null;
    if (contact.leadItem?.contactId) {
      const contactProfile = await ContactService.getContact(companyId, contact.leadItem.contactId).catch(() => null);
      preferredLanguage = contactProfile?.preferredLanguage ?? null;
    }

    // Recent messages — same MSG# query shape crm.js's GET /leads/:id already
    // uses, reversed to chronological order for AIService's conversationHistory.
    const msgRes = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': contact.pk, ':pfx': 'MSG#' },
      ScanIndexForward: false,
      Limit: 10,
    }).promise();
    const recentMessages = (msgRes.Items ?? []).slice().reverse();
    const conversationHistory = recentMessages.map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: _messageSummary(m),
    }));
    const latestInbound = [...recentMessages].reverse().find((m) => m.direction === 'inbound');
    const latestMessage = latestInbound ? _messageSummary(latestInbound) : '';

    // Approved templates only — same filter ComposerToolbar's own Templates panel applies.
    const tmplRes = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#TMPL#${companyId}`, ':sk': 'TMPL#' },
    }).promise();
    const approvedTemplates = (tmplRes.Items ?? []).filter((t) => t.status === 'APPROVED');
    if (approvedTemplates.length === 0) {
      return res.json({ success: true, sent: false, reason: 'no_approved_templates' });
    }

    const result = await AIService.generate({
      useCase: 'inbox-template-suggestion',
      companyId,
      context: {
        latestMessage,
        priorIntent,
        priorIntentConfidence,
        preferredLanguage,
        templates: approvedTemplates.map((t) => ({
          id: t.id, name: t.name, category: t.category, language: t.language,
          bodyPreview: t.bodyPreview, variables: t.variables ?? [],
        })),
      },
      conversationHistory,
      user: req.user,
      assigneeId: req.user.id,
      // Note: this route operates on the lead/inbox contact key (contact.pk),
      // not the separate Customer 360 CONV# conversationId — no conversationId
      // is tracked at this call site, so the contact key is the best real
      // identifier available for grouping this suggestion's cost later.
      entityType: 'conversation',
      entityId: contact.pk,
    });

    if (!result.ok) return sendAIError(res, result);

    if (!result.data.hasSuggestion) {
      return res.json({ success: true, sent: false, reason: 'no_good_fit' });
    }

    // Validate the model's pick against the real registry — never trust a
    // templateId or variable count that wasn't actually offered to it.
    const chosen = approvedTemplates.find((t) => t.id === result.data.templateId);
    if (!chosen || (result.data.variableValues ?? []).length !== (chosen.variables ?? []).length) {
      return res.json({ success: true, sent: false, reason: 'invalid_model_output' });
    }

    // Sends immediately — no human review step (see the header comment above).
    // Uses a dedicated system actor, not req.user, so the MSG# record and any
    // future Inbox display honestly reflect that the agent didn't write or
    // click-send this — the AI did, unattended.
    const AI_ACTOR = { id: 'system', role: 'admin', name: 'AI Assistant' };
    const sendResult = await WASendSvc.sendTemplate(companyId, target, chosen.id, result.data.variableValues, AI_ACTOR);

    // Mandatory, awaited — this is the only record that an unreviewed AI
    // message went out at all, so it must be durable before the response
    // resolves, not fire-and-forget. A failure here does not undo the send
    // (already delivered), but is logged loudly since a silent gap in this
    // specific trail defeats the entire point of keeping it.
    try {
      await logAudit(req.user.id, 'ai_customer_reply_sent', chosen.id, 'success', req.ip, {
        aiGenerated: true,
        useCase: 'inbox-template-suggestion',
        templateId: chosen.id,
        templateName: chosen.name,
        variableValues: result.data.variableValues,
        confidence: result.data.confidence,
        reasoning: result.data.reasoning,
        wamid: sendResult.wamid,
        contactPK: contact.pk,
      }, companyId);
    } catch (auditErr) {
      logger.error(`inbox/suggest-reply: AI-send audit log FAILED for wamid ${sendResult.wamid} — message was sent, no audit record exists: ${auditErr.message}`);
    }

    res.json({
      success: true,
      sent: true,
      template: { id: chosen.id, name: chosen.name },
      reasoning: result.data.reasoning,
      confidence: result.data.confidence,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('inbox/suggest-reply error', err.message);
    next(err);
  }
});

// ── POST /api/whatsapp/send-location — Inbox composer "Send Location" (Item 1c) ─
// Same target-resolution shape as /send-template (leadPK > leadId > phone), but
// with a saved CONFIG#BRANCH# reference instead of free-typed coordinates —
// req.user is the real authenticated agent, not the 'system' actor
// AutomationEngine's send_location action uses.
router.post('/send-location', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { leadId, leadPK: leadPK0, phone, branchId } = req.body;
    const target = leadPK0 ? { leadPK: leadPK0 }
                 : leadId  ? { leadId }
                 : phone   ? { phone }
                 : null;
    if (!target || !branchId) {
      return res.status(400).json({ error: 'leadId, leadPK, or phone — and branchId — are required' });
    }

    const companyId = req.user.companyId;
    const branchRes = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#BRANCH#${companyId}`, SK: `BRANCH#${branchId}` },
    }).promise();
    if (!branchRes.Item) return res.status(404).json({ error: 'Branch not found' });

    await WASendSvc.sendLocation(
      companyId, target,
      { latitude: branchRes.Item.latitude, longitude: branchRes.Item.longitude, name: branchRes.Item.name, address: branchRes.Item.address },
      req.user,
    );
    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── POST /api/whatsapp/broadcast — send template to a lead segment ────────────
router.post('/broadcast', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { templateId, variableValues, filter, headerVariableValue } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });

    const companyId = req.user.companyId;

    const tmplResult = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${companyId}`, SK: `TMPL#${templateId}` },
    }).promise();
    const tmpl = tmplResult.Item;
    if (!tmpl) return res.status(404).json({ error: 'Template not found' });

    const bcastHdrComp = (tmpl.components ?? []).find((c) => c.type === 'HEADER' && c.format === 'TEXT');
    const bcastHasHdrVar = bcastHdrComp && /\{\{1\}\}/.test(bcastHdrComp.text ?? '');

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
    if (filter?.tags?.length) {
      // ID/label tolerant matching — filters may hold catalog IDs or legacy labels
      const accept = await TagService.expandTagFilter(companyId, filter.tags);
      items = items.filter((l) => TagService.matchesTagFilter(l.tags, accept));
    }
    if (filter?.assignedTo) items = items.filter((l) => l.assignedTo === filter.assignedTo);
    if (filter?.source) items = items.filter((l) => l.source === filter.source);

    if (items.length === 0) return res.status(400).json({ error: 'No leads match the selected filters' });
    if (items.length > 1000) return res.status(400).json({ error: 'Broadcast limited to 1000 leads per batch. Refine your filters.' });

    const broadcastId = randomUUID();
    const now = new Date().toISOString();
    const broadcastSK = `${now}#${broadcastId}`;
    let sent = 0; let failed = 0;
    const errors = [];

    await Promise.allSettled(items.map(async (lead) => {
      try {
        if (!lead.phone) {
          logger.warn(`broadcast: skipping lead ${lead.leadId} — no phone number`);
          failed++;
          return;
        }
        const params = resolveTemplateParams(variableValues, { name: lead.name, phone: lead.phone, source: lead.source });
        const resolvedHeader = !bcastHasHdrVar ? null
          : headerVariableValue === '{{name}}' ? (lead.name ?? '')
          : headerVariableValue === '{{phone}}' ? (lead.phone ?? '')
          : (headerVariableValue ?? bcastHdrComp?.example?.header_text?.[0] ?? '');

        await WASendSvc.sendTemplate(
          companyId,
          { resolvedContact: { pk: lead.PK, phone: lead.phone, leadItem: lead, isLead: true } },
          { templateName: tmpl.templateName, language: tmpl.language ?? 'en' },
          params,
          req.user,
          {
            headerVariableValue: bcastHasHdrVar ? resolvedHeader : null,
            content:      `[Broadcast: ${tmpl.name}]`,
            extraFields:  { broadcastId, templateId },
            wamidExtras:  { broadcastId, broadcastSK },
          },
        );
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
    // stripStorageMetadata() before parse — raw DynamoDB items carry PK/SK/
    // companyId/updatedAt, which welcomeConfigSchema.parse() would otherwise
    // see as literal config fields. Also replaces the old backward-compat
    // default: every schema field already has its own .default(), so
    // parse({}) on a missing Item naturally falls through to template-only
    // (messageType/bodyText/buttons/ctaButtons empty), same result as before.
    res.json({
      success: true,
      config: welcomeConfigSchema.parse(stripStorageMetadata(result.Item)),
    });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/welcome-config ──────────────────────────────────────────
router.put('/welcome-config', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const parsed = welcomeConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const cfg = parsed.data;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#WELCOME#${req.user.companyId}`, SK: 'CURRENT',
        companyId: req.user.companyId,
        enabled: cfg.enabled,
        messageType: cfg.messageType,
        templateName: cfg.templateName,
        language: cfg.language,
        bodyText: cfg.bodyText,
        buttons: cfg.buttons,
        ctaButtons: cfg.ctaButtons,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET/PUT /api/whatsapp/conversation-agent-config ───────────────────────────
// The autonomous AI conversation agent's opt-in gate (2026-07-06, Era 22).
// Deliberately defaults to { enabled: false } and lives as its own dedicated
// config, separate from the generic AIService master/module toggle (which
// defaults every registered useCase to enabled) — see
// ConversationalAgentService.js's own header comment for why. Same
// GET-defaults-to-disabled / PUT-boolean-required shape as
// admin.js's CONFIG#AUTOASSIGN route, the closest existing precedent for an
// opt-in-only automated behavior.
router.get('/conversation-agent-config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#CONVAGENT#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    res.json({ success: true, config: result.Item ?? { enabled: false } });
  } catch (err) { next(err); }
});

router.put('/conversation-agent-config', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) required' });
    }
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#CONVAGENT#${req.user.companyId}`, SK: 'CURRENT',
        companyId: req.user.companyId, enabled,
        updatedBy: req.user.id, updatedAt: new Date().toISOString(),
      },
    }).promise();
    await logAudit(req.user.id, 'conversation_agent_config_update', `enabled:${enabled}`, 'success', req.ip, {}, req.user.companyId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/delayed-response-config ─────────────────────────────────
router.get('/delayed-response-config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#DELAYED_RESPONSE#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    // stripStorageMetadata() before parse — see /welcome-config's identical comment.
    res.json({
      success: true,
      config: delayedResponseConfigSchema.parse(stripStorageMetadata(result.Item)),
    });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/delayed-response-config ──────────────────────────────────
router.put('/delayed-response-config', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const parsed = delayedResponseConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const cfg = parsed.data;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#DELAYED_RESPONSE#${req.user.companyId}`, SK: 'CURRENT',
        companyId: req.user.companyId,
        enabled: cfg.enabled,
        delayAmount: cfg.delayAmount,
        delayUnit: cfg.delayUnit,
        messageText: cfg.messageText,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/hours-config ─────────────────────────────────────────────
router.get('/hours-config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#HOURS#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    // stripStorageMetadata() before parse — see /welcome-config's identical comment.
    // Previously this was `result.Item ?? workingHoursConfigSchema.parse({})`,
    // which returned the raw (unstripped) Item on every subsequent GET once a
    // real save existed — the PK/SK/companyId/updatedAt it carried then rode
    // along into the next PUT's body and .strict() rejected them.
    res.json({ success: true, config: workingHoursConfigSchema.parse(stripStorageMetadata(result.Item)) });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/hours-config ──────────────────────────────────────────────
router.put('/hours-config', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const parsed = workingHoursConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const cfg = parsed.data;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#HOURS#${req.user.companyId}`, SK: 'CURRENT',
        companyId: req.user.companyId,
        enabled: cfg.enabled,
        timezone: cfg.timezone,
        schedule: cfg.schedule,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/whatsapp/ooo-config ────────────────────────────────────────────────
router.get('/ooo-config', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#OOO#${req.user.companyId}`, SK: 'CURRENT' },
    }).promise();
    // stripStorageMetadata() before parse — see /welcome-config's identical comment.
    res.json({ success: true, config: oooConfigSchema.parse(stripStorageMetadata(result.Item)) });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/ooo-config ────────────────────────────────────────────────
router.put('/ooo-config', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const parsed = oooConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const cfg = parsed.data;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#OOO#${req.user.companyId}`, SK: 'CURRENT',
        companyId: req.user.companyId,
        enabled: cfg.enabled,
        messageText: cfg.messageText,
        updatedAt: new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── CONFIG#BRANCH# — multi-office branch directory (Item 1c) ──────────────────
// Shared by the Send Location canvas node's dropdown and the Inbox composer's
// own "Send Location" button — one list of saved offices, not duplicated
// per-feature. Personal-company scoped, no superadmin/cross-company sharing.
const branchPK = (companyId) => `CONFIG#BRANCH#${companyId}`;
const branchSK = (branchId)  => `BRANCH#${branchId}`;

// ── GET /api/whatsapp/branches ─────────────────────────────────────────────────
router.get('/branches', authMiddleware, async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': branchPK(req.user.companyId), ':sk': 'BRANCH#' },
    }).promise();
    // stripStorageMetadata() — BranchesPanel.tsx always constructs its
    // PUT/POST body from explicit form fields, never by spreading a fetched
    // branch (see docs/phase3/TECHNICAL_DEBT.md's repo-wide sweep), so this
    // was never at 400 risk — but no reason to hand PK/SK/companyId to the
    // client either.
    const branches = (result.Items ?? []).map(stripStorageMetadata).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    res.json({ success: true, branches });
  } catch (err) { next(err); }
});

// ── POST /api/whatsapp/branches ────────────────────────────────────────────────
router.post('/branches', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const cfg = parsed.data;
    const companyId = req.user.companyId;
    const branchId = randomUUID();
    const now = new Date().toISOString();

    const item = {
      PK: branchPK(companyId), SK: branchSK(branchId),
      branchId, companyId,
      name: cfg.name, address: cfg.address, latitude: cfg.latitude, longitude: cfg.longitude,
      createdAt: now, updatedAt: now,
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, branch: stripStorageMetadata(item) });
  } catch (err) { next(err); }
});

// ── PUT /api/whatsapp/branches/:branchId ───────────────────────────────────────
router.put('/branches/:branchId', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const existing = await dynamodb.get({
      TableName: TABLE, Key: { PK: branchPK(companyId), SK: branchSK(req.params.branchId) },
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Branch not found' });

    const parsed = branchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const cfg = parsed.data;

    const item = {
      ...existing.Item,
      name: cfg.name, address: cfg.address, latitude: cfg.latitude, longitude: cfg.longitude,
      updatedAt: new Date().toISOString(),
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.json({ success: true, branch: stripStorageMetadata(item) });
  } catch (err) { next(err); }
});

// ── DELETE /api/whatsapp/branches/:branchId ─────────────────────────────────────
router.delete('/branches/:branchId', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: branchPK(req.user.companyId), SK: branchSK(req.params.branchId) },
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
    // Fire-and-forget: sync unread reset to CONV# entity
    syncMarkRead(companyId, { leadPK: `LEAD#${companyId}#${leadId}` }, req.user.id).catch(() => {});

    // Send read receipt to Meta (shows blue ticks on customer's phone) — via
    // WhatsAppSendService per ADR-012, not a direct Graph API call.
    if (lastWaMessageId) {
      await WASendSvc.sendReadReceipt(
        companyId, { leadPK: `LEAD#${companyId}#${leadId}` }, lastWaMessageId, req.user,
      ).catch(() => {});
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
    // Fire-and-forget: sync unread reset to CONV# entity
    syncMarkRead(companyId, { inboxPK: `INBOX#${companyId}#${phone}` }, req.user.id).catch(() => {});
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
    const key = `uploads/${req.user.companyId}/${randomUUID()}.${ext}`;

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
router.post('/send-media', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { leadPK, mediaType, mediaUrl, caption, filename } = req.body;
    if (!leadPK || !mediaType || !mediaUrl) return res.status(400).json({ error: 'leadPK, mediaType, and mediaUrl are required' });

    const result = await WASendSvc.sendMedia(
      req.user.companyId,
      { leadPK },
      { mediaType, url: mediaUrl, caption, filename },
      req.user,
    );
    res.json({ success: true, messageId: result.wamid, timestamp: result.timestamp });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('send-media error', err?.response?.data ?? err.message);
    next(err);
  }
});

// ── POST /api/whatsapp/upload-send — read from S3, upload to Meta, send ───────
// Called after the browser has PUT the file directly to S3 via presigned URL.
// Works for both known leads (leadPK) and unknown contacts (phone).
router.post('/upload-send', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
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

    // S3→Meta upload + 29-day dedup cache — delegated to WhatsAppSendService so
    // AutomationEngine's send_document action (which needs the exact same step at
    // execution time, with no lead/target to resolve at config time) can reuse it
    // instead of duplicating this logic a second place.
    let mediaId;
    try {
      mediaId = await WASendSvc.resolveMediaId(companyId, { s3Key, mimeType, filename: safeFilename, fileHash });
    } catch (e) {
      logger.error('Meta media upload failed', e.details ?? e.message);
      return res.status(e.status ?? 400).json({ error: e.message, details: e.details });
    }

    // Do NOT delete S3 object — kept for direct presigned GET streaming (video/large files).
    // Lifecycle rule handles cleanup after 30 days (matches Meta's media_id expiry).

    // Send via media_id + persist via service (message record, WAMID index, last-message update)
    const sendResult = await WASendSvc.sendMedia(
      companyId,
      { resolvedContact: { pk, phone, leadItem, isLead: !!leadItem } },
      { mediaType, mediaId, caption, filename: safeFilename, mimeType, s3Key },
      req.user,
    );

    // MEDIA# index — enables per-contact media gallery (route-specific, not in service)
    const contactKey = leadItem ? pk.split('#')[2] : phone;
    writeMediaIndex(companyId, contactKey, {
      leadPK: pk, mediaId, mimeType,
      filename: safeFilename, caption: caption ?? null,
      direction: 'outbound', sentBy: req.user.id, timestamp: sendResult.timestamp,
    });

    res.json({ success: true, messageId: sendResult.wamid, timestamp: sendResult.timestamp });
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
module.exports.storeInboundMedia = storeInboundMedia;
module.exports.isFlowResponse = isFlowResponse;
module.exports.parseFlowResponse = parseFlowResponse;
module.exports.isButtonReply = isButtonReply;
module.exports.parseButtonReply = parseButtonReply;
module.exports.isListReply = isListReply;
module.exports.parseListReply = parseListReply;
module.exports.sendWelcomeMessage = sendWelcomeMessage;
module.exports.fireButtonFollowUp = fireButtonFollowUp;
module.exports.sendRegisteredFlow = sendRegisteredFlow;
