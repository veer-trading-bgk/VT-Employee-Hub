const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { logAudit } = require('../utils/audit');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

const DEFAULT_STAGES = [
  { key: 'new_lead',   label: 'New Lead',     color: '#64748b', order: 0 },
  { key: 'contacted',  label: 'Contacted',    color: '#3b82f6', order: 1 },
  { key: 'interested', label: 'Interested',   color: '#8b5cf6', order: 2 },
  { key: 'kyc_done',   label: 'KYC Done',     color: '#f59e0b', order: 3 },
  { key: 'demat_done', label: 'Demat Done',   color: '#f97316', order: 4 },
  { key: 'converted',  label: 'Converted',    color: '#10b981', order: 5 },
  { key: 'churned',    label: 'Closed Lost',  color: '#ef4444', order: 6 },
];

// Stages that auto-credit a payroll metric
const METRIC_STAGE_MAP = { kyc_done: 'kyc', demat_done: 'demat' };

function leadPK(companyId, leadId) {
  return `LEAD#${companyId}#${leadId}`;
}

async function getPipelineStages(companyId) {
  try {
    const result = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `CONFIG#CRM#${companyId}`, SK: 'PIPELINE' },
    }).promise();
    return result.Item?.stages ?? DEFAULT_STAGES;
  } catch {
    return DEFAULT_STAGES;
  }
}

async function scanAllLeads(companyId) {
  const params = {
    TableName: TABLE,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
    ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
  };
  const items = [];
  let lastKey;
  do {
    const result = await dynamodb.scan({ ...params, ...(lastKey && { ExclusiveStartKey: lastKey }) }).promise();
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── GET /api/crm/pipeline ──────────────────────────────────────────────────────
router.get('/pipeline', authMiddleware, async (req, res, next) => {
  try {
    const stages = await getPipelineStages(req.user.companyId);
    res.json({ success: true, stages });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/crm/pipeline ──────────────────────────────────────────────────────
router.put('/pipeline', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { stages } = req.body;
    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: 'stages must be a non-empty array' });
    }
    for (const s of stages) {
      if (!s.key || !s.label) return res.status(400).json({ error: 'each stage needs key and label' });
    }

    // Block deleting a stage that still has leads
    const leads = await scanAllLeads(req.user.companyId);
    const newKeys = new Set(stages.map((s) => s.key));
    const existingStages = await getPipelineStages(req.user.companyId);
    for (const s of existingStages) {
      if (!newKeys.has(s.key)) {
        const hasLeads = leads.some((l) => l.stage === s.key);
        if (hasLeads) {
          return res.status(409).json({ error: `Cannot delete stage "${s.label}" — it has active leads. Move them first.` });
        }
      }
    }

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `CONFIG#CRM#${req.user.companyId}`,
        SK: 'PIPELINE',
        stages: stages.map((s, i) => ({ key: s.key, label: s.label, color: s.color ?? '#64748b', order: i })),
        updatedAt: new Date().toISOString(),
      },
    }).promise();

    res.json({ success: true, stages });
  } catch (err) {
    logger.error('crm/pipeline PUT error', err);
    next(err);
  }
});

// ── GET /api/crm/leads ─────────────────────────────────────────────────────────
router.get('/leads', authMiddleware, async (req, res, next) => {
  try {
    const { stage, assignedTo, search } = req.query;
    const companyId = req.user.companyId;
    const empRoles = ['telecaller', 'agent', 'intern'];

    let leads = await scanAllLeads(companyId);

    if (empRoles.includes(req.user.role)) {
      leads = leads.filter((l) => l.assignedTo === req.user.id);
    } else if (assignedTo) {
      leads = leads.filter((l) => l.assignedTo === assignedTo);
    }

    if (stage) leads = leads.filter((l) => l.stage === stage);

    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(
        (l) => l.name?.toLowerCase().includes(q) || l.phone?.includes(q) || l.email?.toLowerCase().includes(q)
      );
    }

    leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ success: true, leads });
  } catch (err) {
    logger.error('crm/leads GET error', err);
    next(err);
  }
});

