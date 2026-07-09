'use strict';
const express = require('express');
const { randomUUID } = require('crypto');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const WASendSvc = require('../services/WhatsAppSendService');
const TagService = require('../services/TagService');
const { resolveTemplateParams } = require('../utils/welcomeVariables');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

const campPK = (cid) => `CONFIG#CAMP#${cid}`;
const campSK = (id)  => `CAMP#${id}`;

// ── Single authoritative audience builder ─────────────────────────────────
// Used by /audience/preview, /audience/validate, and /:id/launch.
// Audience is built exactly once per request; the same object is used for
// both the count validation guard and the send loop — no double-rebuild.
async function _buildAudience(companyId, filter) {
  let items = [];
  let lastKey;
  do {
    const sr = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :pfx) AND SK = :meta AND attribute_not_exists(deletedAt)',
      ExpressionAttributeValues: { ':pfx': `LEAD#${companyId}#`, ':meta': 'METADATA' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(sr.Items ?? []));
    lastKey = sr.LastEvaluatedKey;
  } while (lastKey);

  const f = filter ?? {};
  if (f.stages?.length)  items = items.filter((l) => f.stages.includes(l.stage));
  if (f.tags?.length) {
    // ID/label tolerant matching — filters may hold catalog IDs or legacy labels
    const accept = await TagService.expandTagFilter(companyId, f.tags);
    items = items.filter((l) => TagService.matchesTagFilter(l.tags, accept));
  }
  if (f.assignedTo)      items = items.filter((l) => l.assignedTo === f.assignedTo);
  if (f.source)          items = items.filter((l) => l.source === f.source);

  // Dedup by phoneNorm — one recipient per unique WhatsApp account (ADR-013)
  const seenPhones = new Set();
  let duplicatesRemoved = 0;
  let invalidPhoneCount = 0;
  const leads = [];
  for (const l of items) {
    const norm = l.phoneNorm || l.phone;
    if (!norm)               { invalidPhoneCount++; continue; }
    if (seenPhones.has(norm)) { duplicatesRemoved++;  continue; }
    seenPhones.add(norm);
    leads.push(l);
  }

  return { leads, count: leads.length, stats: { duplicatesRemoved, invalidPhoneCount } };
}

const RECIPIENT_CAP = 50;
function _toRecipient(l) {
  return { pk: l.PK, name: l.name ?? l.phone ?? '', phone: l.phone ?? '', stage: l.stage ?? '', tags: l.tags ?? [] };
}

