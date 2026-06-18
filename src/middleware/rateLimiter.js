const logger = require('../config/logger');

// ── General IP-based rate limiter (for non-login routes) ──────────────────────

const requestCounts = {};

const rateLimit = (limit = 100, windowMs = 60000) => {
  return (req, res, next) => {
    const now = Date.now();
    const windowKey = Math.floor(now / windowMs);
    const key = `${req.ip}:${windowKey}`;

    requestCounts[key] = (requestCounts[key] || 0) + 1;

    if (requestCounts[key] > limit) {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }

    Object.keys(requestCounts).forEach((k) => {
      const windowNum = parseInt(k.split(':')[1]);
      if (windowNum < windowKey - 1) delete requestCounts[k];
    });

    next();
  };
};

// ── Per-email login rate limiter ───────────────────────────────────────────────
// Tracks failed login attempts by email address, not IP.
// This ensures employees on the same office WiFi don't block each other.

const MAX_LOGIN_FAILS  = 10;
const LOGIN_WINDOW_MS  = 15 * 60 * 1000; // 15 minutes

const loginFailCounts = {};

function _loginKey(email) {
  const windowKey = Math.floor(Date.now() / LOGIN_WINDOW_MS);
  return `${email.toLowerCase()}:${windowKey}`;
}

function _cleanLoginCounts() {
  const windowKey = Math.floor(Date.now() / LOGIN_WINDOW_MS);
  Object.keys(loginFailCounts).forEach((k) => {
    if (parseInt(k.split(':').pop()) < windowKey - 1) delete loginFailCounts[k];
  });
}

const loginRateLimiter = {
  isBlocked(email) {
    return (loginFailCounts[_loginKey(email)] ?? 0) >= MAX_LOGIN_FAILS;
  },

  recordFail(email) {
    const key = _loginKey(email);
    loginFailCounts[key] = (loginFailCounts[key] ?? 0) + 1;
    _cleanLoginCounts();
    const count = loginFailCounts[key];
    if (count >= MAX_LOGIN_FAILS) {
      logger.warn(`Login rate-limited by email: ${email} (${count} fails)`);
    }
    return count;
  },

  reset(email) {
    delete loginFailCounts[_loginKey(email)];
  },
};

module.exports = { rateLimit, loginRateLimiter };
