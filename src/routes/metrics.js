const express = require('express');
const { addMetricSchema } = require('../utils/validation');
const { logAudit } = require('../utils/audit');
const { adminMiddleware, checkRole } = require('../middleware/auth');
const { TARGET_DEFAULTS, METRIC_KEYS, toDailyTargets, toMonthlyTargets, calcPoints } = require('../config/metricsConfig');
const dynamodb = require('../config/dynamodb');
const bot = require('../config/telegram');
const logger = require('../config/logger');

const router = express.Router();

// ── Target config helper ──────────────────────────────────────────────────────

async function fetchTargetConfig() {
  try {
    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: 'CONFIG#TARGETS', SK: 'current' },
    }).promise();
    return result.Item?.targets ?? TARGET_DEFAULTS;
  } catch {
    return TARGET_DEFAULTS;
  }
}

// ── Add metric (any authenticated user) ──────────────────────────────────────

router.post('/add', async (req, res, next) => {
  try {
    const { metric_type, value, date, notes } = addMetricSchema.parse(req.body);
    const userId = req.user.id;
    const metricDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    if (value > 100 && metric_type === 'kyc') {
      await logAudit(userId, 'suspicious_metric_entry', metric_type, 'flagged', req.ip, { value });
      await bot.sendMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `⚠️ Suspicious Metric Entry\n\nUser: ${req.user.email}\nMetric: ${metric_type}\nValue: ${value}\nIP: ${req.ip}\n\nPlease verify this entry.`
      );
    }

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
        ', verificationStatus = if_not_exists(verificationStatus, :vs)',
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
        ':vs': 'pending',
        ':ip': req.ip,
        ':notes': notes || '',
      },
    }).promise();

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
      data: { metric_type, value, total: totalValue, date: metricDate },
    });
  } catch (error) {
    next(error);
  }
});

// ── Correct today's value (SET, not ADD) ─────────────────────────────────────

router.put('/set', async (req, res, next) => {
  try {
    const { metric_type, value } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (!metric_type || !METRIC_KEYS.includes(metric_type)) {
      return res.status(400).json({ error: 'Invalid metric_type' });
    }
    if (value === undefined || value === null || isNaN(Number(value)) || Number(value) < 0) {
      return res.status(400).json({ error: 'value must be a non-negative number' });
    }

    const userId = req.user.id;
    const v = Number(value);

    if (v === 0) {
      await dynamodb.delete({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        Key: { PK: userId, SK: `${today}#${metric_type}` },
      }).promise();
    } else {
      await dynamodb.update({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        Key: { PK: userId, SK: `${today}#${metric_type}` },
        UpdateExpression:
          'SET #val = :v, correctedAt = :ca, correctedFrom = :cf, verificationStatus = :vs, verified = :vf, ' +
          'metric_type = if_not_exists(metric_type, :mt), #dt = if_not_exists(#dt, :dt), ' +
          'userId = if_not_exists(userId, :uid), email = if_not_exists(email, :em)',
        ExpressionAttributeNames: { '#val': 'value', '#dt': 'date' },
        ExpressionAttributeValues: {
          ':v': v,
          ':ca': new Date().toISOString(),
          ':cf': 'web_correction',
          ':vs': 'pending',
          ':vf': false,
          ':mt': metric_type,
          ':dt': today,
          ':uid': userId,
          ':em': req.user.email,
        },
      }).promise();
    }

    await logAudit(userId, 'metric_corrected', `${metric_type}=${v}`, 'success', req.ip);
    res.json({ success: true, data: { metric_type, value: v, date: today } });
  } catch (error) {
    next(error);
  }
});

// ── Get metrics for current user ──────────────────────────────────────────────

