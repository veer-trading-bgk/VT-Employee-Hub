const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { METRIC_CONFIG, METRIC_KEYS, TARGET_DEFAULTS } = require('../config/metricsConfig');
const dynamodb = require('../config/dynamodb');
const bot = require('../config/telegram');
const logger = require('../config/logger');

const router = express.Router();
const TABLE = process.env.DYNAMODB_TABLE_METRICS;
const TABLE_EMP = process.env.DYNAMODB_TABLE_EMPLOYEES;

// ── Defaults ───────────────────────────────────────────────────────────────────

// Point 2: pms / pro_insight / ltpp now included — they were silently zero before
const DEFAULT_INCENTIVE_RATES = {
  kyc:         { value: 200, type: 'flat' },
  demat:       { value: 300, type: 'flat' },
  mf:          { value: 250, type: 'flat' },
  insurance:   { value: 2,   type: 'percent' },
  algo:        { value: 100, type: 'flat' },
  coaching:    { value: 50,  type: 'flat' },
  pms:         { value: 500, type: 'flat' },
  pro_insight: { value: 300, type: 'flat' },
  ltpp:        { value: 400, type: 'flat' },
};

// Point 7: tiered slabs replace single threshold/pct
const DEFAULT_BONUS_SLABS = [
  { minBase: 30000, pct: 5  },
  { minBase: 50000, pct: 10 },
  { minBase: 75000, pct: 15 },
];

// ── Pure helpers ───────────────────────────────────────────────────────────────

function ratesKey(companyId) {
  return { PK: companyId ? `CONFIG#RATES#${companyId}` : 'CONFIG#RATES', SK: 'current' };
}

function payrollKey(companyId, month) {
  return { PK: companyId ? `PAYROLL#${companyId}#${month}` : `PAYROLL#${month}`, SK: 'SNAPSHOT' };
}

function adjustmentPK(companyId, month) {
  return companyId ? `ADJUSTMENT#${companyId}#${month}` : `ADJUSTMENT#${month}`;
}

function parseMonth(raw) {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeRates(raw) {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? { value: v, type: 'flat' } : v])
  );
}

// Backward compat: old config stored bonusThreshold/bonusPct, new stores bonusSlabs
function normalizeSlabs(item) {
  if (item.bonusSlabs) return item.bonusSlabs;
  if (item.bonusThreshold != null) return [{ minBase: item.bonusThreshold, pct: item.bonusPct ?? 10 }];
  return DEFAULT_BONUS_SLABS;
}

function calcAmount(metricValue, rateCfg) {
  if (!rateCfg) return 0;
  return rateCfg.type === 'percent'
    ? Math.round(metricValue * rateCfg.value / 100)
    : Math.round(metricValue * rateCfg.value);
}

// Point 7: highest qualifying slab wins
function calcBonus(base, slabs) {
  const qualifying = [...slabs]
    .sort((a, b) => b.minBase - a.minBase)
    .find(s => base >= s.minBase);
  return qualifying ? Math.round(base * qualifying.pct / 100) : 0;
}

