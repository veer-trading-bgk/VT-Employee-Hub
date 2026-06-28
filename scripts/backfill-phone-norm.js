/**
 * One-time backfill: adds the `phoneNorm` attribute (normalised 10-digit phone)
 * to every existing lead METADATA item so the company-phone-index GSI can index them.
 *
 * Prerequisites:
 *   - company-phone-index GSI must be ACTIVE (run create-phone-gsi.js first)
 *   - Check GSI status: node scripts/check-gsi.js
 *
 * Safe to re-run: uses a ConditionExpression so items already backfilled are skipped.
 *
 * Run once: node scripts/backfill-phone-norm.js
 */
require('dotenv').config();
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const TABLE = process.env.DYNAMODB_TABLE_METRICS;

function to10Digit(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length > 10) return d.slice(-10);
  return d;
}

async function backfill() {
  if (!TABLE) { console.error('DYNAMODB_TABLE_METRICS env var required'); process.exit(1); }
  console.log(`Backfilling phoneNorm on lead METADATA items in table: ${TABLE}`);

  let lastKey;
  let scanned = 0, updated = 0, skipped = 0;

  do {
    const result = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :meta',
      ExpressionAttributeValues: { ':prefix': 'LEAD#', ':meta': 'METADATA' },
      ProjectionExpression: 'PK, SK, phone, phoneNorm',
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();

    scanned += result.Items.length;

    await Promise.all(
      result.Items.map(async (item) => {
        if (item.phoneNorm) { skipped++; return; }
        const phoneNorm = to10Digit(item.phone);
        if (!phoneNorm) { skipped++; return; }
        try {
          await dynamodb.update({
            TableName: TABLE,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET phoneNorm = :pn',
            ConditionExpression: 'attribute_not_exists(phoneNorm)',
            ExpressionAttributeValues: { ':pn': phoneNorm },
          }).promise();
          updated++;
        } catch (e) {
          if (e.code === 'ConditionalCheckFailedException') { skipped++; }
          else throw e;
        }
      })
    );

    lastKey = result.LastEvaluatedKey;
    console.log(`  Scanned: ${scanned}, Updated: ${updated}, Skipped: ${skipped}`);
  } while (lastKey);

  console.log(`\nDone. ${updated} items backfilled, ${skipped} already had phoneNorm.`);
  console.log('You can now deploy the code that uses company-phone-index.');
}

backfill().catch((e) => { console.error(e.message); process.exit(1); });
