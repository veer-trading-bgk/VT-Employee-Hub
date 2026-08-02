/**
 * Backfill script: archive inbound WhatsApp media (mediaId, no s3Key) to S3.
 *
 * Calls the SAME InboundMediaArchiveService.storeInboundMedia used by the
 * WhatsApp webhook — no duplicated Graph/CDN/S3 logic.
 *
 * Usage (from project root):
 *   node scripts/backfill-media-s3.js --dry-run
 *   node scripts/backfill-media-s3.js --dry-run --company=viir_trading
 *   node scripts/backfill-media-s3.js --company=viir_trading          # live — needs explicit go-ahead
 *
 * Dry-run is read-only: scans DynamoDB, classifies candidates (attempt /
 * skip-expired / skip-no-token), does NOT call Meta or S3.
 *
 * Live run is idempotent: re-reads each item before archive and skips if
 * s3Key appeared; skips messages older than Meta's ~30-day media retention.
 *
 * Requires local AWS credentials + .env (DYNAMODB_TABLE_METRICS, WA_MEDIA_BUCKET).
 */

'use strict';

require('dotenv').config();
const path = require('path');
const AWS = require('aws-sdk');

const DRY_RUN = process.argv.includes('--dry-run');
const companyArg = process.argv.find((a) => a.startsWith('--company='));
const COMPANY_FILTER = companyArg ? companyArg.slice('--company='.length).trim() : null;

const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const DELAY_MS = 300;

// Meta deletes media after ~30 days — don't waste Graph calls on expired IDs.
const META_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

AWS.config.update({ region: REGION });
const db = new AWS.DynamoDB.DocumentClient();

