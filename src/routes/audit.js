const express = require('express');
const { logAudit } = require('../utils/audit');
const { adminMiddleware } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildScan({ table, timeFilter, companyId, extraFilter, extraValues = {}, limit }) {
  const filterParts = ['PK > :pk'];
  const attrValues = { ':pk': timeFilter, ...extraValues };

  if (companyId) {
    filterParts.push('companyId = :cid');
    attrValues[':cid'] = companyId;
  }
  if (extraFilter) filterParts.push(extraFilter);

  const params = {
    TableName: table,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeValues: attrValues,
  };
  if (limit) params.Limit = limit;
  return params;
}

// ── GET /api/audit/logs ───────────────────────────────────────────────────────
router.get('/logs', adminMiddleware, async (req, res, next) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { userId } = req.query;
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const companyId = req.user.role === 'superadmin' ? (req.query.companyId || null) : req.user.companyId;

    let result;
    if (userId) {
      result = await dynamodb.scan(buildScan({
        table: process.env.DYNAMODB_TABLE_AUDIT,
        timeFilter: `audit#${startTime}`,
        companyId,
        extraFilter: 'SK = :sk',
        extraValues: { ':sk': `user#${userId}` },
        limit,
      })).promise();
    } else {
      result = await dynamodb.scan(buildScan({
        table: process.env.DYNAMODB_TABLE_AUDIT,
        timeFilter: `audit#${startTime}`,
        companyId,
        limit,
      })).promise();
    }

    await logAudit(req.user.id, 'view_audit_logs', userId || 'all', 'success', req.ip, {}, req.user.companyId);
    logger.info(`Admin ${req.user.email} viewed audit logs`);

    res.json({
      success: true,
      data: result.Items || [],
      totalRecords: result.Items?.length || 0,
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

    const result2 = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: [
        'PK > :pk',
        companyId ? 'companyId = :cid' : null,
        '(#action IN (:failed, :suspicious, :delete) OR #result = :flagged)',
      ].filter(Boolean).join(' AND '),
      ExpressionAttributeNames: { '#action': 'action', '#result': 'result' },
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`,
        ...(companyId ? { ':cid': companyId } : {}),
        ':failed': 'failed_login',
        ':suspicious': 'suspicious_metric_entry',
        ':delete': 'delete_employee',
        ':flagged': 'flagged',
      },
    }).promise();

    const summary = {
      failedLogins: result2.Items.filter((i) => i.action === 'failed_login').length,
      suspiciousMetrics: result2.Items.filter((i) => i.action === 'suspicious_metric_entry').length,
      deletedEmployees: result2.Items.filter((i) => i.action === 'delete_employee').length,
      totalSuspicious: result2.Items.length,
    };

    await logAudit(req.user.id, 'view_suspicious_activity', 'suspicious_audit', 'success', req.ip, {}, req.user.companyId);

    res.json({ success: true, summary, details: result2.Items || [], timeRange: `Last ${hours} hours` });
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

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: [
        'PK > :pk',
        companyId ? 'companyId = :cid' : null,
        '#action IN (:success, :failed)',
      ].filter(Boolean).join(' AND '),
      ExpressionAttributeNames: { '#action': 'action' },
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`,
        ...(companyId ? { ':cid': companyId } : {}),
        ':success': 'successful_login',
        ':failed': 'failed_login',
      },
      Limit: 500,
    }).promise();

    const grouped = {};
    result.Items.forEach((log) => {
      if (!grouped[log.userId]) grouped[log.userId] = { successful: 0, failed: 0, ips: new Set() };
      if (log.action === 'successful_login') grouped[log.userId].successful++;
      else grouped[log.userId].failed++;
      grouped[log.userId].ips.add(log.ip);
    });
    Object.keys(grouped).forEach((k) => { grouped[k].ips = Array.from(grouped[k].ips); });

    await logAudit(req.user.id, 'view_login_history', 'login_audit', 'success', req.ip, {}, req.user.companyId);

    res.json({ success: true, data: grouped, totalLogins: result.Items.length, timeRange: `Last ${days} days` });
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

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: ['PK > :pk', companyId ? 'companyId = :cid' : null].filter(Boolean).join(' AND '),
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`,
        ...(companyId ? { ':cid': companyId } : {}),
      },
      Limit: 1000,
    }).promise();

    const stats = {
      totalActions: result.Items.length,
      successfulLogins: result.Items.filter((i) => i.action === 'successful_login').length,
      failedLogins: result.Items.filter((i) => i.action === 'failed_login').length,
      metricAdded: result.Items.filter((i) => i.action === 'metric_added').length,
      adminActions: result.Items.filter((i) => ['delete_employee', 'change_incentive'].includes(i.action)).length,
      uniqueUsers: new Set(result.Items.map((i) => i.userId)).size,
      uniqueIPs: new Set(result.Items.map((i) => i.ip)).size,
      suspiciousActivities: result.Items.filter((i) => i.result === 'flagged' || i.action.includes('failed')).length,
    };

    const ipFailures = {};
    result.Items.filter((i) => i.action === 'failed_login').forEach((i) => {
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

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: ['PK > :pk', companyId ? 'companyId = :cid' : null].filter(Boolean).join(' AND '),
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`,
        ...(companyId ? { ':cid': companyId } : {}),
      },
      Limit: 5000,
    }).promise();

    await logAudit(req.user.id, 'export_audit_logs', 'audit_export', 'success', req.ip, { days, records: result.Items.length }, req.user.companyId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.json"`);
    res.send(JSON.stringify(result.Items, null, 2));
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
