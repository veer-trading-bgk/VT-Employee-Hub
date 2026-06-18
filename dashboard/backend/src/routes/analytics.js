const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// GET /api/analytics?days=30&metric=all
// Aggregates metrics from DynamoDB for the analytics dashboard
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const daysBack = Math.min(parseInt(req.query.days ?? '30', 10), 90);
    const metricFilter = req.query.metric ?? 'all';
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch all metrics in range
    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: '#date >= :startDate',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':startDate': startDate },
      Limit: 2000,
    }).promise();

    const items = result.Items ?? [];

    // ── 1. Daily trend (group by date × metric_type) ──────────────────────────
    const byDate = {};
    items.forEach((item) => {
      const d = item.date;
      if (!byDate[d]) byDate[d] = { date: d, kyc: 0, demat: 0, mf: 0, insurance: 0, algo: 0, coaching: 0 };
      byDate[d][item.metric_type] = (byDate[d][item.metric_type] ?? 0) + (item.value ?? 0);
    });
    const performanceTrend = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    // ── 2. Per-metric totals (for bar chart) ──────────────────────────────────
    const TARGETS = { kyc: 4, demat: 50 / 30, mf: 40 / 30, insurance: 100000 / 30, algo: 10 / 30, coaching: 20000 / 30 };
    const totals = { kyc: 0, demat: 0, mf: 0, insurance: 0, algo: 0, coaching: 0 };
    items.forEach((item) => {
      totals[item.metric_type] = (totals[item.metric_type] ?? 0) + (item.value ?? 0);
    });
    const metricTotals = Object.entries(totals).map(([key, actual]) => ({
      metric: key.toUpperCase(),
      actual: Math.round(actual),
      target: Math.round(TARGETS[key] * daysBack),
      pct: TARGETS[key] * daysBack > 0 ? Math.round((actual / (TARGETS[key] * daysBack)) * 100) : 0,
    }));

    // ── 3. Per-employee totals (for leaderboard export) ───────────────────────
    const byEmployee = {};
    items.forEach((item) => {
      const uid = item.userId ?? item.PK;
      if (!byEmployee[uid]) byEmployee[uid] = { userId: uid, kyc: 0, demat: 0, mf: 0, insurance: 0, total: 0 };
      byEmployee[uid][item.metric_type] = (byEmployee[uid][item.metric_type] ?? 0) + (item.value ?? 0);
    });

    const employeeTotals = Object.values(byEmployee).sort((a, b) => {
      const scoreA = (a.kyc * 10 + a.demat * 15 + a.mf * 20 + a.insurance / 10000);
      const scoreB = (b.kyc * 10 + b.demat * 15 + b.mf * 20 + b.insurance / 10000);
      return scoreB - scoreA;
    }).slice(0, 20);

    // ── 4. Conversion funnel ─────────────────────────────────────────────────
    // Unique employees who logged each metric type
    const uniqueByMetric = {};
    items.forEach((item) => {
      const key = item.metric_type;
      if (!uniqueByMetric[key]) uniqueByMetric[key] = new Set();
      uniqueByMetric[key].add(item.userId ?? item.PK);
    });
    const kycUniq = uniqueByMetric['kyc']?.size ?? 0;
    const conversionFunnel = [
      { name: 'KYC', value: kycUniq, fill: '#6366f1' },
      { name: 'Demat', value: uniqueByMetric['demat']?.size ?? 0, fill: '#22c55e' },
      { name: 'MF', value: uniqueByMetric['mf']?.size ?? 0, fill: '#f59e0b' },
      { name: 'Insurance', value: uniqueByMetric['insurance']?.size ?? 0, fill: '#ec4899' },
    ];

    // ── 5. Monthly cohort (last 3 months) ─────────────────────────────────────
    const cohortMap = {};
    items.forEach((item) => {
      const month = item.date?.slice(0, 7); // YYYY-MM
      if (!month) return;
      if (!cohortMap[month]) cohortMap[month] = { month, employeeSet: new Set(), kyc: 0, insurance: 0 };
      cohortMap[month].employeeSet.add(item.userId ?? item.PK);
      cohortMap[month].kyc += item.metric_type === 'kyc' ? (item.value ?? 0) : 0;
      cohortMap[month].insurance += item.metric_type === 'insurance' ? (item.value ?? 0) : 0;
    });
    const cohortAnalysis = Object.values(cohortMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((c, idx, arr) => {
        const prev = arr[idx - 1];
        const employees = c.employeeSet.size;
        const revenue = Math.round(c.insurance);
        const growth = prev && prev.insurance > 0 ? ((c.insurance - prev.insurance) / prev.insurance) * 100 : 0;
        const avgPerformance = employees > 0 ? Math.round((c.kyc / employees) * 10) : 0;
        return { month: c.month, employees, revenue, growth: Math.round(growth * 10) / 10, avgPerformance };
      });

    res.json({
      meta: { daysBack, totalRecords: items.length, generatedAt: new Date().toISOString() },
      performanceTrend,
      metricTotals,
      conversionFunnel,
      cohortAnalysis,
      topEmployees: employeeTotals,
    });

    // Fire-and-forget — don't let audit log failure break the analytics response
    logAudit(req.user.id, 'view_analytics', 'analytics_dashboard', 'success', req.ip, { daysBack })
      .catch((err) => logger.error('Audit log failed for analytics', err));
  } catch (error) {
    logger.error('Analytics error', error);
    next(error);
  }
});

module.exports = router;