// Load after env is set — config/s3.js fail-fasts without WA_MEDIA_BUCKET.
const { storeInboundMedia } = require(path.join(process.cwd(), 'src/services/InboundMediaArchiveService'));
const { getWabaConfig } = require(path.join(process.cwd(), 'src/services/graphApiHelpers'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PK formats: LEAD#${companyId}#${id} or INBOX#${companyId}#${phone} */
function companyIdFromPK(pk) {
  return pk?.split('#')[1] ?? null;
}

/** Prefer item.timestamp; fall back to MSG#<iso>#… SK. */
function messageTimestampMs(item) {
  if (item.timestamp) {
    const t = Date.parse(item.timestamp);
    if (!Number.isNaN(t)) return t;
  }
  const sk = item.SK || '';
  const m = sk.match(/^MSG#(\d{4}-\d{2}-\d{2}T[^#]+)/);
  if (m) {
    const t = Date.parse(m[1]);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

function isPastMetaRetention(item, now = Date.now()) {
  const ts = messageTimestampMs(item);
  if (ts == null) return false; // unknown age — attempt rather than silent skip
  return (now - ts) > META_RETENTION_MS;
}

async function scanMediaMessages() {
  const items = [];
  let lastKey;
  let page = 0;
  do {
    page++;
    process.stdout.write(`\rScanning table... page ${page} (${items.length} candidates so far)`);
    const filterParts = [
      'begins_with(SK, :sk)',
      'attribute_exists(mediaId)',
      'attribute_not_exists(s3Key)',
    ];
    const values = { ':sk': 'MSG#' };
    // Company scope via PK prefix — LEAD#cid# / INBOX#cid#
    if (COMPANY_FILTER) {
      filterParts.push('(begins_with(PK, :leadPfx) OR begins_with(PK, :inboxPfx))');
      values[':leadPfx'] = `LEAD#${COMPANY_FILTER}#`;
      values[':inboxPfx'] = `INBOX#${COMPANY_FILTER}#`;
    }
    const res = await db.scan({
      TableName: TABLE,
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: values,
      ProjectionExpression: 'PK, SK, mediaId, mimeType, #ts, s3Key',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  console.log(`\nScan complete: ${items.length} MSG# with mediaId and no s3Key.`);
  return items;
}

async function classify(items) {
  const now = Date.now();
  const wabaCache = new Map();
  const attempt = [];
  const skippedExpired = [];
  const skippedNoToken = [];
  const skippedNoCompany = [];

  for (const item of items) {
    if (item.s3Key) continue; // defensive — filter should already exclude
    const companyId = companyIdFromPK(item.PK);
    if (!companyId) {
      skippedNoCompany.push(item);
      continue;
    }
    if (isPastMetaRetention(item, now)) {
      skippedExpired.push(item);
      continue;
    }
    if (!wabaCache.has(companyId)) {
      const cfg = await getWabaConfig(companyId);
      wabaCache.set(companyId, cfg);
    }
    const cfg = wabaCache.get(companyId);
    if (!cfg?.accessToken) {
      skippedNoToken.push(item);
      continue;
    }
    attempt.push({ item, companyId, accessToken: cfg.accessToken });
  }
  return { attempt, skippedExpired, skippedNoToken, skippedNoCompany, wabaCache };
}

async function processLive(candidates) {
  let ok = 0;
  let skippedRace = 0;
  let fail = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { item, companyId, accessToken } = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] ${item.PK} / ${item.SK} mediaId=${item.mediaId}`);

    // Idempotent: another run (or webhook) may have patched s3Key since scan.
    const fresh = await db.get({
      TableName: TABLE,
      Key: { PK: item.PK, SK: item.SK },
      ProjectionExpression: 's3Key, mediaId, mimeType',
    }).promise();
    if (fresh.Item?.s3Key) {
      console.log('  SKIP — s3Key already present (race/idempotent)');
      skippedRace++;
      continue;
    }

    const s3Key = await storeInboundMedia(
      accessToken,
      fresh.Item?.mediaId ?? item.mediaId,
      fresh.Item?.mimeType ?? item.mimeType,
      companyId,
    );
    if (!s3Key) {
      console.error('  FAIL — storeInboundMedia returned null');
      fail++;
      await sleep(DELAY_MS);
      continue;
    }

    const updateResult = await db.update({
      TableName: TABLE,
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: 'SET s3Key = :k',
      ConditionExpression: 'attribute_not_exists(s3Key)',
      ExpressionAttributeValues: { ':k': s3Key },
    }).promise().then(() => 'ok').catch((err) => {
      if (err.code === 'ConditionalCheckFailedException') return 'race';
      throw err;
    });

    if (updateResult === 'race') {
      console.log('  SKIP — s3Key set concurrently');
      skippedRace++;
    } else {
      console.log(`  OK → ${s3Key}`);
      ok++;
    }
    await sleep(DELAY_MS);
  }

  return { ok, skippedRace, fail };
}

(async () => {
  console.log('Backfill inbound WhatsApp media → S3');
  console.log(`Table: ${TABLE}`);
  console.log(`Dry-run: ${DRY_RUN}`);
  console.log(`Company filter: ${COMPANY_FILTER || '(all)'}\n`);

  if (!TABLE) {
    console.error('DYNAMODB_TABLE_METRICS not set — check .env');
    process.exit(1);
  }
  if (!process.env.WA_MEDIA_BUCKET) {
    console.error('WA_MEDIA_BUCKET not set — check .env');
    process.exit(1);
  }

  const scanned = await scanMediaMessages();
  const { attempt, skippedExpired, skippedNoToken, skippedNoCompany } = await classify(scanned);

  console.log('\n── Classification ──');
  console.log(`  would attempt:     ${attempt.length}`);
  console.log(`  skip (expired>30d): ${skippedExpired.length}`);
  console.log(`  skip (no WABA tok): ${skippedNoToken.length}`);
  console.log(`  skip (bad PK):      ${skippedNoCompany.length}`);

  if (attempt.length) {
    console.log('\n── Sample candidates (up to 15) ──');
    for (const { item, companyId } of attempt.slice(0, 15)) {
      const ageDays = (() => {
        const ts = messageTimestampMs(item);
        return ts == null ? '?' : ((Date.now() - ts) / 86400000).toFixed(1);
      })();
      console.log(`  ${companyId} | ${item.mimeType || 'mime?'} | age=${ageDays}d | ${item.mediaId} | ${item.SK}`);
    }
  }

  if (skippedExpired.length) {
    console.log(`\n── Skipped expired (count=${skippedExpired.length}, not attempted) ──`);
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — no Meta/S3/Dynamo writes)');
    return;
  }

  console.log('\n── Live archive ──');
  const result = await processLive(attempt);
  console.log(`\nDone. ok=${result.ok} fail=${result.fail} skippedRace=${result.skippedRace}`);
})().catch((e) => {
  console.error('BACKFILL ERROR:', e);
  process.exit(1);
});
