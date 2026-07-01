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
    const { name, description, trigger, steps, status = 'draft' } = req.body;

    if (!name?.trim())                               return res.status(400).json({ error: 'name is required' });
    if (!trigger?.type)                              return res.status(400).json({ error: 'trigger.type is required' });
    if (!Array.isArray(steps) || steps.length === 0) return res.status(400).json({ error: 'at least one step is required' });

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
      steps,
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

    const { name, description, trigger, steps, status } = req.body;
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
