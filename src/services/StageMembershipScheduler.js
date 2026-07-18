'use strict';
// Sweeps every company's leads for "standing stage membership" drips —
// workflows whose trigger.type is stage_membership (config: { stage })
// that need to catch every lead currently sitting in a target stage, not
// just a one-time stage_changed transition. Invoked on every 5-minute
// EventBridge tick (src/handler.js) alongside runDueCampaigns()/
// runDueLeadScoring()/AutomationEngine.processAllDueWaits() — reuses the
// existing rule rather than a second one, same reasoning as those three.
//
// Audit (2026-07-18, "standing stage membership" drip scoping): no
// stage-scoped GSI or query path exists anywhere in this codebase — every
// stage-filtered lead lookup is a company-wide fetch-then-filter-in-memory
// or a genuine Scan. This sweep follows LeadScoringScheduler.js's shape
// exactly: table-wide, paginated Scan via ExclusiveStartKey, narrow
// ProjectionExpression including stage via the #st alias — same accepted
// interim tradeoff as ADR-014 (see LeadScoringScheduler.js's own TODO and
// docs/adr/ADR-014-campaign-scheduler-scan.md's migration trigger).
//
// Enrollment, not re-validation: once a lead is enrolled into a
// stage_membership workflow, the drip runs to completion via the engine's
// existing blind-continuation semantics — identical to every other trigger
// type (AutomationEngine.js's resumeExecution()/_runAction() never re-fetch
// a lead's live state except inside an explicit condition node). A lead who
// later leaves the target stage is NOT auto-unenrolled or guarded — that is
// a deliberate decision, not an oversight. A workflow author who wants
// exit-guarding can add a condition node themselves, exactly as with any
// other workflow.
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');
const AutomationEngine = require('./AutomationEngine');

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// The ENROLLED# marker carries NO TTL — deliberately unlike PENDINGFLOW#
// (src/routes/whatsapp.js), even though it copies that record's PK/SK shape.
// PENDINGFLOW# expiring is low-stakes (an uncorrelated reply just loses
// attribution); this marker expiring is not — this feature's whole purpose
// is catching leads who sit in a stage indefinitely (a long-lived/terminal
// stage like "KYC Done" is the common case, not an edge case), and a TTL'd
// marker would let DynamoDB silently delete it out from under a lead who
// never left the stage, causing the entire drip to re-fire and re-send from
// scratch — a real customer-facing repeat-spam bug caught by review before
// this shipped. "Enrolled" must mean "enrolled forever" for a given
// (lead, workflow) pair, exactly like the LEAD_PHONE#/PHONE# uniqueness
// locks in entityKeys.js are also permanent, not TTL'd.
//
// Bounds concurrent enrollment attempts per sweep. Each one can trigger a
// full workflow run (potentially a real WhatsApp send on the first node), so
// this stays conservative — closer to CampaignScheduler's BATCH_SIZE=5
// (which also fans out real sends) than LeadScoringScheduler's cheap-update
// BATCH_SIZE=25.
const BATCH_SIZE = 5;

function _chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Sweeps every company's leads for active stage_membership workflows and
 * enrolls any not-yet-enrolled lead currently sitting in that workflow's
 * configured target stage.
 */
