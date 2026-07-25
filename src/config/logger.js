const https = require('https');
const Sentry = require('@sentry/node');

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT  = process.env.TELEGRAM_ADMIN_CHAT_ID;

// Fire-and-forget Telegram message — never throws, never awaited
function tgAlert(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const body = JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TG_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', () => {}); // truly silent — alert failure must never crash the app
  req.write(body);
  req.end();
}

const logger = {
  info: (message) => {
    console.log(`[${new Date().toISOString()}] ✅ ${message}`);
  },

  warn: (message) => {
    console.warn(`[${new Date().toISOString()}] ⚠️ ${message}`);
  },

  // Logs to CloudWatch, sends a Telegram alert, AND reports to Sentry — every
  // call site that already reaches this function (errorHandler.js's 500
  // branch plus every direct logger.error(...) across routes/services) gets
  // Sentry coverage for free, with no per-call-site changes needed.
  // companyId is optional — pass it wherever the caller has req.user
  // available (see errorHandler.js) for the single most useful triage tag
  // in a multi-tenant app; omitted elsewhere rather than threading it
  // through all existing call sites.
  error: (message, error, companyId) => {
    const detail = error instanceof Error ? error.message : String(error ?? '');
    console.error(`[${new Date().toISOString()}] ❌ ${message}`, detail);
    Sentry.captureException(
      error instanceof Error ? error : new Error(detail ? `${message}: ${detail}` : message),
      companyId ? { tags: { companyId } } : undefined
    );
    tgAlert(`🚨 <b>Production Error</b>\n<code>${message}</code>${detail ? `\n${detail}` : ''}`);
  },

  // For critical single-event alerts without a full error object (e.g. IAM deny, S3 failure)
  alert: (message, companyId) => {
    console.error(`[${new Date().toISOString()}] 🚨 ${message}`);
    Sentry.captureMessage(message, companyId ? { level: 'error', tags: { companyId } } : { level: 'error' });
    tgAlert(`🚨 <b>Alert</b>\n${message}`);
  },
};

module.exports = logger;
