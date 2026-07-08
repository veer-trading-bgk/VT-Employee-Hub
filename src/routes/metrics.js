const express = require('express');
const { addMetricSchema } = require('../utils/validation');
const { logAudit } = require('../utils/audit');
const { authMiddleware, adminMiddleware, checkRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');
const { METRIC_CONFIG, TARGET_DEFAULTS, METRIC_KEYS, toDailyTargets, toMonthlyTargets, calcPoints, buildCustomWeights } = require('../config/metricsConfig');
const dynamodb = require('../config/dynamodb');
const { queryAll } = require('../utils/db');
const bot = require('../config/telegram');
const logger = require('../config/logger');
const { notifyCompany } = require('../utils/wsNotify');

const router = express.Router();

// ── Target config helper ──────────────────────────────────────────────────────

async function fetchTargetConfig(companyId) {
  try {
    const pk = companyId ? `CONFIG#TARGETS#${companyId}` : 'CONFIG#TARGETS';
    const result = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: pk, SK: 'current' },
    }).promise();
    return result.Item?.targets ?? TARGET_DEFAULTS;
  } catch {
    return TARGET_DEFAULTS;
  }
}

// ── Build companyId filter clause for DynamoDB scans ─────────────────────────

function addCompanyFilter(params, companyId, existingFilterExpr) {
  if (!companyId) return params;
  const cid = existingFilterExpr
    ? `${existingFilterExpr} AND companyId = :__cid`
    : 'companyId = :__cid';
  return {
    ...params,
    FilterExpression: cid,
    ExpressionAttributeValues: { ...(params.ExpressionAttributeValues || {}), ':__cid': companyId },
  };
}

// ── Shared: check if a metric record is locked (approved/rejected) ────────────

async function checkLocked(userId, sk) {
  const result = await dynamodb.get({
    TableName: process.env.DYNAMODB_TABLE_METRICS,
    Key: { PK: userId, SK: sk },
  }).promise();
  const vs = result.Item?.verificationStatus;
  return { locked: vs === 'approved' || vs === 'rejected', status: vs, item: result.Item };
}

// ── Shared: resolve which employee a metrics request should act on ───────────
// Self by default (no behavior change for the vast majority of callers). The
// frontend's "Team Entry" tab (entry/page.tsx, gated to v3Role owner/admin/manager
// — which maps to raw roles superadmin/admin/manager/team_lead via toV3Role())
// sends an explicit userId to act on another employee's record instead. These
// routes never read it, so the write/read silently targeted the caller's own
// record no matter what — this closes that gap using the exact role/team/tenant
// checks POST /add-for-member already applies (lines 946-975 below), so the two
// proxy-entry paths stay consistent instead of drifting.
async function resolveTargetUserId(req) {
  const requestedUserId = req.body?.userId ?? req.query?.userId;
  if (!requestedUserId || requestedUserId === req.user.id) {
    // targetEmployee: null signals "self" — callers fall back to req.user.email/name.
    return { userId: req.user.id, targetEmployee: null, error: null };
  }

  // Only roles that can reach the frontend's Team Entry tab may target another
  // employee at all — superadmin bypasses every checkRole() elsewhere in this
  // codebase, so it bypasses here too, consistent with that convention.
  const CAN_ACT_FOR_OTHERS = new Set(['admin', 'manager', 'team_lead']);
  if (req.user.role !== 'superadmin' && !CAN_ACT_FOR_OTHERS.has(req.user.role)) {
    return { userId: null, targetEmployee: null, error: { status: 403, message: 'Not authorized to act on another employee\'s metrics' } };
  }

  const targetResult = await dynamodb.get({
    TableName: process.env.DYNAMODB_TABLE_EMPLOYEES,
    Key: { id: requestedUserId },
  }).promise();
  const target = targetResult.Item;
  if (!target) {
    return { userId: null, targetEmployee: null, error: { status: 404, message: 'Employee not found' } };
  }

  // Cross-tenant guard — mirrors admin.js's inline pattern (e.g. line 65).
  if (req.user.role !== 'superadmin' && target.companyId !== req.user.companyId) {
    return { userId: null, targetEmployee: null, error: { status: 403, message: 'Access denied' } };
  }

  // team_lead is scoped to their own team; manager/admin/superadmin are not —
  // mirrors POST /add-for-member's existing team_lead-only restriction exactly.
  if (req.user.role === 'team_lead' && target.teamLeadId !== req.user.id) {
    return { userId: null, targetEmployee: null, error: { status: 403, message: 'This employee is not assigned to your team' } };
  }

  return { userId: requestedUserId, targetEmployee: target, error: null };
}

