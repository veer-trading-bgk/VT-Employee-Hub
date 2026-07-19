'use strict';

const { v4: uuidv4 } = require('uuid');
const dynamodb  = require('../config/dynamodb');
const logger    = require('../config/logger');
const WASendSvc = require('./WhatsAppSendService');
const PipelineService = require('./PipelineService');
const { resolveWelcomeVariables, resolveTemplateParams } = require('../utils/welcomeVariables');
const { to10Digit } = require('../utils/phone');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// A button_reply condition node with no configured timeout still can't wait forever —
// this bounds it so AUTO_WAIT# items can't accumulate indefinitely for an abandoned chat.
const UNBOUNDED_REPLY_WAIT_MS = 30 * 86_400_000; // 30 days

// Reserved sourceHandle id for a send_buttons/send_list node's "no reply" branch —
// distinct from any real button/row id (those come from user-typed titles via
// ButtonListEditor/ListRowEditor, never from this constant's namespace).
const TIMEOUT_HANDLE_ID = '__timeout__';

// ── AutomationEngine ─────────────────────────────────────────────────────────
// Orchestrates workflows: fires triggers, evaluates conditions, runs actions.
// ADR-012: all WA sends delegated to WhatsAppSendService.
// ADR-013: never creates customers; reads existing leads only.
//
// Two execution shapes coexist by design, never mixed within one workflow:
//   - Linear (legacy): workflow.steps[] — a flat array, run by _runSteps().
//   - Graph (branching): workflow.nodes[]/edges[]/entryNodeId — run by _runGraph().
// _startExecution() dispatches on whether workflow.nodes is present. Both shapes
// share the same AUTO_EXEC#/AUTO_WAIT# storage and the same distributed-claim
// resume infra (processDueWaits()) — only the execution-record's result field
// differs ('steps' vs 'path', see _finalizeExecution()).
// ─────────────────────────────────────────────────────────────────────────────

class AutomationEngine {

