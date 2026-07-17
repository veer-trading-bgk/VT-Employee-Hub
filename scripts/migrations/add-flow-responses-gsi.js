'use strict';

/**
 * Migration: Add FlowResponsesByCompany GSI to DYNAMODB_TABLE_METRICS.
 *
 * Safe to run multiple times — checks existing GSIs before creating.
 * No existing data is modified. New GSIs backfill automatically in DynamoDB.
 *
 * Sparse index: only MSG# flow_response items that got a flowRespCompanyPK
 * stamped by the nfm_reply correlation path (whatsapp.js webhook handler)
 * appear in it. Items written before the stamping code shipped never had the
 * attribute and are expected to be absent — consistent with the documented
 * flowId-correlation limitation (correlation only exists from ship date on).
 *
 * Key shape:
 *   hash  flowRespCompanyPK = FLOWRESP#{companyId}#{flowId}
 *   range timestamp         = ISO-8601 message timestamp (already a top-level
 *                             attribute on every MSG# item)
 * Embedding flowId in the hash value makes "all responses for Flow X" a
 * direct GSI query instead of a company-wide fetch-then-filter.
 *
 * Deployment order (relative to code commits):
 *   Order-independent with the stamping commit — the attribute write is
 *   harmless before the GSI exists, and GSI creation backfills any items
 *   already carrying the attribute. Run whenever convenient around deploy.
 *
 * Usage:
 *   DYNAMODB_TABLE_METRICS=<table> AWS_REGION=<region> node scripts/migrations/add-flow-responses-gsi.js
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
    name:        'FlowResponsesByCompany',
    description: 'List Flow responses per company+flowId sorted by timestamp',
    hashKey:     { AttributeName: 'flowRespCompanyPK', AttributeType: 'S' },
    rangeKey:    { AttributeName: 'timestamp',         AttributeType: 'S' },
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
  console.log(`\nMigration: add-flow-responses-gsi`);
  console.log(`Table   : ${TABLE_NAME}`);
  console.log(`Region  : ${REGION}\n`);

  const table       = await describeTable();
  const existingGsi = gsiNames(table);
  console.log(`Existing GSIs: ${[...existingGsi].join(', ') || '(none)'}\n`);

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
    console.log('  FlowResponsesByCompany — FLOWRESP#{companyId}#{flowId}-scoped listing by timestamp');
  }
}

main().catch(err => {
  console.error('\nMigration FAILED:', err.message);
  process.exit(1);
});
