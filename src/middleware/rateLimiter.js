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

// ── Per-API-key rate limiter (public endpoint — spec §7) ──────────────────────
// Same primitive as the IP limiter above, but keyed on req.apiKeyId (set by
// apiKeyAuth) rather than req.ip, so one company's noisy key can never exhaust
// another company's quota. MUST be mounted AFTER apiKeyAuth. Default 60/min.
const apiKeyRateLimit = (limit = 60, windowMs = WINDOW_MS) => {
  return async (req, res, next) => {
    try {
      const apiKeyId = req.apiKeyId;
      // No resolved key (shouldn't happen behind apiKeyAuth) — don't block; auth
      // already gates access, and failing open here matches the IP limiter's stance.
      if (!apiKeyId) return next();
      const windowKey = Math.floor(Date.now() / windowMs) * windowMs;
      const pk = `apikey_limit#${apiKeyId}`;
      const sk = `window#${windowKey}`;
      const count = await atomicIncrement(pk, sk, windowMs);
      if (count > limit) {
        logger.warn(`API key rate limit exceeded for key ${apiKeyId}`);
        return res.status(429).json({ error: 'Rate limit exceeded. Please retry shortly.' });
      }
    } catch (err) {
      logger.error('API key rate limiter middleware error', err);
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

// ── Per-email password-reset rate limiter ─────────────────────────────────────
// Same shape/primitive as loginRateLimiter, lower threshold: legitimate use
// rarely needs more than 1-2 requests, and without this an attacker (or an
// impatient real user) could email-bomb a victim's inbox with reset links,
// or repeatedly churn SES sends during the sandbox-mode/production-quota
// period. Deliberately does NOT block the HTTP response when tripped — see
// auth.js's /forgot-password, which still returns its identical generic
// response either way (an observable "you're rate-limited" response would
// itself leak that the email is registered, same as any other differing
// response would).
const MAX_RESET_REQUESTS = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;

function resetWindowKey(email) {
  const windowStart = Math.floor(Date.now() / RESET_WINDOW_MS) * RESET_WINDOW_MS;
  return { pk: `pwreset_limit#${email.toLowerCase()}`, sk: `window#${windowStart}` };
}

const passwordResetRateLimiter = {
  async isBlocked(email) {
    const { pk, sk } = resetWindowKey(email);
    const count = await getCount(pk, sk);
    return count >= MAX_RESET_REQUESTS;
  },

  async recordAttempt(email) {
    const { pk, sk } = resetWindowKey(email);
    const count = await atomicIncrement(pk, sk, RESET_WINDOW_MS);
    if (count >= MAX_RESET_REQUESTS) {
      logger.warn(`Password reset rate-limited by email: ${email} (${count} requests)`);
    }
    return count;
  },
};

// ── Per-email signup OTP send rate limiter ────────────────────────────────────
// Caps SES sends for a given address during signup (separate from the 60s
// resend cooldown inside SignupOtpService). SMS channel can reuse the same
// primitive later with a destination-keyed window.
const MAX_SIGNUP_OTP_SENDS = 5;
const SIGNUP_OTP_WINDOW_MS = 15 * 60 * 1000;

function signupOtpWindowKey(email) {
  const windowStart = Math.floor(Date.now() / SIGNUP_OTP_WINDOW_MS) * SIGNUP_OTP_WINDOW_MS;
  return { pk: `signup_otp_limit#${email.toLowerCase()}`, sk: `window#${windowStart}` };
}

const signupOtpRateLimiter = {
  async isBlocked(email) {
    const { pk, sk } = signupOtpWindowKey(email);
    const count = await getCount(pk, sk);
    return count >= MAX_SIGNUP_OTP_SENDS;
  },

  async recordAttempt(email) {
    const { pk, sk } = signupOtpWindowKey(email);
    const count = await atomicIncrement(pk, sk, SIGNUP_OTP_WINDOW_MS);
    if (count >= MAX_SIGNUP_OTP_SENDS) {
      logger.warn(`Signup OTP rate-limited by email: ${email} (${count} sends)`);
    }
    return count;
  },
};

module.exports = {
  rateLimit,
  apiKeyRateLimit,
  loginRateLimiter,
  passwordResetRateLimiter,
  signupOtpRateLimiter,
  atomicIncrement,
  getCount,
};
