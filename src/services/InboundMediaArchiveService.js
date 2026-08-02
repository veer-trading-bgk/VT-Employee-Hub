'use strict';

/**
 * InboundMediaArchiveService — Meta media → S3 archival (webhook-agnostic).
 *
 * Single home for the Graph metadata → CDN download → S3 upload path that was
 * previously inline in routes/whatsapp.js (`storeInboundMedia`). Both the
 * WhatsApp webhook (fire-and-forget) and scripts/backfill-media-s3.js call
 * this same function — no duplicated download/upload logic.
 *
 * Does NOT own DynamoDB MSG# patching (callers set s3Key after a successful
 * return). Does NOT change Lambda freeze/thaw semantics — callers that
 * fire-and-forget before res.sendStatus(200) still face that hazard.
 */

const axios = require('axios');
const { s3Client, MEDIA_BUCKET } = require('../config/s3');
const logger = require('../config/logger');
const { GRAPH } = require('./graphApiHelpers');

// Meta media IDs expire in 30 days and proxying through Lambda hits the 6 MB
// response limit. Storing to S3 at ingest time lets the browser stream via
// presigned URL — no Lambda in the path, no size limit.
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp',
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/aac': '.aac',
  'audio/ogg; codecs=opus': '.ogg',
  'application/pdf': '.pdf',
};

// Graph metadata is a tiny JSON payload — 10s matches graphApiHelpers Meta
// call budgets and the pre-existing backfill script. CDN download must cover
// typical inbound sizes from the production census (mostly JPEG, some MP4 /
// ogg voice notes under apforce-wa-media/inbound/) without approaching the
// Lambda/APIGW 30s ceiling on a healthy path; 30s matches the prior backfill.
const GRAPH_TIMEOUT_MS = 10_000;
const CDN_TIMEOUT_MS = 30_000;

// Same-invocation only — 1 retry for transient connection blips. Does not
// survive Lambda freeze/thaw (that remains a deferred execution-model fix).
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ctxFields(companyId, mediaId, mimeType) {
  return `companyId=${companyId} mediaId=${mediaId} mimeType=${mimeType ?? 'null'}`;
}

function errMessage(err) {
  return err?.message ?? String(err);
}

/** 401 / expired-token / stale CDN auth — retrying will not help. */
function isAuthError(err) {
  if (err?.response?.status === 401) return true;
  return /status code 401/i.test(errMessage(err));
}

/** S3 IAM / forbidden — retrying will not help; alert path uses this too. */
function isAccessDeniedError(err) {
  const msg = errMessage(err);
  return msg.includes('Access Denied')
    || msg.includes('AccessDenied')
    || err?.statusCode === 403
    || err?.code === 'AccessDenied'
    || /\b403\b/.test(msg);
}

/**
 * Transient connection-class errors from the investigation (ECONNRESET,
 * socket hang up, stream aborted, ETIMEDOUT, axios timeouts). Not 401,
 * not AccessDenied.
 */
function isTransientNetworkError(err) {
  if (isAuthError(err) || isAccessDeniedError(err)) return false;
  const code = err?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED'
      || code === 'ESOCKETTIMEDOUT' || code === 'ERR_CANCELED') {
    return true;
  }
  const msg = errMessage(err).toLowerCase();
  return msg.includes('socket hang up')
    || msg.includes('stream has been aborted')
    || msg.includes('timeout')
    || msg.includes('econnreset')
    || msg.includes('etimedout');
}

async function withTransientRetry(hop, fields, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err) || attempt >= MAX_ATTEMPTS) throw err;
      logger.warn(
        `storeInboundMedia ${hop} transient failure attempt=${attempt}/${MAX_ATTEMPTS} ${fields}`,
        errMessage(err),
      );
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw lastErr;
}

/**
 * Download inbound Meta media and upload to S3.
 * @param {string} accessToken
 * @param {string} mediaId
 * @param {string|null|undefined} mimeType
 * @param {string} companyId
 * @returns {Promise<string|null>} s3Key on success, null on skip/failure
 */
async function storeInboundMedia(accessToken, mediaId, mimeType, companyId) {
  if (!MEDIA_BUCKET || !mediaId || !accessToken) return null;

  const fields = ctxFields(companyId, mediaId, mimeType);

  let hop = 'graph_lookup';
  try {
    const downloadUrl = await withTransientRetry('graph_lookup', fields, async () => {
      const metaRes = await axios.get(`${GRAPH}/${mediaId}`, {
        params: { access_token: accessToken },
        timeout: GRAPH_TIMEOUT_MS,
      });
      return metaRes.data?.url ?? null;
    });
    if (!downloadUrl) {
      logger.warn(`storeInboundMedia graph_lookup_ok but no download url ${fields}`);
      return null;
    }
    logger.info(`storeInboundMedia graph_lookup_ok ${fields}`);

    hop = 'cdn_download';
    const body = await withTransientRetry('cdn_download', fields, async () => {
      const mediaRes = await axios.get(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'arraybuffer',
        timeout: CDN_TIMEOUT_MS,
      });
      return Buffer.from(mediaRes.data);
    });
    logger.info(`storeInboundMedia cdn_download_ok bytes=${body.length} ${fields}`);

    const ext = MIME_TO_EXT[mimeType] ?? '';
    const s3Key = `inbound/${companyId}/${mediaId}${ext}`;

    hop = 's3_upload';
    await withTransientRetry('s3_upload', fields, async () => {
      await s3Client.upload({
        Bucket: MEDIA_BUCKET,
        Key: s3Key,
        Body: body,
        ContentType: mimeType ?? 'application/octet-stream',
      }).promise();
    });
    logger.info(`storeInboundMedia s3_upload_ok s3Key=${s3Key} ${fields}`);

    return s3Key;
  } catch (err) {
    const msg = errMessage(err);
    // Hop-scoped failure line first so CloudWatch can filter graph/cdn/s3
    // without guessing — then the legacy aggregate line for existing alerts.
    logger.error(`storeInboundMedia ${hop}_failed ${fields}`, msg);
    logger.error(`storeInboundMedia failed ${fields}`, msg);
    // Surface S3 permission errors immediately — these cause silent media loss
    // and need a human IAM fix. Network-class errors stay error-log only:
    // they are intermittent (investigation: freeze/thaw + CDN blips) and
    // Telegram-alerting every hang-up would page on noise without an action.
    if (isAccessDeniedError(err) || msg.includes('403')) {
      logger.alert(`S3 inbound write denied for company <b>${companyId}</b> — check IAM policy on apforce-wa-media/inbound/*`);
    }
    return null;
  }
}

module.exports = {
  storeInboundMedia,
  MIME_TO_EXT,
  GRAPH_TIMEOUT_MS,
  CDN_TIMEOUT_MS,
  MAX_ATTEMPTS,
  isTransientNetworkError,
  isAuthError,
  isAccessDeniedError,
};
