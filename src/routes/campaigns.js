'use strict';
const express = require('express');
const { randomUUID } = require('crypto');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const WASendSvc = require('../services/WhatsAppSendService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

const campPK = (cid) => `CONFIG#CAMP#${cid}`;
const campSK = (id)  => `CAMP#${id}`;

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
      if (c.status === 'active')    active++;
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

// ── POST /audience/preview — count matching leads (before /:id) ───────────
router.post('/audience/preview', authMiddleware, checkRole(['admin', 'manager']), rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const { filter = {} } = req.body;
    const { companyId } = req.user;

    let items = [];
    let lastKey;
    do {
      const r = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pfx) AND SK = :meta',
        ExpressionAttributeValues: { ':pfx': `LEAD#${companyId}#`, ':meta': 'METADATA' },
        ProjectionExpression: 'PK, stage, tags, assignedTo, #src',
        ExpressionAttributeNames: { '#src': 'source' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(r.Items ?? []));
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);

    if (filter.stages?.length)  items = items.filter((l) => filter.stages.includes(l.stage));
    if (filter.tags?.length)    items = items.filter((l) => filter.tags.some((t) => (l.tags ?? []).includes(t)));
    if (filter.assignedTo)      items = items.filter((l) => l.assignedTo === filter.assignedTo);
    if (filter.source)          items = items.filter((l) => l.source === filter.source);

    res.json({ success: true, count: items.length, exceedsLimit: items.length > 1000 });
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
      status:              'draft',
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

// ── POST /:id/launch — execute campaign ───────────────────────────────────
router.post('/:id/launch', authMiddleware, checkRole(['admin', 'manager']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const { companyId } = req.user;

    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(req.params.id) },
    }).promise();
    const campaign = r.Item;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Only draft or scheduled campaigns can be launched' });
    }
    if (campaign.type !== 'whatsapp_broadcast') {
      return res.status(400).json({ error: 'CTWA campaigns are configured via Meta Ads Manager' });
    }
    if (!campaign.templateId) return res.status(400).json({ error: 'No template selected' });

    // Verify template is APPROVED
    const tmplRes = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#TMPL#${companyId}`, SK: `TMPL#${campaign.templateId}` },
    }).promise();
    const tmpl = tmplRes.Item;
    if (!tmpl)                      return res.status(404).json({ error: 'Template not found' });
    if (tmpl.status !== 'APPROVED') return res.status(400).json({ error: 'Only APPROVED templates can be used' });

    // Load audience — same scan+filter pattern as /broadcast (ADR-013 transition item)
    let leads = [];
    let lastKey;
    do {
      const sr = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :pfx) AND SK = :meta',
        ExpressionAttributeValues: { ':pfx': `LEAD#${companyId}#`, ':meta': 'METADATA' },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      leads.push(...(sr.Items ?? []));
      lastKey = sr.LastEvaluatedKey;
    } while (lastKey);

    const f = campaign.audience?.filter ?? {};
    if (f.stages?.length)  leads = leads.filter((l) => f.stages.includes(l.stage));
    if (f.tags?.length)    leads = leads.filter((l) => f.tags.some((t) => (l.tags ?? []).includes(t)));
    if (f.assignedTo)      leads = leads.filter((l) => l.assignedTo === f.assignedTo);
    if (f.source)          leads = leads.filter((l) => l.source === f.source);

    if (leads.length === 0)   return res.status(400).json({ error: 'No contacts match the audience filters' });
    if (leads.length > 1000)  return res.status(400).json({ error: 'Audience exceeds 1,000 contact limit. Refine your filters.' });

    const now = new Date().toISOString();

    // Mark active before sending
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(campaign.id) },
      UpdateExpression: 'SET #st = :active, launchedAt = :now, updatedAt = :now',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':now': now },
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
        const params = (campaign.variableValues ?? []).map((v) => {
          if (v === '{{name}}')  return lead.name  ?? '';
          if (v === '{{phone}}') return lead.phone ?? '';
          return String(v);
        });
        const resolvedHeader = !hasHdrVar ? null
          : campaign.headerVariableValue === '{{name}}'  ? (lead.name  ?? '')
          : campaign.headerVariableValue === '{{phone}}' ? (lead.phone ?? '')
          : (campaign.headerVariableValue ?? hdrComp?.example?.header_text?.[0] ?? '');

        await WASendSvc.sendTemplate(
          companyId,
          { resolvedContact: { pk: lead.PK, phone: lead.phone, leadItem: lead, isLead: true } },
          { templateName: tmpl.templateName, language: tmpl.language ?? 'en' },
          params,
          req.user,
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

    // Persist final stats
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: campPK(companyId), SK: campSK(campaign.id) },
      UpdateExpression: 'SET #st = :done, stats = :stats, completedAt = :now2, updatedAt = :now2',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':done':  sent === 0 ? 'failed' : 'completed',
        ':stats': { totalAudience: leads.length, sent, failed, delivered: 0, read: 0, replied: 0 },
        ':now2':  new Date().toISOString(),
      },
    }).promise();

    res.json({ success: true, sent, failed, total: leads.length, errors: errors.slice(0, 20) });
  } catch (err) {
    // Best-effort revert to failed on unexpected error
    try {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: campPK(req.user.companyId), SK: campSK(req.params.id) },
        UpdateExpression: 'SET #st = :failed, updatedAt = :now',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':failed': 'failed', ':now': new Date().toISOString() },
      }).promise();
    } catch (revertErr) {
      logger.error(`campaign ${req.params.id} status revert failed: ${revertErr.message}`);
    }
    next(err);
  }
});

module.exports = router;
