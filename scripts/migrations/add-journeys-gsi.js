'use strict';

/**
 * Migration: Add JourneysByCompany GSI to DYNAMODB_TABLE_METRICS.
 *
 * Safe to run multiple times — checks existing GSIs before creating.
 * No existing data is modified. New GSIs backfill automatically in DynamoDB
 * (only items that already carry journeysByCompanyGsiPK + createdAt appear).
 *
 * Estimated backfill time: 1–15 minutes depending on table size.
 *
 * Key shape (Task 1 corrected — NOT bare companyId):
 *   PK attribute: journeysByCompanyGsiPK = JOURNEY#${companyId}
 *   SK attribute: createdAt (ISO string from newMeta())
 * Matches GSI.JOURNEYS_BY_COMPANY and Task 6's GET /api/journeys/instances Query.
 *
 * Deployment order:
 *   1. Deploy the open_web_journey GSI-stamp fix so NEW META writes carry the attrs
 *   2. Run this script against scratch/dev first; wait until ACTIVE
 *   3. Run against PRODUCTION; wait until ACTIVE (~5–15 min)
 *   4. Only then rely on GET /api/journeys/instances in a live env
 *
 * Do NOT run this script from the agent / CI deploy path — operator-driven only.
 *
 * Usage:
 *   DYNAMODB_TABLE_METRICS=<table> AWS_REGION=<region> node scripts/migrations/add-journeys-gsi.js
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
    name:        'JourneysByCompany',
    description: 'List journey instances per company sorted by createdAt (newest-first)',
    hashKey:     { AttributeName: 'journeysByCompanyGsiPK', AttributeType: 'S' },
    rangeKey:    { AttributeName: 'createdAt',              AttributeType: 'S' },
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
  console.log(`\nMigration: add-journeys-gsi`);
  console.log(`Table   : ${TABLE_NAME}`);
  console.log(`Region  : ${REGION}\n`);

  const table       = await describeTable();
  const existingGsi = gsiNames(table);
  console.log(`Existing GSIs: ${[...existingGsi].join(', ') || '(none)'}\n`);

  // DynamoDB allows only one GSI per UpdateTable call.
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
    console.log('  JourneysByCompany — JOURNEY#${companyId}-scoped listing by createdAt');
    console.log('  (attribute journeysByCompanyGsiPK | SK createdAt)');
    console.log('\nGET /api/journeys/instances is safe to use once this GSI is ACTIVE');
    console.log('and open_web_journey stamps journeysByCompanyGsiPK on new META writes.\n');
  }
}

main().catch(err => {
  console.error('\nMigration FAILED:', err.message);
  process.exit(1);
});
