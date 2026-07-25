const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  // Zod validation error — client mistake, not a server bug
  // Zod v4's ZodError exposes issues via `.issues`, not the v3-era `.errors`.
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues
    });
  }

  // JWT errors — expected auth failures, never production alerts
  if (err.name === 'TokenExpiredError') {
    logger.warn(`JWT expired (global handler) from ${req.ip}`);
    return res.status(401).json({ error: 'Token expired' });
  }
  if (err.name === 'JsonWebTokenError') {
    logger.warn(`Invalid JWT (global handler) from ${req.ip}: ${err.message}`);
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Everything else is a real server error — alert on Telegram + Sentry.
  // companyId tags the Sentry event when this is an authenticated request
  // (authMiddleware sets req.user); public/webhook routes have no req.user
  // and the event is simply reported untagged.
  logger.error('Error occurred', err, req.user?.companyId);

  // Default error
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
};

module.exports = { errorHandler };