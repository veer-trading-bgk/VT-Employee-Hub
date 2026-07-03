const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const { logAudit } = require('../utils/audit');
const logger = require('../config/logger');
const { rateLimit } = require('../middleware/rateLimiter');
const { createLeadSchema, updateLeadSchema, createFollowupSchema } = require('../utils/validation');
const { notifyCompany } = require('../utils/wsNotify');
const { to10Digit } = require('../utils/phone');
const { leadPhoneLockPK, leadPhoneLockSK } = require('../core/entityKeys');
const LeadService = require('../services/LeadService');
const CIS = require('../services/CustomerIdentityService');
const PipelineService = require('../services/PipelineService');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// Stages that auto-credit a payroll metric
const METRIC_STAGE_MAP = { kyc_done: 'kyc', demat_done: 'demat' };

function leadPK(companyId, leadId) {
  return `LEAD#${companyId}#${leadId}`;
}

const { getPipelineStages, isValidStage } = PipelineService;

async function scanAllLeads(companyId) {
  // GSI query on leadsByCompany � O(company-size) instead of O(table-size)
  const params = {
    TableName: TABLE,
    IndexName: 'leadsByCompany',
    KeyConditionExpression: 'companyId = :cid',
    FilterExpression: 'SK = :meta AND attribute_not_exists(deletedAt)',
    ExpressionAttributeValues: { ':cid': companyId, ':meta': 'METADATA' },
  };
  const items = [];
  let lastKey;
  do {
    const result = await dynamodb.query({ ...params, ...(lastKey && { ExclusiveStartKey: lastKey }) }).promise();
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// Resolves an array of tag values (raw labels or IDs) to catalog IDs.
// IDs already start with 't_' and pass through unchanged.
// Unknown labels are auto-created in the catalog.
async function resolveTagIds(companyId, rawTags, _retry = 0) {
  if (!rawTags || rawTags.length === 0) return [];
  const needsResolve = rawTags.filter((t) => !String(t).startsWith('t_'));
  if (needsResolve.length === 0) return rawTags;
  const catResult = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG' },
  }).promise();
  const catalog = catResult.Item?.tags ?? [];
  const version = catResult.Item?.version ?? 0;
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
    try {
      await dynamodb.put({
        TableName: TABLE,
        Item: { PK: `TAG_CATALOG#${companyId}`, SK: 'CATALOG', tags: catalog, version: version + 1 },
        ConditionExpression: 'attribute_not_exists(#ver) OR #ver = :ver',
        ExpressionAttributeNames: { '#ver': 'version' },
        ExpressionAttributeValues: { ':ver': version },
      }).promise();
    } catch (e) {
      if (e.code === 'ConditionalCheckFailedException' && _retry < 3) {
        return resolveTagIds(companyId, rawTags, _retry + 1);
      }
      throw e;
    }
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
    const { stage, assignedTo, search, dateFrom, dateTo, page: pageParam, pageSize: pageSizeParam } = req.query;
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

    if (dateFrom) leads = leads.filter((l) => l.createdAt && l.createdAt >= dateFrom);
    if (dateTo) {
      const endOfDay = `${dateTo}T23:59:59.999Z`;
      leads = leads.filter((l) => l.createdAt && l.createdAt <= endOfDay);
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
router.post('/leads', authMiddleware, checkRole(['admin', 'manager']), rateLimit(30, 60_000), async (req, res, next) => {
  try {
    // Strip non-digits from phone before schema validation so +91/spaces/dashes are accepted
    const body = { ...req.body };
    if (body.phone) body.phone = String(body.phone).replace(/\D/g, '');
    if (body.email === '') body.email = null;
    if (body.closureDeadline === '') body.closureDeadline = null;
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const { name, phone, email, productInterest, source, notes, assignedTo, assignedToName, closureDeadline, tags, stage } = body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'name and phone are required' });
    }

    const companyId = req.user.companyId;

    // stage is optional on creation (CIS defaults to the pipeline's first stage
    // when omitted) but if one IS supplied, it must exist in the real pipeline —
    // same rule PUT /leads/:id/stage already enforces. Without this, a hardcoded
    // frontend stage list can silently create a lead with an orphaned stage key
    // CIS has no validation of its own to catch.
    if (stage !== undefined && !(await isValidStage(companyId, stage))) {
      return res.status(400).json({ error: 'Invalid stage key' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');

    // ADR-013: identity resolution, atomic phone locking, and dedup all live in
    // CustomerIdentityService — this route no longer reimplements them inline.
    // Tags must be pre-resolved to catalog IDs before calling (CIS's documented contract).
    const resolvedTags = await resolveTagIds(companyId, tags ?? []);

    const result = await CIS.resolveOrCreate(companyId, {
      phone: cleanPhone,
      name: name.trim(),
      email: email?.trim() ?? null,
      productInterest: productInterest ?? [],
      source: source ?? 'manual',
      notes: notes?.trim() ?? '',
      stage: stage ?? undefined,
      tags: resolvedTags,
      assignedTo: assignedTo ?? null,
      assignedToName: assignedToName ?? null,
    }, {
      createdBy: req.user.id,
      actorId:   req.user.id,
      actorName: req.user.name ?? null,
    });

    // Manual creation via this route keeps its existing "reject on duplicate" contract
    // (unlike forms.js's intake paths, where enrichment is the right behavior) — CIS still
    // ran its enrichment against the existing record, recording this attempt as a real touch.
    if (result.existed) {
      const existing = await dynamodb.get({
        TableName: TABLE, Key: { PK: leadPK(companyId, result.leadId), SK: 'METADATA' },
      }).promise();
      return res.status(409).json({
        error: 'A lead with this phone number already exists',
        existingLeadId: result.leadId,
        existingName: existing.Item?.name ?? null,
      });
    }

    const item = result.lead;

    // Fields CIS doesn't manage, patched on right after creation:
    //  - closureDeadline: crm.js-specific field, not part of CIS's identity schema.
    //  - WhatsApp inbox history: when creating from an unknown WhatsApp contact, copy its
    //    message history onto the new LEAD# record. The inbox query (whatsapp.js:836) gates
    //    on lastMessageAt — without it the new lead is excluded from leadItems while dedup
    //    simultaneously suppresses the originating INBOX# record, making the conversation
    //    invisible in all tabs until a new WA message arrives.
    const patch = {};
    if (closureDeadline) patch.closureDeadline = closureDeadline;
    if (source === 'whatsapp') {
      try {
        const inboxR = await dynamodb.get({
          TableName: TABLE,
          Key: { PK: `INBOX#${companyId}#${to10Digit(cleanPhone)}`, SK: 'CONTACT' },
        }).promise();
        if (inboxR.Item?.lastMessageAt) {
          Object.assign(patch, {
            lastMessageAt:        inboxR.Item.lastMessageAt,
            lastMessagePreview:   inboxR.Item.lastMessagePreview ?? '',
            lastMessageDirection: inboxR.Item.lastMessageDirection ?? 'inbound',
            lastInboundAt:        inboxR.Item.lastMessageAt,
            unreadCount:          inboxR.Item.unreadCount ?? 0,
          });
        }
      } catch (e) {
        logger.warn('inbox→lead history copy failed: ' + e.message);
      }
    }
    if (Object.keys(patch).length) {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: item.PK, SK: 'METADATA' },
        UpdateExpression: `SET ${Object.keys(patch).map((k) => `#${k} = :${k}`).join(', ')}`,
        ExpressionAttributeNames: Object.fromEntries(Object.keys(patch).map((k) => [`#${k}`, k])),
        ExpressionAttributeValues: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`:${k}`, v])),
      }).promise();
      Object.assign(item, patch);
    }

    await logAudit(req.user.id, 'crm_lead_created', item.leadId, 'success', req.ip, { name });

    // Link Contact entity to this lead in the background (never blocks response)
    LeadService.linkContactToLead(companyId, item.PK, cleanPhone, name.trim()).catch(() => {});

    // Fire automations
    const { runAutomations } = require('./automations');
    runAutomations(companyId, 'lead_created', {
      leadId: item.leadId, leadPK: item.PK, phone: cleanPhone, name: name.trim(),
      source: item.source, stage: item.stage, tags: item.tags,
      assignedTo: item.assignedTo,
    }).catch((e) => logger.warn('automation error: ' + e.message));

    // Await before responding — same Lambda-freeze reason as lead_assigned.
    await notifyCompany(companyId, { event: 'lead_created', leadId: item.leadId, stage: item.stage }).catch(() => {});
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

    const MSG_PAGE = 50;
    const before = req.query.before;

    const metaRes = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!metaRes.Item) return res.status(404).json({ error: 'Lead not found' });
    const meta = metaRes.Item;

    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && meta.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const msgQuery = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': PK, ':pfx': 'MSG#' },
      ScanIndexForward: false,
      Limit: MSG_PAGE + 1,
    };
    if (before) msgQuery.ExclusiveStartKey = { PK, SK: before };

    // Also fetch pre-promotion INBOX# messages in parallel.
    // When a CRM lead is created from an unknown WhatsApp contact, the earlier
    // messages are stored under INBOX#companyId#phone MSG# (not LEAD# MSG#).
    // Merging them here ensures conversation history is never truncated.
    const [msgRes, inboxMsgRes] = await Promise.all([
      dynamodb.query(msgQuery).promise(),
      meta.phone
        ? dynamodb.query({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
            ExpressionAttributeValues: {
              ':pk': `INBOX#${companyId}#${to10Digit(meta.phone)}`,
              ':pfx': 'MSG#',
            },
          }).promise().catch(() => ({ Items: [] }))
        : Promise.resolve({ Items: [] }),
    ]);

    const leadMsgs = msgRes.Items ?? [];
    const inboxMsgs = inboxMsgRes.Items ?? [];
    const hasMore = leadMsgs.length > MSG_PAGE;

    // Merge INBOX# pre-promotion history with LEAD# messages.
    // Dedup by SK (LEAD# record wins on collision), sort ascending (chronological).
    const seenSKs = new Set(leadMsgs.map((m) => m.SK));
    const messages = [
      ...inboxMsgs.filter((m) => !seenSKs.has(m.SK)),
      ...leadMsgs.slice(0, MSG_PAGE),
    ].sort((a, b) => a.SK.localeCompare(b.SK));

    const noteRes = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :pfx)',
      ExpressionAttributeValues: { ':pk': PK, ':pfx': 'NOTE#' },
    }).promise();
    const internalNotes = (noteRes.Items ?? []).sort((a, b) => a.SK.localeCompare(b.SK));

    // nextCursor for LEAD# pagination (oldest SK in the current lead page)
    const nextCursor = hasMore ? (leadMsgs.slice(0, MSG_PAGE).at(-1)?.SK ?? null) : null;
    res.json({ success: true, lead: meta, messages, internalNotes, hasMore, nextCursor });
  } catch (err) {
    logger.error('crm/leads/:id GET error', err);
    next(err);
  }
});