async function runStageMembershipSweep() {
  const startTime = Date.now();

  // TODO(ADR-014-style interim tradeoff): this Scan finds leads across all
  // companies the same way LeadScoringScheduler.js's own Scan does — migrate
  // to a GSI-based Query when lead volume justifies it. Keep the
  // ProjectionExpression narrow — only what enrollment/context-building
  // needs, never full items.
  const items = [];
  let lastKey;
  do {
    const scan = await dynamodb.scan({
      TableName: TABLE,
      ProjectionExpression: 'PK, SK, companyId, phone, #nm, #st, tags, assignedTo, source',
      FilterExpression: 'begins_with(PK, :lead) AND SK = :meta',
      ExpressionAttributeNames: { '#st': 'stage', '#nm': 'name' },
      ExpressionAttributeValues: { ':lead': 'LEAD#', ':meta': 'METADATA' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(scan.Items ?? []));
    lastKey = scan.LastEvaluatedKey;
  } while (lastKey);

  const scannedCount = items.length;

  // One "which stage_membership workflows are active" fetch per company per
  // sweep, never once per lead — same promise-cache-the-in-flight-fetch
  // pattern LeadScoringScheduler.js's _stagesFor() uses, and for the same
  // reason: concurrent leads in the same company must all await the same
  // in-flight fetch rather than each firing their own redundant query.
  // Reuses AutomationEngine._findActiveWorkflows — the exact same lookup
  // automations.js's Era 48 duplicate-check and fireTrigger() already use as
  // the single source of truth for "active workflows of this trigger type,"
  // not a second implementation of that query. A company with zero active
  // stage_membership workflows costs one cheap Query (cached here) and
  // nothing further — no per-lead marker reads for a company that never
  // uses this feature.
  const workflowsByCompany = new Map();
  function _workflowsFor(companyId) {
    if (!workflowsByCompany.has(companyId)) {
      workflowsByCompany.set(companyId, AutomationEngine._findActiveWorkflows(companyId, 'stage_membership'));
    }
    return workflowsByCompany.get(companyId);
  }

  // Pair every scanned lead with each active stage_membership workflow whose
  // configured target stage matches the lead's current stage. A company can
  // run more than one stage_membership workflow (even targeting the same
  // stage) — each is enrolled independently, keyed by its own workflowId.
  const candidates = [];
  for (const lead of items) {
    if (!lead.companyId || !lead.stage) continue;
    // Same "log and skip, never let one bad read crash the whole sweep"
    // discipline LeadScoringScheduler.js's own per-company config read
    // (_leadScoringEnabledFor) already uses — a transient failure (DynamoDB
    // throttle, etc.) on ONE company's lookup must not discard every
    // candidate already found for companies processed earlier in this loop,
    // nor abort the sweep with zero logging (Promise.allSettled in
    // handler.js swallows an unhandled rejection here silently otherwise).
    // The rejected promise is cached same as a resolved one, so every lead
    // for this company this tick hits the same cached rejection — one log
    // line, not one per lead.
    let workflows;
    try {
      workflows = await _workflowsFor(lead.companyId);
    } catch (e) {
      logger.error(`stage membership: active-workflow lookup failed for company ${lead.companyId}: ${e.message}`);
      continue;
    }
    for (const wf of workflows) {
      const targetStage = wf.trigger?.config?.stage;
      if (targetStage && targetStage === lead.stage) candidates.push({ lead, workflow: wf });
    }
  }

  let enrolledCount = 0;
  let alreadyEnrolledCount = 0;
  let failedCount = 0;

  for (const batch of _chunk(candidates, BATCH_SIZE)) {
    await Promise.allSettled(batch.map(async ({ lead, workflow }) => {
      try {
        // Same optional AND-only trigger.conditions[] filter every other
        // trigger type respects (fireTrigger()/runWorkflowDirect()) — the
        // Conditions section of TriggerEditor renders for every trigger type
        // unconditionally (Stage/From Stage/To Stage/Source/Tags/Assigned
        // To), so a stage_membership workflow author can already add any of
        // those; ignoring the fields they map to would silently make such a
        // condition never match, permanently zero-enrolling the workflow
        // with no error anywhere (a real gap caught by review — fixed here
        // by populating every field _ctxField() can resolve, not just
        // `stage`). toStage is set equal to stage: AutomationEngine._ctxField
        // maps 'to_stage' -> ctx.toStage, and crm.js's own stage_changed
        // context already sets toStage === stage for the same reason (the
        // "stage the lead is now in" is exactly what "to_stage" means there
        // too). fromStage is deliberately left unset: a standing-membership
        // sweep finds a lead already sitting in a stage, not transitioning
        // into one, so there is no "from" to report — a From Stage condition
        // on a stage_membership trigger will therefore never match, which is
        // the intended behavior of choosing the wrong field for this trigger
        // type, not a data gap.
        const context = {
          leadId: lead.PK.split('#').pop(),
          leadPK: lead.PK,
          phone:  lead.phone,
          name:   lead.name,
          stage:  lead.stage,
          toStage: lead.stage,
          source: lead.source,
          tags:   lead.tags ?? [],
          assignedTo: lead.assignedTo,
        };
        // Checked BEFORE claiming the marker (not after) so a lead who
        // doesn't yet satisfy a condition (e.g. a tag not yet applied) is
        // simply re-evaluated on the next sweep instead of being
        // permanently excluded by an early claim.
        const conditions = workflow.trigger?.conditions ?? [];
        if (!AutomationEngine._evalConditions(conditions, context)) return;

        // Re-check the workflow's live status immediately before claiming —
        // closes the staleness window the per-sweep cached _findActiveWorkflows()
        // lookup (_workflowsFor above) otherwise leaves open for the sweep's
        // full duration (a full table-wide Scan plus every earlier batch's
        // real sends can span seconds to minutes). Mirrors the same guard
        // AutomationEngine.resumeExecution() already performs before resuming
        // a paused wait. Costs one extra point read per lead that reaches
        // this point (conditions already passed), not per candidate. Checked
        // BEFORE the claim (not after) so a workflow paused mid-sweep leaves
        // this lead unclaimed — eligible again on a later sweep if the
        // workflow is reactivated — rather than orphaning a claim against a
        // workflow that may never run it.
        if (!(await _isWorkflowStillActive(lead.companyId, workflow.id))) return;

        const claimed = await _claimEnrollment(lead.PK, workflow.id);
        if (!claimed) { alreadyEnrolledCount++; return; }

        // Direct-start, bypassing fireTrigger()'s trigger-type scan entirely
        // — same precedent as inbound_webhook's runWorkflowDirect()
        // (AutomationEngine.js) — this sweep already resolved exactly which
        // workflow to run, there is nothing left for fireTrigger to match.
        await AutomationEngine._startExecution(lead.companyId, workflow, context, 'stage_membership');
        enrolledCount++;
      } catch (e) {
        failedCount++;
        logger.error(`stage membership enrollment failed for ${lead.PK} / workflow ${workflow.id}: ${e.message}`);
      }
    }));
  }

  const executionTime = Date.now() - startTime;
  logger.info(
    `stage membership sweep: scannedCount=${scannedCount} candidateCount=${candidates.length} `
    + `enrolledCount=${enrolledCount} alreadyEnrolledCount=${alreadyEnrolledCount} failedCount=${failedCount} executionTime=${executionTime}ms`,
  );

  return { scannedCount, candidateCount: candidates.length, enrolledCount, alreadyEnrolledCount, failedCount, executionTime };
}

// Fresh, uncached read of one workflow's live status — deliberately NOT the
// cached _findActiveWorkflows() result from _workflowsFor() above, which can
// be stale by the time a given lead's turn to enroll comes up. A missing
// item (workflow deleted mid-sweep) is treated as inactive, same as a
// missing item anywhere else this shape is checked.
async function _isWorkflowStillActive(companyId, workflowId) {
  const { Item } = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#AUTO#${companyId}`, SK: `AUTO#${workflowId}` },
  }).promise();
  return !!Item && (Item.status === 'active' || (Item.status == null && Item.enabled === true));
}