// ── Add metric (any authenticated user) ──────────────────────────────────────

router.post('/add', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { metric_type, value, date, notes } = addMetricSchema.parse(req.body);
    const { userId, targetEmployee, error: targetError } = await resolveTargetUserId(req);
    if (targetError) return res.status(targetError.status).json({ error: targetError.message });
    const metricDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    // Proxy entry (Team Entry) attributes the record to the target employee, not the actor —
    // same convention POST /add-for-member already uses for these exact fields.
    const entryEmail = targetEmployee?.email ?? req.user.email;
    const entryName = targetEmployee?.name || targetEmployee?.email || req.user.name || req.user.email || '';
    const entryCompanyId = targetEmployee?.companyId ?? req.user.companyId;

    // 409 if record is already approved/rejected
    const { locked, status: lockedStatus } = await checkLocked(userId, `${metricDate}#${metric_type}`);
    if (locked) {
      return res.status(409).json({
        error: `This entry has already been ${lockedStatus} and is locked. Use "Add Additional" to submit a correction.`,
        locked: true,
        verificationStatus: lockedStatus,
      });
    }

    if (value > 100 && metric_type === 'kyc') {
      await logAudit(req.user.id, 'suspicious_metric_entry', metric_type, 'flagged', req.ip, { value, targetUserId: userId });
      await bot.sendMessage(
        process.env.TELEGRAM_ADMIN_CHAT_ID,
        `⚠️ Suspicious Metric Entry\n\nUser: ${entryEmail}\nMetric: ${metric_type}\nValue: ${value}\nIP: ${req.ip}\n\nPlease verify this entry.`
      );
    }

    const metricId = `${userId}#${metricDate}#${metric_type}`;
    const addSetClauses = [
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
    ];
    if (entryCompanyId) addSetClauses.push(', companyId = if_not_exists(companyId, :__cid)');
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${metricDate}#${metric_type}` },
      UpdateExpression: ['ADD #val :inc', ...addSetClauses].join(' '),
      ExpressionAttributeNames: { '#val': 'value', '#nm': 'name', '#dt': 'date' },
      ExpressionAttributeValues: {
        ':inc': value,
        ':mid': metricId,
        ':uid': userId,
        ':em': entryEmail,
        ':nm': entryName,
        ':mt': metric_type,
        ':dt': metricDate,
        ':ea': new Date().toISOString(),
        ':ef': targetEmployee ? 'proxy' : 'web',
        ':vf': false,
        ':vs': 'pending',
        ':ip': req.ip,
        ':notes': notes || '',
        ...(entryCompanyId && { ':__cid': entryCompanyId }),
      },
    }).promise();

    const updated = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: `${metricDate}#${metric_type}` },
    }).promise();
    const totalValue = updated.Item?.value ?? value;

    await logAudit(req.user.id, 'metric_added', `${metric_type}+${value}=${totalValue}`, 'success', req.ip, targetEmployee ? { targetUserId: userId } : {});
    logger.info(`Metric added: ${metric_type}+${value}=${totalValue} for user ${userId}`);

    res.json({
      success: true,
      message: `${metric_type} updated: +${value} (total today: ${totalValue})`,
      data: { metric_type, value, total: totalValue, date: metricDate },
    });
    notifyCompany(entryCompanyId, {
      event: 'metric_added',
      userId,
      metric_type,
      value,
      total: totalValue,
      date: metricDate,
    }).catch(() => {});
  } catch (error) {
    next(error);
  }
});

