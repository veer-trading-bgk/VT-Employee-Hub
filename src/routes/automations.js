'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const dynamodb = require('../config/dynamodb');
const logger   = require('../config/logger');
const AutomationEngine = require('../services/AutomationEngine');

const router = express.Router();
const TABLE  = process.env.DYNAMODB_TABLE_METRICS;

const autoPK = (companyId) => `CONFIG#AUTO#${companyId}`;
const autoSK = (id)        => `AUTO#${id}`;
const execPK = (companyId) => `AUTO_EXEC#${companyId}`;

// ── Exported trigger function (called by crm.js, whatsapp.js, campaigns.js) ─
async function runAutomations(companyId, triggerType, context) {
  return AutomationEngine.fireTrigger(companyId, triggerType, context);
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
      trigger:       { type: trigger.type, conditions: trigger.conditions ?? [] },
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
    if (trigger     !== undefined) { sets.push('#t = :t');       expNames['#t']  = 'trigger'; expVals[':t']     = { type: trigger.type, conditions: trigger.conditions ?? [] }; }
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

module.exports = router;
module.exports.runAutomations = runAutomations;
module.exports.processTick    = processTick;