// Point 1: paginated scan — no Limit truncation
async function scanAll(params) {
  const items = [];
  let lastKey;
  const p = { ...params };
  delete p.Limit;
  do {
    if (lastKey) p.ExclusiveStartKey = lastKey;
    const result = await dynamodb.scan(p).promise();
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function loadRates(companyId) {
  try {
    const result = await dynamodb.get({ TableName: TABLE, Key: ratesKey(companyId) }).promise();
    if (result.Item) {
      return {
        rates: normalizeRates(result.Item.rates ?? DEFAULT_INCENTIVE_RATES),
        bonusSlabs: normalizeSlabs(result.Item),
      };
    }
  } catch (err) {
    logger.warn('loadRates fallback to defaults', err.message);
  }
  return { rates: DEFAULT_INCENTIVE_RATES, bonusSlabs: DEFAULT_BONUS_SLABS };
}

async function loadTargets(companyId) {
  try {
    const pk = companyId ? `CONFIG#TARGETS#${companyId}` : 'CONFIG#TARGETS';
    const r = await dynamodb.get({ TableName: TABLE, Key: { PK: pk, SK: 'current' } }).promise();
    return r.Item?.targets ?? TARGET_DEFAULTS;
  } catch {
    return TARGET_DEFAULTS;
  }
}

function buildPayrollEntries(metricsItems, rates, bonusSlabs) {
  const byUser = {};
  metricsItems.forEach((item) => {
    if (item.verificationStatus === 'rejected') return;
    const uid = item.userId ?? item.PK;
    if (!uid || !item.metric_type) return;
    if (!byUser[uid]) byUser[uid] = {};
    byUser[uid][item.metric_type] = (byUser[uid][item.metric_type] ?? 0) + (item.value ?? 0);
  });

  return Object.entries(byUser).map(([userId, metrics]) => {
    let base = 0;
    Object.entries(metrics).forEach(([k, v]) => { base += calcAmount(v, rates[k]); });
    const bonus = calcBonus(base, bonusSlabs);
    return { userId, base, bonus, total: base + bonus, metrics };
  }).sort((a, b) => b.total - a.total);
}

// ── GET /api/compensation/rates ────────────────────────────────────────────────

router.get('/rates', authMiddleware, async (req, res, next) => {
  try {
    const config = await loadRates(req.user.companyId);
    res.json({ success: true, ...config, defaults: DEFAULT_INCENTIVE_RATES, defaultSlabs: DEFAULT_BONUS_SLABS });
  } catch (error) { next(error); }
});

// ── PUT /api/compensation/rates ────────────────────────────────────────────────

router.put('/rates', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { rates, bonusSlabs } = req.body;

    if (!rates || typeof rates !== 'object') return res.status(400).json({ error: 'rates object required' });
    for (const [key, val] of Object.entries(rates)) {
      if (!val || typeof val !== 'object') return res.status(400).json({ error: `Rate for "${key}" must be an object` });
      if (typeof val.value !== 'number' || val.value < 0) return res.status(400).json({ error: `Rate value for "${key}" must be non-negative` });
      if (!['flat', 'percent'].includes(val.type)) return res.status(400).json({ error: `Rate type for "${key}" must be flat or percent` });
      if (val.type === 'percent' && val.value > 100) return res.status(400).json({ error: `Percent rate for "${key}" cannot exceed 100` });
    }
    if (bonusSlabs != null) {
      if (!Array.isArray(bonusSlabs) || bonusSlabs.length === 0) return res.status(400).json({ error: 'bonusSlabs must be a non-empty array' });
      for (const s of bonusSlabs) {
        if (typeof s.minBase !== 'number' || s.minBase < 0) return res.status(400).json({ error: 'Each slab needs a non-negative minBase' });
        if (typeof s.pct !== 'number' || s.pct < 0 || s.pct > 100) return res.status(400).json({ error: 'Slab pct must be 0–100' });
      }
    }

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        ...ratesKey(req.user.companyId),
        rates,
        bonusSlabs: bonusSlabs ?? DEFAULT_BONUS_SLABS,
        updatedBy: req.user.id,
        updatedAt: new Date().toISOString(),
      },
    }).promise();

    await logAudit(req.user.id, 'update_incentive_rates', 'config', 'success', req.ip, { rates, bonusSlabs });
    logger.info(`Admin ${req.user.email} updated incentive rates`);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ── DELETE /api/compensation/rates ─────────────────────────────────────────────

router.delete('/rates', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.delete({ TableName: TABLE, Key: ratesKey(req.user.companyId) }).promise();
    await logAudit(req.user.id, 'reset_incentive_rates', 'config', 'success', req.ip);
    res.json({ success: true, message: 'Rates reset to defaults' });
  } catch (error) { next(error); }
});

// ── GET /api/compensation/calculate/:userId ────────────────────────────────────
// Points 3 (month param), 7 (slab bonus), 11 (projected payout)

