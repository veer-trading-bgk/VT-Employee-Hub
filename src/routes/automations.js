'use strict';

const crypto   = require('crypto');
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const logger   = require('../config/logger');
const AutomationEngine = require('../services/AutomationEngine');
const CIS      = require('../services/CustomerIdentityService');
const { leadPK } = require('../core/entityKeys');

const router = express.Router();
const TABLE  = process.env.DYNAMODB_TABLE_METRICS;

const autoPK = (companyId) => `CONFIG#AUTO#${companyId}`;
const autoSK = (id)        => `AUTO#${id}`;
const execPK = (companyId) => `AUTO_EXEC#${companyId}`;

// ── Exported trigger function (called by crm.js, whatsapp.js, campaigns.js, forms.js) ─
async function runAutomations(companyId, triggerType, context) {
  return AutomationEngine.fireTrigger(companyId, triggerType, context);
}

// ── Validation for the keyword_message trigger's own config ─────────────────
// Unlike every other trigger type, trigger.type alone doesn't define a
// keyword_message trigger — its config (which keyword(s), which mode) does, so
// an empty/malformed config here is a broken workflow, not an empty optional
// filter. Sanitize strips blank keyword rows (an in-progress "any_of" list
// commonly has one) so only real values are ever persisted.
const VALID_KEYWORD_MATCH_MODES = new Set(['exact', 'contains', 'any_of']);
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 200;

function validateKeywordTriggerConfig(config) {
  if (!config || typeof config !== 'object') return 'trigger.config is required for a keyword_message trigger';
  if (!VALID_KEYWORD_MATCH_MODES.has(config.matchMode)) return 'trigger.config.matchMode must be exact, contains, or any_of';
  const keywords = Array.isArray(config.keywords) ? config.keywords.filter((k) => typeof k === 'string' && k.trim()) : [];
  if (keywords.length === 0) return 'trigger.config.keywords must contain at least one non-empty keyword';
  if (keywords.length > MAX_KEYWORDS) return `trigger.config.keywords cannot exceed ${MAX_KEYWORDS} entries`;
  if (keywords.some((k) => k.trim().length > MAX_KEYWORD_LENGTH)) return `each keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer`;
  return null;
}

function sanitizeKeywordTriggerConfig(config) {
  return {
    matchMode:     config.matchMode,
    keywords:      config.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()),
    caseSensitive: config.caseSensitive === true,
  };
}

// ── inbound_webhook trigger — capability-URL token ──────────────────────────
// The token itself is the bearer credential (not a shared HMAC secret like Meta's
// webhook signature scheme) — crypto.randomBytes keeps it in the same random-token
// family as core/id.js's ulid(), compared later via crypto.timingSafeEqual.
function generateWebhookToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Builds the trigger object exactly as persisted — {type, conditions} for every
// existing trigger type, unchanged; keyword_message additionally carries a
// sanitized config. inbound_webhook carries a server-generated token, preserved
// across unrelated edits (existingTrigger) unless the caller explicitly asks to
// regenerate it. Returns { error } instead of throwing so callers can respond
// with a 400 the same way every other validation failure in this file does.
function buildTriggerForStorage(trigger, existingTrigger) {
  if (trigger.type === 'keyword_message') {
    const err = validateKeywordTriggerConfig(trigger.config);
    if (err) return { error: err };
    return { trigger: { type: trigger.type, conditions: trigger.conditions ?? [], config: sanitizeKeywordTriggerConfig(trigger.config) } };
  }
  if (trigger.type === 'inbound_webhook') {
    const canKeepExisting = existingTrigger?.type === 'inbound_webhook' && existingTrigger.webhookToken && !trigger.regenerateToken;
    const webhookToken = canKeepExisting ? existingTrigger.webhookToken : generateWebhookToken();
    return { trigger: { type: trigger.type, conditions: trigger.conditions ?? [], webhookToken } };
  }
  return { trigger: { type: trigger.type, conditions: trigger.conditions ?? [] } };
}

