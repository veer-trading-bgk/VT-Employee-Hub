/**
 * One-time migration: creates GSI 'leadsByCompany' on the DynamoDB metrics table.
 * Enables query-by-companyId instead of full table scan for CRM leads.
 *
 * Run once: node scripts/create-leads-gsi.js
 * After GSI status becomes ACTIVE in AWS console (5-30 min), update scanAllLeads()
 * in src/routes/crm.js to use IndexName: 'leadsByCompany' query instead of scan.
 */
require('dotenv').config();
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB({ region: process.env.AWS_REGION || 'ap-south-1' });
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

async function run() {
  if (!TABLE) { console.error('DYNAMODB_TABLE_METRICS env var required'); process.exit(1); }
  console.log(`Adding GSI 'leadsByCompany' to table: ${TABLE}`);
  try {
    await dynamodb.updateTable({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: 'companyId', AttributeType: 'S' },
        { AttributeName: 'updatedAt', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexUpdates: [{
        Create: {
          IndexName: 'leadsByCompany',
          KeySchema: [
            { AttributeName: 'companyId', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      }],
    }).promise();
    console.log('GSI creation started. Check AWS Console → DynamoDB → Table → Indexes for ACTIVE status.');
  } catch (e) {
    if (e.code === 'ValidationException' && e.message.includes('already exists')) {
      console.log('GSI already exists.');
    } else {
      console.error('Failed:', e.message);
      process.exit(1);
    }
  }
}

run();