router.get('/calculate/:userId', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (['telecaller', 'agent', 'intern'].includes(req.user.role) && req.user.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const month = parseMonth(req.query.month);
    const [metricsItems, { rates, bonusSlabs }] = await Promise.all([
      scanAll({
        TableName: TABLE,
        FilterExpression: 'userId = :uid AND begins_with(#date, :month)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':uid': userId, ':month': month },
      }),
      loadRates(req.user.companyId),
    ]);

    const totals = {};
    metricsItems.forEach((item) => {
      if (item.verificationStatus === 'rejected') return;
      totals[item.metric_type] = (totals[item.metric_type] ?? 0) + (item.value ?? 0);
    });

    let baseCompensation = 0;
    const breakdown = {};
    Object.entries(totals).forEach(([key, metricValue]) => {
      const rateCfg = rates[key];
      if (!rateCfg) return;
      const amount = calcAmount(metricValue, rateCfg);
      breakdown[key] = { value: Math.round(metricValue), rate: rateCfg, amount };
      baseCompensation += amount;
    });

    const performanceBonus = calcBonus(baseCompensation, bonusSlabs);
    const totalCompensation = baseCompensation + performanceBonus;

    // Point 11: projected end-of-month
    const [year, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mo, 0).getDate();
    const now = new Date();
    const isCurrentMonth = now.getMonth() + 1 === mo && now.getFullYear() === year;
    const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;
    const projectedTotal = daysElapsed > 0
      ? Math.round(totalCompensation / daysElapsed * daysInMonth)
      : totalCompensation;

    // Qualifying slab info for transparency
    const qualifyingSlab = [...bonusSlabs]
      .sort((a, b) => b.minBase - a.minBase)
      .find(s => baseCompensation >= s.minBase);
    const nextSlab = [...bonusSlabs]
      .sort((a, b) => a.minBase - b.minBase)
      .find(s => s.minBase > baseCompensation);

    await logAudit(req.user.id, 'view_compensation', userId, 'success', req.ip);

    res.json({
      month,
      breakdown,
      baseCompensation,
      performanceBonus,
      totalCompensation,
      projectedTotal,
      bonusSlabs,
      qualifyingSlab: qualifyingSlab ?? null,
      nextSlab: nextSlab ?? null,
      daysElapsed,
      daysInMonth,
    });
  } catch (error) {
    logger.error('compensation/calculate error', error);
    next(error);
  }
});

// ── GET /api/compensation/history/:userId ──────────────────────────────────────
// Returns last N months from snapshots (finalized data only)

router.get('/history/:userId', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (['telecaller', 'agent', 'intern'].includes(req.user.role) && req.user.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const months = Math.min(parseInt(req.query.months ?? '6', 10), 24);
    const history = [];

    for (let i = 1; i <= months; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const snap = await dynamodb.get({
        TableName: TABLE,
        Key: payrollKey(req.user.companyId, month),
      }).promise();

      if (snap.Item && snap.Item.status !== 'draft') {
        const entry = (snap.Item.payroll ?? []).find(e => e.userId === userId);
        if (entry) {
          history.push({
            month,
            base: entry.base,
            bonus: entry.bonus,
            adjustments: entry.adjustments ?? 0,
            total: entry.finalTotal ?? entry.total,
            status: snap.Item.status,
          });
          continue;
        }
      }
      history.push({ month, base: 0, bonus: 0, adjustments: 0, total: 0, status: 'no_data' });
    }

    res.json({ success: true, userId, history: history.reverse() });
  } catch (error) { next(error); }
});

// ── GET /api/compensation/payroll ──────────────────────────────────────────────
// Points 3 (month param), 5 (manager access), 4 (returns snapshot when exists)

