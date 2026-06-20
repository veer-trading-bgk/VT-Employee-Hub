const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { METRIC_CONFIG, METRIC_KEYS, calcPoints, emptyTotals, toDailyTargets, TARGET_DEFAULTS } = require('../config/metricsConfig');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// GET /api/analytics?days=30
router.get('/', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const daysBack = Math.min(parseInt(req.query.days ?? '30', 10), 90);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch live admin-configured targets (falls back to defaults if never customised)
    const targetCfgRow = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: 'CONFIG#TARGETS', SK: 'current' },
    }).promise();
    const liveTargets = toDailyTargets(targetCfgRow.Item?.targets ?? TARGET_DEFAULTS);

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: '#date >= :startDate AND attribute_exists(metric_type)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: { ':startDate': startDate },
      Limit: 5000,
    }).promise();

    // Exclude rejected metrics from all analytics calculations
    const items = (result.Items ?? []).filter((item) => item.verificationStatus !== 'rejected');

    // ── 1. Daily trend ────────────────────────────────────────────────────────
    const byDate = {};
    items.forEach((item) => {
      const d = item.date;
      if (!d || !METRIC_CONFIG[item.metric_type]) return;
      if (!byDate[d]) byDate[d] = { date: d, ...emptyTotals() };
      byDate[d][item.metric_type] = (byDate[d][item.metric_type] ?? 0) + (item.value ?? 0);
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
      const target = Math.round((liveTargets[key] ?? cfg.dailyTarget) * daysBack);
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
      if (!uid || !METRIC_CONFIG[item.metric_type]) return;
      if (!byEmployee[uid]) {
        byEmployee[uid] = {
          userId: uid,
          name: item.name || item.email || uid,
          email: item.email || uid,
          ...emptyTotals(),
        };
      }
      byEmployee[uid][item.metric_type] = (byEmployee[uid][item.metric_type] ?? 0) + (item.value ?? 0);
    });
    const employeeTotals = Object.values(byEmployee)
      .map((e) => {
        const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, e[k] ?? 0]));
        return { userId: e.userId, name: e.name, email: e.email, ...metrics, points: calcPoints(metrics) };
      })
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .slice(0, 20);

    // ── 4. Conversion funnel ─────────────────────────────────────────────────
    const uniqueByMetric = {};
    items.forEach((item) => {
      if (!METRIC_CONFIG[item.metric_type]) return;
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
      if (!cohortMap[month]) cohortMap[month] = { month, employeeSet: new Set(), totals: emptyTotals() };
      cohortMap[month].employeeSet.add(item.userId ?? item.PK);
      if (METRIC_CONFIG[item.metric_type]) {
        cohortMap[month].totals[item.metric_type] = (cohortMap[month].totals[item.metric_type] || 0) + (item.value ?? 0);
      }
    });
    const cohortAnalysis = Object.values(cohortMap)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((c, idx, arr) => {
        const prev = arr[idx - 1];
        const employees = c.employeeSet.size;
        const revenue = Math.round(c.totals.insurance || 0);
        const growth = prev && prev.totals.insurance > 0
          ? Math.round(((c.totals.insurance - prev.totals.insurance) / prev.totals.insurance) * 1000) / 10
          : 0;
        // avgPerformance: composite score across all metrics vs daily targets
        const avgPerformance = employees > 0
          ? Math.round(
              METRIC_KEYS.reduce((sum, key) => {
                const cfg = METRIC_CONFIG[key];
                const v = (c.totals[key] || 0) / employees;
                // Compare monthly total per employee against live monthly target
                const monthlyT = (liveTargets[key] ?? cfg.dailyTarget) * 30;
                return sum + Math.min((v / (monthlyT || 1)) * 100, 200);
              }, 0) / METRIC_KEYS.length
            )
          : 0;
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
