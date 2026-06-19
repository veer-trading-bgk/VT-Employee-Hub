const express = require('express');
const { addMetricSchema } = require('../utils/validation');
const { logAudit } = require('../utils/audit');
const { adminMiddleware, checkRole } = require('../middleware/auth');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();

// Add metric (any authenticated user)
router.post('/add', async (req, res, next) => {
  try {
    const { metric_type, value, date, notes } = addMetricSchema.parse(req.body);
    const userId = req.user.id;
    const metricDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Verify value is reasonable
    if (value > 100 && metric_type === 'kyc') {
      await logAudit(userId, 'suspicious_metric_entry', metric_type, 'flagged', req.ip, { value });
    }

    // Accumulate metric value for the day (ADD so multiple entries sum up, not replace)
    const metricId = `${userId}#${metricDate}#${metric_type}`;
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${metricDate}#${metric_type}` },
      UpdateExpression: [
        'ADD #val :inc',
        'SET metricId = if_not_exists(metricId, :mid)',
        ', userId = if_not_exists(userId, :uid)',
        ', email = if_not_exists(email, :em)',
        ', #nm = if_not_exists(#nm, :nm)',
        ', metric_type = if_not_exists(metric_type, :mt)',
        ', #dt = if_not_exists(#dt, :dt)',
        ', enteredAt = if_not_exists(enteredAt, :ea)',
        ', enteredFrom = :ef',
        ', verified = if_not_exists(verified, :vf)',
        ', ipAddress = :ip',
        ', notes = :notes',
      ].join(' '),
      ExpressionAttributeNames: { '#val': 'value', '#nm': 'name', '#dt': 'date' },
      ExpressionAttributeValues: {
        ':inc': value,
        ':mid': metricId,
        ':uid': userId,
        ':em': req.user.email,
        ':nm': req.user.name || req.user.email || '',
        ':mt': metric_type,
        ':dt': metricDate,
        ':ea': new Date().toISOString(),
        ':ef': 'web',
        ':vf': false,
        ':ip': req.ip,
        ':notes': notes || '',
      },
    }).promise();

    // Read back the accumulated total to include in response
    const updated = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${metricDate}#${metric_type}` },
    }).promise();
    const totalValue = updated.Item?.value ?? value;

    await logAudit(userId, 'metric_added', `${metric_type}+${value}=${totalValue}`, 'success', req.ip);
    logger.info(`Metric added: ${metric_type}+${value}=${totalValue} for user ${userId}`);

    res.json({
      success: true,
      message: `${metric_type} updated: +${value} (total today: ${totalValue})`,
      data: { metric_type, value, total: totalValue, date: metricDate }
    });
  } catch (error) {
    next(error);
  }
});

// Get metrics for current user
router.get('/my', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const daysBack = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await dynamodb.query({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      KeyConditionExpression: 'PK = :userId AND SK > :date',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':date': startDate
      }
    }).promise();

    // Group by date → { date: { metric_type: value } }
    const targets = {
      kyc:         4,
      demat:       +(50     / 30).toFixed(1),
      mf:          +(40     / 30).toFixed(1),
      insurance:   Math.round(100000 / 30),
      algo:        +(10     / 30).toFixed(2),
      coaching:    Math.round(20000  / 30),
      pms:         +(10     / 30).toFixed(2),
      pro_insight: +(15     / 30).toFixed(2),
      ltpp:        +(10     / 30).toFixed(2),
    };
    const byDate = {};
    result.Items.forEach(item => {
      const d = item.date || item.SK?.split('#')[0] || '';
      if (!byDate[d]) byDate[d] = {};
      byDate[d][item.metric_type] = (byDate[d][item.metric_type] || 0) + (item.value || 0);
    });

    await logAudit(userId, 'view_own_metrics', 'metrics_list', 'success', req.ip);

    res.json({
      success: true,
      data: byDate,
      targets,
      totalRecords: result.Items.length
    });
  } catch (error) {
    next(error);
  }
});

// Get all metrics (admin only)
router.get('/all', adminMiddleware, async (req, res, next) => {
  try {
    const daysBack = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: 'enteredAt > :date',
      ExpressionAttributeValues: {
        ':date': startDate
      },
      Limit: 1000
    }).promise();

    await logAudit(req.user.id, 'view_all_metrics', 'all_metrics', 'success', req.ip);
    logger.info(`Admin ${req.user.email} viewed all metrics`);

    res.json({
      success: true,
      data: result.Items,
      totalRecords: result.Items.length
    });
  } catch (error) {
    next(error);
  }
});