router.get('/payroll', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const month = parseMonth(req.query.month);

    // Return snapshot if it's past draft
    const snapResult = await dynamodb.get({
      TableName: TABLE,
      Key: payrollKey(req.user.companyId, month),
    }).promise();

    if (snapResult.Item && snapResult.Item.status !== 'draft') {
      await logAudit(req.user.id, 'view_payroll', month, 'success', req.ip);
      return res.json({
        month,
        count: snapResult.Item.payroll?.length ?? 0,
        payroll: snapResult.Item.payroll ?? [],
        adjustments: snapResult.Item.adjustments ?? [],
        rates: snapResult.Item.rates,
        bonusSlabs: snapResult.Item.bonusSlabs,
        status: snapResult.Item.status,
        totalBase: snapResult.Item.totalBase,
        totalBonus: snapResult.Item.totalBonus,
        totalAdjustments: snapResult.Item.totalAdjustments,
        totalPayout: snapResult.Item.totalPayout,
        fromSnapshot: true,
        lockedAt: snapResult.Item.lockedAt,
        lockedBy: snapResult.Item.lockedBy,
        approvedAt: snapResult.Item.approvedAt,
      });
    }

    // Live calculation
    const [metricsItems, { rates, bonusSlabs }, adjItems] = await Promise.all([
      scanAll({
        TableName: TABLE,
        FilterExpression: 'begins_with(#date, :month) AND attribute_exists(metric_type)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':month': month },
      }),
      loadRates(req.user.companyId),
      scanAll({
        TableName: TABLE,
        FilterExpression: 'PK = :pk AND SK <> :snap',
        ExpressionAttributeValues: {
          ':pk': adjustmentPK(req.user.companyId, month),
          ':snap': 'SNAPSHOT',
        },
      }),
    ]);

    const payroll = buildPayrollEntries(metricsItems, rates, bonusSlabs);

    await logAudit(req.user.id, 'view_payroll', month, 'success', req.ip);
    res.json({
      month,
      count: payroll.length,
      payroll,
      adjustments: adjItems,
      rates,
      bonusSlabs,
      status: snapResult.Item?.status ?? 'draft',
      fromSnapshot: false,
    });
  } catch (error) {
    logger.error('compensation/payroll error', error);
    next(error);
  }
});

// ── POST /api/compensation/payroll/snapshot ────────────────────────────────────
// Points 4 (snapshot), 9 (target achievement bonus)

router.post('/payroll/snapshot', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const month = parseMonth(req.body.month ?? req.query.month);

    const existing = await dynamodb.get({
      TableName: TABLE,
      Key: payrollKey(req.user.companyId, month),
    }).promise();

    if (existing.Item?.status === 'locked') {
      return res.status(409).json({ error: 'Payroll for this month is already locked' });
    }

    const [metricsItems, { rates, bonusSlabs }, targetCfg, adjItems] = await Promise.all([
      scanAll({
        TableName: TABLE,
        FilterExpression: 'begins_with(#date, :month) AND attribute_exists(metric_type)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':month': month },
      }),
      loadRates(req.user.companyId),
      loadTargets(req.user.companyId),
      scanAll({
        TableName: TABLE,
        FilterExpression: 'PK = :pk AND SK <> :snap',
        ExpressionAttributeValues: {
          ':pk': adjustmentPK(req.user.companyId, month),
          ':snap': 'SNAPSHOT',
        },
      }),
    ]);

    const basePayroll = buildPayrollEntries(metricsItems, rates, bonusSlabs);

    // Point 9: monthly target achievement % per employee
    const [year, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mo, 0).getDate();
    const monthlyTargets = Object.fromEntries(
      Object.entries(targetCfg).map(([k, v]) => [
        k,
        v.targetPeriod === 'month' ? v.target : v.target * daysInMonth,
      ])
    );

    const enrichedPayroll = basePayroll.map(entry => {
      const pcts = METRIC_KEYS.map(k => {
        const t = monthlyTargets[k] ?? 0;
        const a = entry.metrics[k] ?? 0;
        return t > 0 ? Math.min(Math.round((a / t) * 100), 200) : 0;
      });
      const avgAchievement = pcts.length > 0
        ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length)
        : 0;

      const adj = adjItems
        .filter(a => a.userId === entry.userId)
        .reduce((s, a) => s + (a.amount ?? 0), 0);

      return {
        ...entry,
        avgAchievement,
        adjustments: adj,
        finalTotal: entry.total + adj,
      };
    });

    const totalBase        = enrichedPayroll.reduce((s, e) => s + e.base, 0);
    const totalBonus       = enrichedPayroll.reduce((s, e) => s + e.bonus, 0);
    const totalAdjustments = enrichedPayroll.reduce((s, e) => s + e.adjustments, 0);
    const totalPayout      = enrichedPayroll.reduce((s, e) => s + e.finalTotal, 0);

    await dynamodb.put({
      TableName: TABLE,
      Item: {
        ...payrollKey(req.user.companyId, month),
        month,
        status: 'reviewing',
        payroll: enrichedPayroll,
        adjustments: adjItems,
        rates,
        bonusSlabs,
        totalBase,
        totalBonus,
        totalAdjustments,
        totalPayout,
        employeeCount: enrichedPayroll.length,
        createdAt: existing.Item?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: existing.Item?.createdBy ?? req.user.id,
        updatedBy: req.user.id,
      },
    }).promise();

    await logAudit(req.user.id, 'create_payroll_snapshot', month, 'success', req.ip, { employeeCount: enrichedPayroll.length, totalPayout });
    logger.info(`Admin ${req.user.email} created payroll snapshot for ${month}: ₹${totalPayout}`);

    res.json({ success: true, month, status: 'reviewing', employeeCount: enrichedPayroll.length, totalPayout });
  } catch (error) {
    logger.error('payroll/snapshot error', error);
    next(error);
  }
});