// ── Minimal shape validation for graph workflows (nodes/edges/entryNodeId) ──
// Deliberately shallow — checks referential integrity only (every id exists, every
// edge points at a real node), not deeper graph properties like cycles or
// unreachable nodes. Full graph-integrity validation is a canvas-UI (Phase 2)
// concern where a human is actively building the graph and can be guided
// interactively; this route-level check exists to reject obviously broken payloads.
function validateGraphShape(nodes, edges, entryNodeId) {
  if (!Array.isArray(nodes) || nodes.some((n) => !n?.id || !n?.type)) {
    return 'nodes must be an array of { id, type, config }';
  }
  if (edges !== undefined && (!Array.isArray(edges) || edges.some((e) => !e?.id || !e?.source || !e?.target))) {
    return 'edges must be an array of { id, source, target, sourceHandle? }';
  }
  if (!entryNodeId) return 'entryNodeId is required for a graph workflow';
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(entryNodeId)) return 'entryNodeId must reference an existing node';
  for (const e of edges ?? []) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      return `edge "${e.id}" references a node id that does not exist in nodes[]`;
    }
  }
  return null;
}

// ── GET /stats — must be before /:id ────────────────────────────────────────
router.get('/stats', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const [wfRes, execRes] = await Promise.all([
      dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': autoPK(companyId), ':sk': 'AUTO#' },
      }).promise(),
      dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': execPK(companyId) },
        ScanIndexForward: false,
        Limit: 500,
      }).promise(),
    ]);

    const wfs  = wfRes.Items ?? [];
    const excs = execRes.Items ?? [];

    const active    = wfs.filter((w) => w.status === 'active'   || (w.status == null && w.enabled === true)).length;
    const draft     = wfs.filter((w) => w.status === 'draft'    || (w.status == null && w.enabled === false)).length;
    const paused    = wfs.filter((w) => w.status === 'paused').length;
    const successes = excs.filter((e) => e.status === 'completed').length;

    res.json({
      success: true,
      stats: {
        total:           wfs.length,
        active,
        draft,
        paused,
        totalExecutions: excs.length,
        successRate:     excs.length > 0 ? Math.round((successes / excs.length) * 100) : 0,
      },
    });
  } catch (err) { next(err); }
});

// ── GET /executions — must be before /:id ───────────────────────────────────
router.get('/executions', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const { status, workflowId, limit = '50' } = req.query;

    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': execPK(companyId) },
      ScanIndexForward: false,
      Limit: Math.min(parseInt(limit, 10) || 50, 200),
    }).promise();

    let executions = result.Items ?? [];
    if (status)     executions = executions.filter((e) => e.status     === status);
    if (workflowId) executions = executions.filter((e) => e.workflowId === workflowId);

    res.json({ success: true, executions });
  } catch (err) { next(err); }
});

// ── POST /_tick — JWT admin path ─────────────────────────────────────────────
// EventBridge bypass is handled in app.js BEFORE auth middleware via processTick().
// This router handler covers the admin-with-JWT case (manual trigger / testing).
router.post('/_tick', checkRole(['admin']), async (req, res, next) => {
  try {
    const resumed = await AutomationEngine.processDueWaits(req.user.companyId);
    res.json({ success: true, resumed });
  } catch (err) { next(err); }
});

// ── GET / ────────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': autoPK(req.user.companyId), ':sk': 'AUTO#' },
    }).promise();
    const automations = (result.Items ?? []).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    res.json({ success: true, automations });
  } catch (err) { next(err); }
});