// ── GET /stats — dashboard KPIs (before /:id) ─────────────────────────────
router.get('/stats', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const r = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': campPK(companyId), ':sk': 'CAMP#' },
    }).promise();

    let active = 0, draft = 0, scheduled = 0, completed = 0;
    let totalAudience = 0, totalMessages = 0, deliveredCount = 0, readCount = 0, replyCount = 0;

    for (const c of r.Items ?? []) {
      const s = c.stats ?? {};
      if (c.status === 'active')         active++;
      else if (c.status === 'draft')     draft++;
      else if (c.status === 'scheduled') scheduled++;
      else if (c.status === 'completed') completed++;
      totalAudience  += s.totalAudience ?? 0;
      totalMessages  += s.sent ?? 0;
      deliveredCount += s.delivered ?? 0;
      readCount      += s.read ?? 0;
      replyCount     += s.replied ?? 0;
    }

    res.json({
      success: true,
      stats: {
        total: (r.Items ?? []).length,
        active, draft, scheduled, completed,
        totalAudience, totalMessages,
        deliveryRate: totalMessages > 0 ? Math.round((deliveredCount / totalMessages) * 100) : 0,
        readRate:     totalMessages > 0 ? Math.round((readCount     / totalMessages) * 100) : 0,
        replyRate:    totalMessages > 0 ? Math.round((replyCount    / totalMessages) * 100) : 0,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /audience/preview — count + recipient list (before /:id) ─────────
router.post('/audience/preview', authMiddleware, checkRole(['admin', 'manager']), rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const { filter = {} } = req.body;
    const { leads, count, stats } = await _buildAudience(req.user.companyId, filter);

    const recipientsCapped = count > RECIPIENT_CAP;
    res.json({
      success:          true,
      count,
      exceedsLimit:     count > 1000,
      duplicatesRemoved: stats.duplicatesRemoved,
      invalidPhoneCount: stats.invalidPhoneCount,
      recipients:        !recipientsCapped ? leads.map(_toRecipient) : null,
      recipientsCapped,
    });
  } catch (err) { next(err); }
});

// ── POST /audience/validate — preflight before launch (before /:id) ────────
// Called by the UI after the user clicks Launch. Compares the count the user
// saw in the Review step (reviewCount) against the current live audience.
// Returns valid:true only when they are identical. The send loop in /:id/launch
// performs the same check as a server-side safety net.
router.post('/audience/validate', authMiddleware, checkRole(['admin', 'manager']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { filter = {}, reviewCount, reviewRecipients } = req.body;
    const { companyId } = req.user;

    if (typeof reviewCount !== 'number') {
      return res.status(400).json({ error: 'reviewCount is required' });
    }

    const { leads, count, stats } = await _buildAudience(companyId, filter);
    const valid = count === reviewCount;

    const recipientsCapped = count > RECIPIENT_CAP;
    const currentRecipients = !recipientsCapped ? leads.map(_toRecipient) : null;

    // Build per-contact diff when both lists are available (small audiences only)
    let removed = null;
    let added   = null;
    if (Array.isArray(reviewRecipients) && currentRecipients) {
      const reviewPks  = new Set(reviewRecipients.map((r) => r.pk).filter(Boolean));
      const currentPks = new Set(currentRecipients.map((r) => r.pk));
      removed = reviewRecipients
        .filter((r) => r.pk && !currentPks.has(r.pk))
        .map((r) => ({ ...r, reason: 'No longer matches filters (deleted, stage changed, or duplicate)' }));
      added = currentRecipients
        .filter((r) => !reviewPks.has(r.pk))
        .map((r) => ({ ...r, reason: 'New match since review' }));
    }

    res.json({
      success:      true,
      valid,
      reviewCount,
      currentCount: count,
      delta:        count - reviewCount,
      stats:        { duplicatesRemoved: stats.duplicatesRemoved, invalidPhoneCount: stats.invalidPhoneCount },
      removed,
      added,
      validatedAt:  new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ── GET / — list campaigns ────────────────────────────────────────────────
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const { status, type } = req.query;

    const params = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': campPK(companyId), ':sk': 'CAMP#' },
      ScanIndexForward: false,
    };

    const filterParts = [];
    const exprNames  = {};
    if (status) {
      filterParts.push('#st = :st');
      exprNames['#st'] = 'status';
      params.ExpressionAttributeValues[':st'] = status;
    }
    if (type) {
      filterParts.push('#tp = :tp');
      exprNames['#tp'] = 'type';
      params.ExpressionAttributeValues[':tp'] = type;
    }
    if (filterParts.length) {
      params.FilterExpression = filterParts.join(' AND ');
      params.ExpressionAttributeNames = exprNames;
    }

    const result = await dynamodb.query(params).promise();
    res.json({ success: true, campaigns: result.Items ?? [] });
  } catch (err) { next(err); }
});

// ── POST / — create campaign (draft) ──────────────────────────────────────
router.post('/', authMiddleware, checkRole(['admin', 'manager']), rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const {
      name, description, type, objective, tags,
      audience, templateId, templateName,
      variableValues, headerVariableValue, scheduledAt,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!['whatsapp_broadcast', 'ctwa'].includes(type)) {
      return res.status(400).json({ error: 'type must be whatsapp_broadcast or ctwa' });
    }
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'scheduledAt must be in the future' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const { companyId } = req.user;

    const item = {
      PK: campPK(companyId), SK: campSK(id),
      id, companyId,
      name: name.trim(),
      description:         description?.trim() ?? null,
      type,
      objective:           objective ?? 'awareness',
      status:              scheduledAt ? 'scheduled' : 'draft',
      tags:                tags ?? [],
      audience:            { filter: {}, ...(audience ?? {}) },
      templateId:          templateId ?? null,
      templateName:        templateName ?? null,
      variableValues:      variableValues ?? [],
      headerVariableValue: headerVariableValue ?? null,
      scheduledAt:         scheduledAt ?? null,
      stats: { totalAudience: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
      createdBy:     req.user.id,
      createdByName: req.user.name ?? null,
      createdAt: now, updatedAt: now,
    };

    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, campaign: item });
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: campPK(req.user.companyId), SK: campSK(req.params.id) },
    }).promise();
    if (!r.Item) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, campaign: r.Item });
  } catch (err) { next(err); }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const {
      name, description, objective, tags,
      audience, templateId, templateName,
      variableValues, headerVariableValue, scheduledAt,
    } = req.body;

    const existing = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(req.params.id) },
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'scheduled'].includes(existing.Item.status)) {
      return res.status(400).json({ error: 'Only draft or scheduled campaigns can be edited' });
    }

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(req.params.id) },
      UpdateExpression: 'SET #n = :n, description = :d, objective = :obj, tags = :t, audience = :a, templateId = :tid, templateName = :tn, variableValues = :vv, headerVariableValue = :hv, scheduledAt = :sa, updatedAt = :ua',
      ExpressionAttributeNames: { '#n': 'name' },
      ExpressionAttributeValues: {
        ':n':   name?.trim() ?? existing.Item.name,
        ':d':   description?.trim() ?? null,
        ':obj': objective ?? existing.Item.objective,
        ':t':   tags ?? existing.Item.tags,
        ':a':   audience ?? existing.Item.audience,
        ':tid': templateId ?? null,
        ':tn':  templateName ?? null,
        ':vv':  variableValues ?? [],
        ':hv':  headerVariableValue ?? null,
        ':sa':  scheduledAt ?? null,
        ':ua':  new Date().toISOString(),
      },
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /:id — only draft / cancelled / failed ─────────────────────────
router.delete('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const existing = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(req.params.id) },
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'cancelled', 'failed'].includes(existing.Item.status)) {
      return res.status(400).json({ error: 'Only draft, cancelled, or failed campaigns can be deleted' });
    }
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(req.params.id) },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Shared launch logic ─────────────────────────────────────────────────────
// Used by POST /:id/launch (actor = req.user) AND CampaignScheduler's due-campaign
// sweep (actor = a synthetic identity built from the campaign's creator). Validation
// failures throw CampaignLaunchError before anything is written; only errors raised
// after the campaign is marked 'active' trigger the best-effort revert-to-failed.
class CampaignLaunchError extends Error {
  constructor(status, body) {
    super(body.error ?? body.message ?? 'Campaign launch failed');
    this.status = status;
    this.body = body;
  }
}

