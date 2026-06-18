const express = require('express');
const { logAudit, getAuditLogs } = require('../utils/audit');
const { adminMiddleware } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// Get audit logs (admin only)
router.get('/logs', adminMiddleware, async (req, res, next) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168); // max 7 days
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { userId } = req.query;
    const startTime = Date.now() - (hours * 60 * 60 * 1000);

    const params = {
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      ScanIndexForward: false,
      Limit: limit
    };

    let result;
    if (userId) {
      // Query specific user's logs
      params.KeyConditionExpression = 'SK = :sk AND PK > :pk';
      params.ExpressionAttributeValues = {
        ':sk': `user#${userId}`,
        ':pk': `audit#${startTime}`
      };
      result = await dynamodb.query(params).promise();
    } else {
      // Scan all logs
      params.FilterExpression = 'PK > :pk';
      params.ExpressionAttributeValues = {
        ':pk': `audit#${startTime}`
      };
      result = await dynamodb.scan(params).promise();
    }

    await logAudit(req.user.id, 'view_audit_logs', userId || 'all', 'success', req.ip);
    logger.info(`Admin ${req.user.email} viewed audit logs`);

    res.json({
      success: true,
      data: result.Items || [],
      totalRecords: result.Items?.length || 0,
      timeRange: `Last ${hours} hours`
    });
  } catch (error) {
    next(error);
  }
});

// Get suspicious activities (admin only)
router.get('/suspicious', adminMiddleware, async (req, res, next) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
    const startTime = Date.now() - (hours * 60 * 60 * 1000);

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: 'PK > :pk AND (#action IN (:failed, :suspicious, :delete) OR #result = :flagged)',
      ExpressionAttributeNames: {
        '#action': 'action',
        '#result': 'result'
      },
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`,
        ':failed': 'failed_login',
        ':suspicious': 'suspicious_metric_entry',
        ':delete': 'delete_employee',
        ':flagged': 'flagged'
      }
    }).promise();

    const summary = {
      failedLogins: result.Items.filter(i => i.action === 'failed_login').length,
      suspiciousMetrics: result.Items.filter(i => i.action === 'suspicious_metric_entry').length,
      deletedEmployees: result.Items.filter(i => i.action === 'delete_employee').length,
      totalSuspicious: result.Items.length
    };

    await logAudit(req.user.id, 'view_suspicious_activity', 'suspicious_audit', 'success', req.ip);

    res.json({
      success: true,
      summary,
      details: result.Items || [],
      timeRange: `Last ${hours} hours`
    });
  } catch (error) {
    next(error);
  }
});

// Get login history (admin only)
router.get('/logins', adminMiddleware, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const { userId } = req.query;
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: 'PK > :pk AND #action IN (:success, :failed)',
      ExpressionAttributeNames: {
        '#action': 'action'
      },
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`,
        ':success': 'successful_login',
        ':failed': 'failed_login'
      },
      Limit: 500
    }).promise();

    // Group by user and IP
    const grouped = {};
    result.Items.forEach(log => {
      const key = `${log.userId}`;
      if (!grouped[key]) {
        grouped[key] = { successful: 0, failed: 0, ips: new Set() };
      }
      if (log.action === 'successful_login') {
        grouped[key].successful++;
      } else {
        grouped[key].failed++;
      }
      grouped[key].ips.add(log.ip);
    });

    // Convert Set to Array
    Object.keys(grouped).forEach(key => {
      grouped[key].ips = Array.from(grouped[key].ips);
    });

    await logAudit(req.user.id, 'view_login_history', 'login_audit', 'success', req.ip);

    res.json({
      success: true,
      data: grouped,
      totalLogins: result.Items.length,
      timeRange: `Last ${days} days`
    });
  } catch (error) {
    next(error);
  }
});

// Get security report (admin only)
router.get('/security-report', adminMiddleware, async (req, res, next) => {
  try {
    const hours = 24;
    const startTime = Date.now() - (hours * 60 * 60 * 1000);

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: 'PK > :pk',
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`
      },
      Limit: 1000
    }).promise();

    // Calculate statistics
    const stats = {
      totalActions: result.Items.length,
      successfulLogins: result.Items.filter(i => i.action === 'successful_login').length,
      failedLogins: result.Items.filter(i => i.action === 'failed_login').length,
      metricAdded: result.Items.filter(i => i.action === 'metric_added').length,
      adminActions: result.Items.filter(i => ['delete_employee', 'change_incentive'].includes(i.action)).length,
      uniqueUsers: new Set(result.Items.map(i => i.userId)).size,
      uniqueIPs: new Set(result.Items.map(i => i.ip)).size,
      suspiciousActivities: result.Items.filter(i => i.result === 'flagged' || i.action.includes('failed')).length
    };

    // Identify high-risk IPs (multiple failed logins)
    const ipFailures = {};
    result.Items
      .filter(i => i.action === 'failed_login')
      .forEach(i => {
        ipFailures[i.ip] = (ipFailures[i.ip] || 0) + 1;
      });

    const highRiskIPs = Object.entries(ipFailures)
      .filter(([ip, count]) => count >= 3)
      .map(([ip, count]) => ({ ip, failedAttempts: count }));

    await logAudit(req.user.id, 'generate_security_report', 'security_report', 'success', req.ip);
    logger.info(`Security report generated for ${req.user.email}`);

    res.json({
      success: true,
      timeRange: `Last ${hours} hours`,
      generatedAt: new Date().toISOString(),
      statistics: stats,
      highRiskIPs,
      recommendations: generateRecommendations(stats, highRiskIPs)
    });
  } catch (error) {
    next(error);
  }
});

// Export audit logs as JSON (admin only)
router.get('/export', adminMiddleware, async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_AUDIT,
      FilterExpression: 'PK > :pk',
      ExpressionAttributeValues: {
        ':pk': `audit#${startTime}`
      },
      Limit: 5000
    }).promise();

    await logAudit(req.user.id, 'export_audit_logs', 'audit_export', 'success', req.ip, { days, records: result.Items.length });
    logger.info(`Admin ${req.user.email} exported ${result.Items.length} audit logs`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.json"`);
    res.send(JSON.stringify(result.Items, null, 2));
  } catch (error) {
    next(error);
  }
});

// Helper function to generate recommendations
const generateRecommendations = (stats, highRiskIPs) => {
  const recommendations = [];

  if (stats.failedLogins > 5) {
    recommendations.push('⚠️ High number of failed logins detected. Consider enabling IP whitelist.');
  }

  if (stats.suspiciousActivities > 2) {
    recommendations.push('⚠️ Suspicious activities detected. Review audit logs immediately.');
  }

  if (highRiskIPs.length > 0) {
    recommendations.push(`⚠️ ${highRiskIPs.length} IP(s) with multiple failed login attempts. Consider blocking these IPs.`);
  }

  if (stats.adminActions > 10) {
    recommendations.push('ℹ️ High volume of admin actions. Ensure all changes are authorized.');
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ No security issues detected. System is healthy.');
  }

  return recommendations;
};

module.exports = router;