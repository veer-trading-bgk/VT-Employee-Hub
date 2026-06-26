/**
 * Backfill script: download inbound WhatsApp media from Meta and store in S3.
 *
 * Finds all MSG# items that have mediaId but no s3Key, downloads each file
 * from Meta using the company's stored WABA access token, uploads to S3, and
 * updates the DynamoDB item with the s3Key so the frontend can stream directly.
 *
 * Usage (from project root):
 *   node scripts/backfill-media-s3.js [--dry-run]
 *
 * Requires local AWS credentials with access to DynamoDB + S3.
 */

require('dotenv').config();
const AWS = require('aws-sdk');
const axios = require('axios');

const DRY_RUN = process.argv.includes('--dry-run');
const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE = process.env.DYNAMODB_TABLE_METRICS; // whatsapp uses METRICS table (TABLE var)
const MEDIA_BUCKET = process.env.WA_MEDIA_BUCKET || 'apforce-wa-media';
const GRAPH = 'https://graph.facebook.com/v19.0';
const DELAY_MS = 300; // pause between Meta API calls to avoid rate limiting

AWS.config.update({ region: REGION });
const db = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3({ region: REGION });

const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/aac': '.aac',
  'audio/ogg; codecs=opus': '.ogg',
  'application/pdf': '.pdf',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Scan all MSG# items with mediaId but no s3Key ────────────────────────────
async function scanMediaMessages() {
  const items = [];
  let lastKey;
  let page = 0;
  do {
    page++;
    process.stdout.write(`\rScanning table... page ${page} (${items.length} found so far)`);
    const res = await db.scan({
      TableName: TABLE,
      FilterExpression: 'begins_with(SK, :sk) AND attribute_exists(mediaId) AND attribute_not_exists(s3Key)',
      ExpressionAttributeValues: { ':sk': 'MSG#' },
      ProjectionExpression: 'PK, SK, mediaId, mimeType',
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }).promise();
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  console.log(`\nFound ${items.length} messages needing backfill.`);
  return items;
}

// ── Extract companyId from PK ─────────────────────────────────────────────────
// PK formats: LEAD#${companyId}#${id}  or  INBOX#${companyId}#${phone}
function companyIdFromPK(pk) {
  const parts = pk.split('#');
  return parts[1] ?? null;
}

// ── Load WABA config (access token) per company ───────────────────────────────
const wabaCache = {};
async function getWabaConfig(companyId) {
  if (wabaCache[companyId] !== undefined) return wabaCache[companyId];
  const res = await db.get({
    TableName: TABLE,
    Key: { PK: `CONFIG#WABA#${companyId}`, SK: 'CURRENT' },
  }).promise();
  wabaCache[companyId] = res.Item ?? null;
  return wabaCache[companyId];
}

// ── Download from Meta + upload to S3 ────────────────────────────────────────
async function processMessage(item) {
  const { PK, SK, mediaId, mimeType } = item;
  const companyId = companyIdFromPK(PK);
  if (!companyId) { console.warn(`  SKIP — can't parse companyId from PK: ${PK}`); return; }

  const cfg = await getWabaConfig(companyId);
  if (!cfg?.accessToken) { console.warn(`  SKIP — no WABA config for company ${companyId}`); return; }

  try {
    // Step 1: resolve Meta download URL
    const metaRes = await axios.get(`${GRAPH}/${mediaId}`, {
      params: { access_token: cfg.accessToken },
      timeout: 10000,
    });
    const downloadUrl = metaRes.data?.url;
    if (!downloadUrl) { console.warn(`  SKIP ${mediaId} — Meta returned no URL (expired?)`); return; }

    // Step 2: download bytes
    const mediaRes = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const ext = MIME_TO_EXT[mimeType] ?? '';
    const s3Key = `inbound/${companyId}/${mediaId}${ext}`;
    const sizeKB = Math.round(mediaRes.data.byteLength / 1024);

    if (DRY_RUN) {
      console.log(`  DRY-RUN: would upload ${s3Key} (${sizeKB} KB)`);
      return;
    }

    // Step 3: upload to S3
    await s3.upload({
      Bucket: MEDIA_BUCKET,
      Key: s3Key,
      Body: Buffer.from(mediaRes.data),
      ContentType: mimeType ?? 'application/octet-stream',
    }).promise();

    // Step 4: update DynamoDB item with s3Key
    await db.update({
      TableName: TABLE,
      Key: { PK, SK },
      UpdateExpression: 'SET s3Key = :k',
      ExpressionAttributeValues: { ':k': s3Key },
    }).promise();

    console.log(`  OK  ${mediaId} → ${s3Key} (${sizeKB} KB)`);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404 || status === 410) {
      console.warn(`  GONE ${mediaId} — expired on Meta (${status})`);
    } else {
      console.error(`  FAIL ${mediaId} — ${err.message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Backfill inbound WhatsApp media → S3`);
  console.log(`Table: ${TABLE} | Bucket: ${MEDIA_BUCKET} | Dry-run: ${DRY_RUN}\n`);

  if (!TABLE) { console.error('DYNAMODB_TABLE_METRICS not set — check .env'); process.exit(1); }

  const messages = await scanMediaMessages();
  if (messages.length === 0) { console.log('Nothing to backfill.'); return; }

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < messages.length; i++) {
    const item = messages[i];
    console.log(`[${i + 1}/${messages.length}] ${item.PK} / ${item.SK}`);
    await processMessage(item);
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ${messages.length} processed.`);
  if (DRY_RUN) console.log('(dry-run — no changes made)');
})();