// ── PUT /api/crm/leads/:id ─────────────────────────────────────────────────────
router.put('/leads/:id', authMiddleware, rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
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
    if (updates.phone) {
      updates.phone = String(updates.phone).replace(/\D/g, '');
      updates.phoneNorm = to10Digit(updates.phone);
      // Dedup: compare phoneNorm (canonical 10-digit) so +91-prefixed and plain 10-digit
      // formats for the same subscriber are treated as identical.
      if (updates.phoneNorm !== (existing.Item.phoneNorm || to10Digit(existing.Item.phone))) {
        const dupCheck = await dynamodb.query({
          TableName: TABLE,
          IndexName: 'company-phone-index',
          KeyConditionExpression: 'companyId = :cid AND phoneNorm = :norm',
          FilterExpression: 'SK = :meta AND attribute_not_exists(deletedAt)',
          ExpressionAttributeValues: { ':cid': companyId, ':norm': updates.phoneNorm, ':meta': 'METADATA' },
          Limit: 2,
        }).promise();
        const conflict = (dupCheck.Items ?? []).find((l) => l.leadId !== req.params.id);
        if (conflict) {
          return res.status(409).json({ error: 'Phone number already used by another lead', existingLeadId: conflict.leadId, existingName: conflict.name });
        }
      }
    }
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
        const { runAutomations } = require('./automations');
        for (const tag of addedTags) {
          runAutomations(companyId, 'tag_added', {
            leadId: req.params.id, leadPK: PK,
            phone: existing.Item.phone, name: existing.Item.name,
            tags: updates.tags, stage: existing.Item.stage,
            assignedTo: existing.Item.assignedTo,
          }).catch((e) => logger.warn('automation error: ' + e.message));
        }
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
    // Await before responding — Lambda may freeze the container immediately after
    // res.json(), making fire-and-forget after the response unreliable.
    await notifyCompany(companyId, { event: 'lead_assigned', leadId: req.params.id, assignedTo, assignedToName }).catch(() => {});
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
    if (!(await isValidStage(companyId, stage))) {
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
    const { runAutomations } = require('./automations');
    runAutomations(companyId, 'stage_change', {
      leadId: req.params.id, leadPK: PK,
      phone: lead.phone, name: lead.name,
      fromStage: lead.stage, toStage: stage,
      stage, tags: lead.tags ?? [], assignedTo: lead.assignedTo,
    }).catch((e) => logger.warn('automation error: ' + e.message));

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
    notifyCompany(companyId, {
      event: 'lead_updated',
      leadId: req.params.id,
      stage,
      previousStage: lead.stage,
    }).catch(() => {});
  } catch (err) {
    logger.error('crm/leads/:id/stage error', err);
    next(err);
  }
});