// ── Correct today's value (SET, not ADD) ─────────────────────────────────────

router.put('/set', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { metric_type, value } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (!metric_type || !METRIC_KEYS.includes(metric_type)) {
      return res.status(400).json({ error: 'Invalid metric_type' });
    }
    if (value === undefined || value === null || isNaN(Number(value)) || Number(value) < 0) {
      return res.status(400).json({ error: 'value must be a non-negative number' });
    }

    const { userId, targetEmployee, error: targetError } = await resolveTargetUserId(req);
    if (targetError) return res.status(targetError.status).json({ error: targetError.message });
    const entryEmail = targetEmployee?.email ?? req.user.email;

    // 409 if record is already approved/rejected
    const { locked, status: lockedStatus } = await checkLocked(userId, `${today}#${metric_type}`);
    if (locked) {
      return res.status(409).json({
        error: `This entry has been ${lockedStatus} and is locked. Use "Add Additional" to submit a correction.`,
        locked: true,
        verificationStatus: lockedStatus,
      });
    }

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
          ':cf': targetEmployee ? 'proxy_correction' : 'web_correction',
          ':vs': 'pending',
          ':vf': false,
          ':mt': metric_type,
          ':dt': today,
          ':uid': userId,
          ':em': entryEmail,
        },
      }).promise();
    }

    await logAudit(req.user.id, 'metric_corrected', `${metric_type}=${v}`, 'success', req.ip, targetEmployee ? { targetUserId: userId } : {});
    res.json({ success: true, data: { metric_type, value: v, date: today } });
  } catch (error) {
    next(error);
  }
});

// ── Add correction to an approved/rejected record ────────────────────────────
// Creates a new record: SK = date#metric_type#CORR#N
// Parent must be approved or rejected — cannot correct a pending record.

router.post('/correction', rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { metric_type, value, date, notes } = addMetricSchema.parse(req.body);
    const { userId, targetEmployee, error: targetError } = await resolveTargetUserId(req);
    if (targetError) return res.status(targetError.status).json({ error: targetError.message });
    const entryEmail = targetEmployee?.email ?? req.user.email;
    const entryName = targetEmployee?.name || targetEmployee?.email || req.user.name || req.user.email || '';
    const entryCompanyId = targetEmployee?.companyId ?? req.user.companyId;
    const metricDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const parentSK = `${metricDate}#${metric_type}`;

    // Parent record must exist and be approved or rejected
    const parentResult = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: userId, SK: parentSK },
    }).promise();

    if (!parentResult.Item) {
      return res.status(404).json({ error: 'Original record not found for this date and metric' });
    }

    const parentStatus = parentResult.Item.verificationStatus;
    if (!parentStatus || parentStatus === 'pending') {
      return res.status(409).json({
        error: 'Original record is still pending — edit it directly instead of creating a correction',
      });
    }

    // Count existing corrections to determine next number
    const existingCorr = await dynamodb.query({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      KeyConditionExpression: 'PK = :uid AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':uid': userId, ':prefix': `${parentSK}#CORR#` },
    }).promise();
    const correctionNumber = (existingCorr.Items?.length ?? 0) + 1;
    const corrSK = `${parentSK}#CORR#${correctionNumber}`;
    const now = new Date().toISOString();

    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Item: {
        PK: userId,
        SK: corrSK,
        metricId: `${userId}#${corrSK}`,
        userId,
        email: entryEmail,
        name: entryName,
        metric_type,
        value,
        date: metricDate,
        notes: notes || '',
        isCorrection: true,
        correctionNumber,
        parentRecordId: parentSK,
        verified: false,
        verificationStatus: 'pending',
        enteredAt: now,
        createdAt: now,
        submittedAt: now,
        enteredFrom: targetEmployee ? 'proxy_correction' : 'web_correction',
        ipAddress: req.ip,
        ...(entryCompanyId && { companyId: entryCompanyId }),
      },
    }).promise();

    await logAudit(req.user.id, 'correction_added', `${metric_type}+${value} corr#${correctionNumber}`, 'success', req.ip, targetEmployee ? { targetUserId: userId } : {});
    logger.info(`Correction #${correctionNumber} added: ${metric_type}+${value} for user ${userId}`);

    res.json({
      success: true,
      message: `Correction #${correctionNumber} submitted for ${metric_type}: +${value}`,
      data: { metric_type, value, correctionNumber, parentRecordId: parentSK, date: metricDate },
    });
  } catch (error) {
    next(error);
  }
});

