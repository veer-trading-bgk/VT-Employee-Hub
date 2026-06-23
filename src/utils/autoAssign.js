/**
 * Auto-assign a CRM lead to the least-loaded active performer.
 *
 * Rule: each employee can hold up to CAPACITY open leads.
 * "Open" means stage is not converted or churned.
 * The employee with the fewest open leads who is still under capacity is
 * picked first. If everyone is at capacity, the absolute least-loaded is used
 * (no hard block — just a soft target).
 */

const dynamodb = require('../config/dynamodb');

const METRICS_TABLE = process.env.DYNAMODB_TABLE_METRICS;
const EMP_TABLE     = process.env.DYNAMODB_TABLE_EMPLOYEES;

const CAPACITY       = 5;
const CLOSED_STAGES  = new Set(['converted', 'churned']);
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

async function pickNextEmployee(companyId) {
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

  const employees = empResult.Items ?? [];
  if (!employees.length) return null;

  // 2. Count open leads per employee (exclude converted/churned)
  const empIds = new Set(employees.map(e => e.id));
  const counts = Object.fromEntries(employees.map(e => [e.id, 0]));

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
      if (empIds.has(lead.assignedTo) && !CLOSED_STAGES.has(lead.stage)) {
        counts[lead.assignedTo]++;
      }
    });
    lk = r.LastEvaluatedKey;
  } while (lk);

  // 3. Sort: under-capacity first, then fewest leads
  const sorted = [...employees].sort((a, b) => {
    const ca = counts[a.id];
    const cb = counts[b.id];
    if ((ca < CAPACITY) !== (cb < CAPACITY)) return ca < CAPACITY ? -1 : 1;
    return ca - cb;
  });

  return sorted[0] ?? null;
}

module.exports = { getAutoAssignConfig, pickNextEmployee, CAPACITY };