// ── POST /api/crm/leads ────────────────────────────────────────────────────────
router.post('/leads', authMiddleware, async (req, res, next) => {
  try {
    const { name, phone, email, productInterest, source, notes, assignedTo, assignedToName, closureDeadline, tags, stage } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'name and phone are required' });
    }

    const companyId = req.user.companyId;
    const stages = await getPipelineStages(companyId);
    const defaultStage = stage ?? stages[0]?.key ?? 'new_lead';

    const leadId = uuidv4();
    const now = new Date().toISOString();

    const item = {
      PK: leadPK(companyId, leadId),
      SK: 'METADATA',
      leadId,
      companyId,
      name: name.trim(),
      phone: String(phone).replace(/\D/g, ''),
      email: email?.trim() ?? null,
      productInterest: productInterest ?? [],
      source: source ?? 'manual',
      notes: notes?.trim() ?? '',
      stage: defaultStage,
      tags: tags ?? [],
      closureDeadline: closureDeadline ?? null,
      assignedTo: assignedTo ?? req.user.id,
      assignedToName: assignedToName ?? req.user.name ?? null,
      createdBy: req.user.id,
      createdAt: now,
      updatedAt: now,
      convertedAt: null,
    };

    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    await logAudit(req.user.id, 'crm_lead_created', leadId, 'success', req.ip, { name });
    res.status(201).json({ success: true, lead: item });
  } catch (err) {
    logger.error('crm/leads POST error', err);
    next(err);
  }
});

// ── GET /api/crm/leads/:id ─────────────────────────────────────────────────────
router.get('/leads/:id', authMiddleware, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const PK = leadPK(companyId, req.params.id);

    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': PK },
    }).promise();

    const items = result.Items ?? [];
    const meta = items.find((i) => i.SK === 'METADATA');
    if (!meta) return res.status(404).json({ error: 'Lead not found' });

    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && meta.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const messages = items.filter((i) => i.SK.startsWith('MSG#')).sort((a, b) => a.SK.localeCompare(b.SK));
    res.json({ success: true, lead: meta, messages });
  } catch (err) {
    logger.error('crm/leads/:id GET error', err);
    next(err);
  }
});

// ── PUT /api/crm/leads/:id ─────────────────────────────────────────────────────
router.put('/leads/:id', authMiddleware, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const PK = leadPK(companyId, req.params.id);

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Lead not found' });

    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && existing.Item.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowed = ['name', 'phone', 'email', 'productInterest', 'source', 'notes', 'closureDeadline', 'tags'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.phone) updates.phone = String(updates.phone).replace(/\D/g, '');
    updates.updatedAt = new Date().toISOString();

    const setExpr = Object.keys(updates).map((k) => `#${k} = :${k}`).join(', ');
    const names = Object.fromEntries(Object.keys(updates).map((k) => [`#${k}`, k]));
    const values = Object.fromEntries(Object.entries(updates).map(([k, v]) => [`:${k}`, v]));

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: `SET ${setExpr}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }).promise();

    res.json({ success: true, updated: updates });
  } catch (err) {
    logger.error('crm/leads/:id PUT error', err);
    next(err);
  }
});

// ── PUT /api/crm/leads/:id/assign ─────────────────────────────────────────────
router.put('/leads/:id/assign', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { assignedTo, assignedToName } = req.body;
    if (!assignedTo) return res.status(400).json({ error: 'assignedTo required' });

    const companyId = req.user.companyId;
    const PK = leadPK(companyId, req.params.id);

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Lead not found' });

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':at': assignedTo,
        ':atn': assignedToName ?? null,
        ':ua': new Date().toISOString(),
      },
    }).promise();

    await logAudit(req.user.id, 'crm_lead_assigned', req.params.id, 'success', req.ip, { assignedTo });
    res.json({ success: true, assignedTo, assignedToName });
  } catch (err) {
    logger.error('crm/leads/:id/assign error', err);
    next(err);
  }
});

// ── PUT /api/crm/leads/:id/stage ───────────────────────────────────────────────
router.put('/leads/:id/stage', authMiddleware, async (req, res, next) => {
  try {
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ error: 'stage required' });

    const companyId = req.user.companyId;
    const stages = await getPipelineStages(companyId);
    if (!stages.find((s) => s.key === stage)) {
      return res.status(400).json({ error: 'Invalid stage key' });
    }

    const PK = leadPK(companyId, req.params.id);
    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Lead not found' });

    const lead = existing.Item;
    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && lead.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date().toISOString();
    const updateAttrs = { '#stage': 'stage', '#ua': 'updatedAt' };
    const updateVals = { ':stage': stage, ':ua': now };
    let updateExpr = 'SET #stage = :stage, #ua = :ua';

    if (stage === 'converted') {
      updateExpr += ', #ca = :ca';
      updateAttrs['#ca'] = 'convertedAt';
      updateVals[':ca'] = now;
    }

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: updateAttrs,
      ExpressionAttributeValues: updateVals,
    }).promise();

    // Auto-credit metric
    const metricType = METRIC_STAGE_MAP[stage];
    if (metricType && lead.assignedTo && lead.stage !== stage) {
      try {
        const date = now.split('T')[0];
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: `METRICS#${companyId}`, SK: `${lead.assignedTo}#${date}#${metricType}` },
          UpdateExpression: 'SET #uid = if_not_exists(#uid, :uid), #mt = if_not_exists(#mt, :mt), #d = if_not_exists(#d, :d), #ci = if_not_exists(#ci, :ci), #val = if_not_exists(#val, :zero) + :inc, #src = :src, #ua = :ua',
          ExpressionAttributeNames: { '#uid': 'userId', '#mt': 'metric_type', '#d': 'date', '#ci': 'companyId', '#val': 'value', '#src': 'source', '#ua': 'updatedAt' },
          ExpressionAttributeValues: { ':uid': lead.assignedTo, ':mt': metricType, ':d': date, ':ci': companyId, ':zero': 0, ':inc': 1, ':src': 'crm_auto', ':ua': now },
        }).promise();
      } catch (e) {
        logger.warn(`Auto-metric credit failed for lead ${req.params.id}: ${e.message}`);
      }
    }

    await logAudit(req.user.id, 'crm_stage_change', req.params.id, 'success', req.ip, { from: lead.stage, to: stage });
    res.json({ success: true, stage, autoMetric: metricType ?? null });
  } catch (err) {
    logger.error('crm/leads/:id/stage error', err);
    next(err);
  }
});