// ── Get metrics for current user ──────────────────────────────────────────────

router.get('/my', async (req, res, next) => {
  try {
    const { userId, targetEmployee, error: targetError } = await resolveTargetUserId(req);
    if (targetError) return res.status(targetError.status).json({ error: targetError.message });
    const entryCompanyId = targetEmployee?.companyId ?? req.user.companyId;
    const daysBack = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [result, targetCfg] = await Promise.all([
      dynamodb.query({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        KeyConditionExpression: 'PK = :userId AND SK > :date',
        ExpressionAttributeValues: { ':userId': userId, ':date': startDate },
      }).promise(),
      fetchTargetConfig(entryCompanyId),
    ]);

    const targets = toDailyTargets(targetCfg);

    const byDate = {};
    const byStatus = {};
    result.Items.forEach(item => {
      if (!item.metric_type) return;
      const d = item.date || item.SK?.split('#')[0] || '';
      if (!byDate[d]) byDate[d] = {};
      if (!byStatus[d]) byStatus[d] = {};
      // Corrections have SK like date#metric_type#CORR#N — only original records set status
      const isCorrectionRecord = item.SK?.includes('#CORR#');
      const status = item.verificationStatus || (item.verified === true ? 'approved' : 'pending');
      if (status !== 'rejected') {
        byDate[d][item.metric_type] = (byDate[d][item.metric_type] || 0) + (item.value || 0);
      } else if (byDate[d][item.metric_type] === undefined) {
        byDate[d][item.metric_type] = 0;
      }
      // Status map reflects only the original record so frontend can detect the lock state
      if (!isCorrectionRecord) {
        byStatus[d][item.metric_type] = status;
      }
    });

    await logAudit(req.user.id, 'view_own_metrics', 'metrics_list', 'success', req.ip, targetEmployee ? { targetUserId: userId } : {});

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

    const { companyId } = req.user;
    const METRICS_TABLE = process.env.DYNAMODB_TABLE_METRICS;
    const EMP_TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;

    const metricsPromise = companyId
      ? queryAll({
          TableName: METRICS_TABLE,
          IndexName: 'companyIdIndex',
          KeyConditionExpression: 'companyId = :__cid',
          FilterExpression: '#date = :today AND attribute_exists(metric_type)',
          ExpressionAttributeNames: { '#date': 'date' },
          ExpressionAttributeValues: { ':__cid': companyId, ':today': today },
        })
      : dynamodb.scan({
          TableName: METRICS_TABLE,
          FilterExpression: '#date = :today AND attribute_exists(metric_type)',
          ExpressionAttributeNames: { '#date': 'date' },
          ExpressionAttributeValues: { ':today': today },
        }).promise().then((r) => r.Items ?? []);

    const empPromise = companyId
      ? queryAll({
          TableName: EMP_TABLE,
          IndexName: 'companyIdIndex',
          KeyConditionExpression: 'companyId = :__cid',
          FilterExpression: 'attribute_not_exists(#type)',
          ProjectionExpression: 'id, #r, #s',
          ExpressionAttributeNames: { '#r': 'role', '#s': 'status', '#type': 'type' },
          ExpressionAttributeValues: { ':__cid': companyId },
        })
      : dynamodb.scan({
          TableName: EMP_TABLE,
          ProjectionExpression: 'id, #r, #s',
          ExpressionAttributeNames: { '#r': 'role', '#s': 'status' },
        }).promise().then((r) => r.Items ?? []);

    const [metricsItems, targetCfg, empItems] = await Promise.all([
      metricsPromise,
      fetchTargetConfig(companyId),
      empPromise,
    ]);

    // Active performers only: agent / telecaller / intern
    const allowedIds = new Set(
      empItems
        .filter(e => !TEAM_EXCLUDED_ROLES.has(e.role) && e.status !== 'inactive')
        .map(e => e.id)
    );

    const targets = toDailyTargets(targetCfg);
    const summary = {};

    metricsItems.forEach(item => {
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

router.post('/bulk-entry', checkRole(['admin', 'manager']), rateLimit(10, 60_000), async (req, res, next) => {
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
            ...(req.user.companyId && { companyId: req.user.companyId }),
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

// ── Metric display config (per-company label/icon/target overrides) ───────────

const DISPLAY_FIELDS = new Set(['label', 'icon', 'target', 'targetPeriod', 'color', 'pointsWeight']);

router.get('/config', authMiddleware, async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const pk = `CONFIG#METRICS#${companyId ?? 'global'}`;
    const stored = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: pk, SK: 'current' },
    }).promise();
    const overrides = stored.Item?.overrides ?? {};

    const config = METRIC_KEYS.map((key) => {
      const base = METRIC_CONFIG[key];
      const ov   = overrides[key] ?? {};
      return {
        key,
        label:        ov.label        ?? base.label,
        icon:         ov.icon         ?? (base.icon ?? '📊'),
        target:       ov.target       ?? base.target,
        targetPeriod: ov.targetPeriod ?? base.targetPeriod,
        color:        ov.color        ?? base.color,
        pointsWeight: ov.pointsWeight ?? base.pointsWeight,
        isCurrency:   base.isCurrency,
        isCustomized: Object.keys(ov).length > 0,
      };
    });

    res.json({ success: true, config });
  } catch (error) {
    next(error);
  }
});

router.put('/config/:metricKey', adminMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { metricKey } = req.params;
    const { companyId } = req.user;
    if (!METRIC_KEYS.includes(metricKey)) {
      return res.status(400).json({ error: 'Unknown metric key' });
    }

    const override = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (!DISPLAY_FIELDS.has(k)) continue;
      if (k === 'label')        override.label        = String(v).trim().slice(0, 60);
      else if (k === 'icon')    override.icon         = String(v).trim().slice(0, 8);
      else if (k === 'color' && /^#[0-9a-fA-F]{6}$/.test(v)) override.color = v;
      else if (k === 'targetPeriod' && ['day', 'month'].includes(v)) override.targetPeriod = v;
      else if (k === 'target' || k === 'pointsWeight') {
        const n = Number(v);
        if (!isNaN(n) && n > 0) override[k] = n;
      }
    }

    const pk = `CONFIG#METRICS#${companyId ?? 'global'}`;
    // Read-then-write to avoid nested-attribute upsert issues
    const stored = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: pk, SK: 'current' },
    }).promise();
    const allOverrides = stored.Item?.overrides ?? {};
    allOverrides[metricKey] = { ...(allOverrides[metricKey] ?? {}), ...override };

    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Item: { PK: pk, SK: 'current', overrides: allOverrides, updatedAt: new Date().toISOString(), updatedBy: req.user.id },
    }).promise();

    await logAudit(req.user.id, 'update_metric_config', metricKey, 'success', req.ip, override);
    res.json({ success: true, key: metricKey });
  } catch (error) {
    next(error);
  }
});

