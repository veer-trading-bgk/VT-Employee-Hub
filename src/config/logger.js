const https = require('https');

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

  // Logs to CloudWatch AND sends a Telegram alert so bugs surface immediately
  error: (message, error) => {
    const detail = error instanceof Error ? error.message : String(error ?? '');
    console.error(`[${new Date().toISOString()}] ❌ ${message}`, detail);
    tgAlert(`🚨 <b>Production Error</b>\n<code>${message}</code>${detail ? `\n${detail}` : ''}`);
  },

  // For critical single-event alerts without a full error object (e.g. IAM deny, S3 failure)
  alert: (message) => {
    console.error(`[${new Date().toISOString()}] 🚨 ${message}`);
    tgAlert(`🚨 <b>Alert</b>\n${message}`);
  },
};

module.exports = logger;
