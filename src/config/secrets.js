const AWS = require('aws-sdk');

const client = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'ap-south-1' });

// Cached bundle — survives the Lambda lifetime, reset on cold start
let _cache = null;

/**
 * Fetch secrets from AWS Secrets Manager and populate process.env.
 * Safe to call multiple times — subsequent calls are instant (cache hit).
 *
 * Secret name: vt-employee-bot/production
 * Secret value: JSON object with keys matching env var names.
 */
async function loadSecrets() {
  if (_cache) return _cache;

  // In local dev, skip Secrets Manager — rely on .env via dotenv
  if (process.env.NODE_ENV !== 'production') {
    _cache = {};
    return _cache;
  }

  const secretName = process.env.SECRETS_MANAGER_SECRET_NAME || 'vt-employee-bot/production';

  try {
    const data = await client.getSecretValue({ SecretId: secretName }).promise();
    const secrets = JSON.parse(data.SecretString);

    const MANAGED_KEYS = [
      'JWT_SECRET',
      'REFRESH_TOKEN_SECRET',
      'ANTHROPIC_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_ADMIN_CHAT_ID',
    ];
    for (const key of MANAGED_KEYS) {
      if (secrets[key]) process.env[key] = secrets[key];
    }

    _cache = secrets;
  } catch (err) {
    // Secret not yet created or role lacks permission — fall through to Lambda env vars
    console.warn(`[secrets] Secrets Manager unavailable (${err.code}); using Lambda environment variables`);
    _cache = {};
  }

  return _cache;
}

module.exports = { loadSecrets };