router.delete('/config/:metricKey', adminMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { metricKey } = req.params;
    const { companyId } = req.user;
    if (!METRIC_KEYS.includes(metricKey)) {
      return res.status(400).json({ error: 'Unknown metric key' });
    }
    const pk = `CONFIG#METRICS#${companyId ?? 'global'}`;
    const stored = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: { PK: pk, SK: 'current' },
    }).promise();
    const allOverrides = stored.Item?.overrides ?? {};
    delete allOverrides[metricKey];
    await dynamodb.put({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Item: { PK: pk, SK: 'current', overrides: allOverrides, updatedAt: new Date().toISOString(), updatedBy: req.user.id },
    }).promise();
    await logAudit(req.user.id, 'reset_metric_config', metricKey, 'success', req.ip, {});
    res.json({ success: true, key: metricKey, reset: true });
  } catch (error) {
    next(error);
  }
});

// ── Pending metrics ───────────────────────────────────────────────────────────

router.get('/pending', checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const { companyId, role } = req.user;

    let filterExpr =
      'attribute_exists(metric_type) AND ' +
      '(attribute_not_exists(verificationStatus) OR verificationStatus = :pending)';
    const exprValues = { ':pending': 'pending' };

    // Superadmin sees all companies; everyone else sees their own company only
    if (role !== 'superadmin' && companyId) {
      filterExpr += ' AND companyId = :__cid';
      exprValues[':__cid'] = companyId;
    }

    // Paginate through entire table — no Limit so we never miss items
    let items = [];
    let lastKey;
    do {
      const result = await dynamodb.scan({
        TableName: process.env.DYNAMODB_TABLE_METRICS,
        FilterExpression: filterExpr,
        ExpressionAttributeValues: exprValues,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }).promise();
      items = items.concat(result.Items ?? []);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    items.sort((a, b) => (b.enteredAt || '').localeCompare(a.enteredAt || ''));
    res.json({ data: items, total: items.length });
  } catch (error) {
    next(error);
  }
});