// ── DELETE /api/crm/leads/:id — hard-purge: removes all DDB items for this lead ──
// Deletes METADATA + all MSG/NOTE items under LEAD# PK, plus the INBOX# CONTACT
// shadow record and any pre-promotion INBOX# messages for the same phone.
router.delete('/leads/:id', authMiddleware, checkRole(['admin']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const leadId = req.params.id;
    const PK = leadPK(companyId, leadId);

    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Lead not found' });
    const phone = existing.Item.phone;

    // Helper: query all items under a PK and batch-delete them
    async function purgePartition(pk) {
      const items = [];
      let lk;
      do {
        const r = await dynamodb.query({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ...(lk && { ExclusiveStartKey: lk }),
        }).promise();
        items.push(...(r.Items ?? []));
        lk = r.LastEvaluatedKey;
      } while (lk);
      for (let i = 0; i < items.length; i += 25) {
        await dynamodb.batchWrite({
          RequestItems: {
            [TABLE]: items.slice(i, i + 25).map((it) => ({
              DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
            })),
          },
        }).promise();
      }
    }

    // 1. Delete all items under LEAD# PK (METADATA, MSG#*, NOTE#*, etc.)
    await purgePartition(PK);

    // 2. Delete all items under INBOX# PK for this phone (shadow CONTACT + pre-promotion MSG#*)
    if (phone) await purgePartition(`INBOX#${companyId}#${phone}`).catch(() => {});

    // 3. Release the LEAD_PHONE# uniqueness lock (a separate PK, written by
    //    CustomerIdentityService._createCustomer). This was previously left
    //    behind, orphaning the lock: every future create for this number then
    //    failed its ConditionExpression and surfaced a raw "Transaction
    //    cancelled" 500 (production incident 2026-07-03). phoneNorm is the
    //    lock's key component — fall back to normalising the stored phone for
    //    older records written before phoneNorm was persisted.
    //    Associated IDEM# locks (24h TTL) can't be enumerated by leadId here;
    //    CIS ignores a stale idem lock whose lead no longer exists instead.
    const phoneNorm = existing.Item.phoneNorm || (phone ? to10Digit(phone) : null);
    if (phoneNorm) {
      await dynamodb.delete({
        TableName: TABLE,
        Key: { PK: leadPhoneLockPK(companyId, phoneNorm), SK: leadPhoneLockSK() },
      }).promise().catch((e) => logger.warn(`crm/leads purge: phone lock delete failed phoneNorm=${phoneNorm}: ${e.message}`));
    }

    await logAudit(req.user.id, 'crm_lead_purged', leadId, 'success', req.ip, { phone });
    res.json({ success: true });
  } catch (err) {
    logger.error('crm/leads/:id DELETE error', err);
    next(err);
  }
});

