'use strict';

/**
 * Journey Platform — admin CRUD for Journey Definitions + read-only Instances,
 * plus public capability-URL GET/submit (Task 7).
 *
 * Mounted in app.js behind authMiddleware + subscriptionMiddleware (same shape
 * as automations/campaigns/api-keys). Role-gating matches forms.js:
 *   writes  → checkRole(['admin'])
 *   reads   → checkRole(['admin', 'manager'])
 *
 * Public GET/submit are exported as [rateLimit, handler] arrays and registered
 * in app.js BEFORE the auth-guarded router — sibling to automations.inboundWebhook.
 */

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { checkRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const { s3Client, PUBLIC_ASSETS_BUCKET } = require('../config/s3');
const { generateJourneyDefId } = require('../core/id');
const {
  journeyDefPK,
  journeyDefSK,
  journeyPK,
  journeyMetaSK,
  journeyRecordSK,
  journeysByCompanyGsiPK,
  GSI,
} = require('../core/entityKeys');
const { newMeta, updateMeta } = require('../core/systemMeta');
const AutomationEngine = require('../services/AutomationEngine');
const { isEnabled } = require('../utils/featureFlags');

const router = express.Router();
const TABLE = () => process.env.DYNAMODB_TABLE_METRICS;

// Same payload guard as automations.js inboundWebhook.
const MAX_JOURNEY_PAYLOAD_BYTES = 100_000;

// Journey Platform kill-switch (CONFIG#FLAGS journeys_platform, default false).
// Admin: 403. Public: flat 404 (same shape as invalid token — do not advertise).
async function requireJourneysPlatformAdmin(req, res, next) {
  try {
    if (!(await isEnabled(req.user.companyId, 'journeys_platform'))) {
      return res.status(403).json({ success: false, error: 'Journey Platform is not enabled' });
    }
    next();
  } catch (err) { next(err); }
}

async function requireJourneysPlatformPublic(req, res, next) {
  try {
    if (!(await isEnabled(req.params.companyId, 'journeys_platform'))) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  } catch (err) { next(err); }
}

router.use(requireJourneysPlatformAdmin);

// ── Zod schemas (strict — unknown fields rejected) ───────────────────────────

const screenFieldSchema = z.object({
  id:       z.string().trim().min(1).max(80),
  label:    z.string().trim().min(1).max(200),
  type:     z.string().trim().min(1).max(40),
  required: z.boolean().optional(),
  options:  z.array(z.string().trim().min(1).max(200)).max(50).optional(),
}).strict();

const screenSchema = z.object({
  id:     z.string().trim().min(1).max(80),
  title:  z.string().trim().min(1).max(200),
  fields: z.array(screenFieldSchema).max(50).default([]),
}).strict();

// Public journey branding — only these keys are stored / returned on the
// capability-URL GET whitelist. bannerImageUrl must be an absolute http(s)
// URL (public page is unauthenticated; private S3 keys are not usable there).
const brandingConfigSchema = z.object({
  primaryColor:   z.string().trim().min(1).max(32).optional(),
  bannerImageUrl: z.string().trim().url().max(2048).optional(),
}).strict().nullable().optional();

/** Strip unknown keys before returning branding on the public GET. */
function publicBrandingConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (typeof raw.primaryColor === 'string' && raw.primaryColor.trim()) {
    out.primaryColor = raw.primaryColor.trim();
  }
  if (typeof raw.bannerImageUrl === 'string' && raw.bannerImageUrl.trim()) {
    out.bannerImageUrl = raw.bannerImageUrl.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

const createDefSchema = z.object({
  name:             z.string().trim().min(1, 'name is required').max(200),
  industryPack:     z.string().trim().min(1).max(60).default('generic'),
  screens:          z.array(screenSchema).max(20).default([]),
  brandingConfig:   brandingConfigSchema,
  linkedWorkflowId: z.string().trim().min(1).max(80).nullable().optional(),
}).strict();

const updateDefSchema = z.object({
  name:             z.string().trim().min(1).max(200).optional(),
  industryPack:     z.string().trim().min(1).max(60).optional(),
  screens:          z.array(screenSchema).max(20).optional(),
  brandingConfig:   brandingConfigSchema,
  linkedWorkflowId: z.string().trim().min(1).max(80).nullable().optional(),
  active:           z.boolean().optional(),
}).strict().refine(
  (body) => Object.keys(body).length > 0,
  { message: 'At least one field is required' },
);

// ── POST /api/journeys/definitions ───────────────────────────────────────────
router.post('/definitions', checkRole(['admin']), async (req, res, next) => {
  try {
    const data = createDefSchema.parse(req.body);
    const companyId = req.user.companyId;
    const journeyDefId = generateJourneyDefId();
    const meta = newMeta(req.user.id);

    const item = {
      PK: journeyDefPK(companyId),
      SK: journeyDefSK(journeyDefId),
      id: journeyDefId,
      companyId,
      name: data.name,
      industryPack: data.industryPack,
      screens: data.screens,
      brandingConfig: data.brandingConfig ?? null,
      linkedWorkflowId: data.linkedWorkflowId ?? null,
      active: true,
      ...meta,
    };

    await dynamodb.put({ TableName: TABLE(), Item: item }).promise();
    res.status(201).json({ success: true, definition: item });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/definitions ────────────────────────────────────────────
router.get('/definitions', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const result = await dynamodb.query({
      TableName: TABLE(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': journeyDefPK(companyId),
        ':sk': 'DEF#',
      },
    }).promise();

    const definitions = (result.Items ?? []).sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
    );
    res.json({ success: true, definitions });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/definitions/:id ────────────────────────────────────────
router.get('/definitions/:id', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { Item } = await dynamodb.get({
      TableName: TABLE(),
      Key: { PK: journeyDefPK(companyId), SK: journeyDefSK(req.params.id) },
    }).promise();
    if (!Item) return res.status(404).json({ error: 'Journey definition not found' });
    res.json({ success: true, definition: Item });
  } catch (err) { next(err); }
});

// ── PUT /api/journeys/definitions/:id ────────────────────────────────────────
// No optimistic-lock ConditionExpression — admin edits aren't genuinely
// concurrent the way Task 2's engine writes are. Still advances version via
// updateMeta() so systemMeta conventions stay consistent.
router.put('/definitions/:id', checkRole(['admin']), async (req, res, next) => {
  try {
    const data = updateDefSchema.parse(req.body);
    const companyId = req.user.companyId;
    const key = { PK: journeyDefPK(companyId), SK: journeyDefSK(req.params.id) };

    const { Item: current } = await dynamodb.get({ TableName: TABLE(), Key: key }).promise();
    if (!current) return res.status(404).json({ error: 'Journey definition not found' });

    const meta = updateMeta(current, req.user.id);
    const names = { '#v': 'version' };
    const values = {
      ':ua': meta.updatedAt,
      ':ub': meta.updatedBy,
      ':nv': meta.version,
    };
    const sets = ['updatedAt = :ua', 'updatedBy = :ub', '#v = :nv'];

    if (data.name !== undefined) {
      names['#n'] = 'name';
      values[':n'] = data.name;
      sets.push('#n = :n');
    }
    if (data.industryPack !== undefined) {
      values[':ip'] = data.industryPack;
      sets.push('industryPack = :ip');
    }
    if (data.screens !== undefined) {
      values[':sc'] = data.screens;
      sets.push('screens = :sc');
    }
    if (data.brandingConfig !== undefined) {
      values[':bc'] = data.brandingConfig;
      sets.push('brandingConfig = :bc');
    }
    if (data.linkedWorkflowId !== undefined) {
      values[':lw'] = data.linkedWorkflowId;
      sets.push('linkedWorkflowId = :lw');
    }
    if (data.active !== undefined) {
      values[':a'] = data.active;
      sets.push('active = :a');
    }

    await dynamodb.update({
      TableName: TABLE(),
      Key: key,
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/journeys/definitions/:id ─────────────────────────────────────
// Soft-delete only (active: false) — forms.js exact precedent. Never hard-delete;
// existing JOURNEY# instances may still reference this journeyDefId.
router.delete('/definitions/:id', checkRole(['admin']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const key = { PK: journeyDefPK(companyId), SK: journeyDefSK(req.params.id) };

    const { Item: current } = await dynamodb.get({ TableName: TABLE(), Key: key }).promise();
    if (!current) return res.status(404).json({ error: 'Journey definition not found' });

    const meta = updateMeta(current, req.user.id);
    await dynamodb.update({
      TableName: TABLE(),
      Key: key,
      UpdateExpression: 'SET active = :f, updatedAt = :ua, updatedBy = :ub, #v = :nv',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#v': 'version' },
      ExpressionAttributeValues: {
        ':f': false,
        ':ua': meta.updatedAt,
        ':ub': meta.updatedBy,
        ':nv': meta.version,
      },
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/banner-upload-url — presigned PUT for public banner ─────
// Purpose-built sibling of GET /api/auth/me/avatar-upload-url: same query shape
// (mimeType/filename/fileSize), MIME→ext map (never client filename), size cap.
// Writes to the public-assets bucket under journey-banners/{companyId}/… so the
// public unauthenticated journey page can load the image via HTTPS object URL
// without an auth'd s3-url resolver. Bucket + IAM must be applied separately
// (see Founder-reviewed policy JSON) before this route succeeds in production.
const BANNER_MIME_EXT = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
// 2MB — same ceiling as avatar. WebP/JPEG hero banners compress well under
// that; raising to 3MB would only help rare uncompressed photography uploads
// and weakens the shared client-side guard pattern for little gain.
const BANNER_MAX_BYTES = 2 * 1024 * 1024;

router.get('/banner-upload-url', checkRole(['admin']), async (req, res, next) => {
  try {
    const { mimeType, filename, fileSize } = req.query;
    if (!mimeType || !filename) {
      return res.status(400).json({ error: 'mimeType and filename required' });
    }
    if (!PUBLIC_ASSETS_BUCKET) {
      return res.status(500).json({ error: 'PUBLIC_ASSETS_BUCKET env var not set' });
    }
    if (!BANNER_MIME_EXT.has(mimeType)) {
      return res.status(400).json({ error: 'Only JPG, PNG, and WebP images are allowed' });
    }
    if (fileSize && Number(fileSize) > BANNER_MAX_BYTES) {
      return res.status(400).json({ error: 'Banner must be under 2 MB' });
    }

    const ext = BANNER_MIME_EXT.get(mimeType);
    const key = `journey-banners/${req.user.companyId}/${crypto.randomUUID()}.${ext}`;
    const region = process.env.AWS_REGION || 'ap-south-1';
    const publicUrl = `https://${PUBLIC_ASSETS_BUCKET}.s3.${region}.amazonaws.com/${key}`;

    const uploadUrl = s3Client.getSignedUrl('putObject', {
      Bucket: PUBLIC_ASSETS_BUCKET,
      Key: key,
      ContentType: mimeType,
      Expires: 300,
    });

    res.json({ success: true, uploadUrl, key, publicUrl });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/instances ──────────────────────────────────────────────
// Query JourneysByCompany GSI (never Scan). status / journeyDefId / date-range
// filters match crm.js + contacts.js: Query first, then in-memory filter.
router.get('/instances', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const { status, journeyDefId, dateFrom, dateTo } = req.query;

    const items = [];
    let lastKey;
    do {
      const result = await dynamodb.query({
        TableName: TABLE(),
        IndexName: GSI.JOURNEYS_BY_COMPANY,
        KeyConditionExpression: 'journeysByCompanyGsiPK = :pk',
        ExpressionAttributeValues: {
          ':pk': journeysByCompanyGsiPK(companyId),
        },
        ScanIndexForward: false,
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    let instances = items.filter((i) => i.SK === 'META' || i.SK === journeyMetaSK());
    if (status) instances = instances.filter((i) => i.status === status);
    if (journeyDefId) instances = instances.filter((i) => i.journeyDefId === journeyDefId);
    if (dateFrom) instances = instances.filter((i) => i.createdAt && i.createdAt >= dateFrom);
    if (dateTo) {
      const endOfDay = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
      instances = instances.filter((i) => i.createdAt && i.createdAt <= endOfDay);
    }

    res.json({ success: true, instances });
  } catch (err) { next(err); }
});

// ── GET /api/journeys/instances/:id ──────────────────────────────────────────
router.get('/instances/:id', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const pk = journeyPK(companyId, req.params.id);

    const [metaRes, recordRes] = await Promise.all([
      dynamodb.get({ TableName: TABLE(), Key: { PK: pk, SK: journeyMetaSK() } }).promise(),
      dynamodb.get({ TableName: TABLE(), Key: { PK: pk, SK: journeyRecordSK() } }).promise(),
    ]);

    if (!metaRes.Item) return res.status(404).json({ error: 'Journey instance not found' });

    res.json({
      success: true,
      instance: metaRes.Item,
      record: recordRes.Item ?? null,
    });
  } catch (err) { next(err); }
});

// ── Public capability-URL helpers / handlers (Task 7) ────────────────────────
// Token is hashed at rest (Task 5). Compare SHA-256(incoming) to tokenHash with
// the same length-guard + timingSafeEqual pattern automations.js uses for its
// raw webhookToken — never throw on unequal Buffer lengths.

async function validateJourneyToken(companyId, journeyInstanceId, token) {
  const { Item } = await dynamodb.get({
    TableName: TABLE(),
    Key: { PK: journeyPK(companyId, journeyInstanceId), SK: journeyMetaSK() },
  }).promise();
  if (!Item) return { ok: false };

  const expected = Buffer.from(Item.tokenHash ?? '');
  const actual = Buffer.from(
    crypto.createHash('sha256').update(String(token ?? '')).digest('hex'),
  );
  // Mirror automations.js: length check BEFORE timingSafeEqual (which throws on
  // unequal lengths). expected.length > 0 rejects a missing/empty stored hash.
  const tokenMatches = expected.length > 0
    && expected.length === actual.length
    && crypto.timingSafeEqual(expected, actual);
  if (!tokenMatches) return { ok: false };

  if (!Item.tokenExpiresAt || Date.parse(Item.tokenExpiresAt) <= Date.now()) {
    return { ok: false };
  }

  return { ok: true, instance: Item };
}

const FINISHED_STATUSES = new Set(['completed', 'cancelled', 'expired']);

async function handlePublicGet(req, res, next) {
  try {
    const { companyId, journeyInstanceId, token } = req.params;
    const validated = await validateJourneyToken(companyId, journeyInstanceId, token);
    if (!validated.ok) return res.status(404).json({ error: 'Not found' });

    const instance = validated.instance;
    let definition = null;
    if (instance.journeyDefId) {
      const { Item: def } = await dynamodb.get({
        TableName: TABLE(),
        Key: { PK: journeyDefPK(companyId), SK: journeyDefSK(instance.journeyDefId) },
      }).promise();
      if (def) {
        definition = {
          name: def.name ?? null,
          screens: def.screens ?? [],
          brandingConfig: publicBrandingConfig(def.brandingConfig),
        };
      }
    }

    // Whitelisted public shape only — never leak tokenHash / lead / execution refs.
    res.status(200).json({
      success: true,
      instance: {
        journeyInstanceId: instance.id ?? journeyInstanceId,
        status: instance.status,
      },
      definition,
    });
  } catch (err) { next(err); }
}

async function handlePublicSubmit(req, res, next) {
  try {
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (contentLength > MAX_JOURNEY_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const { companyId, journeyInstanceId, token } = req.params;
    const validated = await validateJourneyToken(companyId, journeyInstanceId, token);
    if (!validated.ok) return res.status(404).json({ error: 'Not found' });

    const instance = validated.instance;
    if (FINISHED_STATUSES.has(instance.status)) {
      return res.status(409).json({ error: 'Journey is no longer accepting submissions' });
    }

    const now = new Date().toISOString();
    await dynamodb.put({
      TableName: TABLE(),
      Item: {
        PK: journeyPK(companyId, journeyInstanceId),
        SK: journeyRecordSK(),
        companyId,
        journeyInstanceId,
        data: req.body ?? {},
        submittedAt: now,
      },
    }).promise();

    // First successful submit: opened → in_progress (only place this enum is used).
    if (instance.status === 'opened') {
      const meta = updateMeta(instance, 'system');
      await dynamodb.update({
        TableName: TABLE(),
        Key: { PK: journeyPK(companyId, journeyInstanceId), SK: journeyMetaSK() },
        UpdateExpression: 'SET #st = :st, updatedAt = :ua, updatedBy = :ub, #v = :nv',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#st': 'status', '#v': 'version' },
        ExpressionAttributeValues: {
          ':st': 'in_progress',
          ':ua': meta.updatedAt,
          ':ub': meta.updatedBy,
          ':nv': meta.version,
        },
      }).promise();
    }

    // Write-only — does NOT call resumeOnWebhook / AutomationEngine (Task 8).
    res.status(200).json({ success: true });
  } catch (err) { next(err); }
}

// ── Public webhook-resume (Task 8) ───────────────────────────────────────────
// Connects validateJourneyToken (Task 7) to AutomationEngine.resumeOnWebhook
// (Task 4). No finished-status check here: once complete_journey/cancel_journey
// (or a prior webhook claim / timeout) has run, the AUTO_WAIT# item is already
// gone, so resumeOnWebhook returns { status: 'not_found' } on its own.
async function handlePublicWebhook(req, res, next) {
  try {
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (contentLength > MAX_JOURNEY_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const { companyId, journeyInstanceId, token } = req.params;
    const validated = await validateJourneyToken(companyId, journeyInstanceId, token);
    if (!validated.ok) return res.status(404).json({ error: 'Not found' });

    // Payload passed through as-is — no schema validation (same accepted V1
    // limitation as Task 7's submit body; see architecture doc risks).
    const result = await AutomationEngine.resumeOnWebhook(
      companyId,
      journeyInstanceId,
      req.body ?? {},
    );

    if (result?.status === 'resumed') {
      return res.status(200).json({ success: true, executionId: result.executionId });
    }
    // Flat 404 — same body as invalid token. Task 4 collapses never-paused /
    // already-resumed / timed-out into not_found; do not re-distinguish here.
    return res.status(404).json({ error: 'Not found' });
  } catch (err) { next(err); }
}

module.exports = router;
module.exports.validateJourneyToken = validateJourneyToken;
// Composed as arrays (rate-limit + handler) so app.js can mount in one line
// without importing rateLimiter — same public-route pattern as inboundWebhook.
module.exports.publicGet = [rateLimit(30, 60_000), requireJourneysPlatformPublic, handlePublicGet];
module.exports.publicSubmit = [rateLimit(30, 60_000), requireJourneysPlatformPublic, handlePublicSubmit];
module.exports.publicWebhook = [rateLimit(30, 60_000), requireJourneysPlatformPublic, handlePublicWebhook];