// ── Shared helper: resolve DynamoDB key for a metric item ─────────────────────
// Accepts either { pk, sk } (raw keys from scan) or legacy metricId string.
// Returns null if the input cannot be resolved to a valid key.

function resolveMetricKey(body) {
  const { pk, sk, metricId } = body;
  if (pk && sk) return { PK: pk, SK: sk };
  if (metricId) {
    // legacy format: userId#date#metric_type  (date is YYYY-MM-DD, has no #)
    const idx = metricId.indexOf('#');
    const idx2 = metricId.indexOf('#', idx + 1);
    if (idx < 0 || idx2 < 0) return null;
    return { PK: metricId.slice(0, idx), SK: metricId.slice(idx + 1) };
  }
  return null;
}

// ── Verify metric (body-based) ────────────────────────────────────────────────

router.post('/verify', checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { approved, notes } = req.body;
    const key = resolveMetricKey(req.body);
    if (!key) return res.status(400).json({ error: 'pk+sk or metricId required' });

    // Fetch the actual item so we update the correct record and enforce company scope
    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: key,
    }).promise();

    if (!existing.Item) return res.status(404).json({ error: 'Metric not found' });

    if (req.user.role !== 'superadmin' && existing.Item.companyId &&
        existing.Item.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Not authorized to verify this metric' });
    }

    const vNow = new Date().toISOString();
    const auditFields = approved
      ? ', approvedAt = :ts, approvedBy = :actor'
      : ', rejectedAt = :ts, rejectedBy = :actor, rejectionReason = :vn';
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: key,
      UpdateExpression:
        `SET verified = :v, verificationStatus = :vs, verifiedBy = :vb, verifiedAt = :va, verificationNotes = :vn${auditFields}`,
      ExpressionAttributeValues: {
        ':v': !!approved,
        ':vs': approved ? 'approved' : 'rejected',
        ':vb': req.user.id,
        ':va': vNow,
        ':vn': notes || '',
        ':ts': vNow,
        ':actor': req.user.id,
      },
    }).promise();

    const auditRef = req.body.metricId || `${key.PK}#${key.SK}`;
    await logAudit(req.user.id, 'verify_metric', auditRef, approved ? 'approved' : 'rejected', req.ip);
    res.json({ success: true });
    notifyCompany(req.user.companyId, {
      event: 'metric_verified',
      metricId: auditRef,
      approved: !!approved,
      verifiedBy: req.user.id,
    }).catch(() => {});
  } catch (error) {
    next(error);
  }
});

