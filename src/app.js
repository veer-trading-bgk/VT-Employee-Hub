require('dotenv').config(); // build: 2026-06-30
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
const platformRoutes = require('./routes/platform');
const telegramRoutes = require('./routes/telegram');
const attendanceRoutes = require('./routes/attendance');
const crmRoutes = require('./routes/crm');
const whatsappRoutes = require('./routes/whatsapp');
const contactsRoutes = require('./routes/contacts');
const tagsRoutes = require('./routes/tags');
const automationsRoutes = require('./routes/automations');
const campaignsRoutes = require('./routes/campaigns');
const formsRoutes = require('./routes/forms');
const { authMiddleware, subscriptionMiddleware } = require('./middleware/auth');
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
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
});

// Security middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Routes
// FIX 4: subscriptionMiddleware blocks writes for suspended/expired-trial accounts.
// Applied to routes that accept writes. Read-only routes (analytics, audit) are left open
// so users can still view their data even if the trial lapsed.
// The WhatsApp webhook POST is intentionally excluded (it's inbound, not a user write).
app.use('/api/auth', authRoutes);
app.use('/api/metrics', authMiddleware, subscriptionMiddleware, metricsRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/badges', authMiddleware, badgesRoutes);
app.use('/api/points', authMiddleware, pointsRoutes);
app.use('/api/compensation', authMiddleware, compensationRoutes);
app.use('/api/admin', authMiddleware, subscriptionMiddleware, adminRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/platform', platformRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/attendance', authMiddleware, attendanceRoutes);
app.use('/api/crm', authMiddleware, subscriptionMiddleware, crmRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/tags', tagsRoutes);
// EventBridge scheduler bypass — secret checked here before JWT guard runs
app.post('/api/automations/_tick', automationsRoutes.processTick);
app.use('/api/automations', authMiddleware, subscriptionMiddleware, automationsRoutes);
app.use('/api/campaigns',  authMiddleware, subscriptionMiddleware, campaignsRoutes);
app.use('/api/forms', formsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Error handling
app.use(errorHandler);

module.exports = app;
