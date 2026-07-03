'use strict';

const { v4: uuidv4 } = require('uuid');
const dynamodb  = require('../config/dynamodb');
const logger    = require('../config/logger');
const WASendSvc = require('./WhatsAppSendService');
const PipelineService = require('./PipelineService');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// ── AutomationEngine ─────────────────────────────────────────────────────────
// Orchestrates workflows: fires triggers, evaluates conditions, runs actions.
// ADR-012: all WA sends delegated to WhatsAppSendService.
// ADR-013: never creates customers; reads existing leads only.
// ─────────────────────────────────────────────────────────────────────────────

class AutomationEngine {

  // ── Entry point ─────────────────────────────────────────────────────────
  async fireTrigger(companyId, triggerType, context) {
    try {
      const { Items: items = [] } = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CONFIG#AUTO#${companyId}`, ':sk': 'AUTO#' },
      }).promise();

      const workflows = items.filter((w) => {
        // Only active workflows fire. Legacy workflows use enabled:true when status is absent.
        const isActive = w.status === 'active' || (w.status == null && w.enabled === true);
        if (!isActive) return false;
        const wTrigger = typeof w.trigger === 'object' ? w.trigger.type : w.trigger;
        return wTrigger === triggerType;
      });

      if (workflows.length === 0) return;