router.get('/my', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const daysBack = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [result, targetCfg] = await Promise.all([
      dynamodb.query({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        KeyConditionExpression: 'PK = :userId AND SK > :date',
        ExpressionAttributeValues: { ':userId': userId, ':date': startDate },
      }).promise(),
      fetchTargetConfig(),
    ]);

    const targets = toDailyTargets(targetCfg);

    const byDate = {};
    const byStatus = {};
    result.Items.forEach(item => {
      if (!item.metric_type) return;
      const d = item.date || item.SK?.split('#')[0] || '';
      if (!byDate[d]) byDate[d] = {};
      if (!byStatus[d]) byStatus[d] = {};
      const status = item.verificationStatus || (item.verified === true ? 'approved' : 'pending');
      if (status !== 'rejected') {
        byDate[d][item.metric_type] = (byDate[d][item.metric_type] || 0) + (item.value || 0);
      } else if (byDate[d][item.metric_type] === undefined) {
        byDate[d][item.metric_type] = 0;
      }
      byStatus[d][item.metric_type] = status;
    });

    await logAudit(userId, 'view_own_metrics', 'metrics_list', 'success', req.ip);

    res.json({
      success: true,
      data: byDate,
      statuses: byStatus,
      targets,
      totalRecords: result.Items.length,
    });
  } catch (error) {
    next(error);
  }
});

// ── Get all metrics (admin only) ──────────────────────────────────────────────

router.get('/all', adminMiddleware, async (req, res, next) => {
  try {
    const daysBack = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression: 'enteredAt > :date',
      ExpressionAttributeValues: { ':date': startDate },
      Limit: 1000,
    }).promise();

    await logAudit(req.user.id, 'view_all_metrics', 'all_metrics', 'success', req.ip);
    logger.info(`Admin ${req.user.email} viewed all metrics`);

    res.json({ success: true, data: result.Items, totalRecords: result.Items.length });
  } catch (error) {
    next(error);
  }
});

// ── Team summary (manager/admin) ──────────────────────────────────────────────

router.get('/team-summary', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [result, targetCfg, empResult] = await Promise.all([
      dynamodb.scan({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        FilterExpression: '#date = :today AND attribute_exists(metric_type)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':today': today },
      }).promise(),
      fetchTargetConfig(),
      dynamodb.scan({
        TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
        ProjectionExpression: 'id, #r, #s',
        ExpressionAttributeNames: { '#r': 'role', '#s': 'status' },
      }).promise(),
    ]);

    // Active performers only: agent / telecaller / intern
    const allowedIds = new Set(
      (empResult.Items ?? [])
        .filter(e => !TEAM_EXCLUDED_ROLES.has(e.role) && e.status !== 'inactive')
        .map(e => e.id)
    );

    const targets = toDailyTargets(targetCfg);
    const summary = {};

    (result.Items ?? []).forEach(item => {
      if (!item.userId || !item.metric_type) return;
      if (!allowedIds.has(item.userId)) return;
      const status = item.verificationStatus || (item.verified === true ? 'approved' : 'pending');
      if (status === 'rejected') return;
      if (!summary[item.userId]) {
        summary[item.userId] = {
          email: item.email || item.userId,
          name: item.name || item.email || item.userId,
          metrics: {},
        };
      }
      summary[item.userId].metrics[item.metric_type] =
        (summary[item.userId].metrics[item.metric_type] || 0) + (item.value || 0);
    });

    Object.keys(summary).forEach(uid => {
      Object.keys(targets).forEach(metric => {
        const v = summary[uid].metrics[metric] || 0;
        summary[uid][`${metric}_progress`] = Math.round((v / (targets[metric] || 1)) * 100);
      });
    });

    await logAudit(req.user.id, 'view_team_summary', 'team_metrics', 'success', req.ip);

    res.json({ success: true, date: today, data: summary, targets, activeHeadcount: allowedIds.size });
  } catch (error) {
    next(error);
  }
});

// ── Bulk-entry (admin/manager) ────────────────────────────────────────────────

router.post('/bulk-entry', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { entries = [] } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array required' });
    }
    let count = 0;
    for (const entry of entries) {
      for (const key of METRIC_KEYS) {
        const value = parseFloat(entry[key]) || 0;
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
            verificationStatus: 'pending',
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

// ── Pending metrics ───────────────────────────────────────────────────────────

router.get('/pending', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      FilterExpression:
        'attribute_exists(metric_type) AND ' +
        '(attribute_not_exists(verificationStatus) OR verificationStatus = :pending)',
      ExpressionAttributeValues: { ':pending': 'pending' },
      Limit: 5000,
    }).promise();
    const items = (result.Items ?? []).sort((a, b) => (b.enteredAt || '').localeCompare(a.enteredAt || ''));
    res.json({ data: items, total: items.length });
  } catch (error) {
    next(error);
  }
});