// Conditional put acts as the enrollment claim — mirrors PENDINGFLOW#'s
// PK/SK shape exactly (src/routes/whatsapp.js's sendRegisteredFlow: PK = the
// lead's own PK, SK = a marker-prefixed id) but deliberately WITHOUT a TTL —
// see the ENROLLED# marker comment near the top of this file for why.
// attribute_not_exists(PK) makes this safe under concurrent sweeps (two
// overlapping EventBridge ticks) — only one invocation ever wins the claim
// for a given (lead, workflow) pair, so _startExecution below can never
// double-fire for the same enrollment. The claim is written BEFORE
// _startExecution runs (not after) — same claim-first, at-most-once
// philosophy every other claim mechanism in this codebase already uses
// (CampaignScheduler's launchCampaign() status transition,
// AutomationEngine._claimAndResume()'s conditional delete): if
// _startExecution itself throws, this lead will not be retried next sweep,
// exactly as a stage_changed trigger firing once is also not retried on
// failure.
async function _claimEnrollment(leadPK, workflowId) {
  try {
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: leadPK,
        SK: `ENROLLED#${workflowId}`,
        workflowId,
        enrolledAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }).promise();
    return true;
  } catch (e) {
    if (e.code === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

module.exports = { runStageMembershipSweep };
