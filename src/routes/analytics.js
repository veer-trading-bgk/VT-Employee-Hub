const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// ── Metric config (mirrors dashboard/src/lib/metrics.config.ts) ───────────────
// To add a metric: add it here AND to the frontend config + validation enum.
const METRIC_CONFIG = {
  kyc:         { label: 'KYC',         dailyTarget: 4,            pointsWeight: 10,    isCurrency: false, color: '#6366f1' },
  demat:       { label: 'Demat',       dailyTarget: 50 / 30,      pointsWeight: 15,    isCurrency: false, color: '#22c55e' },
  mf:          { label: 'MF',          dailyTarget: 40 / 30,      pointsWeight: 20,    isCurrency: false, color: '#f59e0b' },
  insurance:   { label: 'Insurance',   dailyTarget: 100000 / 30,  pointsWeight: 10000, isCurrency: true,  color: '#ec4899' },
  algo:        { label: 'Algo',        dailyTarget: 10 / 30,      pointsWeight: 12,    isCurrency: false, color: '#06b6d4' },
  coaching:    { label: 'Coaching',    dailyTarget: 20000 / 30,   pointsWeight: 1000,  isCurrency: true,  color: '#a855f7' },
  pms:         { label: 'PMS',         dailyTarget: 10 / 30,      pointsWeight: 30,    isCurrency: false, color: '#0ea5e9' },
  pro_insight: { label: 'Pro Insight', dailyTarget: 15 / 30,      pointsWeight: 20,    isCurrency: false, color: '#8b5cf6' },
  ltpp:        { label: 'LTPP',        dailyTarget: 10 / 30,      pointsWeight: 25,    isCurrency: false, color: '#14b8a6' },
};

const METRIC_KEYS = Object.keys(METRIC_CONFIG);

/** Points for one employee across all metrics */
function calcPoints(totals) {
  return Math.round(
    METRIC_KEYS.reduce((sum, key) => {
      const cfg = METRIC_CONFIG[key];
      const v = totals[key] ?? 0;
      return sum + (cfg.isCurrency ? v / cfg.pointsWeight : v * cfg.pointsWeight);
    }, 0)
  );
}

/** Empty per-metric totals object */
function emptyTotals() {
  return METRIC_KEYS.reduce((o, k) => { o[k] = 0; return o; }, {});
}

// GET /api/analytics?days=30
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const daysBack = Math.min(parseInt(req.query.days ?? '30', 10), 90);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: '#date >= :startDate',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':startDate': startDate },
      Limit: 5000,
    }).promise();

    const items = result.Items ?? [];

    // ── 1. Daily trend ────────────────────────────────────────────────────────
    const byDate = {};
    items.forEach((item) => {
      const d = item.date;
      if (!byDate[d]) byDate[d] = { date: d, ...emptyTotals() };
      if (METRIC_CONFIG[item.metric_type]) {
        byDate[d][item.metric_type] = (byDate[d][item.metric_type] ?? 0) + (item.value ?? 0);
      }
    });
    const performanceTrend = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    // ── 2. Per-metric totals ──────────────────────────────────────────────────
    const totals = emptyTotals();
    items.forEach((item) => {
      if (METRIC_CONFIG[item.metric_type]) {
        totals[item.metric_type] = (totals[item.metric_type] ?? 0) + (item.value ?? 0);
      }
    });
    const metricTotals = METRIC_KEYS.map((key) => {
      const cfg = METRIC_CONFIG[key];
      const actual = totals[key] ?? 0;
      const target = Math.round(cfg.dailyTarget * daysBack);
      return {
        metric: cfg.label,
        key,
        actual: Math.round(actual),
        target,
        pct: target > 0 ? Math.round((actual / target) * 100) : 0,
      };
    });

    // ── 3. Per-employee totals + ranking ─────────────────────────────────────
    const byEmployee = {};
    items.forEach((item) => {
      const uid = item.userId ?? item.PK;
      if (!byEmployee[uid]) byEmployee[uid] = { userId: uid, ...emptyTotals() };
      if (METRIC_CONFIG[item.metric_type]) {
        byEmployee[uid][item.metric_type] = (byEmployee[uid][item.metric_type] ?? 0) + (item.value ?? 0);
      }
    });
    const employeeTotals = Object.values(byEmployee)
      .map((e) => ({ ...e, points: calcPoints(e) }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 20);

    // ── 4. Conversion funnel ─────────────────────────────────────────────────
    const uniqueByMetric = {};
    items.forEach((item) => {
      if (!uniqueByMetric[item.metric_type]) uniqueByMetric[item.metric_type] = new Set();
      uniqueByMetric[item.metric_type].add(item.userId ?? item.PK);
    });
    const conversionFunnel = METRIC_KEYS.map((key) => ({
      name: METRIC_CONFIG[key].label,
      value: uniqueByMetric[key]?.size ?? 0,
      fill: METRIC_CONFIG[key].color,
    }));

    // ── 5. Monthly cohort ─────────────────────────────────────────────────────
    const cohortMap = {};
    items.forEach((item) => {
      const month = item.date?.slice(0, 7);
      if (!month) return;
      if (!cohortMap[month]) cohortMap[month] = { month, employeeSet: new Set(), kyc: 0, insurance: 0 };
      cohortMap[month].employeeSet.add(item.userId ?? item.PK);
      if (item.metric_type === 'kyc')       cohortMap[month].kyc       += item.value ?? 0;
      if (item.metric_type === 'insurance') cohortMap[month].insurance += item.value ?? 0;
    });
    const cohortAnalysis = Object.values(cohortMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((c, idx, arr) => {
        const prev = arr[idx - 1];
        const employees = c.employeeSet.size;
        const revenue = Math.round(c.insurance);
        const growth = prev && prev.insurance > 0
          ? Math.round(((c.insurance - prev.insurance) / prev.insurance) * 1000) / 10
          : 0;
        const avgPerformance = employees > 0 ? Math.round((c.kyc / employees) * 10) : 0;
        return { month: c.month, employees, revenue, growth, avgPerformance };
      });

    res.json({
      meta: { daysBack, totalRecords: items.length, generatedAt: new Date().toISOString() },
      performanceTrend,
      metricTotals,
      conversionFunnel,
      cohortAnalysis,
      topEmployees: employeeTotals,
    });

    logAudit(req.user.id, 'view_analytics', 'analytics_dashboard', 'success', req.ip, { daysBack })
      .catch((err) => logger.error('Audit log failed for analytics', err));
  } catch (error) {
    logger.error('Analytics error', error);
    next(error);
  }
});

module.exports = router;
