const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const TABLE = process.env.DYNAMODB_TABLE_AUDIT;
const WINDOW_MS = 60 * 1000; // 1-minute window for IP limiter

// ── Shared atomic increment via DynamoDB ──────────────────────────────────────
async function atomicIncrement(pk, sk, windowMs) {
  try {
    const ttl = Math.floor((Date.now() + windowMs * 2) / 1000); // seconds; 2× window for safety
    const res = await dynamodb.update({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': ttl },
      ReturnValues: 'UPDATED_NEW',
    }).promise();
    return res.Attributes?.count ?? 1;
  } catch (err) {
    logger.error('Rate limiter increment error', err);
    return 0; // fail open
  }
}

async function getCount(pk, sk) {
  try {
    const res = await dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: sk } }).promise();
    return res.Item?.count ?? 0;
  } catch {
    return 0;
  }
}

// ── General IP-based rate limiter (Express middleware) ────────────────────────
const rateLimit = (limit = 100, windowMs = WINDOW_MS) => {
  return async (req, res, next) => {
    try {
      const windowKey = Math.floor(Date.now() / windowMs) * windowMs;
      const pk = `ip_limit#${req.ip}`;
      const sk = `window#${windowKey}`;
      const count = await atomicIncrement(pk, sk, windowMs);
      if (count > limit) {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        return res.status(429).json({ error: 'Too many requests, please try again later' });
      }
    } catch (err) {
      logger.error('Rate limiter middleware error', err);
    }
    next();
  };
};

// ── Per-email login rate limiter ──────────────────────────────────────────────
const MAX_LOGIN_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginWindowKey(email) {
  const windowStart = Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  return { pk: `login_limit#${email.toLowerCase()}`, sk: `window#${windowStart}` };
}

const loginRateLimiter = {
  async isBlocked(email) {
    const { pk, sk } = loginWindowKey(email);
    const count = await getCount(pk, sk);
    return count >= MAX_LOGIN_FAILS;
  },

  async recordFail(email) {
    const { pk, sk } = loginWindowKey(email);
    const count = await atomicIncrement(pk, sk, LOGIN_WINDOW_MS);
    if (count >= MAX_LOGIN_FAILS) {
      logger.warn(`Login rate-limited by email: ${email} (${count} fails)`);
    }
    return count;
  },

  async reset(email) {
    try {
      const { pk, sk } = loginWindowKey(email);
      await dynamodb.delete({ TableName: TABLE, Key: { PK: pk, SK: sk } }).promise();
    } catch (err) {
      logger.error('Login rate limiter reset error', err);
    }
  },
};

module.exports = { rateLimit, loginRateLimiter, atomicIncrement, getCount };
