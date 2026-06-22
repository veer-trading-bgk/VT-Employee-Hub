const express = require('express');
const { authMiddleware, checkRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const dynamodb = require('../config/dynamodb');
const logger = require('../config/logger');

const router = express.Router();
const TABLE_METRICS = process.env.DYNAMODB_TABLE_METRICS;

// Each rate is { value: number, type: 'flat' | 'percent' }
// flat    → incentive = metricValue * value          (₹ per unit)
// percent → incentive = metricValue * value / 100   (% of metric value, for currency metrics like insurance)
const DEFAULT_INCENTIVE_RATES = {
  kyc:       { value: 200, type: 'flat' },
  demat:     { value: 300, type: 'flat' },
  mf:        { value: 250, type: 'flat' },
  insurance: { value: 2,   type: 'percent' },
  algo:      { value: 100, type: 'flat' },
  coaching:  { value: 50,  type: 'flat' },
};
const DEFAULT_BONUS_THRESHOLD = 50000;
const DEFAULT_BONUS_PCT = 10;

function ratesKey(companyId) {
  return { PK: companyId ? `CONFIG#RATES#${companyId}` : 'CONFIG#RATES', SK: 'current' };
}

function normalizeRates(raw) {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k,
      typeof v === 'number' ? { value: v, type: 'flat' } : v,
    ])
  );
}

function calcAmount(metricValue, rateCfg) {
  if (!rateCfg) return 0;
  return rateCfg.type === 'percent'
    ? Math.round(metricValue * rateCfg.value / 100)
    : Math.round(metricValue * rateCfg.value);
}

async function loadRates(companyId) {
  try {
    const result = await dynamodb.get({ TableName: TABLE_METRICS, Key: ratesKey(companyId) }).promise();
    if (result.Item) {
      return {
        rates: normalizeRates(result.Item.rates ?? DEFAULT_INCENTIVE_RATES),
        bonusThreshold: result.Item.bonusThreshold ?? DEFAULT_BONUS_THRESHOLD,
        bonusPct: result.Item.bonusPct ?? DEFAULT_BONUS_PCT,
      };
    }
  } catch (err) {
    logger.warn('loadRates fallback to defaults', err.message);
  }
  return { rates: DEFAULT_INCENTIVE_RATES, bonusThreshold: DEFAULT_BONUS_THRESHOLD, bonusPct: DEFAULT_BONUS_PCT };
}

// GET /api/compensation/rates
router.get('/rates', authMiddleware, async (req, res, next) => {
  try {
    const config = await loadRates(req.user.companyId);
    res.json({ success: true, ...config, defaults: DEFAULT_INCENTIVE_RATES });
  } catch (error) {
    next(error);
  }
});

// PUT /api/compensation/rates — admin only
router.put('/rates', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const { rates, bonusThreshold, bonusPct } = req.body;

    if (!rates || typeof rates !== 'object') {
      return res.status(400).json({ error: 'rates object required' });
    }
    for (const [key, val] of Object.entries(rates)) {
      if (!val || typeof val !== 'object') {
        return res.status(400).json({ error: `Rate for "${key}" must be an object with value and type` });
      }
      if (typeof val.value !== 'number' || val.value < 0) {
        return res.status(400).json({ error: `Rate value for "${key}" must be a non-negative number` });
      }
      if (!['flat', 'percent'].includes(val.type)) {
        return res.status(400).json({ error: `Rate type for "${key}" must be "flat" or "percent"` });
      }
      if (val.type === 'percent' && val.value > 100) {
        return res.status(400).json({ error: `Percent rate for "${key}" cannot exceed 100` });
      }
    }
    if (bonusThreshold !== undefined && (typeof bonusThreshold !== 'number' || bonusThreshold < 0)) {
      return res.status(400).json({ error: 'bonusThreshold must be a non-negative number' });
    }
    if (bonusPct !== undefined && (typeof bonusPct !== 'number' || bonusPct < 0 || bonusPct > 100)) {
      return res.status(400).json({ error: 'bonusPct must be between 0 and 100' });
    }

    const key = ratesKey(req.user.companyId);
    await dynamodb.put({
      TableName: TABLE_METRICS,
      Item: {
        ...key,
        rates,
        bonusThreshold: bonusThreshold ?? DEFAULT_BONUS_THRESHOLD,
        bonusPct: bonusPct ?? DEFAULT_BONUS_PCT,
        updatedBy: req.user.id,
        updatedAt: new Date().toISOString(),
      },
    }).promise();

    await logAudit(req.user.id, 'update_incentive_rates', 'config', 'success', req.ip, { rates, bonusThreshold, bonusPct });
    logger.info(`Admin ${req.user.email} updated incentive rates`);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/compensation/rates — reset to defaults
router.delete('/rates', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    await dynamodb.delete({ TableName: TABLE_METRICS, Key: ratesKey(req.user.companyId) }).promise();
    await logAudit(req.user.id, 'reset_incentive_rates', 'config', 'success', req.ip);
    res.json({ success: true, message: 'Rates reset to defaults' });
  } catch (error) {
    next(error);
  }
});

