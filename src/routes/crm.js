const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { logAudit } = require('../utils/audit');
const logger = require('../config/logger');
const { getAutoAssignConfig, pickNextEmployee } = require('../utils/autoAssign');

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

// Resolves an array of tag values (raw labels or IDs) to catalog IDs.
// IDs already start with 't_' and pass through unchanged.
// Unknown labels are auto-created in the catalog.
async function resolveTagIds(companyId, rawTags) {
  if (!rawTags || rawTags.length === 0) return [];
  const needsResolve = rawTags.filter((t) => !String(t).startsWith('t_'));
  if (needsResolve.length === 0) return rawTags;
  const catResult = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG' },
  }).promise();
  const catalog = catResult.Item?.tags ?? [];
  let dirty = false;
  const resolved = rawTags.map((tag) => {
    const s = String(tag).trim();
    if (s.startsWith('t_')) return s;
    const found = catalog.find((t) => t.label.toLowerCase() === s.toLowerCase());
    if (found) return found.id;
    const newId = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    catalog.push({ id: newId, label: s, color: '#6366f1', createdAt: new Date().toISOString() });
    dirty = true;
    return newId;
  });
  if (dirty) {
    await dynamodb.put({
      TableName: TABLE,
      Item: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG', tags: catalog },
    }).promise();
  }
  return [...new Set(resolved)];
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
    const { stage, assignedTo, search, page: pageParam, pageSize: pageSizeParam } = req.query;
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
    const total = leads.length;

    // Paginated path — used by list view
    if (pageParam !== undefined) {
      const page = Math.max(1, Number(pageParam));
      const pageSize = Math.min(200, Math.max(10, Number(pageSizeParam ?? 50)));
      const pages = Math.ceil(total / pageSize) || 1;
      leads = leads.slice((page - 1) * pageSize, page * pageSize);
      return res.json({ success: true, leads, total, page, pages, pageSize });
    }

    // Unpaginated path — used by kanban (capped at 500 for safety)
    const MAX_KANBAN = 500;
    const truncated = total > MAX_KANBAN;
    res.json({ success: true, leads: truncated ? leads.slice(0, MAX_KANBAN) : leads, total, truncated });
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
    const cleanPhone = String(phone).replace(/\D/g, '');

    // Duplicate phone check
    const dupCheck = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND phone = :ph',
      ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA', ':ph': cleanPhone },
    }).promise();
    if ((dupCheck.Items?.length ?? 0) > 0) {
      const existing = dupCheck.Items[0];
      return res.status(409).json({ error: 'A lead with this phone number already exists', existingLeadId: existing.leadId, existingName: existing.name });
    }

    const stages = await getPipelineStages(companyId);
    const defaultStage = stage ?? stages[0]?.key ?? 'new_lead';

    const leadId = uuidv4();
    const now = new Date().toISOString();

    // Auto-assign: if no explicit assignee, pick least-loaded performer
    let resolvedAssignedTo   = assignedTo   ?? null;
    let resolvedAssignedName = assignedToName ?? null;
    let wasAutoAssigned      = false;
    if (!resolvedAssignedTo) {
      try {
        const cfg = await getAutoAssignConfig(companyId);
        if (cfg.enabled) {
          const picked = await pickNextEmployee(companyId, 'crm', cfg);
          if (picked) {
            resolvedAssignedTo   = picked.id;
            resolvedAssignedName = picked.name ?? null;
            wasAutoAssigned      = true;
          }
        }
      } catch (e) { logger.warn('auto-assign error: ' + e.message); }
      // Fallback: assign to creator if auto-assign off or no employees found
      if (!resolvedAssignedTo) {
        resolvedAssignedTo   = req.user.id;
        resolvedAssignedName = req.user.name ?? null;
      }
    }

    const item = {
      PK: leadPK(companyId, leadId),
      SK: 'METADATA',
      leadId,
      companyId,
      name: name.trim(),
      phone: cleanPhone,
      email: email?.trim() ?? null,
      productInterest: productInterest ?? [],
      source: source ?? 'manual',
      notes: notes?.trim() ?? '',
      stage: defaultStage,
      tags: await resolveTagIds(companyId, tags ?? []),
      closureDeadline: closureDeadline ?? null,
      assignedTo: resolvedAssignedTo,
      assignedToName: resolvedAssignedName,
      autoAssigned: wasAutoAssigned,
      createdBy: req.user.id,
      createdAt: now,
      updatedAt: now,
      convertedAt: null,
    };

    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    await logAudit(req.user.id, 'crm_lead_created', leadId, 'success', req.ip, { name });

    // Fire automations
    try {
      const { runAutomations } = require('./automations');
      await runAutomations(companyId, 'lead_created', {
        leadId, leadPK: item.PK, phone: cleanPhone, name: name.trim(),
        source: item.source, stage: defaultStage, tags: item.tags,
        assignedTo: item.assignedTo,
      });
    } catch (e) { logger.warn('lead_created automation error: ' + e.message); }

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
    const internalNotes = items.filter((i) => i.SK.startsWith('NOTE#')).sort((a, b) => a.SK.localeCompare(b.SK));
    res.json({ success: true, lead: meta, messages, internalNotes });
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
    if (updates.tags) updates.tags = await resolveTagIds(companyId, updates.tags);
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

    // Fire tag_added automation for each newly added tag
    if (Array.isArray(updates.tags)) {
      const addedTags = updates.tags.filter((t) => !(existing.Item.tags ?? []).includes(t));
      if (addedTags.length) {
        try {
          const { runAutomations } = require('./automations');
          for (const tag of addedTags) {
            await runAutomations(companyId, 'tag_added', {
              leadId: req.params.id, leadPK: PK,
              phone: existing.Item.phone, name: existing.Item.name,
              tags: updates.tags, stage: existing.Item.stage,
              assignedTo: existing.Item.assignedTo,
            });
          }
        } catch (e) { logger.warn('tag_added automation error: ' + e.message); }
      }
    }

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
      UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
      ExpressionAttributeValues: {
        ':at': assignedTo,
        ':atn': assignedToName ?? null,
        ':cs': 'open',
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

    // Write stage history record
    try {
      await dynamodb.put({
        TableName: TABLE,
        Item: {
          PK,
          SK: `STAGE#${now}`,
          fromStage: lead.stage,
          toStage: stage,
          changedBy: req.user.id,
          changedByName: req.user.name ?? null,
          changedAt: now,
        },
      }).promise();
    } catch (e) { logger.warn('Stage history write failed: ' + e.message); }

    // Fire automations
    try {
      const { runAutomations } = require('./automations');
      await runAutomations(companyId, 'stage_change', {
        leadId: req.params.id, leadPK: PK,
        phone: lead.phone, name: lead.name,
        fromStage: lead.stage, toStage: stage,
        stage, tags: lead.tags ?? [], assignedTo: lead.assignedTo,
      });
    } catch (e) { logger.warn('stage_change automation error: ' + e.message); }

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
    const includeOverdue = req.query.overdue === 'true';
    const startDate = includeOverdue ? '2000-01-01' : today;
    const empRoles = ['telecaller', 'agent', 'intern'];

    const items = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND #dt >= :start AND #dt <= :end AND (attribute_not_exists(done) OR done = :false)',
        ExpressionAttributeNames: { '#dt': 'date' },
        ExpressionAttributeValues: { ':prefix': `FOLLOWUP#${companyId}#`, ':start': startDate, ':end': endDate, ':false': false },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    let followups = empRoles.includes(req.user.role)
      ? items.filter((f) => f.assignedTo === req.user.id)
      : items;

    // Optional leadId filter — used by lead detail page to avoid fetching all company followups
    if (req.query.leadId) {
      followups = followups.filter((f) => f.leadId === req.query.leadId);
    }

    // Batch-enrich with lead names (for global dashboard)
    const needsName = followups.filter((f) => f.leadId && !f.leadName);
    if (needsName.length) {
      const keys = needsName.map((f) => ({ PK: `LEAD#${companyId}#${f.leadId}`, SK: 'METADATA' }));
      for (let i = 0; i < keys.length; i += 100) {
        const batch = keys.slice(i, i + 100);
        const br = await dynamodb.batchGet({ RequestItems: { [TABLE]: { Keys: batch, ProjectionExpression: 'leadId, #n, phone', ExpressionAttributeNames: { '#n': 'name' } } } }).promise();
        const leads = br.Responses?.[TABLE] ?? [];
        leads.forEach((lead) => {
          const fu = followups.find((f) => f.leadId === lead.leadId);
          if (fu) { fu.leadName = lead.name; fu.leadPhone = lead.phone; }
        });
      }
    }

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
    // Fetch lead name to store with the followup for denormalized display
    const leadMeta = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: `LEAD#${companyId}#${req.params.id}`, SK: 'METADATA' },
    }).promise();

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: `FOLLOWUP#${companyId}#${date}`,
        SK: `LEAD#${req.params.id}`,
        leadId: req.params.id,
        leadName: leadMeta.Item?.name ?? null,
        leadPhone: leadMeta.Item?.phone ?? null,
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

