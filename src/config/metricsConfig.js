/**
 * Single source of truth for metric configuration on the backend.
 * Mirrors dashboard/src/lib/metrics.config.ts — keep both in sync when adding metrics.
 */

const METRIC_CONFIG = {
  kyc: {
    label: 'Telecalling (KYC)',
    target: 4,
    targetPeriod: 'day',
    dailyTarget: 4,
    pointsWeight: 10,
    isCurrency: false,
    color: '#6366f1',
  },
  demat: {
    label: 'Demat Accounts',
    target: 50,
    targetPeriod: 'month',
    dailyTarget: 50 / 30,
    pointsWeight: 15,
    isCurrency: false,
    color: '#22c55e',
  },
  mf: {
    label: 'MF Sales',
    target: 40,
    targetPeriod: 'month',
    dailyTarget: 40 / 30,
    pointsWeight: 20,
    isCurrency: false,
    color: '#f59e0b',
  },
  insurance: {
    label: 'Insurance Premium',
    target: 100000,
    targetPeriod: 'month',
    dailyTarget: 100000 / 30,
    pointsWeight: 10000,
    isCurrency: true,
    color: '#ec4899',
  },
  algo: {
    label: 'Algo Trading P&L',
    target: 10,
    targetPeriod: 'month',
    dailyTarget: 10 / 30,
    pointsWeight: 12,
    isCurrency: false,
    color: '#06b6d4',
  },
  coaching: {
    label: 'Coaching Students',
    target: 20000,
    targetPeriod: 'month',
    dailyTarget: 20000 / 30,
    pointsWeight: 1000,
    isCurrency: true,
    color: '#a855f7',
  },
  pms: {
    label: 'PMS',
    target: 10,
    targetPeriod: 'month',
    dailyTarget: 10 / 30,
    pointsWeight: 30,
    isCurrency: false,
    color: '#0ea5e9',
  },
  pro_insight: {
    label: 'Pro Insight',
    target: 15,
    targetPeriod: 'month',
    dailyTarget: 15 / 30,
    pointsWeight: 20,
    isCurrency: false,
    color: '#8b5cf6',
  },
  ltpp: {
    label: 'LTPP',
    target: 10,
    targetPeriod: 'month',
    dailyTarget: 10 / 30,
    pointsWeight: 25,
    isCurrency: false,
    color: '#14b8a6',
  },
};

const METRIC_KEYS = Object.keys(METRIC_CONFIG);

/** TARGET_DEFAULTS shape expected by targets CRUD routes */
const TARGET_DEFAULTS = Object.fromEntries(
  Object.entries(METRIC_CONFIG).map(([key, cfg]) => [
    key,
    { target: cfg.target, targetPeriod: cfg.targetPeriod },
  ])
);

function calcPoints(metricTotals, customWeights) {
  return Math.round(
    METRIC_KEYS.reduce((sum, key) => {
      const cfg = METRIC_CONFIG[key];
      const v = metricTotals[key] ?? 0;
      const w = (customWeights && customWeights[key] != null) ? customWeights[key] : cfg.pointsWeight;
      return sum + (cfg.isCurrency ? v / w : v * w);
    }, 0)
  );
}

function emptyTotals() {
  return METRIC_KEYS.reduce((o, k) => { o[k] = 0; return o; }, {});
}

function toDailyTargets(cfg) {
  return Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [
      k,
      v.targetPeriod === 'day' ? v.target : +(v.target / 30).toFixed(2),
    ])
  );
}

function toMonthlyTargets(cfg) {
  return Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [
      k,
      v.targetPeriod === 'month' ? v.target : v.target * 30,
    ])
  );
}

module.exports = {
  METRIC_CONFIG,
  METRIC_KEYS,
  TARGET_DEFAULTS,
  calcPoints,
  emptyTotals,
  toDailyTargets,
  toMonthlyTargets,
};
