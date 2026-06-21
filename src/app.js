require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const metricsRoutes = require('./routes/metrics');
const auditRoutes = require('./routes/audit');
const aiRoutes = require('./routes/ai');
const analyticsRoutes = require('./routes/analytics');
const badgesRoutes = require('./routes/badges');
const pointsRoutes = require('./routes/points');
const compensationRoutes = require('./routes/compensation');
const adminRoutes = require('./routes/admin');
const companiesRoutes = require('./routes/companies');
const telegramRoutes = require('./routes/telegram');
const { authMiddleware } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Always-allowed APForce production origins — env var can add more
const STATIC_ORIGINS = [
  'https://app.apforce.in',
  'https://dashboard.viirtrading.com',
  'https://vt-employee-hub.vercel.app',
];

const allowedOrigins = [
  ...STATIC_ORIGINS,
  ...(process.env.FRONTEND_URL || 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
].filter((v, i, a) => a.indexOf(v) === i); // dedupe

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
});

// Security middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/metrics', authMiddleware, metricsRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/badges', badgesRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/compensation', compensationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/telegram', telegramRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Error handling
app.use(errorHandler);

module.exports = app;