// ── POST /api/crm/import ──────────────────────────────────────────────────────
router.post('/import', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { leads, options = {} } = req.body;
    const {
      duplicateAction = 'skip',   // 'skip' | 'overwrite'
      defaultStage,
      defaultAssignedTo,
      defaultAssignedToName,
      importTag,
    } = options;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array is required' });
    }
    if (leads.length > 2000) {
      return res.status(400).json({ error: 'Maximum 2000 leads per import batch' });
    }

    const companyId = req.user.companyId;
    const stages = await getPipelineStages(companyId);
    const stageKeys = new Set(stages.map((s) => s.key));
    const finalStage = defaultStage && stageKeys.has(defaultStage) ? defaultStage : stages[0]?.key ?? 'new_lead';

    // Build phone→existing-lead map for duplicate detection
    const existingLeads = await scanAllLeads(companyId);
    const phoneMap = new Map(existingLeads.map((l) => [l.phone, l]));

    // Resolve all text tag labels → catalog IDs before processing leads.
    // CSV tags and importTag arrive as plain strings (e.g. "vip"), but
    // contacts store and filter by catalog IDs (e.g. "t_abc123"). Without
    // this step, tag-based filtering on the contacts page finds nothing.
    const allTagValues = new Set();
    if (importTag?.trim()) allTagValues.add(importTag.trim());
    for (const lead of leads) {
      if (Array.isArray(lead.tags)) {
        for (const t of lead.tags) { if (t?.trim()) allTagValues.add(t.trim()); }
      }
    }

    let tagIdMap = {};
    if (allTagValues.size > 0) {
      const catResult = await dynamodb.get({
        TableName: TABLE,
        Key: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG' },
      }).promise();
      const catalog = catResult.Item?.tags ?? [];
      let catalogDirty = false;

      for (const val of allTagValues) {
        const byId = catalog.find((t) => t.id === val);
        if (byId) { tagIdMap[val] = byId.id; continue; }
        const byLabel = catalog.find((t) => t.label.toLowerCase() === val.toLowerCase());
        if (byLabel) { tagIdMap[val] = byLabel.id; continue; }
        const newId = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        catalog.push({ id: newId, label: val, color: '#6366f1', createdAt: new Date().toISOString() });
        tagIdMap[val] = newId;
        catalogDirty = true;
      }

      if (catalogDirty) {
        await dynamodb.put({
          TableName: TABLE,
          Item: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG', tags: catalog },
        }).promise();
      }
    }

    const importTagId = importTag?.trim() ? tagIdMap[importTag.trim()] ?? null : null;

    const results = { imported: 0, overwritten: 0, skipped: 0, errors: [] };
    const now = new Date().toISOString();

    await Promise.allSettled(
      leads.map(async (lead, idx) => {
        try {
          const name = String(lead.name ?? '').trim();
          const phone = String(lead.phone ?? '').replace(/\D/g, '');

          if (!name || phone.length < 7) {
            results.errors.push({ row: idx + 2, phone: phone || '—', reason: !name ? 'Name is required' : 'Invalid phone number' });
            return;
          }

          const existing = phoneMap.get(phone);
          if (existing && duplicateAction === 'skip') {
            results.skipped++;
            return;
          }

          const rawTags = Array.isArray(lead.tags) ? lead.tags : [];
          const tags = [...new Set([
            ...rawTags.map((t) => tagIdMap[t?.trim()] ?? t).filter(Boolean),
            ...(importTagId ? [importTagId] : []),
          ])];

          const leadId = existing?.leadId ?? uuidv4();
          await dynamodb.put({
            TableName: TABLE,
            Item: {
              PK: leadPK(companyId, leadId),
              SK: 'METADATA',
              leadId,
              companyId,
              name,
              phone,
              email: String(lead.email ?? '').trim() || null,
              productInterest: Array.isArray(lead.productInterest) ? lead.productInterest : [],
              source: lead.source ?? 'import',
              notes: String(lead.notes ?? '').trim(),
              stage: finalStage,
              tags,
              closureDeadline: lead.closureDeadline ?? null,
              assignedTo: defaultAssignedTo ?? req.user.id,
              assignedToName: defaultAssignedToName ?? req.user.name ?? null,
              createdBy: req.user.id,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
              convertedAt: null,
              importedAt: now,
            },
          }).promise();

          if (existing) results.overwritten++;
          else results.imported++;
        } catch (e) {
          results.errors.push({ row: idx + 2, phone: String(leads[idx]?.phone ?? ''), reason: e.message });
        }
      })
    );

    await logAudit(req.user.id, 'crm_bulk_import', 'batch', 'success', req.ip, {
      imported: results.imported, overwritten: results.overwritten, skipped: results.skipped, errors: results.errors.length,
    });
    res.json({ success: true, ...results });
  } catch (err) {
    logger.error('crm/import error', err);
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

// ── GET /api/crm/crm-analytics ────────────────────────────────────────────────
router.get('/crm-analytics', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const [leads, stages] = await Promise.all([
      scanAllLeads(companyId),
      getPipelineStages(companyId),
    ]);

    // Stage distribution
    const byStage = Object.fromEntries(stages.map((s) => [s.key, 0]));
    for (const lead of leads) { if (byStage[lead.stage] !== undefined) byStage[lead.stage]++; }

    // Funnel with conversion rates between adjacent stages
    const funnel = stages.map((s, i) => {
      const count = byStage[s.key] ?? 0;
      const prevCount = i > 0 ? (byStage[stages[i - 1]?.key] ?? 0) : null;
      const conversionRate = prevCount ? Math.round((count / prevCount) * 100) : null;
      return { key: s.key, label: s.label, color: s.color, count, conversionRate };
    });

    // Stage history for avg time calc
    let stageHistoryItems = [];
    try {
      let lastKey;
      do {
        const r = await dynamodb.scan({
          TableName: TABLE,
          FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':sk': 'STAGE#' },
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        }).promise();
        stageHistoryItems.push(...(r.Items ?? []));
        lastKey = r.LastEvaluatedKey;
      } while (lastKey);
    } catch (e) { logger.warn('Stage history scan failed: ' + e.message); }

    // Calculate avg days per stage from history
    const stageTimeMap = {};
    for (const item of stageHistoryItems) {
      if (!stageTimeMap[item.fromStage]) stageTimeMap[item.fromStage] = [];
    }
    // Group by lead PK, sort by time, calc duration between consecutive stage entries
    const byLead = {};
    for (const item of stageHistoryItems) {
      if (!byLead[item.PK]) byLead[item.PK] = [];
      byLead[item.PK].push(item);
    }
    const stageDurations = {};
    for (const items of Object.values(byLead)) {
      const sorted = items.sort((a, b) => a.changedAt?.localeCompare(b.changedAt));
      for (let i = 1; i < sorted.length; i++) {
        const days = (new Date(sorted[i].changedAt) - new Date(sorted[i - 1].changedAt)) / 86400000;
        if (!stageDurations[sorted[i - 1].fromStage]) stageDurations[sorted[i - 1].fromStage] = [];
        stageDurations[sorted[i - 1].fromStage].push(days);
      }
    }
    const avgDaysPerStage = Object.fromEntries(
      Object.entries(stageDurations).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10])
    );

    // Source breakdown
    const bySource = {};
    for (const lead of leads) {
      const src = lead.source ?? 'unknown';
      bySource[src] = (bySource[src] ?? 0) + 1;
    }

    // Leads created per day (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dailyCreated = {};
    for (const lead of leads) {
      const day = lead.createdAt?.slice(0, 10);
      if (day && day >= thirtyDaysAgo) dailyCreated[day] = (dailyCreated[day] ?? 0) + 1;
    }
    const trend = Object.entries(dailyCreated).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

    // Today and this week stats
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const newToday = leads.filter((l) => l.createdAt?.startsWith(today)).length;
    const newThisWeek = leads.filter((l) => l.createdAt?.slice(0, 10) >= weekAgo).length;
    const convertedThisMonth = leads.filter((l) => l.convertedAt?.startsWith(new Date().toISOString().slice(0, 7))).length;

    res.json({
      success: true,
      summary: { total: leads.length, newToday, newThisWeek, convertedThisMonth },
      funnel,
      bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      avgDaysPerStage,
      trend,
    });
  } catch (err) {
    logger.error('crm-analytics error', err);
    next(err);
  }
});

module.exports = router;
