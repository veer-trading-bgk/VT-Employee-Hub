#!/usr/bin/env node
'use strict';

/**
 * Migration: Add Contact GSIs to the METRICS DynamoDB table.
 *
 * RUN THIS ONCE before deploying Commit 8 (Contact API routes).
 * The script is idempotent — safe to run multiple times.
 *
 * Required env vars:
 *   DYNAMODB_TABLE_METRICS   — e.g. vt-metrics-prod
 *   AWS_REGION               — e.g. ap-south-1
 *
 * For production, also set:
 *   AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY   (if not using instance role)
 *
 * Usage:
 *   node scripts/migrations/add-contact-gsi.js
 *
 * ─── GSIs being added ─────────────────────────────────────────────────────────
 *
 * 1. ContactPhoneIndex
 *    Purpose:    Find a contact by phone number within a company (dedup + lookup)
 *    PK:         phoneE164    (E.164 string, e.g. "+919876543210")
 *    SK:         companyId    (string)
 *    Projection: ALL          (avoids follow-up GetItem for contact list/display)
 *    Used by:    ContactRepository.queryByPhone()
 *
 * 2. ContactsByCompany
 *    Purpose:    List all contacts for a company, sorted newest-first
 *    PK:         contactCompanyPK  (string, value = "CONTACT#${companyId}")
 *    SK:         createdAt         (ISO 8601 string, lexicographically sortable)
 *    Projection: ALL
 *    Used by:    ContactRepository.queryByCompany()
 *
 * ─── Billing note ─────────────────────────────────────────────────────────────
 * Adding GSIs triggers a table backfill. Only existing items that have the GSI
 * key attributes will be indexed. Since CONTACT# items are new (written after
 * this migration), the initial backfill cost is near-zero.
 *
 * The table remains ACTIVE during GSI creation — existing operations are not
 * interrupted. GSI status transitions: CREATING → BACKFILLING → ACTIVE.
 * This typically takes 1–10 minutes.
 */

require('dotenv').config();
const AWS = require('aws-sdk');

const TABLE   = process.env.DYNAMODB_TABLE_METRICS;
const REGION  = process.env.AWS_REGION || 'ap-south-1';
const DDB_GSI = new AWS.DynamoDB({ region: REGION });

const NEW_GSIS = [
  {
    name: 'ContactPhoneIndex',
    pk:   'phoneE164',
    sk:   'companyId',
  },
  {
    name: 'ContactsByCompany',
    pk:   'contactCompanyPK',
    sk:   'createdAt',
  },
];

async function describeTable() {
  const result = await DDB_GSI.describeTable({ TableName: TABLE }).promise();
  return result.Table;
}

async function existingGsiNames(tableDesc) {
  return new Set((tableDesc.GlobalSecondaryIndexes ?? []).map((g) => g.IndexName));
}

function buildGsiCreate(gsi) {
  return {
    Create: {
      IndexName: gsi.name,
      KeySchema: [
        { AttributeName: gsi.pk, KeyType: 'HASH' },
        { AttributeName: gsi.sk, KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
      // BillingMode is inherited from the table (PAY_PER_REQUEST or PROVISIONED).
      // If PROVISIONED, set ProvisionedThroughput here:
      // ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
  };
}

function buildAttributeDefinition(name) {
  return { AttributeName: name, AttributeType: 'S' };
}

async function waitForActive(gsiName, maxWaitMs = 600_000, pollMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const desc = await describeTable();
    const gsi  = (desc.GlobalSecondaryIndexes ?? []).find((g) => g.IndexName === gsiName);
    if (!gsi) {
      console.log(`  [${gsiName}] not found in table — still being registered...`);
    } else {
      console.log(`  [${gsiName}] status: ${gsi.IndexStatus}`);
      if (gsi.IndexStatus === 'ACTIVE') return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for GSI ${gsiName} to become ACTIVE`);
}

async function main() {
  if (!TABLE) {
    console.error('ERROR: DYNAMODB_TABLE_METRICS env var is not set.');
    process.exit(1);
  }

  console.log(`Table:  ${TABLE}`);
  console.log(`Region: ${REGION}`);
  console.log('');

  const tableDesc = await describeTable();
  const existing  = await existingGsiNames(tableDesc);

  console.log('Existing GSIs:', [...existing].join(', ') || '(none)');

  const toCreate = NEW_GSIS.filter((g) => !existing.has(g.name));

  if (toCreate.length === 0) {
    console.log('\nAll required GSIs already exist — nothing to do.');
    return;
  }

  // Collect new attribute definitions needed (avoid duplicates with existing ones)
  const existingAttrs = new Set(
    (tableDesc.AttributeDefinitions ?? []).map((a) => a.AttributeName)
  );
  const newAttrs = [];
  for (const gsi of toCreate) {
    if (!existingAttrs.has(gsi.pk)) { newAttrs.push(buildAttributeDefinition(gsi.pk)); existingAttrs.add(gsi.pk); }
    if (!existingAttrs.has(gsi.sk)) { newAttrs.push(buildAttributeDefinition(gsi.sk)); existingAttrs.add(gsi.sk); }
  }

  // DynamoDB only allows one GSI creation per UpdateTable call.
  // We loop and create them one at a time, waiting for ACTIVE between each.
  for (const gsi of toCreate) {
    const gsiAttrs = [];
    if (!existingAttrs.has(gsi.pk) || newAttrs.some((a) => a.AttributeName === gsi.pk)) {
      gsiAttrs.push(buildAttributeDefinition(gsi.pk));
    }
    if (!existingAttrs.has(gsi.sk) || newAttrs.some((a) => a.AttributeName === gsi.sk)) {
      gsiAttrs.push(buildAttributeDefinition(gsi.sk));
    }

    // Deduplicate — DynamoDB errors if you re-define an existing attribute
    const existingAttrNames = new Set(
      (await describeTable()).AttributeDefinitions.map((a) => a.AttributeName)
    );
    const attrDefs = [
      ...(await describeTable()).AttributeDefinitions,
      ...gsiAttrs.filter((a) => !existingAttrNames.has(a.AttributeName)),
    ];

    console.log(`\nCreating GSI: ${gsi.name}`);
    await DDB_GSI.updateTable({
      TableName:                   TABLE,
      AttributeDefinitions:        attrDefs,
      GlobalSecondaryIndexUpdates: [buildGsiCreate(gsi)],
    }).promise();

    console.log(`  Waiting for ${gsi.name} to become ACTIVE (this may take 1–10 minutes)...`);
    await waitForActive(gsi.name);
    console.log(`  ${gsi.name} is ACTIVE ✓`);
  }

  console.log('\nMigration complete. All Contact GSIs are ACTIVE.');
  console.log('You may now deploy Commit 8 (Contact API routes).');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