// ── Dismiss (delete) an orphaned pending metric ───────────────────────────────

router.post('/pending/dismiss', checkRole(['admin', 'manager']), rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const key = resolveMetricKey(req.body);
    if (!key) return res.status(400).json({ error: 'pk+sk or metricId required' });

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: key,
    }).promise();

    if (!existing.Item) return res.status(404).json({ error: 'Metric not found' });

    if (req.user.role !== 'superadmin' && existing.Item.companyId &&
        existing.Item.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Not authorized to dismiss this metric' });
    }

    await dynamodb.delete({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: key,
    }).promise();

    await logAudit(req.user.id, 'dismiss_metric', `${key.PK}#${key.SK}`, 'deleted', req.ip);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ── Verify metric (path param, admin only) ────────────────────────────────────

router.post('/verify/:metricId', adminMiddleware, rateLimit(20, 60_000), async (req, res, next) => {
  try {
    const { metricId } = req.params;
    const { approved, notes } = req.body;
    const key = resolveMetricKey({ metricId });
    if (!key) return res.status(400).json({ error: 'Invalid metricId format (expected userId#date#metric_type)' });

    const existing = await dynamodb.get({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: key,
    }).promise();
    if (!existing.Item) return res.status(404).json({ error: 'Metric not found' });

    const vNow2 = new Date().toISOString();
    const auditFields2 = approved
      ? ', approvedAt = :ts, approvedBy = :actor'
      : ', rejectedAt = :ts, rejectedBy = :actor, rejectionReason = :vn';
    await dynamodb.update({
      TableName: process.env.DYNAMODB_TABLE_METRICS,
      Key: key,
      UpdateExpression:
        `SET verified = :v, verificationStatus = :vs, verifiedBy = :vb, verifiedAt = :va, verificationNotes = :vn${auditFields2}`,
      ExpressionAttributeValues: {
        ':v': !!approved,
        ':vs': approved ? 'approved' : 'rejected',
        ':vb': req.user.id,
        ':va': vNow2,
        ':vn': notes || '',
        ':ts': vNow2,
        ':actor': req.user.id,
      },
    }).promise();
    await logAudit(req.user.id, 'verify_metric', metricId, approved ? 'approved' : 'rejected', req.ip);
    logger.info(`Metric ${metricId} ${approved ? 'approved' : 'rejected'} by ${req.user.email}`);
    res.json({ success: true, message: `Metric ${approved ? 'approved' : 'rejected'}` });
    notifyCompany(req.user.companyId, {
      event: 'metric_verified',
      metricId,
      approved: !!approved,
      verifiedBy: req.user.id,
    }).catch(() => {});
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

    const { companyId } = req.user;
    const METRICS_TABLE = process.env.DYNAMODB_TABLE_METRICS;
    const EMP_TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;

    const lbMetricsPromise = companyId
      ? queryAll({
          TableName: METRICS_TABLE,
          IndexName: 'companyIdIndex',
          KeyConditionExpression: 'companyId = :__cid',
          FilterExpression: '#date BETWEEN :start AND :end AND attribute_exists(metric_type)',
          ExpressionAttributeNames: { '#date': 'date' },
          ExpressionAttributeValues: { ':__cid': companyId, ':start': monthStart, ':end': today },
        })
      : dynamodb.scan({
          TableName: METRICS_TABLE,
          FilterExpression: '#date BETWEEN :start AND :end AND attribute_exists(metric_type)',
          ExpressionAttributeNames: { '#date': 'date' },
          ExpressionAttributeValues: { ':start': monthStart, ':end': today },
        }).promise().then((r) => r.Items ?? []);

    const lbEmpPromise = companyId
      ? queryAll({
          TableName: EMP_TABLE,
          IndexName: 'companyIdIndex',
          KeyConditionExpression: 'companyId = :__cid',
          FilterExpression: 'attribute_not_exists(#type)',
          ProjectionExpression: 'id, #r, #s',
          ExpressionAttributeNames: { '#r': 'role', '#s': 'status', '#type': 'type' },
          ExpressionAttributeValues: { ':__cid': companyId },
        })
      : dynamodb.scan({
          TableName: EMP_TABLE,
          ProjectionExpression: 'id, #r, #s',
          ExpressionAttributeNames: { '#r': 'role', '#s': 'status' },
        }).promise().then((r) => r.Items ?? []);

    const [lbMetricsItems, targetCfg, lbEmpItems] = await Promise.all([
      lbMetricsPromise,
      fetchTargetConfig(companyId),
      lbEmpPromise,
    ]);

    // Active performers only: agent / telecaller / intern
    const allowedIds = new Set(
      lbEmpItems
        .filter(e => !TEAM_EXCLUDED_ROLES.has(e.role) && e.status !== 'inactive')
        .map(e => e.id)
    );
    const activeHeadcount = allowedIds.size;

    const monthlyTargets = toMonthlyTargets(targetCfg);

    const byUser = {};
    lbMetricsItems.forEach(item => {
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

    // Custom weights map from stored config (admin-configurable per metric) — shared
    // helper also used by points.js's /award and admin.js's /points-rebuild.
    const customWeights = buildCustomWeights(targetCfg);

    const ranked = Object.values(byUser)
      .map(user => ({ ...user, points: calcPoints(user.metrics, customWeights) }))
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
    const { companyId } = req.user;
    const EMP_TABLE = process.env.DYNAMODB_TABLE_EMPLOYEES;

    const perfItems = companyId
      ? await queryAll({
          TableName: EMP_TABLE,
          IndexName: 'companyIdIndex',
          KeyConditionExpression: 'companyId = :__cid',
          FilterExpression: '#s <> :inactive AND attribute_not_exists(#type)',
          ProjectionExpression: 'id, #n, email, #r, teamLeadId',
          ExpressionAttributeNames: { '#n': 'name', '#s': 'status', '#r': 'role', '#type': 'type' },
          ExpressionAttributeValues: { ':__cid': companyId, ':inactive': 'inactive' },
        })
      : await dynamodb.scan({
          TableName: EMP_TABLE,
          ProjectionExpression: 'id, #n, email, #r, teamLeadId',
          ExpressionAttributeNames: { '#n': 'name', '#s': 'status', '#r': 'role' },
          FilterExpression: '#s <> :inactive',
          ExpressionAttributeValues: { ':inactive': 'inactive' },
        }).promise().then((r) => r.Items ?? []);

    const PERFORMER_ROLES = new Set(['agent', 'telecaller', 'intern']);
    const performers = perfItems
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

router.post('/add-for-member', checkRole(['team_lead', 'manager', 'admin']), rateLimit(20, 60_000), async (req, res, next) => {
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

    // 409 if target employee's record is already approved/rejected
    const { locked: proxyLocked, status: proxyLockedStatus } = await checkLocked(
      targetUserId, `${metricDate}#${validated.metric_type}`
    );
    if (proxyLocked) {
      return res.status(409).json({
        error: `This entry for ${target.name} has been ${proxyLockedStatus} and is locked.`,
        locked: true,
        verificationStatus: proxyLockedStatus,
      });
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
    notifyCompany(req.user.companyId, {
      event: 'metric_added',
      userId: targetUserId,
      metric_type: validated.metric_type,
      value: validated.value,
      total: totalValue,
      date: metricDate,
    }).catch(() => {});
  } catch (error) {
    next(error);
  }
});

module.exports = router;
