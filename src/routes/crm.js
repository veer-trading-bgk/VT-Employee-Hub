const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { logAudit } = require('../utils/audit');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const TABLE_EMP = process.env.DYNAMODB_TABLE || process.env.DYNAMODB_TABLE_METRICS;

// Pipeline stages in order
const STAGES = ['new', 'contacted', 'interested', 'kyc_done', 'demat_done', 'converted', 'churned'];

// Stages that trigger auto-metric credit
const METRIC_STAGE_MAP = { kyc_done: 'kyc', demat_done: 'demat' };

function leadPK(companyId, leadId) {
  return `LEAD#${companyId}#${leadId}`;
}

async function scanAllLeads(companyId) {
  const params = {
    TableName: TABLE,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
    ExpressionAttributeValues: {
      ':prefix': `LEAD#${companyId}#`,
      ':meta': 'METADATA',
    },
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

// ── GET /api/crm/leads ─────────────────────────────────────────────────────────
router.get('/leads', authMiddleware, async (req, res, next) => {
  try {
    const { stage, assignedTo, search } = req.query;
    const companyId = req.user.companyId;
    const empRoles = ['telecaller', 'agent', 'intern'];

    let leads = await scanAllLeads(companyId);

    // Employees only see their assigned leads
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
    const { name, phone, email, productInterest, source, notes, assignedTo } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'name and phone are required' });
    }

    const companyId = req.user.companyId;
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
      stage: 'new',
      assignedTo: assignedTo ?? req.user.id,
      assignedToName: null,
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

    // Fetch all items for this lead (METADATA + messages)
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

    const messages = items
      .filter((i) => i.SK.startsWith('MSG#'))
      .sort((a, b) => a.SK.localeCompare(b.SK));

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

    const allowed = ['name', 'phone', 'email', 'productInterest', 'source', 'notes', 'assignedTo'];
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

// ── PUT /api/crm/leads/:id/stage ───────────────────────────────────────────────
router.put('/leads/:id/stage', authMiddleware, async (req, res, next) => {
  try {
    const { stage } = req.body;
    if (!STAGES.includes(stage)) {
      return res.status(400).json({ error: `stage must be one of: ${STAGES.join(', ')}` });
    }

    const companyId = req.user.companyId;
    const PK = leadPK(companyId, req.params.id);

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Lead not found' });

    const lead = existing.Item;
    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && lead.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date().toISOString();
    const updateAttrs = {
      '#stage': 'stage',
      '#updatedAt': 'updatedAt',
    };
    const updateVals = { ':stage': stage, ':updatedAt': now };
    let updateExpr = 'SET #stage = :stage, #updatedAt = :updatedAt';

    if (stage === 'converted') {
      updateExpr += ', #convertedAt = :convertedAt';
      updateAttrs['#convertedAt'] = 'convertedAt';
      updateVals[':convertedAt'] = now;
    }

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: updateAttrs,
      ExpressionAttributeValues: updateVals,
    }).promise();

    // Auto-credit metric for assigned employee when stage hits kyc_done / demat_done
    const metricType = METRIC_STAGE_MAP[stage];
    if (metricType && lead.assignedTo && lead.stage !== stage) {
      try {
        const date = now.split('T')[0];
        const metricId = `${lead.assignedTo}#${date}#${metricType}`;
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: `METRICS#${companyId}`, SK: metricId },
          UpdateExpression: 'SET #uid = if_not_exists(#uid, :uid), #mt = if_not_exists(#mt, :mt), #d = if_not_exists(#d, :d), #ci = if_not_exists(#ci, :ci), #val = if_not_exists(#val, :zero) + :inc, #src = :src, #ua = :ua',
          ExpressionAttributeNames: {
            '#uid': 'userId', '#mt': 'metric_type', '#d': 'date',
            '#ci': 'companyId', '#val': 'value', '#src': 'source', '#ua': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':uid': lead.assignedTo, ':mt': metricType, ':d': date,
            ':ci': companyId, ':zero': 0, ':inc': 1, ':src': 'crm_auto', ':ua': now,
          },
        }).promise();
        logger.info(`Auto-credited ${metricType} to ${lead.assignedTo} from CRM lead ${req.params.id}`);
      } catch (e) {
        logger.warn(`Auto-metric credit failed for lead ${req.params.id}: ${e.message}`);
      }
    }

    await logAudit(req.user.id, 'crm_stage_change', req.params.id, 'success', req.ip, {
      from: lead.stage, to: stage,
    });

    res.json({ success: true, leadId: req.params.id, stage, autoMetric: metricType ?? null });
  } catch (err) {
    logger.error('crm/leads/:id/stage error', err);
    next(err);
  }
});

