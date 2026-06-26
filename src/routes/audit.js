const express = require('express');
const { logAudit } = require('../utils/audit');
const { adminMiddleware } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
// Query audit_logs using companyIdIndex GSI when companyId is known.
// Falls back to a scan for superadmin cross-company queries (companyId = null).
async function queryAuditLogs({
  companyId, startTime, skCondition = null,
  extraFilter = null, extraNames = {}, extraValues = {}, limit,
}) {
  const TABLE = process.env.DYNAMODB_TABLE_AUDIT;
  const timeValue = `audit#${startTime}`;

  if (!companyId) {
    const filterParts = ['PK > :pk'];
    if (extraFilter) filterParts.push(extraFilter);
    const params = {
      TableName: TABLE,
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: { ':pk': timeValue, ...extraValues },
      ...(Object.keys(extraNames).length && { ExpressionAttributeNames: extraNames }),
    };
    if (limit) params.Limit = limit;
    const r = await dynamodb.scan(params).promise();
    return r.Items ?? [];
  }

  const keyExpr = skCondition
    ? `companyId = :cid AND ${skCondition}`
    : 'companyId = :cid';
  const filterParts = ['PK > :pk'];
  if (extraFilter) filterParts.push(extraFilter);

  const params = {
    TableName: TABLE,
    IndexName: 'companyIdIndex',
    KeyConditionExpression: keyExpr,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeValues: { ':cid': companyId, ':pk': timeValue, ...extraValues },
    ...(Object.keys(extraNames).length && { ExpressionAttributeNames: extraNames }),
  };
  if (limit) params.Limit = limit;
  const r = await dynamodb.query(params).promise();
  return r.Items ?? [];
}