  // ── Shared lookup: active workflows for a company matching a trigger type ──
  // The single source of truth for "which live workflows react to this trigger",
  // used by fireTrigger() (which then layers on its keyword/condition filters)
  // AND by hasActiveWorkflow() below. The query is scoped to this company's
  // CONFIG#AUTO# partition, so every returned workflow provably belongs to
  // `companyId`; the filter then keeps only active ones (legacy workflows use
  // enabled:true when status is absent) whose trigger type equals `triggerType`.
  async _findActiveWorkflows(companyId, triggerType) {
    const { Items: items = [] } = await dynamodb.query({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `CONFIG#AUTO#${companyId}`, ':sk': 'AUTO#' },
    }).promise();
    return items.filter((w) => {
      const isActive = w.status === 'active' || (w.status == null && w.enabled === true);
      if (!isActive) return false;
      const wTrigger = typeof w.trigger === 'object' ? w.trigger.type : w.trigger;
      return wTrigger === triggerType;
    });
  }

  // Cheap boolean existence check over _findActiveWorkflows — generic over
  // triggerType (reusable for any future trigger, not specialized). Used by the
  // webhook first-contact guard to let a whatsapp_conversation_started workflow
  // own AI engagement. Read-only: NEVER emits warnings or side effects.
  async hasActiveWorkflow(companyId, triggerType) {
    const matches = await this._findActiveWorkflows(companyId, triggerType);
    return matches.length > 0;
  }

  // ── Entry point ─────────────────────────────────────────────────────────
  async fireTrigger(companyId, triggerType, context) {
    try {
      const matched = await this._findActiveWorkflows(companyId, triggerType);
      // keyword_message's own config (which keyword(s)/mode) decides whether THIS
      // workflow's trigger actually matches this specific event — unlike every other
      // trigger type, where trigger.type alone is enough and trigger.conditions[]
      // (still evaluated below, unaffected) is only ever an optional extra filter.
      // flow_completed uses the same per-trigger-config mechanism, with opposite
      // fail-open semantics on a missing config (see _matchesFlowCompletedConfig).
      const workflows =
        triggerType === 'keyword_message'   ? matched.filter((w) => this._matchesKeywordConfig(w.trigger?.config, context.messageText))
        : triggerType === 'comment_received' ? matched.filter((w) => this._matchesCommentConfig(w.trigger?.config, context))
        : triggerType === 'flow_completed'  ? matched.filter((w) => this._matchesFlowCompletedConfig(w.trigger?.config, context.flowId))
        : matched;

      if (workflows.length === 0) return;

      // Each workflow starts independently (a rejected one never affects another —
      // the per-workflow .catch() below already swallows its own error before this
      // Promise.allSettled ever sees it) but the caller now genuinely waits for all
      // of them, instead of firing and forgetting. An un-awaited _startExecution()
      // chain could freeze mid-flight when the Lambda execution context suspends
      // right after the caller's own HTTP response resolves — silently delaying (or,
      // if the environment is never reused again, permanently losing) the entry
      // action. See docs/bible/19_DECISION_LOG.md Era 20 for the incident this fixes
      // (measured 6.3s-49.4s real production delays, and 2 executions that never
      // completed at all, all traced to this exact gap).
      const starts = [];
      for (const wf of workflows) {
        const conditions = Array.isArray(wf.trigger?.conditions)
          ? wf.trigger.conditions
          : (wf.conditions ?? []);
        if (!this._evalConditions(conditions, context)) continue;
        starts.push(
          this._startExecution(companyId, wf, context, triggerType).catch((e) =>
            logger.warn(`AutomationEngine: "${wf.name}" start failed: ${e.message}`),
          ),
        );
      }
      await Promise.allSettled(starts);
    } catch (e) {
      logger.warn(`AutomationEngine.fireTrigger(${triggerType}): ${e.message}`);
    }
  }

  // ── Direct dispatch for one specific, already-resolved workflow ───────────
  // Unlike fireTrigger() (scans every workflow matching a trigger type and evaluates
  // each one's conditions), a caller here already knows exactly which workflow to run
  // — e.g. the inbound webhook route, which resolves the workflow from its URL, not
  // from a trigger-type scan. Public precisely so routes never reach into
  // _startExecution directly. Still runs the same trigger.conditions[] gate
  // fireTrigger() applies (same _evalConditions() call, no second evaluator) —
  // skipping straight to _startExecution() used to bypass it entirely. Unlike
  // fireTrigger()'s extraction, no top-level wf.conditions fallback here: every
  // writer of a workflow item (buildTriggerForStorage() in automations.js, the
  // linear→graph migration script, every test fixture) nests conditions under
  // trigger — nothing ever writes a top-level conditions field to fall back to.
  async runWorkflowDirect(companyId, workflow, context) {
    const conditions = workflow.trigger?.conditions ?? [];
    if (!this._evalConditions(conditions, context)) return;
    return this._startExecution(companyId, workflow, context, 'inbound_webhook');
  }

  // ── Create + run a new execution ────────────────────────────────────────
  async _startExecution(companyId, workflow, context, triggerType) {
    const executionId = uuidv4();
    const now         = new Date().toISOString();
    const isGraph     = Array.isArray(workflow.nodes) && workflow.nodes.length > 0;
    const steps       = isGraph ? null : this._normalizeSteps(workflow.steps ?? [], workflow.actions ?? []);

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
      ...(isGraph
        ? { path: [] }
        : { steps: steps.map((s) => ({ stepId: s.id, type: s.type, status: 'pending' })) }),
      startedAt:    now,
      TTL:          Math.floor(Date.now() / 1000) + 90 * 86400, // 90-day retention
    };

    await dynamodb.put({ TableName: TABLE, Item: execItem }).promise();

    if (isGraph) await this._runGraph(companyId, workflow, execItem, context, workflow.entryNodeId);
    else         await this._runSteps(companyId, workflow, steps, execItem, context, 0);
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

    await this._finalizeExecution(companyId, workflow, execItem, 'steps', stepResults);
  }

  // ── Graph runner — walks nodes[]/edges[] instead of a flat steps[] array ──
  // Shares _runAction() (node.config is the same shape as a legacy step's config),
  // the AUTO_WAIT#/_storeWait() distributed-claim resume infra, and _finalizeExecution()
  // with the linear runner — only the traversal and the execution-record field differ.
  async _runGraph(companyId, workflow, execItem, context, nodeId, resumeSignal = null) {
    const nodeMap = new Map((workflow.nodes ?? []).map((n) => [n.id, n]));
    const edges   = workflow.edges ?? [];
    const path    = [...(execItem.path ?? [])];
    const ts      = () => new Date().toISOString();
    let pending   = resumeSignal;

    while (nodeId) {
      const node = nodeMap.get(nodeId);
      if (!node) {
        logger.warn(`AutomationEngine: dangling edge to missing node "${nodeId}" in workflow "${workflow.name}" — execution ends here`);
        break;
      }

      // Resuming a node that was previously paused (wait, or a button_reply condition
      // waiting on a reply/timeout) — its outcome was already decided by the caller
      // (resumeExecution). Replace the 'waiting'/'waiting_reply' placeholder already in
      // path (written when it first paused) with its resolved outcome, then move
      // straight to the resolved next node.
      if (pending) {
        const resolvedEntry = { nodeId, type: node.type, status: pending.status, completedAt: ts(), ...(pending.branchKey !== undefined && { branchKey: pending.branchKey }) };
        if (path.length > 0 && path[path.length - 1].nodeId === nodeId) path[path.length - 1] = resolvedEntry;
        else path.push(resolvedEntry);

        // sourceHandle == null (not strict !==) — the canvas serializes the
        // default/no-handle edge as `undefined` (automationGraph.ts's
        // fromReactFlow), never a literal `null`, so this must catch both.
        // Without this filter a resumed node with >1 outgoing edge (e.g.
        // wait_instagram_reply once its optional timeout handle is wired)
        // would pick whichever edge happens to be first in the array,
        // regardless of handle — a real reply could silently route down the
        // timeout branch. Every other resume path (condition/send_buttons/
        // send_list) always sets an explicit branchKey and never reaches this
        // fallback, so this is a no-op for them.
        const edge = pending.branchKey !== undefined
          ? edges.find((e) => e.source === nodeId && e.sourceHandle === pending.branchKey)
          : edges.find((e) => e.source === nodeId && e.sourceHandle == null);
        nodeId  = edge?.target ?? null;
        pending = null;
        continue;
      }

      if (node.type === 'end') {
        path.push({ nodeId, type: 'end', status: 'completed', completedAt: ts() });
        break;
      }

      if (node.type === 'wait') {
        const delayMs  = this._parseWait(node.config ?? {});
        const resumeAt = new Date(Date.now() + delayMs).toISOString();
        await this._storeWait(companyId, {
          executionId: execItem.executionId, workflowId: workflow.id, execSK: execItem.SK,
          graph: true, nodeId, resumeAt, context,
        });
        path.push({ nodeId, type: 'wait', status: 'waiting', resumeAt });
        await this._patchExecPath(companyId, execItem.SK, path, 'paused');
        return;
      }

      // A condition node in 'button_reply' mode is inherently a pause point: it sends
      // no message itself (the preceding send_template/interactive node did that) and
      // waits for either a matching inbound button tap (event-driven resume, see
      // whatsapp.js's webhook + resumeOnButtonReply()) or its own timeout (time-driven
      // resume via the existing processDueWaits() sweep) — whichever comes first.
      if (node.type === 'condition' && node.config?.mode === 'button_reply') {
        const { timeoutAmount, timeoutUnit } = node.config;
        const resumeAt = timeoutAmount
          ? new Date(Date.now() + this._parseWait({ amount: timeoutAmount, unit: timeoutUnit })).toISOString()
          : new Date(Date.now() + UNBOUNDED_REPLY_WAIT_MS).toISOString(); // no configured timeout — still expires eventually so AUTO_WAIT# can't accumulate forever
        const expectedButtonIds = (node.config.branches ?? []).map((b) => b.buttonId).filter(Boolean);
        await this._storeWait(companyId, {
          executionId: execItem.executionId, workflowId: workflow.id, execSK: execItem.SK,
          graph: true, nodeId, resumeAt, context,
          awaitReply: { phone: context.phone ?? null, expectedButtonIds },
        });
        path.push({ nodeId, type: 'condition', status: 'waiting_reply', resumeAt });
        await this._patchExecPath(companyId, execItem.SK, path, 'paused');
        return;
      }

      if (node.type === 'condition') {
        const branchKey = await this._evalCondition(companyId, node, context);
        path.push({ nodeId, type: 'condition', status: 'evaluated', completedAt: ts(), branchKey });
        const edge = edges.find((e) => e.source === nodeId && e.sourceHandle === branchKey);
        nodeId = edge?.target ?? null;
        continue;
      }

      // A send_buttons/send_list node becomes a pause point ONLY when the workflow
      // author actually wired an edge from one of its own per-option handles (or the
      // reserved timeout handle) — purely opt-in, so every workflow predating this
      // feature (a single edge with sourceHandle: null) falls straight through to the
      // generic Action node branch below, completely unaffected.
      if (node.type === 'send_buttons' || node.type === 'send_list') {
        const optionIds = this._replyOptionIds(node);
        const usesReplyHandles = optionIds.length > 0 && edges.some((e) =>
          e.source === nodeId && (optionIds.includes(e.sourceHandle) || e.sourceHandle === TIMEOUT_HANDLE_ID),
        );

        if (usesReplyHandles) {
          let result;
          try {
            result = await this._runAction(companyId, node, context);
            path.push({ nodeId, type: node.type, status: 'sent', completedAt: ts(), result });
            if (context.leadId) {
              this._tlWrite(companyId, context, workflow.name, node.type, result).catch(() => {});
            }
          } catch (e) {
            // Send failed — nothing went out, so there's nothing to wait for a reply to.
            // Falls through via the node's default (sourceHandle-less) edge, if any —
            // same as an unconnected Condition branch ending execution here.
            const detail = e.response?.data?.error?.message ?? e.message;
            path.push({ nodeId, type: node.type, status: 'failed', completedAt: ts(), error: detail });
            logger.warn(`AutomationEngine: node "${node.type}" failed in "${workflow.name}": ${detail}`);
            const edge = edges.find((e) => e.source === nodeId && e.sourceHandle == null);
            nodeId = edge?.target ?? null;
            continue;
          }

          const { replyTimeoutAmount, replyTimeoutUnit } = node.config ?? {};
          const resumeAt = replyTimeoutAmount
            ? new Date(Date.now() + this._parseWait({ amount: replyTimeoutAmount, unit: replyTimeoutUnit })).toISOString()
            : new Date(Date.now() + UNBOUNDED_REPLY_WAIT_MS).toISOString();
          await this._storeWait(companyId, {
            executionId: execItem.executionId, workflowId: workflow.id, execSK: execItem.SK,
            graph: true, nodeId, resumeAt, context,
            awaitReply: { phone: context.phone ?? null, expectedButtonIds: optionIds },
          });
          path.push({ nodeId, type: node.type, status: 'waiting_reply', resumeAt });
          await this._patchExecPath(companyId, execItem.SK, path, 'paused');
          return;
        }
      }

      // A wait_instagram_reply node is the Follow Gate's pause point (ADR-021
      // R5): DM #1 (a private reply) was already sent by the preceding
      // send_instagram_private_reply node, and this node waits for the user's
      // free-text DM reply — an event-driven resume (resumeOnInstagramReply(),
      // called from instagram.js's inbound-DM webhook) — or its own timeout
      // (time-driven resume via the processAllDueWaits() sweep). Unlike
      // WhatsApp's button-reply waits, the resume key is the IGSID (Instagram
      // DMs are free text, not button taps), sourced from DM #1's private-reply
      // response (context.igsid, set by the private-reply node). On reply we
      // follow the node's single default edge (→ DM #2); on timeout we follow
      // an optional TIMEOUT_HANDLE_ID edge if wired, else the flow simply ends.
      if (node.type === 'wait_instagram_reply') {
        const { timeoutAmount, timeoutUnit } = node.config ?? {};
        const resumeAt = timeoutAmount
          ? new Date(Date.now() + this._parseWait({ amount: timeoutAmount, unit: timeoutUnit })).toISOString()
          : new Date(Date.now() + UNBOUNDED_REPLY_WAIT_MS).toISOString();
        await this._storeWait(companyId, {
          executionId: execItem.executionId, workflowId: workflow.id, execSK: execItem.SK,
          graph: true, nodeId, resumeAt, context,
          awaitReply: { igsid: context.igsid ?? null },
        });
        path.push({ nodeId, type: 'wait_instagram_reply', status: 'waiting_reply', resumeAt });
        await this._patchExecPath(companyId, execItem.SK, path, 'paused');
        return;
      }

      // Action node — send_template / assign_employee / change_stage / add_tag / create_task.
      try {
        const result = await this._runAction(companyId, node, context);
        path.push({ nodeId, type: node.type, status: 'completed', completedAt: ts(), result });
        if (context.leadId) {
          this._tlWrite(companyId, context, workflow.name, node.type, result).catch(() => {});
        }
      } catch (e) {
        const detail = e.response?.data?.error?.message ?? e.message;
        path.push({ nodeId, type: node.type, status: 'failed', completedAt: ts(), error: detail });
        logger.warn(`AutomationEngine: node "${node.type}" failed in "${workflow.name}": ${detail}`);
      }

      const edge = edges.find((e) => e.source === nodeId);
      nodeId = edge?.target ?? null;
    }

    await this._finalizeExecution(companyId, workflow, execItem, 'path', path);
  }

  // Buttons/rows a send_buttons/send_list node's own per-option canvas handles can
  // branch on. cta_buttons mode is excluded: Meta never sends a webhook event for a
  // CTA (URL) button tap, so there's nothing to ever branch on for that mode.
  _replyOptionIds(node) {
    if (node.type === 'send_buttons') {
      const cfg = node.config ?? {};
      if (cfg.messageType === 'cta_buttons') return [];
      return (cfg.buttons ?? []).map((b) => b.id).filter(Boolean);
    }
    if (node.type === 'send_list') {
      return (node.config?.rows ?? []).map((r) => r.id).filter(Boolean);
    }
    return [];
  }

  // ── Resume after wait ────────────────────────────────────────────────────
  // resolvedBranch: only meaningful for a graph wait paused on a button_reply condition
  // node. null/undefined (the processDueWaits time-sweep case) means "no reply arrived in
  // time" — follow the node's own fallbackKey. A branch key (from resumeOnButtonReply,
  // an inbound reply that matched) means follow that branch instead.
  async resumeExecution(companyId, waitRecord, resolvedBranch = null) {
    const { workflowId, execSK, steps, context, nextStepIndex, graph, nodeId } = waitRecord;
    const [wfRes, execRes] = await Promise.all([
      dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${workflowId}` } }).promise(),
      dynamodb.get({ TableName: TABLE, Key: { PK: `AUTO_EXEC#${companyId}`,   SK: execSK             } }).promise(),
    ]);
    if (!wfRes.Item || !execRes.Item) return;
    if (wfRes.Item.status !== 'active' && wfRes.Item.enabled !== true) {
      logger.info(`AutomationEngine: workflow ${workflowId} no longer active; skipping resume`);
      return;
    }

    if (graph) {
      const node = (wfRes.Item.nodes ?? []).find((n) => n.id === nodeId);
      const isConditionReplyWait = node?.type === 'condition' && node.config?.mode === 'button_reply';
      const isSendReplyWait = node?.type === 'send_buttons' || node?.type === 'send_list';
      const isIgReplyWait = node?.type === 'wait_instagram_reply';
      const resumeSignal = isConditionReplyWait
        ? { status: resolvedBranch ? 'evaluated' : 'timed_out', branchKey: resolvedBranch ?? node.config.fallbackKey ?? null }
        : isSendReplyWait
          ? { status: resolvedBranch ? 'replied' : 'timed_out', branchKey: resolvedBranch ?? TIMEOUT_HANDLE_ID }
          : isIgReplyWait
            // Reply (resolvedBranch set by resumeOnInstagramReply) → single default
            // edge to DM #2, no branchKey. Timeout (resolvedBranch null, from the
            // time-sweep) → optional TIMEOUT_HANDLE_ID edge if wired, else end.
            ? (resolvedBranch ? { status: 'replied' } : { status: 'timed_out', branchKey: TIMEOUT_HANDLE_ID })
            : { status: 'completed' }; // plain 'wait' node — single outgoing edge, no branch
      return this._runGraph(companyId, wfRes.Item, execRes.Item, context, nodeId, resumeSignal);
    }

    await this._runSteps(companyId, wfRes.Item, steps, execRes.Item, context, nextStepIndex);
  }

  // ── Process due waits (called by POST /api/automations/_tick) ────────────
  // Single-company Query path — kept for the JWT-admin manual-trigger/testing route.
  // processAllDueWaits() below is the table-wide sweep actually wired to the
  // EventBridge schedule.
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
    return this._claimAndResume(Items);
  }

  // ── Process due waits across EVERY company (called by the 5-minute EventBridge tick) ──
  // Table-wide Scan across every company's AUTO_WAIT# partition — same accepted interim
  // tradeoff as ADR-014's CampaignScheduler Scan (no GSI yet at today's scale: "a handful
  // of paused executions per company", per resumeOnButtonReply()'s own comment). Fixes a
  // real production gap: processDueWaits() above was never actually wired to any schedule
  // (this file's own comment said "Wire to AWS EventBridge Scheduled Rule for production"
  // since 2026-07-01, but handler.js's Scheduled Event branch only ever called
  // runDueCampaigns()/runDueLeadScoring()) — so no paused workflow's timeout branch, and
  // no delayed_response timer, ever fired on its own before this.
  async processAllDueWaits() {
    const now = new Date().toISOString();
    const { Items = [] } = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :pfx) AND resumeAt <= :now',
      ExpressionAttributeValues: { ':pfx': 'AUTO_WAIT#', ':now': now },
    }).promise();
    return this._claimAndResume(Items);
  }

  // ── Shared claim+dispatch loop for both processDueWaits() and processAllDueWaits() ──
  async _claimAndResume(items) {
    let resumed = 0;
    for (const item of items) {
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
        // Same AUTO_WAIT# partition, same claim loop — a non-workflow wait
        // (e.g. DelayedResponseService's "Delayed Response Message" feature)
        // is discriminated by waitType and dispatched separately, rather than
        // building a second scan/claim mechanism. Existing workflow wait items
        // have no waitType field, so they fall through to resumeExecution()
        // exactly as before — this dispatch is purely additive.
        if (item.waitType === 'delayed_response') {
          await require('./DelayedResponseService').resume(item.companyId, item);
        } else {
          await this.resumeExecution(item.companyId, item);
        }
        resumed++;
      } catch (e) {
        logger.warn(`AutomationEngine: resume failed for ${item.executionId}: ${e.message}`);
      }
    }
    return resumed;
  }

  // ── Event-driven resume for button_reply condition nodes ─────────────────
  // Called from whatsapp.js's inbound webhook when an inbound message is a button tap
  // (isButtonReply()/parseButtonReply()) — mirrors processDueWaits()'s conditional-delete
  // claim so a reply and a concurrent timeout sweep can never both resume the same wait.
  // Queries the whole AUTO_WAIT#{companyId} partition (a Query on a known PK, not a Scan)
  // rather than a time-bounded range, since a reply can arrive at any point before its
  // node's timeout — accepted at today's scale (a handful of paused executions per
  // company), same accepted-scale reasoning as ADR-014's CampaignScheduler Scan.
  async resumeOnButtonReply(companyId, phone10, buttonId) {
    try {
      const { Items = [] } = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `AUTO_WAIT#${companyId}` },
        Limit: 100,
      }).promise();

      // ADR-013 Rule 3: never compare raw phone numbers. The real inbound webhook
      // path always passes a normalized phone10 here, and automations.js's
      // inbound_webhook trigger now normalizes at the source too — but this
      // comparison is the only reader of awaitReply.phone, so re-normalizing here
      // as well is a cheap defense-in-depth against any future writer regression.
      const candidates = Items.filter((item) =>
        to10Digit(item.awaitReply?.phone) === phone10 &&
        (item.awaitReply.expectedButtonIds ?? []).includes(buttonId),
      );

      for (const item of candidates) {
        try {
          await dynamodb.delete({
            TableName: TABLE,
            Key:       { PK: item.PK, SK: item.SK },
            ConditionExpression: 'attribute_exists(PK)',
          }).promise();
        } catch (e) {
          if (e.code === 'ConditionalCheckFailedException') continue; // already claimed (e.g. by the timeout sweep)
          logger.warn(`AutomationEngine: reply-claim failed for ${item.executionId}: ${e.message}`);
          continue;
        }

        const wfRes = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${item.workflowId}` } }).promise();
        const node  = (wfRes.Item?.nodes ?? []).find((n) => n.id === item.nodeId);

        // Condition (button_reply mode) maps a tapped buttonId to its own branch key
        // via branches[]. send_buttons/send_list use the tapped id directly as the
        // handle id — no indirection needed, since the button/row's own id IS the
        // canvas handle id (see _replyOptionIds()).
        const resolvedBranch = node?.type === 'condition'
          ? ((node.config?.branches ?? []).find((b) => b.buttonId === buttonId)?.key ?? null)
          : buttonId;

        await this.resumeExecution(companyId, item, resolvedBranch).catch((e) =>
          logger.warn(`AutomationEngine: resume-on-reply failed for ${item.executionId}: ${e.message}`),
        );
      }
    } catch (e) {
      logger.warn(`AutomationEngine.resumeOnButtonReply: ${e.message}`);
    }
  }

  // ── Event-driven resume for wait_instagram_reply nodes (Follow Gate) ──────
  // The Instagram-DM sibling of resumeOnButtonReply, called from instagram.js's
  // inbound-DM webhook when a user replies to DM #1 (ADR-021 R5). Two
  // deliberate differences from the WhatsApp path: the match key is the IGSID
  // (awaitReply.igsid), not a phone, because Instagram contacts have no phone;
  // and ANY inbound text resumes — there are no button ids to match, since
  // Instagram DMs are free text. Same whole-partition Query + conditional-delete
  // claim so a reply and a concurrent timeout sweep can never both resume the
  // same wait. Isolation is automatic: these waits store no `phone`, so
  // resumeOnButtonReply/cancelButtonReplyWaits (both key on awaitReply.phone)
  // never touch them, and this never touches a WhatsApp button wait (no igsid).
  // Returns the number of executions resumed, so the caller can suppress
  // keyword_message when a reply was consumed by a Follow Gate.
  async resumeOnInstagramReply(companyId, igsid) {
    let resumed = 0;
    if (!igsid) return resumed;
    try {
      const { Items = [] } = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `AUTO_WAIT#${companyId}` },
        Limit: 100,
      }).promise();

      const candidates = Items.filter((item) => item.awaitReply?.igsid && item.awaitReply.igsid === igsid);

      for (const item of candidates) {
        try {
          await dynamodb.delete({
            TableName: TABLE,
            Key:       { PK: item.PK, SK: item.SK },
            ConditionExpression: 'attribute_exists(PK)',
          }).promise();
        } catch (e) {
          if (e.code === 'ConditionalCheckFailedException') continue; // already claimed (e.g. the timeout sweep)
          logger.warn(`AutomationEngine: ig-reply-claim failed for ${item.executionId}: ${e.message}`);
          continue;
        }

        // A truthy resolvedBranch signals "reply arrived" to resumeExecution
        // (vs. the time-sweep's null → timeout); wait_instagram_reply has a
        // single default edge, so the exact value only needs to be truthy.
        await this.resumeExecution(companyId, item, 'replied').catch((e) =>
          logger.warn(`AutomationEngine: ig-reply resume failed for ${item.executionId}: ${e.message}`),
        );
        resumed++;
      }
    } catch (e) {
      logger.warn(`AutomationEngine.resumeOnInstagramReply: ${e.message}`);
    }
    return resumed;
  }

  // ── Read-only companion to resumeOnInstagramReply (Instagram page, PR2) ────
  // The set of IGSIDs that currently have a paused Follow Gate (a
  // wait_instagram_reply node awaiting their reply). In-flight ONLY — a
  // completed or timed-out gate's AUTO_WAIT# item is already deleted, so it has
  // no separate record (accepted for v3). Reuses the EXACT same
  // AUTO_WAIT#{companyId} Query + awaitReply.igsid filter as
  // resumeOnInstagramReply, so the page's "pending gate" badge and the resume
  // path can never disagree on what "pending" means. Degrades to an empty set on
  // any read failure — a missing badge must never fail the contacts list.
  async pendingInstagramReplyIgsids(companyId) {
    const out = new Set();
    try {
      const { Items = [] } = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `AUTO_WAIT#${companyId}` },
        Limit: 100,
      }).promise();
      for (const item of Items) {
        if (item.awaitReply?.igsid) out.add(item.awaitReply.igsid);
      }
    } catch (e) {
      logger.warn(`AutomationEngine.pendingInstagramReplyIgsids: ${e.message}`);
    }
    return out;
  }

  // ── Cancel a contact's paused button-reply waits, WITHOUT resuming ────────
  // Finding 1 (Era 49, 2026-07-15). Free text on an unengaged, unassigned
  // conversation engages the AI and overrides a whatsapp_conversation_started
  // workflow paused at its buttons. The paused AUTO_WAIT# would otherwise
  // survive and let a LATER stray button tap resume that overridden workflow via
  // resumeOnButtonReply() — a double action on a conversation the AI now owns.
  // This claims and DELETES those waits without resuming, so a late tap finds
  // nothing to fire. Called from whatsapp.js ONLY when startForLead() actually
  // engaged (returned true), so an assigned/declined lead's paused workflow is
  // left untouched. Scoped to awaitReply (button-tappable) waits: delayed_response
  // waits are cancelled separately (DelayedResponseService.cancelPending) and
  // time-only delay waits aren't button-tappable, so both are correctly ignored.
  // Same whole-partition Query + conditional-delete claim as resumeOnButtonReply();
  // fire-and-forget, never throws.
  async cancelButtonReplyWaits(companyId, phone10) {
    try {
      const { Items = [] } = await dynamodb.query({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `AUTO_WAIT#${companyId}` },
        Limit: 100,
      }).promise();

      const candidates = Items.filter((item) =>
        item.awaitReply && to10Digit(item.awaitReply.phone) === phone10,
      );

      await Promise.all(candidates.map((item) =>
        dynamodb.delete({
          TableName: TABLE,
          Key: { PK: item.PK, SK: item.SK },
          ConditionExpression: 'attribute_exists(PK)',
        }).promise().catch((e) => {
          // Already claimed (e.g. a concurrent timeout sweep or a genuine reply
          // that raced this cancel) — nothing left to cancel, not an error.
          if (e.code !== 'ConditionalCheckFailedException') {
            logger.warn(`AutomationEngine.cancelButtonReplyWaits: claim failed for ${item.executionId}: ${e.message}`);
          }
        }),
      ));
    } catch (e) {
      logger.warn(`AutomationEngine.cancelButtonReplyWaits: ${e.message}`);
    }
  }

  // Anti-spam reply-variant picker for the Instagram send nodes (ADR-021 R6).
  // Instagram's automated systems can flag identical repeated replies as spam,
  // so a comment_received flow supplies replyVariants: string[] (>=2) and one is
  // chosen at random per send. A single messageText remains valid (v1 keyword
  // replies, and any single-variant config) — returns null when neither is a
  // usable non-empty string so the caller throws a clear config error.
  _pickInstagramVariant(config) {
    const variants = Array.isArray(config?.replyVariants)
      ? config.replyVariants.filter((v) => typeof v === 'string' && v.trim())
      : [];
    if (variants.length > 0) return variants[Math.floor(Math.random() * variants.length)];
    const single = config?.messageText;
    return (typeof single === 'string' && single.trim()) ? single : null;
  }

  // ── Action executor ──────────────────────────────────────────────────────
  async _runAction(companyId, step, ctx) {
    const { leadPK, phone, name, leadId, assignedTo, source, traits } = ctx;
    const now = new Date().toISOString();

    switch (step.type) {
      case 'send_template': {
        const { templateName, language = 'en', variables = [] } = step.config ?? {};
        if (!templateName || !phone) throw new Error('send_template: templateName and phone required');
        // traits (from a form_submitted trigger's context) let a variable slot
        // reference {{trait.<key>}} — resolved here via the same welcomeVariables
        // registry, no second context-passing path invented.
        const params = resolveTemplateParams(variables, { name, phone, source, traits });
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

      // Reuses the identical interactive-message construction the welcome-message
      // feature already sends (src/routes/whatsapp.js's sendWelcomeMessage()) — same
      // reply_buttons/cta_buttons shapes, same {{name}}/{{phone}} free-text
      // substitution, just delegated to WASendSvc.sendInteractive() mid-workflow
      // instead of on first contact.
      case 'send_buttons': {
        const { messageType, bodyText, buttons = [], ctaButtons = [], header } = step.config ?? {};
        if (!phone) throw new Error('send_buttons: phone required');
        if (!bodyText) throw new Error('send_buttons: bodyText required');
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const resolvedText = resolveWelcomeVariables(bodyText, { name, phone, source, traits });

        let interactive;
        if (messageType === 'cta_buttons') {
          const cta = ctaButtons[0];
          if (!cta) throw new Error('send_buttons: ctaButtons required for cta_buttons mode');
          interactive = {
            type: 'cta_url',
            body: { text: resolvedText },
            action: { name: 'cta_url', parameters: { display_text: cta.text, url: cta.value } },
          };
        } else {
          if (buttons.length === 0) throw new Error('send_buttons: buttons required for reply_buttons mode');
          interactive = {
            type: 'button',
            body: { text: resolvedText },
            action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
          };
        }

        // Optional image/video/document shown above the body text — Meta's Interactive
        // Message header field. sendInteractive() is a raw pass-through (see its own
        // JSDoc), so this needs no service change, only the object built here. Same
        // url-or-s3Key resolution as send_document below: an uploaded header image
        // only has an s3Key at config time, resolved to a media_id here, at
        // execution time, via the same WASendSvc.resolveMediaId() call.
        if (header?.type && (header.url || header.s3Key)) {
          const headerMediaId = header.url
            ? undefined
            : await WASendSvc.resolveMediaId(companyId, { s3Key: header.s3Key, mimeType: header.mimeType, filename: header.filename });
          interactive.header = {
            type: header.type,
            [header.type]: header.url ? { link: header.url } : { id: headerMediaId },
          };
        }

        const r = await WASendSvc.sendInteractive(
          companyId, target, interactive,
          { id: 'system', role: 'admin', name: 'Automation' },
        );
        return { wamid: r.wamid };
      }

      // Reuses WASendSvc.sendMedia() exactly as it already handles documents for the
      // Inbox's manual send flow. A url is passed straight through (Meta fetches the
      // link itself, no extra step). An uploaded file only has an s3Key at config
      // time — there is no lead/target yet to send to, so the S3→Meta media_id
      // resolution (WASendSvc.resolveMediaId(), same method whatsapp.js's
      // POST /upload-send route uses) has to happen here, at execution time, once a
      // real contact is known.
      case 'send_document': {
        const { url, s3Key, mimeType, caption, filename } = step.config ?? {};
        if (!phone) throw new Error('send_document: phone required');
        if (!url && !s3Key) throw new Error('send_document: a URL or an uploaded file is required');
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const resolvedCaption = caption ? resolveWelcomeVariables(caption, { name, phone, traits }) : undefined;

        const mediaId = url ? undefined : await WASendSvc.resolveMediaId(companyId, { s3Key, mimeType, filename });

        const r = await WASendSvc.sendMedia(
          companyId, target,
          { mediaType: 'document', mediaId, url, caption: resolvedCaption, filename, mimeType, s3Key },
          { id: 'system', role: 'admin', name: 'Automation' },
        );
        return { wamid: r.wamid };
      }

      // Plain Message node (Item 1) — freeform text via WASendSvc.sendText().
      // No 24h-customer-service-window enforcement here: that's a canvas-UI hint
      // shown at config time (a workflow author can't know in advance exactly
      // when this node will fire relative to the customer's last inbound
      // message), the same way ComposerToolbar.tsx only warns rather than
      // hard-blocks — Meta itself is the actual enforcement point and will
      // reject the send if the window has genuinely closed.
      case 'send_message': {
        const { messageText } = step.config ?? {};
        if (!phone) throw new Error('send_message: phone required');
        if (!messageText) throw new Error('send_message: messageText required');
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const resolvedText = resolveWelcomeVariables(messageText, { name, phone, traits });
        const r = await WASendSvc.sendText(
          companyId, target, resolvedText,
          { id: 'system', role: 'admin', name: 'Automation' },
        );
        return { wamid: r.wamid ?? r.waMessageId };
      }

      // Message + List node (Item 1b) — Meta's WhatsApp Interactive List
      // message: up to 10 rows in a single section (Meta's platform limit;
      // multi-section lists exist in the spec but add UI complexity this v1
      // deliberately skips — see ListRowEditor.tsx's own comment).
      case 'send_list': {
        const { bodyText, buttonText, rows = [] } = step.config ?? {};
        if (!phone) throw new Error('send_list: phone required');
        if (!bodyText) throw new Error('send_list: bodyText required');
        if (!buttonText) throw new Error('send_list: buttonText required');
        if (rows.length === 0) throw new Error('send_list: at least one row required');
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const resolvedText = resolveWelcomeVariables(bodyText, { name, phone, source, traits });
        const interactive = {
          type: 'list',
          body: { text: resolvedText },
          action: {
            button: buttonText,
            sections: [{
              rows: rows.map((r) => ({
                id: r.id, title: r.title,
                ...(r.description && { description: r.description }),
              })),
            }],
          },
        };
        const r = await WASendSvc.sendInteractive(
          companyId, target, interactive,
          { id: 'system', role: 'admin', name: 'Automation' },
        );
        return { wamid: r.wamid };
      }

      // Send Location node (Item 1c) — dropdown-based config referencing a
      // saved CONFIG#BRANCH# office record (same branches Settings manages
      // and the Inbox composer's own "Send Location" button reuses), rather
      // than free-typed lat/long per workflow.
      case 'send_location': {
        const { branchId } = step.config ?? {};
        if (!phone) throw new Error('send_location: phone required');
        if (!branchId) throw new Error('send_location: branchId required');
        const branchRes = await dynamodb.get({
          TableName: TABLE,
          Key: { PK: `CONFIG#BRANCH#${companyId}`, SK: `BRANCH#${branchId}` },
        }).promise();
        if (!branchRes.Item) throw new Error('send_location: branch not found — it may have been deleted');
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const r = await WASendSvc.sendLocation(
          companyId, target,
          { latitude: branchRes.Item.latitude, longitude: branchRes.Item.longitude, name: branchRes.Item.name, address: branchRes.Item.address },
          { id: 'system', role: 'admin', name: 'Automation' },
        );
        return { wamid: r.wamid };
      }

      // Sends a registered WhatsApp Flow — reuses sendRegisteredFlow() exactly as
      // the Inbox's manual "Send Flow" affordance does (POST /inbox/:leadId/send-flow).
      // Tapping the message's button opens the Flow form directly: unlike
      // send_buttons/send_list there is no separate button concept to configure,
      // the Flow message IS the button. Neither the DRAFT-flow gate nor the
      // stale-flowId 404 are reimplemented here — sendRegisteredFlow already
      // throws both (a deleted CONFIG#FLOW# row surfaces the same way
      // send_location's deleted-branch case does), and the generic catch below
      // in _runSteps/_runGraph logs+continues on any thrown error identically.
      // Lazy require avoids a circular require with whatsapp.js, which already
      // lazy-requires this file for the reverse direction (fireTrigger etc. on
      // inbound webhooks) — same pattern as the ConversationalAgentService
      // require in the start_ai_conversation case further below.
      case 'send_flow': {
        const { flowId } = step.config ?? {};
        if (!phone) throw new Error('send_flow: phone required');
        if (!flowId) throw new Error('send_flow: flowId required');
        const { sendRegisteredFlow } = require('../routes/whatsapp');
        const target = leadPK
          ? { resolvedContact: { pk: leadPK, phone, isLead: true } }
          : { phone };
        const r = await sendRegisteredFlow(
          companyId, target, flowId,
          { id: 'system', role: 'admin', name: 'Automation' },
        );
        return { wamid: r.wamid };
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
        // stageChangedAt alongside updatedAt/stage — same field the two manual
        // stage-write paths (crm.js, ContactBulkOpsService.updateStage) stamp,
        // so a stage move driven by automation also floats to the top of its
        // new column on the Sales Kanban board (sales/page.tsx, 2026-07-17).
        await dynamodb.update({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
          UpdateExpression: 'SET #s = :s, updatedAt = :ua, stageChangedAt = :sca',
          ExpressionAttributeNames:  { '#s': 'stage' },
          ExpressionAttributeValues: { ':s': stage, ':ua': now, ':sca': now },
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

      // Hand off to the autonomous AI conversation agent. ADR-015: goes through
      // ConversationalAgentService -> AIService, never a provider directly. This
      // is a TERMINAL hand-off — once it engages, the conversation's handoffState
      // becomes 'ai' and every later inbound message is carried by the AI engine
      // (continueTurn), NOT by this workflow, which completes at this node. The
      // action no-ops safely (engaged:false) when the agent is disabled, the lead
      // is human-owned (assignedTo), or a bot conversation is already active /
      // handed off — see ConversationalAgentService.startForLead's guard. Lazy
      // require avoids any load-order coupling with the agent service.
      case 'start_ai_conversation': {
        // leadPK is NOT required here: whatsapp_conversation_started fires for
        // unknown INBOX# contacts with none, so startForLead() itself resolve-or-
        // creates the lead (via CIS, ADR-013) when leadPK is absent — customer
        // creation lives in the agent service, so AutomationEngine keeps its
        // "reads existing leads only" boundary (line ~25) intact and simply passes
        // leadPK through (undefined for a conversation_started context). phone is
        // the one hard requirement: there's nothing to resolve a lead from without
        // it, and startForLead needs it as phone10 either way.
        if (!phone) throw new Error('start_ai_conversation: phone required');
        const ConversationalAgentService = require('./ConversationalAgentService');
        const { contextHint } = step.config ?? {};
        // Optional free-text hint (e.g. a tapped button's category) — resolved
        // through the same {{name}}/{{phone}}/{{trait.*}} registry the send_*
        // actions use, so a hint can personalize the AI's turn-0 seed.
        const resolvedHint = contextHint
          ? resolveWelcomeVariables(contextHint, { name, phone, source, traits })
          : '';
        const engaged = await ConversationalAgentService.startForLead(companyId, {
          leadPK, phone10: phone, name, contextHint: resolvedHint,
        });
        return { engaged };
      }

      // Meta Signal — report a conversion event for this lead to Meta's
      // Conversions API. All the business capability (once-ever claim,
      // dataset provisioning, the /events POST, CAPILOG# logging) lives in
      // CapiService (sibling boundary, ADR-019); this case only fetches the
      // lead and surfaces the outcome. The lead re-fetch is REQUIRED, not an
      // optimization: no trigger's frozen context carries ctwaClid (audited
      // 2026-07-18), and after a wait node the replayed context is stale
      // anyway — ctwaClid is create-only/immutable, so a fetch at fire time
      // is always correct. Skips (organic lead, already reported, no lead in
      // context) return normally; only a real Meta send failure throws, so
      // the execution path records a failed node — and the runner's per-node
      // catch guarantees the workflow itself still continues, same as every
      // sibling action. Lazy require: cold-path module, same pattern as the
      // ConversationalAgentService require directly above.
      case 'meta_signal': {
        const { metaEventName, valueField } = step.config ?? {};
        if (!metaEventName) throw new Error('meta_signal: metaEventName required');
        // Contexts with no lead (e.g. whatsapp_conversation_started fires for
        // unknown INBOX# contacts) have nothing to attribute — a skip, same
        // "nothing to report" posture as an organic lead, not an error.
        if (!leadPK || !leadId) return { status: 'skipped', reason: 'no_lead_in_context' };
        const { Item: lead } = await dynamodb.get({
          TableName: TABLE,
          Key: { PK: leadPK, SK: 'METADATA' },
        }).promise();
        if (!lead) return { status: 'skipped', reason: 'lead_missing' };
        const CapiService = require('./CapiService');
        const r = await CapiService.reportForLead(companyId, { lead, metaEventName, valueField });
        if (r.status === 'failed') throw new Error(`meta_signal: ${r.error}`);
        return r;
      }

      // Instagram DM (normal send, recipient: { id: igsid }). v1's keyword reply
      // AND the Follow Gate's DM #2 (ADR-021 R2 — sent only after the user has
      // replied, opening a 24h window). Reads ctx.igsid directly, NOT leadPK/
      // phone: Instagram contacts are IGCONTACT# records, never LEAD# (the
      // 2026-07-18 "lightweight, no CRM" decision). For a comment-sourced flow
      // ctx.igsid is the canonical IGSID captured by the preceding
      // send_instagram_private_reply node; for a DM-sourced flow it comes from
      // instagram.js's inbound handler.
      case 'send_instagram_message': {
        const messageText = this._pickInstagramVariant(step.config);
        if (!ctx.igsid) throw new Error('send_instagram_message: igsid required (not an Instagram-sourced context)');
        if (!messageText) throw new Error('send_instagram_message: messageText or replyVariants required');
        const InstagramSendService = require('./InstagramSendService');
        const r = await InstagramSendService.sendText(companyId, ctx.igsid, messageText);
        return { mid: r.mid };
      }

      // Instagram comment private reply — DM #1 of a comment_received flow
      // (ADR-021 R1/R2). Recipient is the comment_id (ctx.commentId), the only
      // way to first-contact a commenter with no open messaging window. Captures
      // the response's canonical IGSID into ctx.igsid so a following
      // wait_instagram_reply keys its wait on it and DM #2 can reach the user.
      // The caller (instagram.js) has already written the per-comment
      // idempotency claim, so this node never double-sends on a webhook retry.
      case 'send_instagram_private_reply': {
        const messageText = this._pickInstagramVariant(step.config);
        if (!ctx.commentId) throw new Error('send_instagram_private_reply: commentId required (not a comment-sourced context)');
        if (!messageText) throw new Error('send_instagram_private_reply: messageText or replyVariants required');
        const InstagramSendService = require('./InstagramSendService');
        const r = await InstagramSendService.sendPrivateReply(companyId, ctx.commentId, messageText);
        if (r.igsid) ctx.igsid = r.igsid; // authoritative IGSID for the follow-gate wait + DM #2
        // Flip the stored comment 'unreplied' → 'replied' (ADR-022 D1.4), keyed by
        // the comment coords carried in the comment_received context. Awaited (not
        // fire-and-forget — avoids the Era-20 un-awaited-work gap) but never throws.
        await require('./InstagramCommentService').markCommentReplied(companyId, ctx.mediaId, ctx.commentId, ctx.commentTs);
        return { mid: r.mid, igsid: r.igsid };
      }

      default:
        throw new Error(`Unknown action type: ${step.type}`);
    }
  }

  // ── Condition evaluator (trigger-time — always frozen context) ───────────
  _evalConditions(conditions, ctx) {
    for (const c of conditions) {
      if (!this._evalOne(c, ctx)) return false;
    }
    return true;
  }

  _evalOne({ field, operator = 'equals', value }, ctx) {
    // Legacy operator names from crm.js (backward compat)
    if (operator === 'from_stage') return ctx.fromStage === value;
    if (operator === 'to_stage')   return ctx.toStage   === value;
    if (operator === 'has_tag')    return (ctx.tags ?? []).includes(value);
    return this._matchesOperator(this._ctxField(field, ctx), operator, value);
  }

  _matchesOperator(actual, operator, value) {
    switch (operator) {
      // Array-shaped fields (currently only 'tags') need membership, not identity —
      // an array is never === a string, so equals/not_equals silently always failed/
      // passed for them until this Array.isArray branch (mirrors the contains/
      // not_contains branches just below, which already had this right).
      case 'equals':       return Array.isArray(actual) ? actual.includes(value) : actual === value;
      case 'not_equals':   return Array.isArray(actual) ? !actual.includes(value) : actual !== value;
      case 'contains':     return Array.isArray(actual) ? actual.includes(value) : String(actual ?? '').includes(String(value ?? ''));
      case 'not_contains': return Array.isArray(actual) ? !actual.includes(value) : !String(actual ?? '').includes(String(value ?? ''));
      case 'exists':       return actual !== undefined && actual !== null && actual !== '';
      case 'not_exists':   return actual === undefined || actual === null || actual === '' || (Array.isArray(actual) && actual.length === 0);
      default:             return false; // unknown operator → condition fails safely
    }
  }

  // ── Keyword hit test (shared by keyword_message and comment_received) ────
  // 'contains' and 'any_of' are the same operation — substring-match against a
  // list of keywords, just 1 entry vs. N — so they share this one code path
  // rather than duplicating it. Fails closed (false) on any missing/malformed
  // config, same philosophy as _matchesOperator()'s "unknown operator → false".
  _keywordHit(config, text) {
    if (!config || typeof text !== 'string') return false;
    const keywords = Array.isArray(config.keywords)
      ? config.keywords.filter((k) => typeof k === 'string' && k.trim())
      : [];
    if (keywords.length === 0) return false;

    const norm = (s) => (config.caseSensitive ? s.trim() : s.trim().toLowerCase());
    const target = norm(text);
    if (!target) return false;

    if (config.matchMode === 'exact') return keywords.some((k) => norm(k) === target);
    return keywords.some((k) => target.includes(norm(k))); // 'contains' and 'any_of'
  }

  // keyword_message trigger's own config decides whether THIS workflow matches
  // this inbound message — a thin wrapper over the shared keyword-hit test.
  _matchesKeywordConfig(config, messageText) {
    return this._keywordHit(config, messageText);
  }

  // ── Comment trigger matcher (comment_received trigger's own config) ──────
  // Requires BOTH a mediaId match (specific post/Reel targeting — the locked v2
  // scope, ADR-021 R4) AND a keyword match against the comment text. mediaId is
  // compared as a string on both sides (Meta media ids are numeric strings) and
  // must be a real non-empty value — a blank config.mediaId never matches
  // anything, so a malformed trigger fails closed rather than firing on every
  // comment. Keyword semantics are shared verbatim with keyword_message.
  _matchesCommentConfig(config, context) {
    if (!config || typeof config !== 'object') return false;
    const wantMedia = typeof config.mediaId === 'string' ? config.mediaId.trim() : '';
    if (!wantMedia || wantMedia !== String(context.mediaId ?? '')) return false;
    return this._keywordHit(config, context.commentText);
  }

  // ── flow_completed trigger matcher (flow_completed trigger's own config) ──
  // config.flowId set → only that Flow's completions fire this workflow;
  // unset/blank → company-wide catch-all (any completed Flow). Fails OPEN on
  // a missing config — the opposite of _matchesKeywordConfig, deliberately:
  // a keyword trigger without keywords is a broken workflow (nothing defines
  // what fires it), while a flow_completed trigger without a flowId is the
  // documented "any Flow" configuration, not an authoring error.
  _matchesFlowCompletedConfig(config, flowId) {
    const wanted = typeof config?.flowId === 'string' ? config.flowId.trim() : '';
    if (!wanted) return true;
    return wanted === flowId;
  }

  // ── Graph condition-node evaluator (mid-workflow — live re-fetch when possible) ──
  // Unlike trigger conditions (_evalConditions, always evaluated the instant a trigger
  // fires), a graph condition node can run after a wait — so it re-reads the lead's
  // current METADATA rather than trusting context captured when the workflow started.
  // Falls back to frozen context for contacts with no leadPK (unknown/INBOX contacts,
  // nothing to re-fetch) or if the re-fetch itself fails.
  async _evalCondition(companyId, node, context) {
    const cfg    = node.config ?? {};
    const actual = await this._resolveConditionField(cfg.field, context);

    if (cfg.mode === 'boolean') {
      return this._matchesOperator(actual, cfg.operator ?? 'equals', cfg.value) ? 'yes' : 'no';
    }

    // field_match — first branch whose own comparison value matches wins
    for (const branch of cfg.branches ?? []) {
      if (this._matchesOperator(actual, cfg.operator ?? 'equals', branch.value)) return branch.key;
    }
    return cfg.fallbackKey ?? null;
  }

  async _resolveConditionField(field, context) {
    if (!context.leadPK) return this._ctxField(field, context);
    try {
      const { Item } = await dynamodb.get({ TableName: TABLE, Key: { PK: context.leadPK, SK: 'METADATA' } }).promise();
      return this._ctxField(field, { ...context, ...Item });
    } catch (e) {
      logger.warn(`AutomationEngine: condition live re-fetch failed, using frozen context: ${e.message}`);
      return this._ctxField(field, context);
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

  async _patchExecPath(companyId, SK, path, status) {
    await dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `AUTO_EXEC#${companyId}`, SK },
      UpdateExpression: 'SET #st = :st, #p = :path',
      ExpressionAttributeNames:  { '#st': 'status', '#p': 'path' },
      ExpressionAttributeValues: { ':st': status, ':path': path },
    }).promise();
  }

  // ── Shared finalizer — both _runSteps ('steps') and _runGraph ('path') end here ──
  async _finalizeExecution(companyId, workflow, execItem, fieldName, results) {
    const completedAt = new Date().toISOString();
    const durationMs  = Date.now() - new Date(execItem.startedAt).getTime();
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const actionCount = results.filter((r) => r.type !== 'end' && r.type !== 'condition').length;
    const finalStatus = failedCount === 0        ? 'completed'
                      : failedCount === actionCount ? 'failed'
                      :                               'partial_failure';
    const valKey = `:${fieldName}`; // ':steps' or ':path'

    // 'path' is a reserved DynamoDB keyword — fieldName must always go through an
    // ExpressionAttributeNames alias (#f), the same way #st already aliases 'status',
    // never interpolated raw into the UpdateExpression. 'steps' isn't reserved, but
    // aliasing both the same way keeps this one code path correct for either caller.
    await dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `AUTO_EXEC#${companyId}`, SK: execItem.SK },
      UpdateExpression: `SET #st = :st, #f = ${valKey}, completedAt = :ca, durationMs = :dm`,
      ExpressionAttributeNames:  { '#st': 'status', '#f': fieldName },
      ExpressionAttributeValues: { ':st': finalStatus, [valKey]: results, ':ca': completedAt, ':dm': durationMs },
    }).promise();

    // Bump workflow stats (fire-and-forget). successCount/failureCount give
    // WorkflowList.tsx a per-workflow health indicator without opening each
    // execution — 'completed' is the only success terminal state, 'failed'
    // and 'partial_failure' both count as a failure for this simple binary
    // split (no separate partial-failure counter). Existing workflows with
    // no history just start both at 0 from here on — AUTO_EXEC# records
    // carry a 90-day TTL (_startExecution above), so there is no complete
    // history to backfill from even if it were wanted.
    const statField = finalStatus === 'completed' ? 'successCount' : 'failureCount';
    dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${workflow.id}` },
      UpdateExpression: `SET runCount = if_not_exists(runCount, :z) + :one, ${statField} = if_not_exists(${statField}, :z) + :one, lastRunAt = :lra, updatedAt = :ua`,
      ExpressionAttributeValues: { ':one': 1, ':z': 0, ':lra': completedAt, ':ua': completedAt },
    }).promise().catch(() => {});
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