// ── POST / ───────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, checkRole(['admin']), rateLimit(30, 60_000), async (req, res, next) => {
  try {
    const { companyId, id: userId, name: userName } = req.user;
    const { name, description, trigger, steps, nodes, edges, entryNodeId, status = 'draft' } = req.body;

    if (!name?.trim())  return res.status(400).json({ error: 'name is required' });
    if (!trigger?.type) return res.status(400).json({ error: 'trigger.type is required' });

    const triggerResult = buildTriggerForStorage(trigger);
    if (triggerResult.error) return res.status(400).json({ error: triggerResult.error });

    // A workflow is either graph-shaped (nodes/edges) or linear-shaped (steps) —
    // never both. Presence of a non-empty nodes[] selects the graph shape.
    const isGraph = Array.isArray(nodes) && nodes.length > 0;
    if (!isGraph && (!Array.isArray(steps) || steps.length === 0)) {
      return res.status(400).json({ error: 'at least one step is required' });
    }
    if (isGraph) {
      const err = validateGraphShape(nodes, edges, entryNodeId);
      if (err) return res.status(400).json({ error: err });
    }

    const id     = uuidv4();
    const now    = new Date().toISOString();
    const safeStatus = ['active', 'draft'].includes(status) ? status : 'draft';

    const item = {
      PK: autoPK(companyId), SK: autoSK(id),
      id, companyId,
      name:          name.trim(),
      description:   description?.trim() ?? null,
      status:        safeStatus,
      trigger:       triggerResult.trigger,
      ...(isGraph ? { nodes, edges: edges ?? [], entryNodeId } : { steps }),
      runCount:      0,
      lastRunAt:     null,
      createdBy:     userId,
      createdByName: userName ?? null,
      createdAt:     now,
      updatedAt:     now,
      enabled:       safeStatus === 'active', // legacy compat
    };

    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    logger.info(`Automation created: "${item.name}" (${id}) by ${userId}`);
    res.status(201).json({ success: true, automation: item });
  } catch (err) { next(err); }
});

