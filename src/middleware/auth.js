const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const authMiddleware = (req, res, next) => {
  try {
    // Get token from cookies or Authorization header
    const token = req.cookies?.accessToken || req.headers.authorization?.split(' ')[1];

    if (!token) {
      logger.warn(`Unauthorized access attempt from ${req.ip}`);
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject temporary 2FA tokens — they must not grant access to protected routes
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

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin') {
    logger.warn(`Unauthorized admin access attempt by ${req.user.id} from ${req.ip}`);
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`Role check failed for ${req.user.id}. Required: ${allowedRoles}, Got: ${req.user.role}`);
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

module.exports = { authMiddleware, adminMiddleware, checkRole };