// ── PUT /api/compensation/payroll/status ───────────────────────────────────────
// Points 6 (workflow) + 13 (Telegram on lock)

router.put('/payroll/status', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { month: rawMonth, status } = req.body;
    const month = parseMonth(rawMonth);

    const VALID_STATUSES = ['draft', 'reviewing', 'approved', 'locked'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const existing = await dynamodb.get({
      TableName: TABLE,
      Key: payrollKey(req.user.companyId, month),
    }).promise();

    if (!existing.Item) {
      return res.status(404).json({ error: 'No snapshot found. Create one first via POST /payroll/snapshot.' });
    }
    if (existing.Item.status === 'locked' && status !== 'locked') {
      return res.status(409).json({ error: 'Cannot change status of a locked payroll' });
    }

    const extraAttrs = {};
    if (status === 'approved') { extraAttrs.approvedAt = new Date().toISOString(); extraAttrs.approvedBy = req.user.id; }
    if (status === 'locked')   { extraAttrs.lockedAt   = new Date().toISOString(); extraAttrs.lockedBy   = req.user.id; }

    const setClauses = ['#s = :s', 'updatedAt = :ua', 'updatedBy = :ub'];
    const attrValues = { ':s': status, ':ua': new Date().toISOString(), ':ub': req.user.id };
    if (status === 'approved') { setClauses.push('approvedAt = :aa', 'approvedBy = :ab'); attrValues[':aa'] = extraAttrs.approvedAt; attrValues[':ab'] = req.user.id; }
    if (status === 'locked')   { setClauses.push('lockedAt = :la', 'lockedBy = :lb');     attrValues[':la'] = extraAttrs.lockedAt;   attrValues[':lb'] = req.user.id; }

    await dynamodb.update({
      TableName: TABLE,
      Key: payrollKey(req.user.companyId, month),
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: attrValues,
    }).promise();

    await logAudit(req.user.id, `payroll_${status}`, month, 'success', req.ip);
    logger.info(`Payroll ${month} → ${status} by ${req.user.email}`);

    // Point 13: Telegram notification on lock
    if (status === 'locked') {
      const snap = await dynamodb.get({ TableName: TABLE, Key: payrollKey(req.user.companyId, month) }).promise();
      const payroll = snap.Item?.payroll ?? [];

      payroll.forEach(async (entry) => {
        try {
          const emp = await dynamodb.get({ TableName: TABLE_EMP, Key: { id: entry.userId } }).promise();
          const telegramId = emp.Item?.telegramId;
          if (!telegramId) return;

          const adjLine = entry.adjustments && entry.adjustments !== 0
            ? `\n⚡ Adjustments: ₹${entry.adjustments.toLocaleString('en-IN')}`
            : '';
          const achieveLine = entry.avgAchievement != null
            ? `\n🎯 Target Achievement: ${entry.avgAchievement}%`
            : '';

          const msg = [
            `💰 *Payroll Finalised — ${month}*`,
            ``,
            `📊 Base Incentive: ₹${entry.base.toLocaleString('en-IN')}`,
            `🎁 Performance Bonus: ₹${entry.bonus.toLocaleString('en-IN')}${adjLine}${achieveLine}`,
            ``,
            `✅ *Total Payout: ₹${(entry.finalTotal ?? entry.total).toLocaleString('en-IN')}*`,
          ].join('\n');

          await bot.sendMessage(telegramId, msg, { parse_mode: 'Markdown' });
        } catch (e) {
          logger.warn(`Telegram notify failed for ${entry.userId}: ${e.message}`);
        }
      });
    }

    res.json({ success: true, month, status });
  } catch (error) {
    logger.error('payroll/status error', error);
    next(error);
  }
});