// ── DELETE /api/crm/leads/:id ──────────────────────────────────────────────────
router.delete('/leads/:id', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const PK = leadPK(req.user.companyId, req.params.id);
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': PK },
      ProjectionExpression: 'PK, SK',
    }).promise();

    const items = result.Items ?? [];
    if (items.length === 0) return res.status(404).json({ error: 'Lead not found' });

    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await dynamodb.batchWrite({
        RequestItems: { [TABLE]: chunk.map((item) => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } })) },
      }).promise();
    }

    await logAudit(req.user.id, 'crm_lead_deleted', req.params.id, 'success', req.ip, {});
    res.json({ success: true });
  } catch (err) {
    logger.error('crm/leads/:id DELETE error', err);
    next(err);
  }
});

// ── GET /api/crm/followups ─────────────────────────────────────────────────────
router.get('/followups', authMiddleware, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const today = new Date().toISOString().slice(0, 10);
    const daysAhead = Number(req.query.days ?? 7);
    const endDate = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
    const empRoles = ['telecaller', 'agent', 'intern'];

    const items = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND #dt >= :start AND #dt <= :end AND (attribute_not_exists(done) OR done = :false)',
        ExpressionAttributeNames: { '#dt': 'date' },
        ExpressionAttributeValues: { ':prefix': `FOLLOWUP#${companyId}#`, ':start': today, ':end': endDate, ':false': false },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const followups = empRoles.includes(req.user.role)
      ? items.filter((f) => f.assignedTo === req.user.id)
      : items;

    res.json({ success: true, followups: followups.sort((a, b) => a.date.localeCompare(b.date)) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/crm/leads/:id/followup ──────────────────────────────────────────
router.post('/leads/:id/followup', authMiddleware, async (req, res, next) => {
  try {
    const { date, note } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const companyId = req.user.companyId;
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `FOLLOWUP#${companyId}#${date}`,
        SK: `LEAD#${req.params.id}`,
        leadId: req.params.id,
        companyId,
        date,
        note: note?.trim() ?? '',
        assignedTo: req.user.id,
        done: false,
        createdAt: new Date().toISOString(),
      },
    }).promise();

    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/crm/followups/:date/:leadId/done ──────────────────────────────────
router.put('/followups/:date/:leadId/done', authMiddleware, async (req, res, next) => {
  try {
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `FOLLOWUP#${req.user.companyId}#${req.params.date}`, SK: `LEAD#${req.params.leadId}` },
      UpdateExpression: 'SET done = :t, doneAt = :da, doneBy = :db',
      ExpressionAttributeValues: { ':t': true, ':da': new Date().toISOString(), ':db': req.user.id },
    }).promise();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/crm/stats ─────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const [leads, stages] = await Promise.all([
      scanAllLeads(req.user.companyId),
      getPipelineStages(req.user.companyId),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const byStage = Object.fromEntries(stages.map((s) => [s.key, 0]));
    let convertedToday = 0;

    for (const lead of leads) {
      if (byStage[lead.stage] !== undefined) byStage[lead.stage]++;
      if (lead.convertedAt?.startsWith(today)) convertedToday++;
    }

    res.json({ success: true, total: leads.length, byStage, convertedToday, stages });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
