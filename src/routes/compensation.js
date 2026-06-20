const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();
const TABLE_METRICS = process.env.DYNAMODB_TABLE_METRICS;

const INCENTIVE_RATES = { kyc: 200, demat: 300, mf: 250, insurance: 500, algo: 100, coaching: 50 };

// GET /api/compensation/calculate/:userId
router.get('/calculate/:userId', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    // Only admin/manager can view others; employee can only view own
    if (req.user.role === 'telecaller' && req.user.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const monthPrefix = `${year}-${month}`;

    const result = await dynamodb.scan({
      TableName: TABLE_METRICS,
      FilterExpression: 'userId = :uid AND begins_with(#date, :month)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':uid': userId, ':month': monthPrefix },
      Limit: 1000,
    }).promise();

    // Aggregate per metric_type — exclude rejected metrics from pay
    const totals = {};
    (result.Items ?? []).forEach((item) => {
      if (item.verificationStatus === 'rejected') return;
      totals[item.metric_type] = (totals[item.metric_type] ?? 0) + (item.value ?? 0);
    });

    let baseCompensation = 0;
    const breakdown = {};
    Object.entries(totals).forEach(([key, count]) => {
      const rate = INCENTIVE_RATES[key];
      if (!rate) return;
      const amount = Math.round(count * rate);
      breakdown[key] = { count: Math.round(count), rate, amount };
      baseCompensation += amount;
    });

    // 10% performance bonus if total > ₹50,000
    const performanceBonus = baseCompensation >= 50000 ? Math.round(baseCompensation * 0.1) : 0;
    const totalCompensation = baseCompensation + performanceBonus;

    await logAudit(req.user.id, 'view_compensation', userId, 'success', req.ip);

    res.json({
      month: parseInt(month),
      year,
      breakdown,
      baseCompensation,
      performanceBonus,
      totalCompensation,
    });
  } catch (error) {
    logger.error('compensation/calculate error', error);
    next(error);
  }
});

// GET /api/compensation/payroll — admin: all employees this month
router.get('/payroll', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const metricsResult = await dynamodb.scan({
      TableName: TABLE_METRICS,
      FilterExpression: 'begins_with(#date, :month)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':month': monthPrefix },
      Limit: 5000,
    }).promise();

    // Group by userId → metric_type — exclude rejected metrics from pay
    const byUser = {};
    (metricsResult.Items ?? []).forEach((item) => {
      if (item.verificationStatus === 'rejected') return;
      const uid = item.userId ?? item.PK;
      if (!byUser[uid]) byUser[uid] = {};
      byUser[uid][item.metric_type] = (byUser[uid][item.metric_type] ?? 0) + (item.value ?? 0);
    });

    const payroll = Object.entries(byUser).map(([userId, metrics]) => {
      let base = 0;
      Object.entries(metrics).forEach(([k, v]) => {
        base += Math.round(v * (INCENTIVE_RATES[k] ?? 0));
      });
      const bonus = base >= 50000 ? Math.round(base * 0.1) : 0;
      return { userId, base, bonus, total: base + bonus, metrics };
    }).sort((a, b) => b.total - a.total);

    await logAudit(req.user.id, 'view_payroll', 'all', 'success', req.ip);
    res.json({ month: monthPrefix, count: payroll.length, payroll });
  } catch (error) {
    logger.error('compensation/payroll error', error);
    next(error);
  }
});

module.exports = router;
