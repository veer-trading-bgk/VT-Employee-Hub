const dynamodb = require('../config/dynamodb');
const { logAudit } = require('../utils/audit');
const logger = require('../config/logger');

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15-minute rolling window
const TABLE = process.env.DYNAMODB_TABLE_AUDIT;

function rateLimitKey(email) {
  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  return { PK: `totp_limit#${email}`, SK: `window#${windowStart}` };
}

async function getCurrentAttempts(email) {
  try {
    const result = await dynamodb.get({ TableName: TABLE, Key: rateLimitKey(email) }).promise();
    return result.Item?.attempts ?? 0;
  } catch {
    return 0; // fail open — don't lock users out due to DB errors
  }
}

async function recordTotpFailure(email, userId) {
  try {
    const result = await dynamodb.update({
      TableName: TABLE,
      Key: rateLimitKey(email),
      UpdateExpression: 'ADD attempts :one SET email = :email, updatedAt = :ts',
      ExpressionAttributeValues: {
        ':one': 1,
        ':email': email,
        ':ts': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    const attempts = result.Attributes?.attempts ?? 1;

    if (attempts >= MAX_ATTEMPTS) {
      logger.warn(`TOTP lockout: ${email} reached ${attempts} failed attempts`);
      await logAudit(userId || 'unknown', 'totp_lockout', email, 'locked', 'system', { attempts }).catch(() => {});
    }

    return attempts;
  } catch (error) {
    logger.error('Failed to record TOTP failure', error);
    return 0;
  }
}

async function clearTotpAttempts(email) {
  try {
    await dynamodb.delete({ TableName: TABLE, Key: rateLimitKey(email) }).promise();
  } catch (error) {
    logger.error('Failed to clear TOTP attempts', error);
  }
}

/**
 * Call before validating the TOTP code.
 * Writes a 429 and returns false if the user is locked out; returns true if allowed.
 */
async function totpRateLimitCheck(email, userId, res) {
  const attempts = await getCurrentAttempts(email);
  if (attempts >= MAX_ATTEMPTS) {
    logger.warn(`TOTP rate-limited: ${email}`);
    await logAudit(userId || 'unknown', 'totp_rate_limited', email, 'blocked', 'system').catch(() => {});
    res.status(429).json({
      error: 'Too many failed 2FA attempts. Try again in 15 minutes.',
      lockedOut: true,
      retryAfterMinutes: 15,
    });
    return false;
  }
  return true;
}

module.exports = { totpRateLimitCheck, recordTotpFailure, clearTotpAttempts };
