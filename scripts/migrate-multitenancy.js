/**
 * Migration: stamp all existing employees + metrics with companyId = 'viir_trading'
 * and create the Viir Trading company profile record.
 *
 * Run ONCE before deploying the multi-tenancy code:
 *   node scripts/migrate-multitenancy.js
 *
 * Safe to re-run: uses UpdateExpression with if_not_exists so existing companyId
 * values are never overwritten.
 */

'use strict';

require('dotenv').config();
const AWS = require('aws-sdk');

const TABLE_EMPLOYEES = process.env.DYNAMODB_TABLE_EMPLOYEES;
const TABLE_METRICS   = process.env.DYNAMODB_TABLE_METRICS;

if (!TABLE_EMPLOYEES || !TABLE_METRICS) {
  console.error('ERROR: DYNAMODB_TABLE_EMPLOYEES and DYNAMODB_TABLE_METRICS must be set in .env');
  process.exit(1);
}

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const COMPANY_ID   = 'viir_trading';
const COMPANY_NAME = 'Viir Trading';
const BROKER       = 'Angel One';
const CITY         = 'India';

async function scanAll(tableName, params = {}) {
  const items = [];
  let lastKey;
  do {
    const result = await dynamodb.scan({
      TableName: tableName,
      ...params,
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function main() {
  console.log(`\n=== APForce Multi-Tenancy Migration ===`);
  console.log(`Target tables: ${TABLE_EMPLOYEES}, ${TABLE_METRICS}`);
  console.log(`Company ID: ${COMPANY_ID}\n`);

  // ── 1. Create / upsert the company profile record ──────────────────────────

  console.log('Step 1: Creating company profile record...');
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await dynamodb.put({
    TableName: TABLE_EMPLOYEES,
    Item: {
      id: `COMPANY#${COMPANY_ID}`,
      type: 'COMPANY_PROFILE',
      companyId: COMPANY_ID,
      companyName: COMPANY_NAME,
      broker: BROKER,
      city: CITY,
      plan: 'trial',
      trialEndsAt,
      planStatus: 'active',
      createdAt: new Date().toISOString(),
      migratedAt: new Date().toISOString(),
    },
    // Overwrite if exists (idempotent re-run)
  }).promise();
  console.log(`  ✓ Company profile created: COMPANY#${COMPANY_ID}`);

  // ── 2. Stamp all employees that lack a companyId ───────────────────────────

  console.log('\nStep 2: Stamping employees with companyId...');
  const employees = await scanAll(TABLE_EMPLOYEES, {
    FilterExpression: 'attribute_not_exists(companyId) AND attribute_not_exists(#type)',
    ExpressionAttributeNames: { '#type': 'type' },
    ProjectionExpression: 'id',
  });

  console.log(`  Found ${employees.length} employees without companyId`);

  let empUpdated = 0;
  for (const emp of employees) {
    await dynamodb.update({
      TableName: TABLE_EMPLOYEES,
      Key: { id: emp.id },
      UpdateExpression: 'SET companyId = if_not_exists(companyId, :cid)',
      ExpressionAttributeValues: { ':cid': COMPANY_ID },
    }).promise();
    empUpdated++;
    if (empUpdated % 10 === 0) process.stdout.write(`  ${empUpdated}/${employees.length}...\r`);
  }
  console.log(`  ✓ Stamped ${empUpdated} employees`);

  // ── 3. Stamp all metric records that lack a companyId ─────────────────────

  console.log('\nStep 3: Stamping metrics with companyId...');
  const metrics = await scanAll(TABLE_METRICS, {
    FilterExpression: 'attribute_not_exists(companyId) AND attribute_exists(metric_type)',
    ProjectionExpression: 'PK, SK',
  });

  console.log(`  Found ${metrics.length} metric records without companyId`);

  let metricUpdated = 0;
  // Process in batches of 25 (DynamoDB write limit) — but updates not batch writable, so parallel limit
  const CONCURRENCY = 10;
  for (let i = 0; i < metrics.length; i += CONCURRENCY) {
    const chunk = metrics.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map((m) =>
        dynamodb.update({
          TableName: TABLE_METRICS,
          Key: { PK: m.PK, SK: m.SK },
          UpdateExpression: 'SET companyId = if_not_exists(companyId, :cid)',
          ExpressionAttributeValues: { ':cid': COMPANY_ID },
        }).promise()
      )
    );
    metricUpdated += chunk.length;
    process.stdout.write(`  ${metricUpdated}/${metrics.length} metrics...\r`);
  }
  console.log(`  ✓ Stamped ${metricUpdated} metric records`);

  // ── 4. Migrate CONFIG#TARGETS to company-scoped key ───────────────────────

  console.log('\nStep 4: Migrating targets config to company-scoped key...');
  const oldTargets = await dynamodb.get({
    TableName: TABLE_METRICS,
    Key: { PK: 'CONFIG#TARGETS', SK: 'current' },
  }).promise();

  if (oldTargets.Item && oldTargets.Item.targets) {
    await dynamodb.put({
      TableName: TABLE_METRICS,
      Item: {
        ...oldTargets.Item,
        PK: `CONFIG#TARGETS#${COMPANY_ID}`,
        migratedAt: new Date().toISOString(),
      },
    }).promise();
    console.log(`  ✓ Targets copied to CONFIG#TARGETS#${COMPANY_ID}`);
  } else {
    console.log('  ✓ No custom targets found — defaults will be used');
  }

  console.log('\n=== Migration complete! ===');
  console.log(`Company ID: ${COMPANY_ID}`);
  console.log(`Employees stamped: ${empUpdated}`);
  console.log(`Metrics stamped: ${metricUpdated}`);
  console.log(`Trial ends: ${trialEndsAt.slice(0, 10)}\n`);
}

main().catch((err) => {
  console.error('\nMigration FAILED:', err);
  process.exit(1);
});