// ── Verify metric (body-based) ────────────────────────────────────────────────

router.post('/verify', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { metricId, approved, notes } = req.body;
    if (!metricId) return res.status(400).json({ error: 'metricId required' });
    const [userId, date, metric_type] = metricId.split('#');
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${date}#${metric_type}` },
      UpdateExpression:
        'SET verified = :v, verificationStatus = :vs, verifiedBy = :vb, verifiedAt = :va, verificationNotes = :vn',
      ExpressionAttributeValues: {
        ':v': !!approved,
        ':vs': approved ? 'approved' : 'rejected',
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

// ── Verify metric (path param, admin only) ────────────────────────────────────

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
      UpdateExpression:
        'SET verified = :v, verificationStatus = :vs, verifiedBy = :vb, verifiedAt = :va, verificationNotes = :vn',
      ExpressionAttributeValues: {
        ':v': !!approved,
        ':vs': approved ? 'approved' : 'rejected',
        ':vb': req.user.id,
        ':va': new Date().toISOString(),
        ':vn': notes || '',
      },
    }).promise();
    await logAudit(req.user.id, 'verify_metric', metricId, approved ? 'approved' : 'rejected', req.ip);
    logger.info(`Metric ${metricId} ${approved ? 'approved' : 'rejected'} by ${req.user.email}`);
    res.json({ success: true, message: `Metric ${approved ? 'approved' : 'rejected'}` });
  } catch (error) {
    next(error);
  }
});

// ── Monthly leaderboard ───────────────────────────────────────────────────────

// Roles excluded from team metrics — they manage, not perform
const TEAM_EXCLUDED_ROLES = new Set(['admin', 'manager', 'team_lead']);

router.get('/leaderboard', async (req, res, next) => {
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const today = now.toISOString().split('T')[0];

    const [result, targetCfg, empResult] = await Promise.all([
      dynamodb.scan({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        FilterExpression: '#date BETWEEN :start AND :end AND attribute_exists(metric_type)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':start': monthStart, ':end': today },
      }).promise(),
      fetchTargetConfig(),
      dynamodb.scan({
        TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
        ProjectionExpression: 'id, #r, #s',
        ExpressionAttributeNames: { '#r': 'role', '#s': 'status' },
      }).promise(),
    ]);

    // Active performers only: agent / telecaller / intern
    const allowedIds = new Set(
      (empResult.Items ?? [])
        .filter(e => !TEAM_EXCLUDED_ROLES.has(e.role) && e.status !== 'inactive')
        .map(e => e.id)
    );
    const activeHeadcount = allowedIds.size;

    const monthlyTargets = toMonthlyTargets(targetCfg);

    const byUser = {};
    (result.Items ?? []).forEach(item => {
      if (!item.userId || !item.metric_type) return;
      if (!allowedIds.has(item.userId)) return;
      const status = item.verificationStatus || (item.verified === true ? 'approved' : 'pending');
      if (status === 'rejected') return;
      if (!byUser[item.userId]) {
        byUser[item.userId] = {
          userId: item.userId,
          name: item.name || item.email || item.userId,
          email: item.email || item.userId,
          metrics: {},
        };
      }
      byUser[item.userId].metrics[item.metric_type] =
        (byUser[item.userId].metrics[item.metric_type] || 0) + (item.value || 0);
    });

    const ranked = Object.values(byUser)
      .map(user => ({ ...user, points: calcPoints(user.metrics) }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .map((user, i) => ({ ...user, rank: i + 1 }));

    await logAudit(req.user.id, 'view_leaderboard', 'monthly', 'success', req.ip);

    res.json({ success: true, month: monthStart.slice(0, 7), data: ranked, monthlyTargets, activeHeadcount });
  } catch (error) {
    next(error);
  }
});

// ── Performer roster — admin / manager / team_lead ────────────────────────────
// Returns all active performers (agent/telecaller/intern) for entry forms.

router.get('/performers', checkRole(['admin', 'manager', 'team_lead']), async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      FilterExpression: '#s <> :inactive',
      ProjectionExpression: 'id, #n, email, #r, teamLeadId',
      ExpressionAttributeNames: { '#n': 'name', '#s': 'status', '#r': 'role' },
      ExpressionAttributeValues: { ':inactive': 'inactive' },
    }).promise();

    const PERFORMER_ROLES = new Set(['agent', 'telecaller', 'intern']);
    const performers = (result.Items ?? [])
      .filter(e => PERFORMER_ROLES.has(e.role))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json({ success: true, data: performers });
  } catch (error) {
    next(error);
  }
});