// Get team summary (manager/admin)
router.get('/team-summary', checkRole(['admin', 'manager', 'team_lead']), async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: '#date = :today',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':today': today
      }
    }).promise();

    // Calculate summary
    const summary = {};
    const targets = {
      kyc:         4,
      demat:       50     / 30,
      mf:          40     / 30,
      insurance:   100000 / 30,
      algo:        10     / 30,
      coaching:    20000  / 30,
      pms:         10     / 30,
      pro_insight: 15     / 30,
      ltpp:        10     / 30,
    };

    result.Items.forEach(item => {
      if (!summary[item.userId]) {
        summary[item.userId] = {
          email: item.email || item.userId,
          name: item.name || item.email || item.userId,
          metrics: {},
        };
      }
      summary[item.userId].metrics[item.metric_type] = (summary[item.userId].metrics[item.metric_type] || 0) + (item.value || 0);
    });

    // Calculate progress
    Object.keys(summary).forEach(userId => {
      Object.keys(targets).forEach(metric => {
        const value = summary[userId].metrics[metric] || 0;
        summary[userId][`${metric}_progress`] = Math.round((value / targets[metric]) * 100);
      });
    });

    await logAudit(req.user.id, 'view_team_summary', 'team_metrics', 'success', req.ip);

    res.json({
      success: true,
      date: today,
      data: summary,
      targets
    });
  } catch (error) {
    next(error);
  }
});

// Bulk-entry (admin) — POST /api/metrics/bulk-entry
router.post('/bulk-entry', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { entries = [] } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array required' });
    }
    let count = 0;
    for (const entry of entries) {
      const metricTypes = ['kyc', 'demat', 'mf', 'insurance', 'algo', 'coaching', 'pms', 'pro_insight', 'ltpp'];
      for (const key of metricTypes) {
        const value = parseInt(entry[key]) || 0;
        if (value <= 0) continue;
        const entryDate = entry.date || new Date().toISOString().split('T')[0];
        const userId = entry.employeeId;
        await dynamodb.put({
          TableName: process.env.DYNAMODB_TABLE_METRICS,
          Item: {
            PK: userId,
            SK: `${entryDate}#${key}`,
            metricId: `${userId}#${entryDate}#${key}`,
            userId,
            metric_type: key,
            value,
            date: entryDate,
            enteredAt: new Date().toISOString(),
            enteredFrom: 'bulk_web',
            enteredBy: req.user.id,
            notes: entry.notes || '',
            verified: false,
            flagged: (key === 'kyc' && value > 50) || (key === 'demat' && value > 30),
          },
        }).promise();
        count++;
      }
    }
    await logAudit(req.user.id, 'bulk_entry', `${entries.length}_employees`, 'success', req.ip, { count });
    res.json({ success: true, count });
  } catch (error) {
    next(error);
  }
});

// Get pending (unverified) metrics — GET /api/metrics/pending
router.get('/pending', checkRole(['admin', 'manager', 'team_lead']), async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: 'verified = :f',
      ExpressionAttributeValues: { ':f': false },
      Limit: 200,
    }).promise();
    const items = (result.Items ?? []).sort((a, b) => (b.enteredAt || '').localeCompare(a.enteredAt || ''));
    res.json({ data: items, total: items.length });
  } catch (error) {
    next(error);
  }
});

// Verify metric (body-based) — POST /api/metrics/verify
router.post('/verify', checkRole(['admin', 'manager', 'team_lead']), async (req, res, next) => {
  try {
    const { metricId, approved, notes } = req.body;
    if (!metricId) return res.status(400).json({ error: 'metricId required' });
    // metricId format: userId#date#metric_type
    const [userId, date, metric_type] = metricId.split('#');
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${date}#${metric_type}` },
      UpdateExpression: 'SET verified = :v, verifiedBy = :vb, verifiedAt = :va, verificationNotes = :vn',
      ExpressionAttributeValues: {
        ':v': !!approved,
        ':vb': req.user.id,
        ':va': new Date().toISOString(),
        ':vn': notes || '',
      },
    }).promise();
    await logAudit(req.user.id, 'verify_metric', metricId, approved ? 'approved' : 'rejected', req.ip);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Verify metric by path param — POST /api/metrics/verify/:metricId (admin only)
// metricId format: userId#date#metric_type
router.post('/verify/:metricId', adminMiddleware, async (req, res, next) => {
  try {
    const { metricId } = req.params;
    const { approved, notes } = req.body;
    const parts = metricId.split('#');
    if (parts.length < 3) {
      return res.status(400).json({ error: 'Invalid metricId format (expected userId#date#metric_type)' });
    }
    const [userId, date, metric_type] = parts;

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${date}#${metric_type}` },
      UpdateExpression: 'SET verified = :v, verifiedBy = :vb, verifiedAt = :va, verificationNotes = :vn',
      ExpressionAttributeValues: {
        ':v': !!approved,
        ':vb': req.user.id,
        ':va': new Date().toISOString(),
        ':vn': notes || ''
      }
    }).promise();

    await logAudit(req.user.id, 'verify_metric', metricId, approved ? 'approved' : 'rejected', req.ip);
    logger.info(`Metric ${metricId} ${approved ? 'approved' : 'rejected'} by ${req.user.email}`);

    res.json({ success: true, message: `Metric ${approved ? 'approved' : 'rejected'}` });
  } catch (error) {
    next(error);
  }
});

module.exports = router;