// ── GET /api/compensation/adjustments ─────────────────────────────────────────
// Point 8

router.get('/adjustments', authMiddleware, checkRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const month = parseMonth(req.query.month);
    const items = await scanAll({
      TableName: TABLE,
      FilterExpression: 'PK = :pk AND SK <> :snap',
      ExpressionAttributeValues: {
        ':pk': adjustmentPK(req.user.companyId, month),
        ':snap': 'SNAPSHOT',
      },
    });
    res.json({ success: true, month, adjustments: items });
  } catch (error) { next(error); }
});

// ── POST /api/compensation/adjustments ────────────────────────────────────────

router.post('/adjustments', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { userId, month: rawMonth, amount, reason, type } = req.body;
    const month = parseMonth(rawMonth);

    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (typeof amount !== 'number') return res.status(400).json({ error: 'amount must be a number (positive = bonus, negative = deduction)' });
    if (!reason?.trim()) return res.status(400).json({ error: 'reason required' });
    if (!['bonus', 'deduction', 'correction'].includes(type)) {
      return res.status(400).json({ error: 'type must be bonus, deduction, or correction' });
    }

    const snap = await dynamodb.get({ TableName: TABLE, Key: payrollKey(req.user.companyId, month) }).promise();
    if (snap.Item?.status === 'locked') {
      return res.status(409).json({ error: 'Cannot add adjustments to a locked payroll' });
    }

    const sk = `${userId}#${Date.now()}`;
    await dynamodb.put({
      TableName: TABLE,
      Item: {
        PK: adjustmentPK(req.user.companyId, month),
        SK: sk,
        userId,
        month,
        amount,
        reason: reason.trim(),
        type,
        addedBy: req.user.id,
        addedAt: new Date().toISOString(),
      },
    }).promise();

    await logAudit(req.user.id, 'add_adjustment', `${userId}#${month}`, 'success', req.ip, { amount, reason, type });
    res.status(201).json({ success: true, id: sk });
  } catch (error) { next(error); }
});

// ── DELETE /api/compensation/adjustments/:id ───────────────────────────────────

router.delete('/adjustments/:id', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const month = parseMonth(req.query.month);

    const snap = await dynamodb.get({ TableName: TABLE, Key: payrollKey(req.user.companyId, month) }).promise();
    if (snap.Item?.status === 'locked') {
      return res.status(409).json({ error: 'Cannot remove adjustments from a locked payroll' });
    }

    await dynamodb.delete({
      TableName: TABLE,
      Key: { PK: adjustmentPK(req.user.companyId, month), SK: id },
    }).promise();

    await logAudit(req.user.id, 'delete_adjustment', id, 'success', req.ip);
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
