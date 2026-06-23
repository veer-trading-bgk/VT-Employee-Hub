const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const { sendTemplate } = require('../utils/whatsappSend');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// ── Automation execution engine ───────────────────────────────────────────────
async function runAutomations(companyId, trigger, context) {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#AUTO#${companyId}`, ':sk': 'AUTO#' },
    }).promise();

    const automations = (result.Items ?? []).filter((a) => a.enabled && a.trigger === trigger);
    if (automations.length === 0) return;

    for (const auto of automations) {
      try {
        if (!checkConditions(auto.conditions ?? [], context)) continue;
        await executeActions(companyId, auto.actions ?? [], context);
        logger.info(`Automation "${auto.name}" fired for trigger=${trigger} company=${companyId}`);
      } catch (e) {
        logger.warn(`Automation "${auto.name}" action failed: ${e.message}`);
      }
    }
  } catch (e) {
    logger.warn(`runAutomations error: ${e.message}`);
  }
}

function checkConditions(conditions, ctx) {
  for (const c of conditions) {
    switch (c.field) {
      case 'from_stage': if (ctx.fromStage !== c.value) return false; break;
      case 'to_stage':   if (ctx.toStage !== c.value) return false; break;
      case 'stage':      if (ctx.stage !== c.value) return false; break;
      case 'source':     if (ctx.source !== c.value) return false; break;
      case 'has_tag':    if (!(ctx.tags ?? []).includes(c.value)) return false; break;
    }
  }
  return true;
}

async function executeActions(companyId, actions, ctx) {
  const { leadId, leadPK, phone, name, assignedTo } = ctx;
  const now = new Date().toISOString();

  for (const action of actions) {
    switch (action.type) {
      case 'send_template': {
        if (!action.templateName || !phone) break;
        const params = (action.variables ?? []).map((v) => {
          if (v === '{{name}}') return name ?? '';
          if (v === '{{phone}}') return phone ?? '';
          return v;
        });
        await sendTemplate(companyId, phone, action.templateName, action.language ?? 'en', params);
        break;
      }
      case 'assign_to': {
        if (!action.employeeId) break;
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
          ExpressionAttributeValues: {
            ':at': action.employeeId,
            ':atn': action.employeeName ?? null,
            ':cs': 'open',
            ':ua': now,
          },
        }).promise();
        break;
      }
      case 'add_tag': {
        if (!action.tag) break;
        const cur = await dynamodb.get({ TableName: TABLE, Key: { PK: leadPK, SK: 'METADATA' } }).promise();
        const tags = [...new Set([...(cur.Item?.tags ?? []), action.tag])];
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET tags = :t, updatedAt = :ua',
          ExpressionAttributeValues: { ':t': tags, ':ua': now },
        }).promise();
        break;
      }
      case 'move_stage': {
        if (!action.stage) break;
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET #s = :s, updatedAt = :ua',
          ExpressionAttributeNames: { '#s': 'stage' },
          ExpressionAttributeValues: { ':s': action.stage, ':ua': now },
        }).promise();
        break;
      }
      case 'create_followup': {
        const days = Number(action.daysFromNow ?? 1);
        const date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        await dynamodb.put({
          TableName: TABLE,
          Item: {
            PK: `FOLLOWUP#${companyId}#${date}`,
            SK: `LEAD#${leadId}`,
            leadId, companyId, date,
            note: action.note ?? `Auto follow-up (${days}d)`,
            assignedTo: assignedTo ?? '',
            done: false,
            createdAt: now,
            source: 'automation',
          },
        }).promise();
        break;
      }
    }
  }
}

// ── GET /api/automations ──────────────────────────────────────────────────────
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#AUTO#${req.user.companyId}`, ':sk': 'AUTO#' },
    }).promise();
    res.json({ success: true, automations: (result.Items ?? []).sort((a, b) => a.createdAt?.localeCompare(b.createdAt)) });
  } catch (err) { next(err); }
});

// ── POST /api/automations ─────────────────────────────────────────────────────
router.post('/', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { name, trigger, conditions, actions, enabled } = req.body;
    if (!name?.trim() || !trigger || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'name, trigger, and at least one action are required' });
    }
    const id = uuidv4();
    const now = new Date().toISOString();
    const item = {
      PK: `CONFIG#AUTO#${req.user.companyId}`, SK: `AUTO#${id}`,
      id, companyId: req.user.companyId,
      name: name.trim(), trigger,
      conditions: conditions ?? [],
      actions,
      enabled: enabled !== false,
      runCount: 0,
      createdBy: req.user.id,
      createdAt: now, updatedAt: now,
    };
    await dynamodb.put({ TableName: TABLE, Item: item }).promise();
    res.status(201).json({ success: true, automation: item });
  } catch (err) { next(err); }
});

// ── PUT /api/automations/:id ──────────────────────────────────────────────────
router.put('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { name, trigger, conditions, actions, enabled } = req.body;
    await dynamodb.update({
      TableName: TABLE,
      Key: { PK: `CONFIG#AUTO#${req.user.companyId}`, SK: `AUTO#${req.params.id}` },
      UpdateExpression: 'SET #n = :n, #t = :t, conditions = :c, actions = :a, enabled = :e, updatedAt = :ua',
      ExpressionAttributeNames: { '#n': 'name', '#t': 'trigger' },
      ExpressionAttributeValues: {
        ':n': name?.trim(), ':t': trigger,
        ':c': conditions ?? [], ':a': actions,
        ':e': enabled !== false, ':ua': new Date().toISOString(),
      },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/automations/:id ───────────────────────────────────────────────
router.delete('/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: `CONFIG#AUTO#${req.user.companyId}`, SK: `AUTO#${req.params.id}` },
    }).promise();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runAutomations = runAutomations;
