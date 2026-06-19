/**
 * One-time script to remove test data.
 * Keeps admin account, deletes all other employees, metrics, and audit logs.
 *
 * Run: node scripts/clear-test-data.js
 */

require('dotenv').config();
const AWS = require('aws-sdk');

const ddb = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const EMPLOYEES_TABLE  = process.env.DYNAMODB_TABLE_EMPLOYEES || 'employees';
const METRICS_TABLE    = process.env.DYNAMODB_TABLE_METRICS   || 'business_metrics';
const AUDIT_TABLE      = process.env.DYNAMODB_TABLE_AUDIT     || 'audit_logs';
const BADGES_TABLE     = process.env.DYNAMODB_TABLE_BADGES    || 'vt-badges';

const ADMIN_ID = 'emp_1781596612438'; // Viir — keep this account

// ── Helpers ──────────────────────────────────────────────────────────────────

// Reserved DynamoDB keywords that need aliasing in expressions
const RESERVED = ['role', 'name', 'status', 'date', 'value'];

async function scanAll(tableName, projectionKeys) {
  const items = [];
  let lastKey;

  // Build ExpressionAttributeNames for any reserved keywords
  const exprNames = {};
  const safeKeys = projectionKeys.map((k) => {
    if (RESERVED.includes(k)) {
      exprNames[`#${k}`] = k;
      return `#${k}`;
    }
    return k;
  });

  do {
    const params = {
      TableName: tableName,
      ProjectionExpression: safeKeys.join(', '),
    };
    if (Object.keys(exprNames).length > 0) params.ExpressionAttributeNames = exprNames;
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const res = await ddb.scan(params).promise();
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function batchDelete(tableName, keyObjects) {
  if (keyObjects.length === 0) return 0;
  const CHUNK = 25;
  let deleted = 0;
  for (let i = 0; i < keyObjects.length; i += CHUNK) {
    const chunk = keyObjects.slice(i, i + CHUNK);
    const requests = chunk.map((key) => ({ DeleteRequest: { Key: key } }));
    await ddb.batchWrite({ RequestItems: { [tableName]: requests } }).promise();
    deleted += chunk.length;
    process.stdout.write(`\r  ${tableName}: deleted ${deleted} / ${keyObjects.length}`);
  }
  console.log();
  return deleted;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== VT Test Data Cleanup ===\n');

  // 1. Delete test employee accounts (keep admin)
  console.log('1. Scanning employees...');
  const employees = await scanAll(EMPLOYEES_TABLE, ['id', 'email', 'role']);
  const toDeleteEmployees = employees.filter((e) => e.id !== ADMIN_ID);
  console.log(`   Found ${employees.length} total, deleting ${toDeleteEmployees.length} test accounts:`);
  toDeleteEmployees.forEach((e) => console.log(`   - ${e.email} (${e.role})`));
  const empKeys = toDeleteEmployees.map((e) => ({ id: e.id }));
  await batchDelete(EMPLOYEES_TABLE, empKeys);

  // 2. Clear all metrics
  console.log('2. Scanning business_metrics...');
  const metrics = await scanAll(METRICS_TABLE, ['PK', 'SK']);
  console.log(`   Found ${metrics.length} metric records`);
  const metricKeys = metrics.map((m) => ({ PK: m.PK, SK: m.SK }));
  await batchDelete(METRICS_TABLE, metricKeys);

  // 3. Clear all audit logs
  console.log('3. Scanning audit_logs...');
  const audits = await scanAll(AUDIT_TABLE, ['PK', 'SK']);
  console.log(`   Found ${audits.length} audit records`);
  const auditKeys = audits.map((a) => ({ PK: a.PK, SK: a.SK }));
  await batchDelete(AUDIT_TABLE, auditKeys);

  // 4. Clear badges (already empty but included for completeness)
  console.log('4. Scanning vt-badges...');
  const badges = await scanAll(BADGES_TABLE, ['PK', 'SK']);
  console.log(`   Found ${badges.length} badge records`);
  const badgeKeys = badges.map((b) => ({ PK: b.PK, SK: b.SK }));
  await batchDelete(BADGES_TABLE, badgeKeys);

  console.log('\n✅ Done. Kept:');
  console.log(`   Admin: Viir (viireshcshettar@gmail.com) — id: ${ADMIN_ID}`);
  console.log('\nYou can now re-create employees fresh via the admin panel.\n');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
