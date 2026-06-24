/**
 * One-off script: delete all employees EXCEPT the admin account.
 * Run with: node scripts/delete-non-admin-employees.js
 *
 * DRY_RUN=true node scripts/delete-non-admin-employees.js   ← preview only, no deletes
 */

const AWS = require('aws-sdk');
const readline = require('readline');

const REGION   = 'ap-south-1';
const TABLE    = 'employees';
const DRY_RUN  = process.env.DRY_RUN === 'true';

const ddb = new AWS.DynamoDB.DocumentClient({ region: REGION });

async function scanAll() {
  const items = [];
  let lastKey;
  do {
    const res = await ddb.scan({
      TableName: TABLE,
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

function prompt(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, ans => { rl.close(); resolve(ans.trim().toLowerCase()); });
  });
}

(async () => {
  console.log('\n=== Employee cleanup script ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  const all = await scanAll();
  console.log(`Total records in employees table: ${all.length}`);

  // Keep: role === 'admin' (keep all admins)
  const toKeep   = all.filter(e => e.role === 'admin' || e.type === 'COMPANY_PROFILE');
  const toDelete = all.filter(e => e.role !== 'admin' && e.type !== 'COMPANY_PROFILE');

  console.log(`\nWill KEEP  (${toKeep.length}):`);
  toKeep.forEach(e => console.log(`  ✓ [${e.role ?? e.type ?? '?'}] ${e.name ?? e.id}  <${e.email ?? '-'}>`));

  console.log(`\nWill DELETE (${toDelete.length}):`);
  if (toDelete.length === 0) {
    console.log('  (nothing to delete)');
    process.exit(0);
  }
  toDelete.forEach(e => console.log(`  ✗ [${e.role ?? '?'}] ${e.name ?? e.id}  <${e.email ?? '-'}>`));

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes made. Remove DRY_RUN=true to execute.');
    process.exit(0);
  }

  const ans = await prompt('\nType YES to confirm deletion: ');
  if (ans !== 'yes') {
    console.log('Aborted.');
    process.exit(0);
  }

  let deleted = 0;
  for (const emp of toDelete) {
    await ddb.delete({ TableName: TABLE, Key: { id: emp.id } }).promise();
    console.log(`  Deleted: ${emp.name ?? emp.id} <${emp.email ?? '-'}>`);
    deleted++;
  }

  console.log(`\nDone. Deleted ${deleted} employee(s). Admin account(s) preserved.`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