// ── POST /:id/duplicate — "Save as Template" (Item 5) ──────────────────────────
// Personal save-and-reuse only, per company — no superadmin/marketplace
// publishing surface exists yet, so this deliberately stays a same-company
// copy (audited: no cross-company template-sharing route or entity exists
// anywhere in this codebase to extend instead of duplicating).
// Deep-copies steps/nodes/edges (JSON round-trip) so the duplicate shares no
// object references with the original — safe to edit independently even
// though both live in the same Node process for the length of this request.
// Always created as status: 'draft' (never inherits 'active') so duplicating
// a live workflow can never result in two active workflows both firing on
// the same trigger; run stats (runCount/lastRunAt) reset to fresh, and
// createdBy/createdByName record the duplicating user, not the original author.
router.post('/:id/duplicate', authMiddleware, checkRole(['admin']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { companyId, id: userId, name: userName } = req.user;
    const existing = await dynamodb.get({
      TableName: TABLE, Key: { PK: autoPK(companyId), SK: autoSK(req.params.id) },
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Workflow not found' });

    const original = existing.Item;
    const isGraph  = Array.isArray(original.nodes) && original.nodes.length > 0;
    const newId    = uuidv4();
    const now      = new Date().toISOString();
    const requestedName = req.body?.name?.trim();

    const duplicate = {
      PK: autoPK(companyId), SK: autoSK(newId),
      id: newId, companyId,
      name:          requestedName || `${original.name} (Copy)`,
      description:   original.description ?? null,
      status:        'draft',
      enabled:       false,
      trigger:       JSON.parse(JSON.stringify(original.trigger ?? { type: null, conditions: [] })),
      ...(isGraph
        ? {
            nodes:       JSON.parse(JSON.stringify(original.nodes)),
            edges:       JSON.parse(JSON.stringify(original.edges ?? [])),
            entryNodeId: original.entryNodeId,
          }
        : { steps: JSON.parse(JSON.stringify(original.steps ?? [])) }),
      runCount:      0,
      lastRunAt:     null,
      createdBy:     userId,
      createdByName: userName ?? null,
      createdAt:     now,
      updatedAt:     now,
    };

    await dynamodb.put({ TableName: TABLE, Item: duplicate }).promise();
    logger.info(`Automation duplicated: "${original.name}" (${original.id}) -> "${duplicate.name}" (${newId}) by ${userId}`);
    res.status(201).json({ success: true, automation: duplicate });
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const r = await dynamodb.get({
      TableName: TABLE,
      Key: { PK: autoPK(req.user.companyId), SK: autoSK(req.params.id) },
    }).promise();
    if (!r.Item) return res.status(404).json({ error: 'Workflow not found' });
    res.json({ success: true, automation: r.Item });
  } catch (err) { next(err); }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const existing = await dynamodb.get({
      TableName: TABLE, Key: { PK: autoPK(companyId), SK: autoSK(req.params.id) },
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Workflow not found' });

    const { name, description, trigger, steps, nodes, edges, entryNodeId, status } = req.body;
    const expNames = {};
    const expVals  = { ':ua': new Date().toISOString() };
    const sets     = ['updatedAt = :ua'];

    if (name        !== undefined) {
      const trimmed = name?.trim();
      if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });
      sets.push('#n = :n'); expNames['#n'] = 'name'; expVals[':n'] = trimmed;
    }
    if (description !== undefined) { sets.push('description = :d');                           expVals[':d']     = description?.trim() ?? null; }
    if (trigger     !== undefined) {
      if (!trigger?.type) return res.status(400).json({ error: 'trigger.type is required' });
      const triggerResult = buildTriggerForStorage(trigger, existing.Item.trigger);
      if (triggerResult.error) return res.status(400).json({ error: triggerResult.error });
      sets.push('#t = :t'); expNames['#t'] = 'trigger'; expVals[':t'] = triggerResult.trigger;
    }
    if (steps       !== undefined) { sets.push('steps = :steps');                             expVals[':steps'] = steps; }
    if (nodes       !== undefined) {
      const graphErr = validateGraphShape(nodes, edges, entryNodeId);
      if (graphErr) return res.status(400).json({ error: graphErr });
      sets.push('nodes = :nodes, edges = :edges, entryNodeId = :enid');
      expVals[':nodes'] = nodes; expVals[':edges'] = edges ?? []; expVals[':enid'] = entryNodeId;
    }
    if (status      !== undefined) {
      if (!['active', 'draft', 'paused', 'archived'].includes(status)) {
        return res.status(400).json({ error: 'status must be: active | draft | paused | archived' });
      }
      sets.push('#st = :st, enabled = :en');
      expNames['#st'] = 'status';
      expVals[':st']  = status;
      expVals[':en']  = status === 'active';
    }

    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: autoPK(companyId), SK: autoSK(req.params.id) },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ...(Object.keys(expNames).length && { ExpressionAttributeNames: expNames }),
      ExpressionAttributeValues: expVals,
    }).promise();

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /:id/status — activate | pause | archive ─────────────────────────────
router.put('/:id/status', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const { status } = req.body;
    if (!['active', 'draft', 'paused', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'status must be: active | draft | paused | archived' });
    }
    try {
      await dynamodb.update({
        TableName: TABLE,
        Key: { PK: autoPK(companyId), SK: autoSK(req.params.id) },
        UpdateExpression: 'SET #st = :st, enabled = :en, updatedAt = :ua',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames:  { '#st': 'status' },
        ExpressionAttributeValues: { ':st': status, ':en': status === 'active', ':ua': new Date().toISOString() },
      }).promise();
    } catch (e) {
      if (e.code === 'ConditionalCheckFailedException') return res.status(404).json({ error: 'Workflow not found' });
      throw e;
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const r = await dynamodb.get({
      TableName: TABLE, Key: { PK: autoPK(companyId), SK: autoSK(req.params.id) },
    }).promise();
    if (!r.Item) return res.status(404).json({ error: 'Workflow not found' });
    if (r.Item.status === 'active' || r.Item.enabled === true) {
      return res.status(400).json({ error: 'Deactivate the workflow before deleting it' });
    }
    await dynamodb.delete({
      TableName: TABLE, Key: { PK: autoPK(companyId), SK: autoSK(req.params.id) },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── EventBridge bypass handler (mounted in app.js BEFORE auth middleware) ────
// Checks x-automation-secret; if missing/wrong, calls next() to fall through
// to the JWT-authed automations router below it in app.js.
async function processTick(req, res, next) {
  try {
    const secret = process.env.AUTOMATION_TICK_SECRET;
    if (secret && req.headers['x-automation-secret'] === secret) {
      const companyId = String(req.query.companyId ?? req.body?.companyId ?? '');
      if (!companyId) return res.status(400).json({ error: 'companyId required' });
      const resumed = await AutomationEngine.processDueWaits(companyId);
      return res.json({ success: true, resumed });
    }
    next(); // no secret or wrong secret → fall through to JWT path
  } catch (e) { next(e); }
}

// ── Inbound webhook trigger (mounted in app.js BEFORE auth middleware) ──────
// Public, no auth — the token itself is the bearer credential (capability-URL
// scheme; see buildTriggerForStorage's inbound_webhook comment). Unlike every
// other trigger, the caller already names the exact workflow via the URL, so
// this dispatches directly via AutomationEngine.runWorkflowDirect() rather
// than fireTrigger()'s "scan every workflow of this trigger type" path.
//
// Duplicate submissions are NOT rejected (unlike forms.js's public-form-submit
// route, which 409s a repeat phone number to stop an accidental double-click):
// an external system re-notifying about the same contact (e.g. "cart
// abandoned" firing again) is normal for this trigger, not user error, so the
// workflow runs every time a valid event arrives — same "no auto-suppression"
// philosophy keyword_message triggers already use.
const MAX_WEBHOOK_PAYLOAD_BYTES = 100_000; // a real lead-capture payload is a few hundred bytes

async function handleInboundWebhook(req, res, next) {
  try {
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (contentLength > MAX_WEBHOOK_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const { companyId, workflowId, token } = req.params;
    const wfRes = await dynamodb.get({
      TableName: TABLE, Key: { PK: autoPK(companyId), SK: autoSK(workflowId) },
    }).promise();
    const workflow = wfRes.Item;
    if (!workflow || workflow.trigger?.type !== 'inbound_webhook') {
      return res.status(404).json({ error: 'Not found' });
    }

    const expected = Buffer.from(workflow.trigger.webhookToken ?? '');
    const actual   = Buffer.from(String(token ?? ''));
    const tokenMatches = expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!tokenMatches) return res.status(404).json({ error: 'Not found' }); // 404, not 401 — don't confirm a workflow exists to a guesser

    const isActive = workflow.status === 'active' || (workflow.status == null && workflow.enabled === true);
    if (!isActive) return res.status(404).json({ error: 'Not found' });

    const { phone, name, email } = req.body ?? {};
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

    // ADR-013: identity resolution goes through CIS, same as every other lead-creating
    // entry point. No actorId — an unauthenticated webhook has no user, so CIS's
    // fallback-to-actor auto-assign step correctly never fires here either.
    const result = await CIS.resolveOrCreate(companyId, {
      phone: cleanPhone,
      name:  String(name ?? cleanPhone).trim(),
      email: email ? String(email).trim() : null,
      source: 'inbound_webhook',
      notes: '',
    }, { createdBy: 'inbound_webhook' });

    // result.lead is only populated on a fresh create (CIS's own contract) — an
    // enriched or idempotent-replayed hit returns leadId only. One direct-key read
    // by leadPK covers both cases uniformly, same live-read discipline
    // _resolveConditionField() already uses for a condition node's stage/tag checks.
    const leadKey = { PK: leadPK(companyId, result.leadId), SK: 'METADATA' };
    const lead = result.lead ?? (await dynamodb.get({ TableName: TABLE, Key: leadKey }).promise()).Item;

    await AutomationEngine.runWorkflowDirect(companyId, workflow, {
      leadId: result.leadId, leadPK: leadKey.PK, phone: cleanPhone, name: lead?.name ?? cleanPhone,
      source: 'inbound_webhook', stage: lead?.stage, tags: lead?.tags, assignedTo: lead?.assignedTo,
    });

    res.status(200).json({ success: true });
  } catch (err) { next(err); }
}

module.exports = router;
module.exports.runAutomations = runAutomations;
module.exports.processTick    = processTick;
// Composed as an array (rate-limit + handler) so app.js can mount it in one line
// without importing rateLimiter separately, same public-route pattern processTick uses.
module.exports.inboundWebhook = [rateLimit(30, 60_000), handleInboundWebhook];
