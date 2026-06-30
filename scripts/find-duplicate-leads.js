/**
 * Duplicate Lead Audit Utility
 *
 * Scans all LEAD#METADATA items, groups by companyId + phoneNorm,
 * and reports every phone number that has more than one live lead.
 *
 * Platform rule:
 *   leadId   = primary system identity
 *   phoneNorm = canonical matching identity (10-digit, no country code)
 *   phone    = original display value (stored as-is, not used for dedup)
 *
 * This script does NOT merge or delete anything. Output is a JSON report
 * plus a human-readable summary in the console. Review before taking action.
 *
 * Usage:
 *   node scripts/find-duplicate-leads.js
 *   node scripts/find-duplicate-leads.js > report.json   (pipe full JSON output)
 *   COMPANY_ID=abc123 node scripts/find-duplicate-leads.js   (single company)
 *
 * Prerequisites:
 *   DYNAMODB_TABLE_METRICS and AWS credentials in environment (same as Lambda).
 */

require('dotenv').config();
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const FILTER_COMPANY = process.env.COMPANY_ID ?? null;

function to10Digit(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length > 10) return d.slice(-10);
  return d;
}

// Pick the "suggested primary" record: prefer the one with the most recent
// real activity (lastMessageAt), or the earliest created if no messages.
function pickPrimary(leads) {
  const withMessages = leads.filter((l) => l.lastMessageAt);
  const pool = withMessages.length > 0 ? withMessages : leads;
  return pool.reduce((best, l) => {
    const ts = l.lastMessageAt ?? l.createdAt ?? '';
    const bestTs = best.lastMessageAt ?? best.createdAt ?? '';
    return ts > bestTs ? l : best;
  });
}

async function scanAllLeadMetadata() {
  const filterExpr = FILTER_COMPANY
    ? 'begins_with(PK, :prefix) AND SK = :meta AND attribute_not_exists(deletedAt)'
    : 'begins_with(PK, :prefix) AND SK = :meta AND attribute_not_exists(deletedAt)';

  const baseValues = FILTER_COMPANY
    ? { ':prefix': `LEAD#${FILTER_COMPANY}#`, ':meta': 'METADATA' }
    : { ':prefix': 'LEAD#', ':meta': 'METADATA' };

  const items = [];
  let lastKey;
  let scanned = 0;

  do {
    const result = await dynamodb.scan({
      TableName: TABLE,
      FilterExpression: filterExpr,
      ExpressionAttributeValues: baseValues,
      ProjectionExpression: [
        'leadId', 'companyId', 'phone', 'phoneNorm',
        'name', 'assignedTo', 'assignedToName',
        'stage', 'createdAt', 'updatedAt', 'lastMessageAt',
      ].join(', '),
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();

    items.push(...(result.Items ?? []));
    scanned += result.Count ?? 0;
    lastKey = result.LastEvaluatedKey;

    process.stderr.write(`\r  Scanned ${scanned} items…`);
  } while (lastKey);

  process.stderr.write('\n');
  return items;
}

async function run() {
  if (!TABLE) {
    console.error('DYNAMODB_TABLE_METRICS env var is required');
    process.exit(1);
  }

  process.stderr.write(`Scanning table: ${TABLE}\n`);
  if (FILTER_COMPANY) process.stderr.write(`Filtering to company: ${FILTER_COMPANY}\n`);

  const allLeads = await scanAllLeadMetadata();
  process.stderr.write(`Total live leads found: ${allLeads.length}\n`);

  // Group by companyId + phoneNorm
  const groups = new Map(); // key = "companyId|phoneNorm"
  for (const lead of allLeads) {
    // Recompute phoneNorm in case old records were not backfilled
    const norm = lead.phoneNorm || to10Digit(lead.phone);
    if (!norm) continue; // no phone at all — skip

    const key = `${lead.companyId}|${norm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...lead, _computedNorm: norm });
  }

  // Collect duplicates (groups with > 1 lead)
  const duplicates = [];
  for (const [key, leads] of groups) {
    if (leads.length < 2) continue;
    const [companyId, phoneNorm] = key.split('|');
    const primary = pickPrimary(leads);
    duplicates.push({
      companyId,
      phoneNorm,
      count: leads.length,
      suggestedPrimaryLeadId: primary.leadId,
      leads: leads
        .sort((a, b) => (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1)
        .map((l) => ({
          leadId:          l.leadId,
          name:            l.name ?? '(unnamed)',
          phone:           l.phone,
          phoneNorm:       l._computedNorm,
          stage:           l.stage ?? '—',
          assignedTo:      l.assignedTo ?? null,
          assignedToName:  l.assignedToName ?? null,
          createdAt:       l.createdAt ?? null,
          updatedAt:       l.updatedAt ?? null,
          lastMessageAt:   l.lastMessageAt ?? null,
          isSuggestedPrimary: l.leadId === primary.leadId,
        })),
    });
  }

  // Sort by company then by count desc
  duplicates.sort((a, b) => {
    if (a.companyId !== b.companyId) return a.companyId.localeCompare(b.companyId);
    return b.count - a.count;
  });

  // Console summary
  if (duplicates.length === 0) {
    process.stderr.write('\nNo duplicates found. All phoneNorm values are unique per company.\n');
  } else {
    process.stderr.write(`\n${'─'.repeat(72)}\n`);
    process.stderr.write(`DUPLICATE LEADS FOUND: ${duplicates.length} phone numbers have multiple leads\n`);
    process.stderr.write(`${'─'.repeat(72)}\n\n`);

    for (const dup of duplicates) {
      process.stderr.write(`Company: ${dup.companyId}  |  Phone: ${dup.phoneNorm}  |  ${dup.count} duplicates\n`);
      for (const l of dup.leads) {
        const marker = l.isSuggestedPrimary ? '★ PRIMARY' : '  MERGE  ';
        process.stderr.write(
          `  [${marker}]  ${l.leadId}  "${l.name}"  stage=${l.stage}  ` +
          `owner=${l.assignedToName ?? 'unassigned'}  created=${l.createdAt?.slice(0, 10) ?? '?'}\n`,
        );
      }
      process.stderr.write('\n');
    }

    process.stderr.write(`${'─'.repeat(72)}\n`);
    process.stderr.write(`ACTION REQUIRED: Review above duplicates.\n`);
    process.stderr.write(`Do NOT merge automatically — confirm the correct primary record first.\n`);
    process.stderr.write(`Pipe stdout to a file for the full JSON report: node scripts/find-duplicate-leads.js > report.json\n`);
    process.stderr.write(`${'─'.repeat(72)}\n`);
  }

  // Full structured report to stdout (pipeable to JSON file)
  const report = {
    generatedAt:    new Date().toISOString(),
    table:          TABLE,
    companyFilter:  FILTER_COMPANY,
    totalLeadsScanned: allLeads.length,
    duplicatePhoneNumbers: duplicates.length,
    duplicates,
  };

  console.log(JSON.stringify(report, null, 2));
}

run().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