// ── POST /api/crm/leads/:id/restore — undo soft-delete ────────────────────────
router.post('/leads/:id/restore', authMiddleware, checkRole(['admin', 'manager']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const PK = leadPK(req.user.companyId, req.params.id);
    const existing = await dynamodb.get({ TableName: TABLE, Key: { PK, SK: 'METADATA' } }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Lead not found' });
    if (!existing.Item.deletedAt) return res.status(400).json({ error: 'Lead is not deleted' });

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK, SK: 'METADATA' },
      UpdateExpression: 'REMOVE deletedAt, deletedBy',
    }).promise();

    await logAudit(req.user.id, 'crm_lead_restored', req.params.id, 'success', req.ip, {});
    res.json({ success: true });
  } catch (err) {
    logger.error('crm/leads/:id/restore error', err);
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
router.post('/leads/:id/followup', authMiddleware, rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const parsed = createFollowupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    const { date, note } = parsed.data;

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

    // Build phoneNorm→existing-lead map for duplicate detection.
    // Keyed on phoneNorm (canonical 10-digit) so cross-format duplicates are caught
    // (e.g. import row has 919866141993, existing lead stored 9866141993 — same subscriber).
    const existingLeads = await scanAllLeads(companyId);
    const phoneMap = new Map(existingLeads.map((l) => [l.phoneNorm || to10Digit(l.phone), l]));

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

          const existing = phoneMap.get(to10Digit(phone));
          if (existing && duplicateAction === 'skip') {
            results.skipped++;
            return;
          }

          const rawTags = Array.isArray(lead.tags) ? lead.tags : [];
          const tags = [...new Set([
            ...rawTags.map((t) => tagIdMap[t?.trim()] ?? t).filter(Boolean),
            ...(importTagId ? [importTagId] : []),
          ])];

          if (existing) {
            // duplicateAction === 'overwrite' — an explicit, deliberate force-overwrite of
            // an existing lead's fields. Not routed through CIS: CIS's enrichment is a
            // conservative smart-merge (fills blanks only, never replaces populated fields),
            // a different and more cautious operation than what "overwrite" asks for here.
            await dynamodb.put({
              TableName: TABLE,
              Item: {
                PK: leadPK(companyId, existing.leadId),
                SK: 'METADATA',
                leadId: existing.leadId,
                companyId,
                name,
                phone,
                phoneNorm: to10Digit(phone),
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
                createdAt: existing.createdAt ?? now,
                updatedAt: now,
                convertedAt: null,
                importedAt: now,

                // V2 entity links — null until background linkage runs
                contactId:             existing.contactId ?? null,
                primaryConversationId: existing.primaryConversationId ?? null,

                // Reserved future-ready fields (Phase 2/3)
                pipelineId:      existing.pipelineId      ?? null,
                productId:       existing.productId       ?? null,
                expectedValue:   existing.expectedValue   ?? null,
                probability:     existing.probability     ?? null,
                wonAt:           existing.wonAt           ?? null,
                lostReason:      existing.lostReason      ?? null,
                customerJourney: existing.customerJourney ?? null,

                // Append-only audit arrays — preserve on overwrite
                ownerHistory:      existing.ownerHistory      ?? [],
                leadSourceHistory: existing.leadSourceHistory ?? [],
              },
            }).promise();
            results.overwritten++;
            return;
          }

          // New lead — routed through CIS for atomic phone-locking + idempotency, closing
          // the TOCTOU race the pre-fetched phoneMap snapshot can't (ADR-013). assignedTo
          // is always resolved explicitly here (never left for CIS to auto-assign) to keep
          // this route's existing default of "importer owns it," not the auto-assign pool.
          const result = await CIS.resolveOrCreate(companyId, {
            phone,
            name,
            email: String(lead.email ?? '').trim() || null,
            productInterest: Array.isArray(lead.productInterest) ? lead.productInterest : [],
            source: lead.source ?? 'import',
            notes: String(lead.notes ?? '').trim(),
            stage: finalStage,
            tags,
            assignedTo: defaultAssignedTo ?? req.user.id,
            assignedToName: defaultAssignedToName ?? req.user.name ?? null,
          }, {
            createdBy: req.user.id,
            actorId:   req.user.id,
            actorName: req.user.name ?? null,
          });

          if (result.existed) {
            // Lost a race against a concurrent create for this phone since the phoneMap
            // snapshot was taken — CIS enriched the winner instead of creating a duplicate.
            results.skipped++;
            return;
          }

          const patch = {};
          if (lead.closureDeadline) patch.closureDeadline = lead.closureDeadline;
          patch.importedAt = now;
          await dynamodb.update({
            TableName: TABLE,
            Key: { PK: result.lead.PK, SK: 'METADATA' },
            UpdateExpression: `SET ${Object.keys(patch).map((k) => `#${k} = :${k}`).join(', ')}`,
            ExpressionAttributeNames: Object.fromEntries(Object.keys(patch).map((k) => [`#${k}`, k])),
            ExpressionAttributeValues: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`:${k}`, v])),
          }).promise();

          results.imported++;
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

