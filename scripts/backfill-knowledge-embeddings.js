/**
 * Backfill script: compute and store embeddings for published Knowledge
 * Center entries that don't have one yet (RAG PR A, ADR-017).
 *
 * Runs once at deploy time so entries published before this PR aren't stuck
 * on keyword-only matching indefinitely — KnowledgeService.getMatchingEntries
 * already falls back to keyword matching for any entry missing
 * activeEmbedding, so this is a catch-up pass, not a blocking migration.
 *
 * Scans every company's KNOWLEDGE#{companyId} partition, finds ENTRY# items
 * with activeVersion > 0 (published) and no activeEmbedding, computes one via
 * EmbeddingService, and writes it back.
 *
 * Usage (from project root):
 *   node scripts/backfill-knowledge-embeddings.js [--dry-run]
 *
 * Requires local AWS credentials with access to DynamoDB, and VOYAGE_API_KEY
 * set (via .env or the environment) to actually compute embeddings.
 */

require('dotenv').config();
const AWS = require('aws-sdk');
const path = require('path');
const EmbeddingService = require(path.join(process.cwd(), 'src/services/EmbeddingService'));

const DRY_RUN = process.argv.includes('--dry-run');
const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const DELAY_MS = 300; // pause between embedding calls to avoid rate limiting

AWS.config.update({ region: REGION });
const db = new AWS.DynamoDB.DocumentClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every company's KNOWLEDGE# entries live under a distinct partition key
// (companyId is part of PK, never discoverable via a single Query) — a
// full-table Scan filtered to that PK prefix is the only way to find every
// company's entries in one pass, same approach backfill-phone-norm.js and
// backfill-media-s3.js already use for the same reason.
async function scanUnembeddedEntries() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await db.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND begins_with(SK, :entryPrefix) AND activeVersion > :zero AND attribute_not_exists(activeEmbedding)',
      ExpressionAttributeValues: { ':prefix': 'KNOWLEDGE#', ':entryPrefix': 'ENTRY#', ':zero': 0 },
      ExclusiveStartKey,
    }).promise();
    items.push(...result.Items);
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  console.log(`Backfill: knowledge entry embeddings ${DRY_RUN ? '(DRY RUN)' : ''}`);
  const entries = await scanUnembeddedEntries();
  console.log(`Found ${entries.length} published entries missing activeEmbedding.`);

  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    const text = `${entry.activeQuestion}\n${entry.activeAnswer}`;
    console.log(`- ${entry.companyId} / ${entry.entryId}: "${entry.activeQuestion}"`);

    if (DRY_RUN) { continue; }

    const result = await EmbeddingService.embed({ texts: [text], companyId: entry.companyId, inputType: 'document' });
    if (!result.ok) {
      console.error(`  FAILED: ${JSON.stringify(result.reason)}`);
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    await db.update({
      TableName: TABLE,
      Key: { PK: entry.PK, SK: entry.SK },
      UpdateExpression: 'SET activeEmbedding = :em',
      ExpressionAttributeValues: { ':em': result.data.embeddings[0] },
    }).promise();
    succeeded++;
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${DRY_RUN ? 'Would embed' : 'Embedded'}: ${DRY_RUN ? entries.length : succeeded}${DRY_RUN ? '' : `, failed: ${failed}`}`);
}

main().catch((e) => { console.error('BACKFILL ERROR:', e); process.exit(1); });
