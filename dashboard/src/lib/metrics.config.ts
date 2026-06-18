// Single source of truth for every metric the dashboard knows about.
// Add a new metric by adding one entry here - no other code changes needed
// (cards, charts, leaderboard, and CSV export all read from this config).

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
  icon: string; // emoji, keeps this dependency-free
}

export const METRICS: MetricConfig[] = [
  {
    key: 'kyc',
    label: 'Telecalling (KYC)',
    unit: 'count',
    target: 4,
    targetPeriod: 'day',
    color: '#6366f1',
    icon: '📞'
  },
  {
    key: 'demat',
    label: 'Demat Accounts',
    unit: 'count',
    target: 50,
    targetPeriod: 'month',
    color: '#22c55e',
    icon: '🏦'
  },
  {
    key: 'mf',
    label: 'MF Sales',
    unit: 'count',
    target: 40,
    targetPeriod: 'month',
    color: '#f59e0b',
    icon: '📈'
  },
  {
    key: 'insurance',
    label: 'Insurance Premium',
    unit: 'currency',
    target: 100000,
    targetPeriod: 'month',
    color: '#ec4899',
    icon: '🛡️'
  },
  {
    key: 'algo',
    label: 'Algo Trading P&L',
    unit: 'count',
    target: 10,
    targetPeriod: 'month',
    color: '#06b6d4',
    icon: '🤖'
  },
  {
    key: 'coaching',
    label: 'Coaching Students',
    unit: 'currency',
    target: 20000,
    targetPeriod: 'month',
    color: '#a855f7',
    icon: '🎓'
  }
  // Future metrics (webinar signups, client retention, etc.) just get
  // appended here.
];

export const getMetricConfig = (key: string): MetricConfig | undefined =>
  METRICS.find((m) => m.key === key);

/** Daily target, normalizing monthly targets to a per-day figure (30-day month) */
export const dailyTarget = (metric: MetricConfig): number =>
  metric.targetPeriod === 'day' ? metric.target : metric.target / 30;

export const formatMetricValue = (metric: MetricConfig, value: number): string => {
  if (metric.unit === 'currency') {
    return `₹${value.toLocaleString('en-IN')}`;
  }
  return value.toLocaleString('en-IN');
};
