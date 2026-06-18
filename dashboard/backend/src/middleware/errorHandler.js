const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Error occurred', err);

  // Zod validation error
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Default error
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
};

module.exports = { errorHandler };