async function _launchCampaign(companyId, campaignId, { reviewCount = null, actor } = {}) {
  const r = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: campPK(companyId), SK: campSK(campaignId) },
  }).promise();
  const campaign = r.Item;
  if (!campaign) throw new CampaignLaunchError(404, { error: 'Campaign not found' });
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    throw new CampaignLaunchError(400, { error: 'Only draft or scheduled campaigns can be launched' });
  }
  if (campaign.type !== 'whatsapp_broadcast') {
    throw new CampaignLaunchError(400, { error: 'CTWA campaigns are configured via Meta Ads Manager' });
  }
  if (!campaign.templateId) throw new CampaignLaunchError(400, { error: 'No template selected' });

  // Verify template is APPROVED
  const tmplRes = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#TMPL#${companyId}`, SK: `TMPL#${campaign.templateId}` },
  }).promise();
  const tmpl = tmplRes.Item;
  if (!tmpl)                      throw new CampaignLaunchError(404, { error: 'Template not found' });
  if (tmpl.status !== 'APPROVED') throw new CampaignLaunchError(400, { error: 'Only APPROVED templates can be used' });

  // Build audience once — this is the single authoritative audience for this launch.
  // The same object is used for the integrity check AND the send loop (no double-rebuild).
  const { leads, count: finalCount, stats: audienceStats } =
    await _buildAudience(companyId, campaign.audience?.filter ?? {});

  // Enterprise integrity check: abort if the audience changed since the user
  // confirmed it on the Review step.
  if (reviewCount !== null && finalCount !== reviewCount) {
    logger.warn(`campaign ${campaign.id} launch aborted: reviewCount=${reviewCount} finalCount=${finalCount}`);
    throw new CampaignLaunchError(409, {
      error:        'AUDIENCE_CHANGED',
      message:      'The audience changed between your review and launch. Refresh the Review step and try again.',
      reviewCount,
      currentCount: finalCount,
      delta:        finalCount - reviewCount,
      stats:        audienceStats,
    });
  }

  if (finalCount === 0)  throw new CampaignLaunchError(400, { error: 'No contacts match the audience filters' });
  if (finalCount > 1000) throw new CampaignLaunchError(400, { error: 'Audience exceeds 1,000 contact limit. Refine your filters.' });

  // ── Atomic claim: Scheduled/Draft -> Launching -> Running ───────────────────
  // Two conditional transitions guard against two concurrent invocations (overlapping
  // EventBridge triggers, or a scheduler racing a manual "Launch Now" click) ever
  // both sending the same campaign. All validation above is read-only and re-checked
  // implicitly by this condition, so a losing invocation never mutates anything.
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(campaignId) },
      UpdateExpression: 'SET #st = :launching, launchClaimedAt = :now',
      ConditionExpression: '#st IN (:draft, :scheduled)',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':launching': 'launching', ':draft': 'draft', ':scheduled': 'scheduled',
        ':now': new Date().toISOString(),
      },
    }).promise();
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException') {
      // Another process already claimed this campaign between our read and our
      // write — exit gracefully, nothing was mutated by this invocation.
      throw new CampaignLaunchError(409, {
        error:   'ALREADY_LAUNCHING',
        message: 'Campaign is already being launched by another process.',
      });
    }
    throw e;
  }

  try {
    const now = new Date().toISOString();

    // Launching -> Running. Only the invocation that won the claim above reaches
    // this line, so no ConditionExpression race is possible here.
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(campaign.id) },
      UpdateExpression: 'SET #st = :active, launchedAt = :now, updatedAt = :now',
      ConditionExpression: '#st = :launching',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':launching': 'launching', ':now': now },
    }).promise();

    // Detect TEXT header variable
    const hdrComp = (tmpl.components ?? []).find((c) => c.type === 'HEADER' && c.format === 'TEXT');
    const hasHdrVar = hdrComp && /\{\{1\}\}/.test(hdrComp.text ?? '');

    let sent = 0; let failed = 0;
    const errors = [];

    // Send via WASendSvc (ADR-012: all outbound WA messages through WhatsAppSendService)
    await Promise.allSettled(leads.map(async (lead) => {
      try {
        if (!lead.phone) { failed++; return; }
        const params = resolveTemplateParams(campaign.variableValues, { name: lead.name, phone: lead.phone, source: lead.source });
        const resolvedHeader = !hasHdrVar ? null
          : campaign.headerVariableValue === '{{name}}'  ? (lead.name  ?? '')
          : campaign.headerVariableValue === '{{phone}}' ? (lead.phone ?? '')
          : (campaign.headerVariableValue ?? hdrComp?.example?.header_text?.[0] ?? '');

        await WASendSvc.sendTemplate(
          companyId,
          { resolvedContact: { pk: lead.PK, phone: lead.phone, leadItem: lead, isLead: true } },
          { templateName: tmpl.templateName, language: tmpl.language ?? 'en' },
          params,
          actor,
          {
            headerVariableValue: hasHdrVar ? resolvedHeader : null,
            content:     `[Campaign: ${campaign.name}]`,
            extraFields: { campaignId: campaign.id, templateId: campaign.templateId },
            wamidExtras: { campaignId: campaign.id },
          },
        );
        sent++;
      } catch (e) {
        failed++;
        errors.push({ phone: lead.phone, error: e?.response?.data?.error?.message ?? e.message });
        logger.warn(`campaign ${campaign.id} send failed for ${lead.phone}: ${e.message}`);
      }
    }));

    // Persist final stats — includes audience integrity fields for audit trail
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(campaign.id) },
      UpdateExpression: 'SET #st = :done, stats = :stats, completedAt = :now2, updatedAt = :now2',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':done':  sent === 0 ? 'failed' : 'completed',
        ':stats': {
          totalAudience:        finalCount,
          sent,
          failed,
          delivered:            0,
          read:                 0,
          replied:              0,
          duplicatesRemoved:    audienceStats.duplicatesRemoved,
          invalidPhonesSkipped: audienceStats.invalidPhoneCount,
          reviewCount:          reviewCount ?? finalCount,
          actualSentCount:      sent,
          validationTimestamp:  now,
        },
        ':now2': new Date().toISOString(),
      },
    }).promise();

    return { sent, failed, total: finalCount, errors: errors.slice(0, 20) };
  } catch (err) {
    // Best-effort revert to failed on unexpected error (covers the Launching -> Running
    // transition and anything during/after the send loop — the campaign must never be
    // left stuck in a non-terminal state once claimed).
    try {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: campPK(companyId), SK: campSK(campaignId) },
        UpdateExpression: 'SET #st = :failed, updatedAt = :now',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':failed': 'failed', ':now': new Date().toISOString() },
      }).promise();
    } catch (revertErr) {
      logger.error(`campaign ${campaignId} status revert failed: ${revertErr.message}`);
    }
    throw err;
  }
}

// ── POST /:id/launch — execute campaign ───────────────────────────────────
router.post('/:id/launch', authMiddleware, checkRole(['admin', 'manager']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const reviewCount = typeof req.body?.reviewCount === 'number' ? req.body.reviewCount : null;
    const result = await _launchCampaign(req.user.companyId, req.params.id, { reviewCount, actor: req.user });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof CampaignLaunchError) return res.status(err.status).json(err.body);
    next(err);
  }
});

// Exposed for CampaignScheduler's due-campaign sweep (invoked in-process, not over HTTP).
router.launchCampaign = _launchCampaign;
router.CampaignLaunchError = CampaignLaunchError;

module.exports = router;
