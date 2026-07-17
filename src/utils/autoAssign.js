const dynamodb = require('../config/dynamodb');
const { isClosedLead } = require('../services/LeadScoringService');
const PipelineService = require('../services/PipelineService');

const METRICS_TABLE   = process.env.DYNAMODB_TABLE_METRICS;
const EMP_TABLE       = process.env.DYNAMODB_TABLE_EMPLOYEES;
const PERFORMER_ROLES = ['telecaller', 'agent', 'intern'];

async function getAutoAssignConfig(companyId) {
  try {
    const r = await dynamodb.get({
      TableName: METRICS_TABLE,
      Key: { PK: `CONFIG#AUTOASSIGN#${companyId}`, SK: 'current' },
    }).promise();
    return r.Item ?? { enabled: false };
  } catch {
    return { enabled: false };
  }
}

async function pickNextEmployee(companyId, source, cfg) {
  const capacity = cfg?.capacity ?? 5;
  const overflow = cfg?.overflow ?? 'assign';
  const pool     = cfg?.pools?.[source] ?? [];

  // 1. Fetch all active performers for this company
  const empResult = await dynamodb.scan({
    TableName: EMP_TABLE,
    FilterExpression: '#r IN (:r1, :r2, :r3) AND #s <> :inactive AND companyId = :cid',
    ExpressionAttributeNames: { '#r': 'role', '#s': 'status' },
    ExpressionAttributeValues: {
      ':r1': PERFORMER_ROLES[0], ':r2': PERFORMER_ROLES[1], ':r3': PERFORMER_ROLES[2],
      ':inactive': 'inactive',
      ':cid': companyId,
    },
  }).promise();

  let employees = empResult.Items ?? [];
  if (!employees.length) return null;

  // 2. Filter out employees opted out of auto-assign
  employees = employees.filter(e => e.autoAssignEnabled !== false);

  // 3. Filter by source pool if configured (empty pool = all employees)
  if (pool.length > 0) {
    const poolSet = new Set(pool);
    employees = employees.filter(e => poolSet.has(e.id));
  }

  if (!employees.length) return null;

  // 4. Count open leads per employee
  const empIds = new Set(employees.map(e => e.id));
  const counts = Object.fromEntries(employees.map(e => [e.id, 0]));

  // isClosedLead() is now flag-based (Stage 3, 2026-07-17 360° audit) — needs
  // this company's pipeline to look up isWon/isLost. One fetch, reused across
  // every scanned lead below (same "once per company, not once per lead"
  // shape as LeadScoringScheduler's own _stagesFor).
  const stages = await PipelineService.getPipelineStages(companyId);

  let lk;
  do {
    const r = await dynamodb.scan({
      TableName: METRICS_TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta AND attribute_exists(assignedTo)',
      ExpressionAttributeValues: { ':prefix': `LEAD#${companyId}#`, ':meta': 'METADATA' },
      ProjectionExpression: 'assignedTo, stage',
      ...(lk && { ExclusiveStartKey: lk }),
    }).promise();
    (r.Items ?? []).forEach(lead => {
      // Reconciled 2026-07-06 (Era 22): this used to check its own local
      // CLOSED_STAGES = ['converted','churned'], while LeadScoringService.
      // isClosedLead() checked stage==='lost'||wonAt — two different, silently
      // disagreeing conventions for the same concept. isClosedLead() is now
      // the one canonical definition, used here too — and (Stage 3,
      // 2026-07-17) flag-based against this company's real pipeline rather
      // than a hardcoded key/wonAt check.
      if (empIds.has(lead.assignedTo) && !isClosedLead(lead, stages)) {
        counts[lead.assignedTo]++;
      }
    });
    lk = r.LastEvaluatedKey;
  } while (lk);

  // 5. Sort weighted least-loaded: rank by openLeads / weight so higher-weight employees
  //    receive proportionally more leads before being considered "full"
  const sorted = [...employees].sort((a, b) => {
    const wa = a.autoAssignWeight ?? 1;
    const wb = b.autoAssignWeight ?? 1;
    return (counts[a.id] / wa) - (counts[b.id] / wb);
  });

  const best = sorted[0];
  if (!best) return null;

  // 6. Overflow: if hard-cap mode and best candidate is already at/over capacity, return null
  if (overflow === 'unassigned' && counts[best.id] >= capacity) return null;

  return best;
}

module.exports = { getAutoAssignConfig, pickNextEmployee };
