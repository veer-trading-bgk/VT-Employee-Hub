require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const ddb = new AWS.DynamoDB();
const tables = ['employees', 'business_metrics', 'audit_logs', 'vt-badges'];

Promise.all(
  tables.map((t) =>
    ddb
      .describeTable({ TableName: t })
      .promise()
      .then((r) => ({
        table: t,
        keySchema: r.Table.KeySchema,
        itemCount: r.Table.ItemCount,
        gsis: (r.Table.GlobalSecondaryIndexes || []).map((g) => ({
          name: g.IndexName,
          keys: g.KeySchema,
          projection: g.Projection.ProjectionType,
          status: g.IndexStatus,
        })),
      }))
      .catch((e) => ({ table: t, error: e.message }))
  )
).then((results) => {
  results.forEach((r) => {
    console.log(`\n=== ${r.table} (${r.itemCount ?? '?'} items) ===`);
    if (r.error) { console.log(`  ERROR: ${r.error}`); return; }
    console.log(`  Primary key: ${r.keySchema.map(k => `${k.AttributeName} (${k.KeyType})`).join(', ')}`);
    if (r.gsis.length === 0) {
      console.log('  GSIs: NONE');
    } else {
      r.gsis.forEach((g) =>
        console.log(`  GSI: ${g.name} | keys: ${g.keys.map(k => `${k.AttributeName}(${k.KeyType})`).join('+')} | projection: ${g.projection} | status: ${g.status}`)
      );
    }
  });
});
