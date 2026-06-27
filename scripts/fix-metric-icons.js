/**
 * One-time fix: remove `icon` from any metric config override that was saved
 * before the backend metricsConfig.js had icon fields (they defaulted to '📊').
 * Preserves all other overrides (label, target, color, etc.).
 */
const AWS = require('aws-sdk');
const path = require('path');

// Load env from lambda-env.json
const env = require('./lambda-env.json');
Object.assign(process.env, env.Variables || env);

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const TABLE = process.env.DYNAMODB_TABLE_METRICS;

// Correct icons matching dashboard/src/lib/metrics.config.ts
const CORRECT_ICONS = {
  kyc:        '📞',
  demat:      '🏦',
  mf:         '📈',
  insurance:  '🛡️',
  algo:       '🤖',
  coaching:   '🎓',
  pms:        '💼',
  pro_insight:'💡',
  ltpp:       '📋',
};

async function run() {
  // Scan for all CONFIG#METRICS# records
  const result = await dynamodb.scan({
    TableName: TABLE,
    FilterExpression: 'begins_with(PK, :pk)',
    ExpressionAttributeValues: { ':pk': 'CONFIG#METRICS#' },
  }).promise();

  if (!result.Items?.length) {
    console.log('No metric config records found.');
    return;
  }

  for (const item of result.Items) {
    console.log(`\nProcessing ${item.PK}`);
    const overrides = item.overrides || {};
    let changed = false;

    for (const [key, ov] of Object.entries(overrides)) {
      const correctIcon = CORRECT_ICONS[key];
      if (ov.icon && correctIcon && ov.icon !== correctIcon) {
        console.log(`  ${key}: removing bad icon "${ov.icon}" (correct: "${correctIcon}")`);
        delete ov.icon;
        changed = true;
      } else if (ov.icon && correctIcon) {
        console.log(`  ${key}: icon already correct ("${ov.icon}")`);
      }
    }

    if (changed) {
      await dynamodb.put({
        TableName: TABLE,
        Item: { ...item, overrides, updatedAt: new Date().toISOString() },
      }).promise();
      console.log(`  Saved.`);
    } else {
      console.log(`  No changes needed.`);
    }
  }

  console.log('\nDone.');
}

run().catch(console.error);