// ── TL: my assigned team ──────────────────────────────────────────────────────

router.get('/my-team', checkRole(['team_lead']), async (req, res, next) => {
  try {
    const result = await dynamodb.scan({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      FilterExpression: 'teamLeadId = :tlId AND #s <> :inactive',
      ProjectionExpression: 'id, #n, email',
      ExpressionAttributeNames: { '#n': 'name', '#s': 'status' },
      ExpressionAttributeValues: { ':tlId': req.user.id, ':inactive': 'inactive' },
    }).promise();

    const members = (result.Items ?? []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
});

// ── Proxy metric entry — TL adds for their team / manager adds for any performer ──

router.post('/add-for-member', checkRole(['team_lead', 'manager', 'admin']), async (req, res, next) => {
  try {
    const { targetUserId, metric_type, value, date, notes } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

    const validated = addMetricSchema.parse({ metric_type, value, date, notes });
    const metricDate = validated.date
      ? new Date(validated.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Fetch and validate target employee
    const targetResult = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
      Key: { id: targetUserId },
    }).promise();
    const target = targetResult.Item;
    if (!target) return res.status(404).json({ error: 'Employee not found' });

    const PERFORMER_ROLES = new Set(['agent', 'telecaller', 'intern']);
    if (!PERFORMER_ROLES.has(target.role)) {
      return res.status(403).json({ error: 'Can only add metrics for performers (agent/telecaller/intern)' });
    }
    if (target.status === 'inactive') {
      return res.status(403).json({ error: 'Cannot add metrics for an inactive employee' });
    }

    // TL can only add for employees assigned to them
    if (req.user.role === 'team_lead' && target.teamLeadId !== req.user.id) {
      return res.status(403).json({ error: 'This employee is not assigned to your team' });
    }

    const metricId = `${targetUserId}#${metricDate}#${validated.metric_type}`;

    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: targetUserId, SK: `${metricDate}#${validated.metric_type}` },
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
        ', enteredBy = :eb',
        ', verified = if_not_exists(verified, :vf)',
        ', verificationStatus = if_not_exists(verificationStatus, :vs)',
        ', notes = :notes',
      ].join(' '),
      ExpressionAttributeNames: { '#val': 'value', '#nm': 'name', '#dt': 'date' },
      ExpressionAttributeValues: {
        ':inc': validated.value,
        ':mid': metricId,
        ':uid': targetUserId,
        ':em': target.email,
        ':nm': target.name || target.email,
        ':mt': validated.metric_type,
        ':dt': metricDate,
        ':ea': new Date().toISOString(),
        ':ef': 'proxy',
        ':eb': req.user.id,
        ':vf': false,
        ':vs': 'pending',
        ':notes': validated.notes || '',
      },
    }).promise();

    const updated = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: targetUserId, SK: `${metricDate}#${validated.metric_type}` },
    }).promise();
    const totalValue = updated.Item?.value ?? validated.value;

    await logAudit(req.user.id, 'proxy_metric_entry', targetUserId, 'success', req.ip, {
      metric_type: validated.metric_type,
      value: validated.value,
      total: totalValue,
      date: metricDate,
    });
    logger.info(`Proxy entry: ${req.user.email} → ${target.email} ${validated.metric_type}+${validated.value}`);

    res.json({
      success: true,
      message: `${validated.metric_type} +${validated.value} for ${target.name} (total: ${totalValue})`,
      data: { metric_type: validated.metric_type, value: validated.value, total: totalValue, date: metricDate },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
