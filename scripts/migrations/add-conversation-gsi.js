'use strict';

/**
 * Migration: Add ConvByCompany and ConvByContact GSIs to DYNAMODB_TABLE_METRICS.
 *
 * Safe to run multiple times — checks existing GSIs before creating.
 * No existing data is modified. New GSIs backfill automatically in DynamoDB.
 *
 * Estimated backfill time: 1–15 minutes depending on table size.
 *
 * Deployment order (relative to code commits):
 *   1. Deploy Commit 4 code (ConversationRepository + ConversationService) — adds no API routes yet
 *   2. Run this migration script in PRODUCTION
 *   3. Wait for GSIs to reach ACTIVE status (~5–15 min)
 *   4. Proceed to Commit 7 (conversationResolver) which starts writing CONV# items
 *
 * Usage:
 *   DYNAMODB_TABLE_METRICS=<table> AWS_REGION=<region> node scripts/migrations/add-conversation-gsi.js
 */

const AWS = require('aws-sdk');

const REGION     = process.env.AWS_REGION || 'ap-south-1';
const TABLE_NAME = process.env.DYNAMODB_TABLE_METRICS;

if (!TABLE_NAME) {
  console.error('ERROR: DYNAMODB_TABLE_METRICS env var is required.');
  process.exit(1);
}

const client = new AWS.DynamoDB({ region: REGION });

// ─── GSI definitions ─────────────────────────────────────────────────────────

const GSIDEFS = [
  {
    name:        'ConvByCompany',
    description: 'List conversations per company sorted by lastActivityAt (newest-first)',
    hashKey:     { AttributeName: 'convCompanyPK',  AttributeType: 'S' },
    rangeKey:    { AttributeName: 'lastActivityAt', AttributeType: 'S' },
    projection:  { ProjectionType: 'ALL' },
  },
  {
    name:        'ConvByContact',
    description: 'List conversations per contact sorted by lastActivityAt (newest-first)',
    hashKey:     { AttributeName: 'convContactPK',  AttributeType: 'S' },
    rangeKey:    { AttributeName: 'lastActivityAt', AttributeType: 'S' },
    projection:  { ProjectionType: 'ALL' },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function describeTable() {
  const result = await client.describeTable({ TableName: TABLE_NAME }).promise();
  return result.Table;
}

function gsiNames(table) {
  return new Set((table.GlobalSecondaryIndexes || []).map(g => g.IndexName));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForGsi(indexName, maxWaitMs = 10 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const table   = await describeTable();
    const gsi     = (table.GlobalSecondaryIndexes || []).find(g => g.IndexName === indexName);
    const status  = gsi ? gsi.IndexStatus : 'NOT_FOUND';
    console.log(`  ${indexName}: ${status}`);
    if (status === 'ACTIVE') return;
    if (status === 'NOT_FOUND') throw new Error(`GSI ${indexName} disappeared during wait`);
    await sleep(15_000); // poll every 15 seconds
  }
  throw new Error(`Timed out waiting for GSI ${indexName} to become ACTIVE`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nMigration: add-conversation-gsi`);
  console.log(`Table   : ${TABLE_NAME}`);
  console.log(`Region  : ${REGION}\n`);

  const table       = await describeTable();
  const existingGsi = gsiNames(table);
  console.log(`Existing GSIs: ${[...existingGsi].join(', ') || '(none)'}\n`);

  // Determine which new GSI attribute definitions are needed
  const existingAttrNames = new Set(table.AttributeDefinitions.map(a => a.AttributeName));
  const allNewAttrs       = GSIDEFS.flatMap(g => [g.hashKey, g.rangeKey]);
  const newAttrs          = allNewAttrs.filter(a => !existingAttrNames.has(a.AttributeName));

  // DynamoDB allows only one GSI per UpdateTable call.
  // We iterate and issue separate calls for each missing GSI.
  let anyCreated = false;
  for (const def of GSIDEFS) {
    if (existingGsi.has(def.name)) {
      console.log(`  [SKIP] ${def.name} — already exists`);
      continue;
    }

    console.log(`  [CREATE] ${def.name} — ${def.description}`);

    const isOnDemand = table.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST';

    const createSpec = {
      IndexName:  def.name,
      KeySchema:  [
        { AttributeName: def.hashKey.AttributeName,  KeyType: 'HASH'  },
        { AttributeName: def.rangeKey.AttributeName, KeyType: 'RANGE' },
      ],
      Projection: def.projection,
    };
    if (!isOnDemand) {
      createSpec.ProvisionedThroughput = { ReadCapacityUnits: 5, WriteCapacityUnits: 5 };
    }

    // Always declare both key attributes in every UpdateTable call —
    // DynamoDB requires all GSI key attributes in the same request.
    await client.updateTable({
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        { AttributeName: def.hashKey.AttributeName,  AttributeType: def.hashKey.AttributeType  },
        { AttributeName: def.rangeKey.AttributeName, AttributeType: def.rangeKey.AttributeType },
      ],
      GlobalSecondaryIndexUpdates: [{ Create: createSpec }],
    }).promise();
    anyCreated = true;

    console.log(`  Waiting for ${def.name} to become ACTIVE...`);
    await waitForGsi(def.name);
    console.log(`  ${def.name} is ACTIVE.\n`);
  }

  if (!anyCreated) {
    console.log('All GSIs already present. Nothing to do.\n');
  } else {
    console.log('Migration complete.\n');
    console.log('Summary:');
    console.log('  ConvByCompany  — companyId-scoped listing by lastActivityAt (newest-first)');
    console.log('  ConvByContact  — per-contact conversation listing by lastActivityAt');
    console.log('\nDeploy Commit 7 (conversationResolver) when both GSIs are ACTIVE.\n');
  }
}

main().catch(err => {
  console.error('\nMigration FAILED:', err.message);
  process.exit(1);
});
