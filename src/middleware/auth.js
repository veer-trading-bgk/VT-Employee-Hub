const jwt = require('jsonwebtoken');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

// ── Basic token check ─────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.split(' ')[1];
    if (!token) {
      logger.warn(`Unauthorized access attempt from ${req.ip}`);
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.temp === true) {
      logger.warn(`Temp token used for protected route by ${decoded.email} from ${req.ip}`);
      return res.status(401).json({ error: 'Complete 2FA verification first' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    logger.error('Token verification failed', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Role guards ───────────────────────────────────────────────────────────────
const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    logger.warn(`Unauthorized admin access attempt by ${req.user.id} from ${req.ip}`);
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// FIX 5: platform-level super-admin for APForce staff only
const platformAdminMiddleware = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'APForce platform admin access required' });
  }
  next();
};

const checkRole = (allowedRoles) => (req, res, next) => {
  // superadmin can access any company-level route for support/debugging
  if (req.user.role === 'superadmin') return next();
  if (!allowedRoles.includes(req.user.role)) {
    logger.warn(`Role check failed for ${req.user.id}. Required: ${allowedRoles}, Got: ${req.user.role}`);
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// ── FIX 4: Subscription / trial enforcement ───────────────────────────────────
// Plan status is embedded in the JWT (set at login from company profile).
// Blocks writes if: account is suspended, OR trial has expired.
// superadmin and public webhooks bypass this check.
const subscriptionMiddleware = (req, res, next) => {
  // Platform admins and unauthenticated paths bypass
  if (!req.user || req.user.role === 'superadmin') return next();

  // Internal plan (owner-owned companies) never expire and can never be blocked
  if (req.user.plan === 'internal') return next();

  const { planStatus, trialEndsAt } = req.user;

  if (planStatus === 'suspended') {
    return res.status(402).json({
      error: 'Account suspended. Contact APForce support.',
      code: 'ACCOUNT_SUSPENDED',
    });
  }

  if (trialEndsAt && planStatus !== 'active') {
    const expired = Date.now() > new Date(trialEndsAt).getTime();
    if (expired) {
      return res.status(402).json({
        error: 'Trial expired. Please upgrade your plan to continue.',
        code: 'TRIAL_EXPIRED',
        trialExpired: true,
      });
    }
  }

  next();
};

// In-memory company plan cache for subscriptionMiddleware.
// Keyed by companyId, TTL 5 min. Used by routes that need a fresh check
// without waiting for the user to re-login (e.g. plan upgrade takes effect quickly).
const _planCache = new Map();
const PLAN_CACHE_TTL = 5 * 60 * 1000;

async function fetchCompanyPlan(companyId) {
  const cached = _planCache.get(companyId);
  if (cached && Date.now() - cached.ts < PLAN_CACHE_TTL) return cached.data;

  try {
    const res = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: `COMPANY#${companyId}` },
      ProjectionExpression: '#plan, trialEndsAt, planStatus',
      ExpressionAttributeNames: { '#plan': 'plan' },
    }).promise();
    const data = {
      plan: res.Item?.plan ?? 'trial',
      trialEndsAt: res.Item?.trialEndsAt ?? null,
      planStatus: res.Item?.planStatus ?? 'active',
    };
    _planCache.set(companyId, { ts: Date.now(), data });
    return data;
  } catch {
    return { plan: 'trial', trialEndsAt: null, planStatus: 'active' };
  }
}

function invalidatePlanCache(companyId) {
  _planCache.delete(companyId);
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  platformAdminMiddleware,
  checkRole,
  subscriptionMiddleware,
  fetchCompanyPlan,
  invalidatePlanCache,
};