      for (const wf of workflows) {
        const conditions = Array.isArray(wf.trigger?.conditions)
          ? wf.trigger.conditions
          : (wf.conditions ?? []);
        if (!this._evalConditions(conditions, context)) continue;
        // Fire-and-forget per workflow so one failure doesn't block others
        this._startExecution(companyId, wf, context, triggerType).catch((e) =>
          logger.warn(`AutomationEngine: "${wf.name}" start failed: ${e.message}`),
        );
      }
    } catch (e) {
      logger.warn(`AutomationEngine.fireTrigger(${triggerType}): ${e.message}`);
    }
  }

  // ── Create + run a new execution ────────────────────────────────────────
  async _startExecution(companyId, workflow, context, triggerType) {
    const executionId = uuidv4();
    const now         = new Date().toISOString();
    const steps       = this._normalizeSteps(workflow.steps ?? [], workflow.actions ?? []);

    const execItem = {
      PK:           `AUTO_EXEC#${companyId}`,
      SK:           `EXEC#${now}#${executionId}`,
      executionId,
      workflowId:   workflow.id,
      workflowName: workflow.name,
      companyId,
      status:       'running',
      triggeredBy:  { type: triggerType, entityId: context.leadId ?? context.contactId ?? 'system' },
      leadPK:       context.leadPK     ?? null,
      contactId:    context.contactId  ?? null,
      contactName:  context.name ?? context.contactName ?? null,
      steps:        steps.map((s) => ({ stepId: s.id, type: s.type, status: 'pending' })),
      startedAt:    now,
      TTL:          Math.floor(Date.now() / 1000) + 90 * 86400, // 90-day retention
    };

    await dynamodb.put({ TableName: TABLE, Item: execItem }).promise();
    await this._runSteps(companyId, workflow, steps, execItem, context, 0);
  }

  // ── Sequential step runner ───────────────────────────────────────────────
  async _runSteps(companyId, workflow, steps, execItem, context, startIdx) {
    const ts          = () => new Date().toISOString();
    const stepResults = [...execItem.steps];

    for (let i = startIdx; i < steps.length; i++) {
      const step = steps[i];
      stepResults[i] = { ...stepResults[i], status: 'running', startedAt: ts() };

      // 'end' and 'wait' are outside the action try/catch — their errors propagate up cleanly.
      // This prevents the catch block from continuing past a failed wait (which would cause
      // double-execution: the stored WAIT# fires later AND the loop continues immediately).
      if (step.type === 'end') {
        stepResults[i] = { ...stepResults[i], status: 'completed', completedAt: ts() };
        break;
      }

      if (step.type === 'wait') {
        const delayMs  = this._parseWait(step.config ?? {});
        const resumeAt = new Date(Date.now() + delayMs).toISOString();
        await this._storeWait(companyId, {
          executionId: execItem.executionId,
          workflowId:  workflow.id,
          execSK:      execItem.SK,
          steps,
          context,
          resumeAt,
          nextStepIndex: i + 1,
        });
        stepResults[i] = { ...stepResults[i], status: 'waiting', resumeAt };
        await this._patchExec(companyId, execItem.SK, stepResults, 'paused');
        return; // execution paused; will resume via processDueWaits
      }

      try {
        const result = await this._runAction(companyId, step, context);
        stepResults[i] = { ...stepResults[i], status: 'completed', completedAt: ts(), result };

        if (context.leadId) {
          this._tlWrite(companyId, context, workflow.name, step.type, result).catch(() => {});
        }
      } catch (e) {
        // A failed WhatsAppSendService call throws the raw axios error, whose
        // .message is a generic "Request failed with status code 400" — Meta's
        // actual rejection reason lives in .response.data.error.message and was
        // previously dropped here entirely, both from the log line and from the
        // stepResults.error field the dashboard's Executions tab renders
        // (ExecutionList.tsx), making template failures undiagnosable from the
        // UI or CloudWatch alike. Same err.response.data.error.message accessor
        // already used by whatsapp.js's /send-template and /broadcast routes.
        const detail = e.response?.data?.error?.message ?? e.message;
        stepResults[i] = { ...stepResults[i], status: 'failed', completedAt: ts(), error: detail };
        logger.warn(`AutomationEngine: step "${step.type}" failed in "${workflow.name}": ${detail}`);
        // Continue to next step — a single action failure never halts the workflow
      }
    }

    const completedAt = ts();
    const durationMs  = Date.now() - new Date(execItem.startedAt).getTime();
    const failedCount = stepResults.filter((s) => s.status === 'failed').length;
    const actionCount = stepResults.filter((s) => s.type  !== 'end').length;
    const finalStatus = failedCount === 0        ? 'completed'
                      : failedCount === actionCount ? 'failed'
                      :                               'partial_failure';

    await dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `AUTO_EXEC#${companyId}`, SK: execItem.SK },
      UpdateExpression: 'SET #st = :st, steps = :steps, completedAt = :ca, durationMs = :dm',
      ExpressionAttributeNames:  { '#st': 'status' },
      ExpressionAttributeValues: { ':st': finalStatus, ':steps': stepResults, ':ca': completedAt, ':dm': durationMs },
    }).promise();

    // Bump workflow stats (fire-and-forget)
    dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${workflow.id}` },
      UpdateExpression: 'SET runCount = if_not_exists(runCount, :z) + :one, lastRunAt = :lra, updatedAt = :ua',
      ExpressionAttributeValues: { ':one': 1, ':z': 0, ':lra': completedAt, ':ua': completedAt },
    }).promise().catch(() => {});
  }

  // ── Resume after wait ────────────────────────────────────────────────────
  async resumeExecution(companyId, waitRecord) {
    const { workflowId, execSK, steps, context, nextStepIndex } = waitRecord;
    const [wfRes, execRes] = await Promise.all([
      dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${workflowId}` } }).promise(),
      dynamodb.get({ TableName: TABLE, Key: { PK: `AUTO_EXEC#${companyId}`,   SK: execSK             } }).promise(),
    ]);
    if (!wfRes.Item || !execRes.Item) return;
    if (wfRes.Item.status !== 'active' && wfRes.Item.enabled !== true) {
      logger.info(`AutomationEngine: workflow ${workflowId} no longer active; skipping resume`);
      return;
    }
    await this._runSteps(companyId, wfRes.Item, steps, execRes.Item, context, nextStepIndex);
  }

  // ── Process due waits (called by POST /api/automations/_tick) ────────────
  // Wire to AWS EventBridge Scheduled Rule for production.
  async processDueWaits(companyId) {
    const now = new Date().toISOString();
    const { Items = [] } = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lo AND :hi',
      ExpressionAttributeValues: {
        ':pk': `AUTO_WAIT#${companyId}`,
        ':lo': 'WAIT#0000',
        ':hi': `WAIT#${now}#ZZZZ`,
      },
      Limit: 50,
    }).promise();

    let resumed = 0;
    for (const item of Items) {
      // Conditional delete acts as a distributed claim — only ONE concurrent Lambda invocation
      // can claim each WAIT# item, preventing double-resume under concurrent /_tick calls.
      try {
        await dynamodb.delete({
          TableName: TABLE,
          Key:       { PK: item.PK, SK: item.SK },
          ConditionExpression: 'attribute_exists(PK)',
        }).promise();
      } catch (e) {
        if (e.code === 'ConditionalCheckFailedException') continue; // already claimed by another invocation
        logger.warn(`AutomationEngine: wait-claim failed for ${item.executionId}: ${e.message}`);
        continue;
      }
      try {
        await this.resumeExecution(companyId, item);
        resumed++;
      } catch (e) {
        logger.warn(`AutomationEngine: resume failed for ${item.executionId}: ${e.message}`);
      }
    }
    return resumed;
  }

  // ── Action executor ──────────────────────────────────────────────────────
  async _runAction(companyId, step, ctx) {
    const { leadPK, phone, name, leadId, assignedTo } = ctx;
    const now = new Date().toISOString();

    switch (step.type) {
      case 'send_template': {
        const { templateName, language = 'en', variables = [] } = step.config ?? {};
        if (!templateName || !phone) throw new Error('send_template: templateName and phone required');
        const params = variables.map((v) => {
          if (v === '{{name}}')  return name  ?? '';
          if (v === '{{phone}}') return phone ?? '';
          return String(v);
        });
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const r = await WASendSvc.sendTemplate(
          companyId, target,
          { templateName, language },
          params,
          { id: 'system', role: 'admin', name: 'Automation' },
          { content: `[Automation: ${templateName}]` },
        );
        return { wamid: r.wamid ?? r.waMessageId };
      }

      case 'assign_employee': {
        const { employeeId, employeeName } = step.config ?? {};
        if (!employeeId || !leadPK) throw new Error('assign_employee: employeeId and leadPK required');
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET assignedTo = :at, assignedToName = :atn, chatStatus = :cs, updatedAt = :ua',
          ExpressionAttributeValues: { ':at': employeeId, ':atn': employeeName ?? null, ':cs': 'open', ':ua': now },
        }).promise();
        return { assignedTo: employeeId };
      }

      case 'change_stage': {
        const { stage } = step.config ?? {};
        if (!stage || !leadPK) throw new Error('change_stage: stage required');
        // Runs unattended — a bad stage key here has no manual save/toast to catch it,
        // so it must be rejected the same way the manual PUT /stage route rejects it.
        if (!(await PipelineService.isValidStage(companyId, stage))) {
          throw new Error(`change_stage: "${stage}" is not a valid stage in the current pipeline`);
        }
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET #s = :s, updatedAt = :ua',
          ExpressionAttributeNames:  { '#s': 'stage' },
          ExpressionAttributeValues: { ':s': stage, ':ua': now },
        }).promise();
        return { stage };
      }

      case 'add_tag': {
        const { tag } = step.config ?? {};
        if (!tag || !leadPK) throw new Error('add_tag: tag required');
        // Atomic list_append avoids the read-modify-write TOCTOU race under concurrent executions.
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET tags = list_append(if_not_exists(tags, :empty), :newTag), updatedAt = :ua',
          ConditionExpression: 'not contains(tags, :tagVal)',
          ExpressionAttributeValues: { ':newTag': [tag], ':empty': [], ':tagVal': tag, ':ua': now },
        }).promise().catch((e) => {
          // ConditionalCheckFailedException means tag already present — idempotent, not an error
          if (e.code !== 'ConditionalCheckFailedException') throw e;
        });
        return { tag };
      }

      case 'create_task': {
        if (!leadId) throw new Error('create_task: leadId required');
        const { daysFromNow = 1, note } = step.config ?? {};
        const date = new Date(Date.now() + Number(daysFromNow) * 86400000).toISOString().slice(0, 10);
        await dynamodb.put({
          TableName: TABLE,
          Item: {
            PK: `FOLLOWUP#${companyId}#${date}`, SK: `LEAD#${leadId}`,
            leadId, companyId, date,
            note:       note ?? `Auto task (${daysFromNow}d)`,
            assignedTo: assignedTo ?? '',
            done: false, createdAt: now, source: 'automation',
          },
        }).promise();
        return { date };
      }

      default:
        throw new Error(`Unknown action type: ${step.type}`);
    }
  }

  // ── Condition evaluator ──────────────────────────────────────────────────
  _evalConditions(conditions, ctx) {
    for (const c of conditions) {
      if (!this._evalOne(c, ctx)) return false;
    }
    return true;
  }

  _evalOne({ field, operator = 'equals', value }, ctx) {
    const actual = this._ctxField(field, ctx);
    switch (operator) {
      case 'equals':      return actual === value;
      case 'not_equals':  return actual !== value;
      case 'contains':    return Array.isArray(actual) ? actual.includes(value) : String(actual ?? '').includes(String(value ?? ''));
      case 'not_contains':return Array.isArray(actual) ? !actual.includes(value) : !String(actual ?? '').includes(String(value ?? ''));
      case 'exists':      return actual !== undefined && actual !== null && actual !== '';
      case 'not_exists':  return actual === undefined  || actual === null  || actual === '';
      // Legacy operator names from crm.js (backward compat)
      case 'from_stage':  return ctx.fromStage === value;
      case 'to_stage':    return ctx.toStage   === value;
      case 'has_tag':     return (ctx.tags ?? []).includes(value);
      default:            return false; // unknown operator → condition fails safely (don't fire)
    }
  }

  _ctxField(field, ctx) {
    const map = {
      stage:      ctx.stage ?? ctx.toStage,
      from_stage: ctx.fromStage,
      to_stage:   ctx.toStage,
      source:     ctx.source,
      tags:       ctx.tags,
      assignedTo: ctx.assignedTo,
    };
    return field in map ? map[field] : ctx[field];
  }

  // ── Wait helpers ─────────────────────────────────────────────────────────
  _parseWait({ unit = 'minutes', amount = 5 }) {
    const ms = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
    return (ms[unit] ?? 60_000) * Math.max(1, Number(amount));
  }

  async _storeWait(companyId, payload) {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK:  `AUTO_WAIT#${companyId}`,
        SK:  `WAIT#${payload.resumeAt}#${payload.executionId}`,
        ...payload, companyId,
        TTL: Math.floor(new Date(payload.resumeAt).getTime() / 1000) + 7 * 86400, // 7-day grace window
      },
    }).promise();
  }

  async _patchExec(companyId, SK, steps, status) {
    await dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `AUTO_EXEC#${companyId}`, SK },
      UpdateExpression: 'SET #st = :st, steps = :steps',
      ExpressionAttributeNames:  { '#st': 'status' },
      ExpressionAttributeValues: { ':st': status, ':steps': steps },
    }).promise();
  }

  // ── Timeline integration ─────────────────────────────────────────────────
  async _tlWrite(companyId, ctx, workflowName, stepType, result) {
    let tl;
    try { tl = require('../events/timeline'); } catch { return; }
    if (typeof tl?.writeTlRecord !== 'function') return;
    await tl.writeTlRecord(companyId, 'LEAD', ctx.leadId, {
      eventType: 'automation_action',
      actorId:   'system', actorName: 'Automation',
      summary:   `${workflowName}: ${stepType.replace(/_/g, ' ')}`,
      metadata:  { workflowName, stepType, result },
    });
  }

  // ── Convert legacy actions[] → steps[] (backward compat) ────────────────
  _normalizeSteps(steps, actions) {
    if (steps.length > 0) return steps;
    const typeMap = { assign_to: 'assign_employee', move_stage: 'change_stage', create_followup: 'create_task' };
    return actions.map((a, i) => ({
      id:     `legacy-step-${i}`,
      type:   typeMap[a.type] ?? a.type,
      config: a,
    }));
  }
}

module.exports = new AutomationEngine();
