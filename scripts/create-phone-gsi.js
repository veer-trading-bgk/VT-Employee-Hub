/**
 * One-time migration: creates GSI 'company-phone-index' on the DynamoDB metrics table.
 * Enables O(1) lead lookup by (companyId, phoneNorm) in the webhook hot path,
 * replacing the full-table Scan that searched by phone across all leads.
 *
 * Deploy order:
 *   1. node scripts/create-phone-gsi.js          — start GSI build
 *   2. Wait until GSI status is ACTIVE (5-30 min, check with node scripts/check-gsi.js)
 *   3. node scripts/backfill-phone-norm.js        — add phoneNorm to existing leads
 *   4. git push origin main                       — deploy code that uses the GSI
 *
 * Run once: node scripts/create-phone-gsi.js
 */
require('dotenv').config();
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB({ region: process.env.AWS_REGION || 'ap-south-1' });
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

async function run() {
  if (!TABLE) { console.error('DYNAMODB_TABLE_METRICS env var required'); process.exit(1); }
  console.log(`Adding GSI 'company-phone-index' to table: ${TABLE}`);
  try {
    await dynamodb.updateTable({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: 'companyId', AttributeType: 'S' },
        { AttributeName: 'phoneNorm', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [{
        Create: {
          IndexName: 'company-phone-index',
          KeySchema: [
            { AttributeName: 'companyId', KeyType: 'HASH' },
            { AttributeName: 'phoneNorm', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      }],
    }).promise();
    console.log('GSI creation started. Monitor with: node scripts/check-gsi.js');
    console.log('Once ACTIVE, run: node scripts/backfill-phone-norm.js');
  } catch (e) {
    if (e.code === 'ValidationException' && e.message.includes('already exists')) {
      console.log('GSI already exists — skip to backfill.');
    } else {
      console.error('Failed:', e.message);
      process.exit(1);
    }
  }
}

run();