// ── GET /api/audit/logs ───────────────────────────────────────────────────────
router.get('/logs', adminMiddleware, async (req, res, next) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { userId } = req.query;
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const companyId = req.user.role === 'superadmin' ? (req.query.companyId || null) : req.user.companyId;

    const items = await queryAuditLogs({
      companyId,
      startTime,
      skCondition: userId ? 'SK = :sk' : null,
      extraValues: userId ? { ':sk': `user#${userId}` } : {},
      limit,
    });

    await logAudit(req.user.id, 'view_audit_logs', userId || 'all', 'success', req.ip, {}, req.user.companyId);
    logger.info(`Admin ${req.user.email} viewed audit logs`);

    res.json({
      success: true,
      data: items,
      totalRecords: items.length,
      timeRange: `Last ${hours} hours`,
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/audit/suspicious ─────────────────────────────────────────────────
router.get('/suspicious', adminMiddleware, async (req, res, next) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const companyId = req.user.role === 'superadmin' ? (req.query.companyId || null) : req.user.companyId;

    const result2 = await queryAuditLogs({
      companyId,
      startTime,
      extraFilter: '(#action IN (:failed, :suspicious, :delete) OR #result = :flagged)',
      extraNames: { '#action': 'action', '#result': 'result' },
      extraValues: {
        ':failed': 'failed_login',
        ':suspicious': 'suspicious_metric_entry',
        ':delete': 'delete_employee',
        ':flagged': 'flagged',
      },
    });

    const summary = {
      failedLogins: result2.filter((i) => i.action === 'failed_login').length,
      suspiciousMetrics: result2.filter((i) => i.action === 'suspicious_metric_entry').length,
      deletedEmployees: result2.filter((i) => i.action === 'delete_employee').length,
      totalSuspicious: result2.length,
    };

    await logAudit(req.user.id, 'view_suspicious_activity', 'suspicious_audit', 'success', req.ip, {}, req.user.companyId);

    res.json({ success: true, summary, details: result2, timeRange: `Last ${hours} hours` });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/audit/logins ─────────────────────────────────────────────────────
router.get('/logins', adminMiddleware, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const companyId = req.user.role === 'superadmin' ? (req.query.companyId || null) : req.user.companyId;

    const loginItems = await queryAuditLogs({
      companyId,
      startTime,
      extraFilter: '#action IN (:success, :failed)',
      extraNames: { '#action': 'action' },
      extraValues: { ':success': 'successful_login', ':failed': 'failed_login' },
      limit: 500,
    });

    const grouped = {};
    loginItems.forEach((log) => {
      if (!grouped[log.userId]) grouped[log.userId] = { successful: 0, failed: 0, ips: new Set() };
      if (log.action === 'successful_login') grouped[log.userId].successful++;
      else grouped[log.userId].failed++;
      grouped[log.userId].ips.add(log.ip);
    });
    Object.keys(grouped).forEach((k) => { grouped[k].ips = Array.from(grouped[k].ips); });

    await logAudit(req.user.id, 'view_login_history', 'login_audit', 'success', req.ip, {}, req.user.companyId);

    res.json({ success: true, data: grouped, totalLogins: loginItems.length, timeRange: `Last ${days} days` });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/audit/security-report ───────────────────────────────────────────
router.get('/security-report', adminMiddleware, async (req, res, next) => {
  try {
    const hours = 24;
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const companyId = req.user.role === 'superadmin' ? (req.query.companyId || null) : req.user.companyId;

    const secItems = await queryAuditLogs({ companyId, startTime, limit: 1000 });

    const stats = {
      totalActions: secItems.length,
      successfulLogins: secItems.filter((i) => i.action === 'successful_login').length,
      failedLogins: secItems.filter((i) => i.action === 'failed_login').length,
      metricAdded: secItems.filter((i) => i.action === 'metric_added').length,
      adminActions: secItems.filter((i) => ['delete_employee', 'change_incentive'].includes(i.action)).length,
      uniqueUsers: new Set(secItems.map((i) => i.userId)).size,
      uniqueIPs: new Set(secItems.map((i) => i.ip)).size,
      suspiciousActivities: secItems.filter((i) => i.result === 'flagged' || i.action.includes('failed')).length,
    };

    const ipFailures = {};
    secItems.filter((i) => i.action === 'failed_login').forEach((i) => {
      ipFailures[i.ip] = (ipFailures[i.ip] || 0) + 1;
    });
    const highRiskIPs = Object.entries(ipFailures)
      .filter(([, count]) => count >= 3)
      .map(([ip, count]) => ({ ip, failedAttempts: count }));

    await logAudit(req.user.id, 'generate_security_report', 'security_report', 'success', req.ip, {}, req.user.companyId);

    res.json({
      success: true,
      timeRange: `Last ${hours} hours`,
      generatedAt: new Date().toISOString(),
      statistics: stats,
      highRiskIPs,
      recommendations: generateRecommendations(stats, highRiskIPs),
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/audit/export ─────────────────────────────────────────────────────
router.get('/export', adminMiddleware, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const companyId = req.user.role === 'superadmin' ? (req.query.companyId || null) : req.user.companyId;

    const exportItems = await queryAuditLogs({ companyId, startTime, limit: 5000 });

    await logAudit(req.user.id, 'export_audit_logs', 'audit_export', 'success', req.ip, { days, records: exportItems.length }, req.user.companyId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.json"`);
    res.send(JSON.stringify(exportItems, null, 2));
  } catch (error) {
    next(error);
  }
});

function generateRecommendations(stats, highRiskIPs) {
  const r = [];
  if (stats.failedLogins > 5) r.push('⚠️ High number of failed logins detected. Consider enabling IP whitelist.');
  if (stats.suspiciousActivities > 2) r.push('⚠️ Suspicious activities detected. Review audit logs immediately.');
  if (highRiskIPs.length > 0) r.push(`⚠️ ${highRiskIPs.length} IP(s) with multiple failed login attempts.`);
  if (stats.adminActions > 10) r.push('ℹ️ High volume of admin actions. Ensure all changes are authorized.');
  if (r.length === 0) r.push('✅ No security issues detected. System is healthy.');
  return r;
}

module.exports = router;
