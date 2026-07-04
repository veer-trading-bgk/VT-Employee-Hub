'use strict';

const { v4: uuidv4 } = require('uuid');
const dynamodb  = require('../config/dynamodb');
const logger    = require('../config/logger');
const WASendSvc = require('./WhatsAppSendService');
const PipelineService = require('./PipelineService');
const { resolveWelcomeVariables } = require('../utils/welcomeVariables');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// A button_reply condition node with no configured timeout still can't wait forever —
// this bounds it so AUTO_WAIT# items can't accumulate indefinitely for an abandoned chat.
const UNBOUNDED_REPLY_WAIT_MS = 30 * 86_400_000; // 30 days

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

        const edge = pending.branchKey !== undefined
          ? edges.find((e) => e.source === nodeId && e.sourceHandle === pending.branchKey)
          : edges.find((e) => e.source === nodeId);
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
      const isReplyWait = node?.type === 'condition' && node.config?.mode === 'button_reply';
      const resumeSignal = isReplyWait
        ? { status: resolvedBranch ? 'evaluated' : 'timed_out', branchKey: resolvedBranch ?? node.config.fallbackKey ?? null }
        : { status: 'completed' }; // plain 'wait' node — single outgoing edge, no branch
      return this._runGraph(companyId, wfRes.Item, execRes.Item, context, nodeId, resumeSignal);
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
        // Same AUTO_WAIT# partition, same claim loop — a non-workflow wait
        // (e.g. DelayedResponseService's "Delayed Response Message" feature)
        // is discriminated by waitType and dispatched separately, rather than
        // building a second scan/claim mechanism. Existing workflow wait items
        // have no waitType field, so they fall through to resumeExecution()
        // exactly as before — this dispatch is purely additive.
        if (item.waitType === 'delayed_response') {
          await require('./DelayedResponseService').resume(companyId, item);
        } else {
          await this.resumeExecution(companyId, item);
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

      const candidates = Items.filter((item) =>
        item.awaitReply?.phone === phone10 &&
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

        const wfRes  = await dynamodb.get({ TableName: TABLE, Key: { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${item.workflowId}` } }).promise();
        const node   = (wfRes.Item?.nodes ?? []).find((n) => n.id === item.nodeId);
        const branch = (node?.config?.branches ?? []).find((b) => b.buttonId === buttonId);

        await this.resumeExecution(companyId, item, branch?.key ?? null).catch((e) =>
          logger.warn(`AutomationEngine: resume-on-reply failed for ${item.executionId}: ${e.message}`),
        );
      }
    } catch (e) {
      logger.warn(`AutomationEngine.resumeOnButtonReply: ${e.message}`);
    }
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
        const resolvedText = resolveWelcomeVariables(bodyText, { name, phone });

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
        const resolvedCaption = caption ? resolveWelcomeVariables(caption, { name, phone }) : undefined;

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
        const resolvedText = resolveWelcomeVariables(messageText, { name, phone });
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
        const resolvedText = resolveWelcomeVariables(bodyText, { name, phone });
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
      case 'equals':       return actual === value;
      case 'not_equals':   return actual !== value;
      case 'contains':     return Array.isArray(actual) ? actual.includes(value) : String(actual ?? '').includes(String(value ?? ''));
      case 'not_contains': return Array.isArray(actual) ? !actual.includes(value) : !String(actual ?? '').includes(String(value ?? ''));
      case 'exists':       return actual !== undefined && actual !== null && actual !== '';
      case 'not_exists':   return actual === undefined  || actual === null  || actual === '';
      default:             return false; // unknown operator → condition fails safely
    }
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

    await dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `AUTO_EXEC#${companyId}`, SK: execItem.SK },
      UpdateExpression: `SET #st = :st, ${fieldName} = ${valKey}, completedAt = :ca, durationMs = :dm`,
      ExpressionAttributeNames:  { '#st': 'status' },
      ExpressionAttributeValues: { ':st': finalStatus, [valKey]: results, ':ca': completedAt, ':dm': durationMs },
    }).promise();

    // Bump workflow stats (fire-and-forget)
    dynamodb.update({
      TableName: TABLE,
      Key:       { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${workflow.id}` },
      UpdateExpression: 'SET runCount = if_not_exists(runCount, :z) + :one, lastRunAt = :lra, updatedAt = :ua',
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