// GET /api/compensation/calculate/:userId
router.get('/calculate/:userId', authMiddleware, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (req.user.role === 'telecaller' && req.user.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const monthPrefix = `${year}-${month}`;

    const [metricsResult, { rates, bonusThreshold, bonusPct }] = await Promise.all([
      dynamodb.scan({
        TableName: TABLE_METRICS,
        FilterExpression: 'userId = :uid AND begins_with(#date, :month)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':uid': userId, ':month': monthPrefix },
        Limit: 1000,
      }).promise(),
      loadRates(req.user.companyId),
    ]);

    const totals = {};
    (metricsResult.Items ?? []).forEach((item) => {
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

    const performanceBonus = baseCompensation >= bonusThreshold ? Math.round(baseCompensation * bonusPct / 100) : 0;
    const totalCompensation = baseCompensation + performanceBonus;

    await logAudit(req.user.id, 'view_compensation', userId, 'success', req.ip);

    res.json({ month: parseInt(month), year, breakdown, baseCompensation, performanceBonus, totalCompensation });
  } catch (error) {
    logger.error('compensation/calculate error', error);
    next(error);
  }
});

// GET /api/compensation/payroll — admin: all employees this month
router.get('/payroll', authMiddleware, checkRole(['admin']), async (req, res, next) => {
  try {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [metricsResult, { rates, bonusThreshold, bonusPct }] = await Promise.all([
      dynamodb.scan({
        TableName: TABLE_METRICS,
        FilterExpression: 'begins_with(#date, :month)',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: { ':month': monthPrefix },
        Limit: 5000,
      }).promise(),
      loadRates(req.user.companyId),
    ]);

    const byUser = {};
    (metricsResult.Items ?? []).forEach((item) => {
      if (item.verificationStatus === 'rejected') return;
      const uid = item.userId ?? item.PK;
      if (!byUser[uid]) byUser[uid] = {};
      byUser[uid][item.metric_type] = (byUser[uid][item.metric_type] ?? 0) + (item.value ?? 0);
    });

    const payroll = Object.entries(byUser).map(([userId, metrics]) => {
      let base = 0;
      Object.entries(metrics).forEach(([k, v]) => {
        base += calcAmount(v, rates[k]);
      });
      const bonus = base >= bonusThreshold ? Math.round(base * bonusPct / 100) : 0;
      return { userId, base, bonus, total: base + bonus, metrics };
    }).sort((a, b) => b.total - a.total);

    await logAudit(req.user.id, 'view_payroll', 'all', 'success', req.ip);
    res.json({ month: monthPrefix, count: payroll.length, payroll, rates, bonusThreshold, bonusPct });
  } catch (error) {
    logger.error('compensation/payroll error', error);
    next(error);
  }
});

module.exports = router;
