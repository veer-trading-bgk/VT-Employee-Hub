// Single source of truth for every metric the dashboard knows about.
// To add a new metric: append one entry to METRICS below, then add the
// same key to METRIC_KEYS in the backend analytics route.
// Everything else (cards, charts, leaderboard, CSV export, daily entry)
// reads from this config automatically.

export type MetricUnit = 'count' | 'currency';
export type TargetPeriod = 'day' | 'month';

export interface MetricConfig {
  /** Matches the `metric_type` field stored in DynamoDB / sent by the API */
  key: string;
  label: string;
  unit: MetricUnit;
  /** Numeric target for the given period */
  target: number;
  targetPeriod: TargetPeriod;
  /** Tailwind color tokens used consistently across cards/charts */
  color: string;
  icon: string;
  /**
   * Weight used in the points formula: points += value * pointsWeight
   * For currency metrics (unit === 'currency'), divide value by this
   * weight instead (i.e. ₹10,000 insurance = 1 point when weight=10000).
   * Defaults to 1 if omitted.
   */
  pointsWeight: number;
}

export const METRICS: MetricConfig[] = [
  // ── Core products ───────────────────────────────────────────────────────────
  {
    key: 'kyc',
    label: 'Telecalling (KYC)',
    unit: 'count',
    target: 4,
    targetPeriod: 'day',
    color: '#6366f1',
    icon: '📞',
    pointsWeight: 10,
  },
  {
    key: 'demat',
    label: 'Demat Accounts',
    unit: 'count',
    target: 50,
    targetPeriod: 'month',
    color: '#22c55e',
    icon: '🏦',
    pointsWeight: 15,
  },
  {
    key: 'mf',
    label: 'MF Sales',
    unit: 'count',
    target: 40,
    targetPeriod: 'month',
    color: '#f59e0b',
    icon: '📈',
    pointsWeight: 20,
  },
  {
    key: 'insurance',
    label: 'Insurance Premium',
    unit: 'currency',
    target: 100000,
    targetPeriod: 'month',
    color: '#ec4899',
    icon: '🛡️',
    pointsWeight: 10000, // ₹10,000 = 1 point
  },
  {
    key: 'algo',
    label: 'Algo Trading P&L',
    unit: 'count',
    target: 10,
    targetPeriod: 'month',
    color: '#06b6d4',
    icon: '🤖',
    pointsWeight: 12,
  },
  {
    key: 'coaching',
    label: 'Coaching Students',
    unit: 'currency',
    target: 20000,
    targetPeriod: 'month',
    color: '#a855f7',
    icon: '🎓',
    pointsWeight: 1000, // ₹1,000 = 1 point
  },
  // ── Matrix products ─────────────────────────────────────────────────────────
  {
    key: 'pms',
    label: 'PMS',
    unit: 'count',
    target: 10,
    targetPeriod: 'month',
    color: '#0ea5e9',
    icon: '💼',
    pointsWeight: 30,
  },
  {
    key: 'pro_insight',
    label: 'Pro Insight',
    unit: 'count',
    target: 15,
    targetPeriod: 'month',
    color: '#8b5cf6',
    icon: '💡',
    pointsWeight: 20,
  },
  {
    key: 'ltpp',
    label: 'LTPP',
    unit: 'count',
    target: 10,
    targetPeriod: 'month',
    color: '#14b8a6',
    icon: '📋',
    pointsWeight: 25,
  },
];

// Derived helpers — computed once, used everywhere

export const METRIC_KEYS = METRICS.map((m) => m.key);

export const getMetricConfig = (key: string): MetricConfig | undefined =>
  METRICS.find((m) => m.key === key);

/** Daily target, normalizing monthly targets to a per-day figure (30-day month) */
export const dailyTarget = (metric: MetricConfig): number =>
  metric.targetPeriod === 'day' ? metric.target : metric.target / 30;

/** Full monthly target, normalizing day-based targets to a 30-day figure */
export const monthlyTarget = (metric: MetricConfig): number =>
  metric.targetPeriod === 'month' ? metric.target : metric.target * 30;

export const formatMetricValue = (metric: MetricConfig, value: number): string =>
  metric.unit === 'currency'
    ? `₹${value.toLocaleString('en-IN')}`
    : value.toLocaleString('en-IN');

/**
 * Calculate points for a single employee's metric totals.
 * For count metrics:    points += value * pointsWeight
 * For currency metrics: points += value / pointsWeight
 */
export const calcPoints = (metricTotals: Record<string, number>): number =>
  Math.round(
    METRICS.reduce((sum, m) => {
      const v = metricTotals[m.key] ?? 0;
      return sum + (m.unit === 'currency' ? v / m.pointsWeight : v * m.pointsWeight);
    }, 0)
  );
