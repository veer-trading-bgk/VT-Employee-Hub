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
const LeadService = require('../services/LeadService');
const CIS = require('../services/CustomerIdentityService');
const PipelineService = require('../services/PipelineService');
const ContactBulkOps = require('../services/ContactBulkOpsService');
const TagService = require('../services/TagService');
const TeamScopeService = require('../services/TeamScopeService');

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
    FilterExpression: 'SK = :meta',
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
// Unknown labels are auto-created in the catalog via TagService.addLabelIfMissing()
// (atomic list_append — see TagService.js — so this can never clobber a
// concurrent write to some other tag's fields, e.g. the Settings page's
// aiAssignable toggle).
async function resolveTagIds(companyId, rawTags) {
  if (!rawTags || rawTags.length === 0) return [];
  const needsResolve = rawTags.filter((t) => !String(t).startsWith('t_'));
  if (needsResolve.length === 0) return rawTags;

  // Cache label lookups within this call so N occurrences of the same new
  // label in one request only create one catalog entry (matches prior
  // in-memory-array behavior) instead of racing addLabelIfMissing N times.
  const byLabel = new Map();
  const resolved = [];
  for (const tag of rawTags) {
    const s = String(tag).trim();
    if (s.startsWith('t_')) { resolved.push(s); continue; }
    const key = s.toLowerCase();
    let entry = byLabel.get(key);
    if (!entry) {
      entry = await TagService.addLabelIfMissing(companyId, s);
      byLabel.set(key, entry);
    }
    resolved.push(entry.id);
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
router.put('/pipeline', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { stages } = req.body;
    if (!Array.isArray(stages) || stages.length === 0) {
      return res.status(400).json({ error: 'stages must be a non-empty array' });
    }
    for (const s of stages) {
      if (!s.key || !s.label) return res.status(400).json({ error: 'each stage needs key and label' });
      // isWon/isLost (Stage 3, 2026-07-17 360° audit) are mutually exclusive —
      // a stage can be one, the other, or neither, never both. Enforced here
      // too, not just in the Pipeline Stage Manager UI, since this route is
      // the actual trust boundary.
      if (s.isWon && s.isLost) {
        return res.status(400).json({ error: `Stage "${s.label}" cannot be marked both Won and Lost` });
      }
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
        // isWon/isLost only stored when explicitly true — an admin who never
        // touches the Won/Lost control gets a stage identical in shape to
        // today's (key/label/color/order only), not a stray `isWon: false`
        // on every stage.
        stages: stages.map((s, i) => ({
          key: s.key, label: s.label, color: s.color ?? '#64748b', order: i,
          ...(s.isWon && { isWon: true }),
          ...(s.isLost && { isLost: true }),
        })),
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
    // Normalize phone before schema validation so +91/spaces/dashes are accepted —
    // to10Digit() (not just a digit-strip) so a country-code-prefixed number is
    // truncated to the exact-10-digit shape createLeadSchema.phone requires.
    const body = { ...req.body };
    if (body.phone) body.phone = to10Digit(body.phone);
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

    // ADR-013: identity resolution, atomic phone locking, and dedup all live in
    // CustomerIdentityService — this route no longer reimplements them inline.
    // Tags must be pre-resolved to catalog IDs before calling (CIS's documented contract).
    const resolvedTags = await resolveTagIds(companyId, tags ?? []);

    const result = await CIS.resolveOrCreate(companyId, {
      phone,
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
          Key: { PK: `INBOX#${companyId}#${phone}`, SK: 'CONTACT' },
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
    LeadService.linkContactToLead(companyId, item.PK, phone, name.trim()).catch(() => {});

    // Fire automations
    const { runAutomations } = require('./automations');
    runAutomations(companyId, 'lead_created', {
      leadId: item.leadId, leadPK: item.PK, phone, name: name.trim(),
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
    // Older/partially-created records can lack these array fields entirely —
    // default them so consumers don't have to null-check on every render.
    if (!Array.isArray(meta.productInterest)) meta.productInterest = [];
    if (!Array.isArray(meta.tags)) meta.tags = [];

    const empRoles = ['telecaller', 'agent', 'intern'];
    if (empRoles.includes(req.user.role) && meta.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // team_lead is TEAM-scoped, not owner-only like the three roles above —
    // blocked only when the lead belongs to neither them nor one of their
    // team members. Same TeamScopeService the Inbox list scoping uses, so
    // "visible in my inbox" and "openable by id" can't disagree (previously
    // this route didn't scope team_lead at all — company-wide detail reads
    // despite an own-only list; 2026-07-17 360° audit, Stage 1 Fix 3).
    if (req.user.role === 'team_lead' && meta.assignedTo !== req.user.id) {
      const teamMemberIds = await TeamScopeService.getTeamMemberIds(companyId, req.user.id);
      if (!teamMemberIds.has(meta.assignedTo)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
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

    const allowed = ['name', 'phone', 'email', 'productInterest', 'source', 'notes', 'closureDeadline', 'tags', 'expectedValue', 'probability'];
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
          FilterExpression: 'SK = :meta',
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
router.put('/leads/:id/assign', authMiddleware, checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { assignedTo, assignedToName } = req.body;
    if (!assignedTo) return res.status(400).json({ error: 'assignedTo required' });

    const companyId = req.user.companyId;

    let result;
    try {
      result = await ContactBulkOps.assignLead(companyId, req.params.id, { assignedTo, assignedToName });
    } catch (e) {
      if (e instanceof ContactBulkOps.NotFoundError) return res.status(404).json({ error: e.message });
      throw e;
    }

    await logAudit(req.user.id, 'crm_lead_assigned', req.params.id, 'success', req.ip, { assignedTo });
    // Await before responding — Lambda may freeze the container immediately after
    // res.json(), making fire-and-forget after the response unreliable.
    await notifyCompany(companyId, { event: 'lead_assigned', leadId: req.params.id, assignedTo: result.assignedTo, assignedToName: result.assignedToName }).catch(() => {});
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('crm/leads/:id/assign error', err);
    next(err);
  }
});

// ── PUT /api/crm/leads/:id/stage ───────────────────────────────────────────────
router.put('/leads/:id/stage', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ error: 'stage required' });

    const companyId = req.user.companyId;
    // Replaces isValidStage(companyId, stage) — that helper only returns a
    // boolean, discarding the matched stage object, but the convertedAt
    // branch below (Stage 3, 2026-07-17 360° audit) needs that object's
    // isWon flag. One fetch covers both the validity check and the flag
    // lookup, rather than fetching the pipeline twice.
    const pipelineStages = await getPipelineStages(companyId);
    const targetStage = pipelineStages.find((s) => s.key === stage);
    if (!targetStage) {
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
    // stageChangedAt is distinct from updatedAt — updatedAt bumps on ANY edit
    // (rename, notes, tags, ...), which makes it too noisy for "most recently
    // moved into this stage" ordering. The Sales Kanban board sorts each
    // column by this field (dashboard sales/page.tsx, 2026-07-17) so a
    // just-dragged card floats to the top of its new column instead of
    // landing wherever the board's unrelated sort happened to place it.
    const updateAttrs = { '#stage': 'stage', '#ua': 'updatedAt', '#sca': 'stageChangedAt' };
    const updateVals = { ':stage': stage, ':ua': now, ':sca': now };
    let updateExpr = 'SET #stage = :stage, #ua = :ua, #sca = :sca';

    // convertedAt fires when the NEW stage is flagged isWon (Stage 3,
    // 2026-07-17 360° audit) — replaces the old `stage === 'converted'`
    // literal-key match, which only ever fired for a company that happened
    // to name a stage exactly "converted" (no such key exists in the
    // documented default pipeline, so this branch was dead in practice for
    // every company on the default six stages). isWon is opt-in per company
    // via the Pipeline Stage Manager; an unconfigured pipeline never
    // triggers this, matching every other isWon/isLost reader.
    // Gated on an actual transition (lead.stage !== stage), same as the
    // auto-metric-credit block below — without this, a repeat/idempotent
    // PUT into an already-Won stage would silently reset convertedAt to
    // "now" and corrupt convertedToday/convertedThisMonth stats. The old
    // literal-key check had this same gap, but it was unreachable since no
    // company ever named a stage "converted"; isWon being a real opt-in
    // flag makes the gap reachable in practice, so it must be closed here.
    if (targetStage.isWon && lead.stage !== stage) {
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
    // NOTE: was 'stage_change' (no 'd') until 2026-07-04 — the UI's trigger picker and
    // events/catalog.js's STAGE_CHANGED both use 'stage_changed', so any workflow built
    // through the UI with a "Stage Changed" trigger could never actually fire. Fixed to
    // match the canonical name used everywhere else.
    const { runAutomations } = require('./automations');
    runAutomations(companyId, 'stage_changed', {
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
// Purge logic (LEAD#/INBOX#/TL#/linked CONV#/phone lock, Era 36/37/41 orphan
// handling) now lives in ContactBulkOpsService.deleteLead — extracted
// verbatim (Track A5 fast-follow, 2026-07-10) so the new bulk-delete path
// (contacts.js POST /bulk-update) reuses the exact same purge, not a
// shortcut that only deletes LEAD# and leaves CONV#/TL# orphaned. This
// route stays the audit-log + response-shaping wrapper around it, same
// split already used for assignLead/updateStage/updateTags above. See
// ContactBulkOpsService.js's deleteLead for full purge-scope documentation.
router.delete('/leads/:id', authMiddleware, checkRole(['admin']), rateLimit(10, 60_000), async (req, res, next) => {
  try {
    const leadId = req.params.id;

    let result;
    try {
      result = await ContactBulkOps.deleteLead(req.user.companyId, leadId);
    } catch (e) {
      if (e instanceof ContactBulkOps.NotFoundError) return res.status(404).json({ error: e.message });
      throw e;
    }
    const { phone, convId, inboxConvId, convTlPurge, convTlPartialFailure } = result;

    await logAudit(req.user.id, 'crm_lead_purged', leadId, 'success', req.ip, {
      phone, convId, inboxConvId, convTlPurge,
    });

    // LEAD#/INBOX#/the phone lock are the parts that matter most for a real
    // right-to-erasure request and are either fully synchronous above (so any
    // failure already threw and hit the catch block below) or always attempted.
    // CONV#/TL# purge is best-effort by design (see deleteLead) — a real
    // customer's deletion request must not be blocked by a transient failure
    // there. Surface a partial failure in the response too, not just the audit
    // record, so an admin retrying by hand (or scripting against this route)
    // gets an immediate signal instead of having to cross-check CloudWatch/audit.
    res.json(
      convTlPartialFailure
        ? { success: true, warning: 'Lead data was purged, but cleanup of the linked conversation/timeline records partially failed — see audit log (crm_lead_purged) for details.' }
        : { success: true },
    );
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
router.put('/followups/:date/:leadId/done', authMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
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

// ── GET /api/crm/my-work — "My Work" home dashboard aggregation ────────────────
// Personal-only for every role, including admins — this endpoint backs the "My
// Work" page specifically (not a team/company dashboard; those are /analytics
// and /sales). Reuses scanAllLeads() (leadsByCompany GSI Query) for
// urgentReplies/recentContacts/newContacts — all three already denormalized
// onto LEAD# METADATA, no new fields needed — plus one FOLLOWUP# scan (same
// cost shape as GET /followups above) bucketed into overdue/today/done-today
// here instead of that route's done-exclusion filter.
//
// messagesReplied/leadsProgressed (the original placeholder's other 2 KPIs) are
// deliberately not implemented — neither has a queryable per-user-per-day path
// today (MSG#/STAGE# history is per-lead, no GSI on sender+date), and building
// one means new write-path instrumentation, not just aggregation. Approved as
// out of scope; home/page.tsx ships with 2 real KPIs instead of 4.
const NEW_EMPLOYEE_WINDOW_MS = 7 * 24 * 3600 * 1000;

router.get('/my-work', authMiddleware, async (req, res, next) => {
  try {
    const companyId = req.user.companyId;
    const userId = req.user.id;
    const today = new Date().toISOString().slice(0, 10);

    const allLeads = await scanAllLeads(companyId);
    const myLeads = allLeads.filter((l) => l.assignedTo === userId);

    const urgentReplies = myLeads
      .filter((l) => l.lastMessageDirection === 'inbound' && l.chatStatus !== 'resolved' && l.lastInboundAt)
      .sort((a, b) => new Date(a.lastInboundAt) - new Date(b.lastInboundAt))
      .slice(0, 20)
      .map((l) => ({
        id: l.leadId,
        contactId: l.leadId,
        contactName: l.name ?? l.waName ?? l.phone,
        contactPhone: l.phone,
        lastMessage: l.lastMessagePreview ?? '',
        waitingMinutes: Math.max(0, Math.round((Date.now() - new Date(l.lastInboundAt).getTime()) / 60000)),
      }));

    const recentContacts = myLeads
      .filter((l) => l.lastMessageAt || l.updatedAt)
      .slice()
      .sort((a, b) => new Date(b.lastMessageAt ?? b.updatedAt) - new Date(a.lastMessageAt ?? a.updatedAt))
      .slice(0, 20)
      .map((l) => ({
        id: l.leadId,
        name: l.name ?? l.waName ?? l.phone,
        phone: l.phone,
        stage: l.stage,
        updatedAt: l.lastMessageAt ?? l.updatedAt,
      }));

    const newContacts = myLeads.filter((l) => l.createdAt?.slice(0, 10) === today).length;
    const hasContact = allLeads.some((l) => l.createdBy === userId);

    // Follow-ups — one Scan across this user's own FOLLOWUP# items (any date,
    // done or not); assignedTo already scopes it to one person, so no separate
    // date bound is needed to keep the result small.
    const followupItems = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({
        TableName: TABLE,
        FilterExpression: 'begins_with(PK, :prefix) AND assignedTo = :uid',
        ExpressionAttributeValues: { ':prefix': `FOLLOWUP#${companyId}#`, ':uid': userId },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }).promise();
      followupItems.push(...(result.Items ?? []));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const overdueFollowups = followupItems
      .filter((f) => f.date < today && !f.done)
      .map((f) => ({
        id: `${f.date}|${f.leadId}`, contactId: f.leadId,
        contactName: f.leadName ?? f.leadPhone ?? '', type: 'call', dueAt: f.date,
      }));

    const todayFollowups = followupItems
      .filter((f) => f.date === today && !f.done)
      .map((f) => ({
        id: `${f.date}|${f.leadId}`, contactId: f.leadId,
        contactName: f.leadName ?? f.leadPhone ?? '', type: 'call',
        notes: f.note || undefined, dueAt: f.date,
      }));

    const followupsDone = followupItems.filter((f) => f.done && f.doneAt?.slice(0, 10) === today).length;
    const hasFollowup = followupItems.length > 0;

    const empRes = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: userId },
      ProjectionExpression: 'createdAt',
    }).promise();
    const isNewEmployee = empRes.Item?.createdAt
      ? (Date.now() - new Date(empRes.Item.createdAt).getTime()) < NEW_EMPLOYEE_WINDOW_MS
      : false;

    const gettingStartedProgress = [
      ...(hasContact ? ['contact'] : []),
      ...(hasFollowup ? ['followup'] : []),
    ];

    res.json({
      success: true,
      urgentReplies,
      overdueFollowups,
      todayFollowups,
      recentContacts,
      kpis: { followupsDone, newContacts },
      isNewEmployee,
      gettingStartedProgress,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/crm/import ──────────────────────────────────────────────────────
// rateLimit bumped 5 -> 15/60s on 2026-07-09 (docs/phase3/TECHNICAL_DEBT.md):
// the 5/60s figure was sized back when the frontend fired one request per CSV
// row (fixed in 95063cd) — now one request covers a whole import (<=2000
// leads), so 5/60s was only ever going to bite legitimate rapid re-attempts,
// not real per-row abuse. 15/60s stays a real ceiling while giving room for
// a few retries/re-uploads in quick succession.
router.post('/import', authMiddleware, checkRole(['admin', 'manager']), rateLimit(15, 60_000), async (req, res, next) => {
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

    // Resolved the same way resolveTagIds() does — TagService.addLabelIfMissing()'s
    // atomic list_append, not a read-then-put of the whole catalog, so a large
    // import can never clobber a concurrent aiAssignable toggle (or any other
    // tag's fields) on the Settings page.
    let tagIdMap = {};
    if (allTagValues.size > 0) {
      const catalog = await TagService.getCatalog(companyId);
      const byId = new Map(catalog.map((t) => [t.id, t]));
      const byLabel = new Map(catalog.map((t) => [t.label.toLowerCase(), t]));

      for (const val of allTagValues) {
        const existing = byId.get(val) ?? byLabel.get(val.toLowerCase());
        if (existing) { tagIdMap[val] = existing.id; continue; }
        const created = await TagService.addLabelIfMissing(companyId, val);
        byLabel.set(val.toLowerCase(), created);
        tagIdMap[val] = created.id;
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