// ── DELETE /api/crm/leads/:id ──────────────────────────────────────────────────
router.delete('/leads/:id', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const PK = leadPK(companyId, req.params.id);

    // Fetch all items (metadata + messages) and batch delete
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': PK },
      ProjectionExpression: 'PK, SK',
    }).promise();

    const items = result.Items ?? [];
    if (items.length === 0) return res.status(404).json({ error: 'Lead not found' });

    // DynamoDB batch delete in chunks of 25
    for (let i = 0; i < items.length; i += 25) {
      const chunk = items.slice(i, i + 25);
      await dynamodb.batchWrite({
        RequestItems: {
          [TABLE]: chunk.map((item) => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } })),
        },
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

    const params = {
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK >= :start AND SK <= :end AND (attribute_not_exists(done) OR done = :false)',
      ExpressionAttributeValues: {
        ':prefix': `FOLLOWUP#${companyId}#`,
        ':start': `LEAD#`,
        ':end': `LEAD#~`,
        ':false': false,
      },
    };

    // Scan FOLLOWUP records for date range
    const dateParams = {
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND #dt >= :start AND #dt <= :end AND (attribute_not_exists(done) OR done = :false)',
      ExpressionAttributeNames: { '#dt': 'date' },
      ExpressionAttributeValues: {
        ':prefix': `FOLLOWUP#${companyId}#`,
        ':start': today,
        ':end': endDate,
        ':false': false,
      },
    };

    const items = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({ ...dateParams, ...(lastKey && { ExclusiveStartKey: lastKey }) }).promise();
      items.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    let followups = items;
    if (empRoles.includes(req.user.role)) {
      followups = followups.filter((f) => f.assignedTo === req.user.id);
    }

    followups.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ success: true, followups });
  } catch (err) {
    logger.error('crm/followups GET error', err);
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
    const leadId = req.params.id;
    const PK = `FOLLOWUP#${companyId}#${date}`;
    const SK = `LEAD#${leadId}`;

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK,
        SK,
        leadId,
        companyId,
        date,
        note: note?.trim() ?? '',
        assignedTo: req.user.id,
        done: false,
        createdAt: new Date().toISOString(),
      },
    }).promise();

    res.status(201).json({ success: true, date, leadId });
  } catch (err) {
    logger.error('crm/followup POST error', err);
    next(err);
  }
});

// ── PUT /api/crm/followups/:date/:leadId/done ──────────────────────────────────
router.put('/followups/:date/:leadId/done', authMiddleware, async (req, res, next) => {
  try {
    const { date, leadId } = req.params;
    const companyId = req.user.companyId;

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `FOLLOWUP#${companyId}#${date}`, SK: `LEAD#${leadId}` },
      UpdateExpression: 'SET done = :t, doneAt = :da, doneBy = :db',
      ExpressionAttributeValues: {
        ':t': true,
        ':da': new Date().toISOString(),
        ':db': req.user.id,
      },
    }).promise();

    res.json({ success: true });
  } catch (err) {
    logger.error('crm/followup done error', err);
    next(err);
  }
});

// ── GET /api/crm/stats ─────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const leads = await scanAllLeads(req.user.companyId);
    const today = new Date().toISOString().slice(0, 10);

    const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
    let convertedToday = 0;

    for (const lead of leads) {
      byStage[lead.stage] = (byStage[lead.stage] ?? 0) + 1;
      if (lead.stage === 'converted' && lead.convertedAt?.startsWith(today)) convertedToday++;
    }

    res.json({
      success: true,
      total: leads.length,
      byStage,
      convertedToday,
      stages: STAGES,
    });
  } catch (err) {
    logger.error('crm/stats error', err);
    next(err);
  }
});

module.exports = router;
