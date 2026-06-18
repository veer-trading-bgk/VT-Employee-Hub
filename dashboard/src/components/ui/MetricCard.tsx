import { formatMetricValue, type MetricConfig } from '@/lib/metrics.config';

interface MetricCardProps {
  metric: MetricConfig;
  value: number;
  target: number;
  progress: number;
}

export function MetricCard({ metric, value, target, progress }: MetricCardProps) {
  const barColor = progress >= 100 ? 'bg-emerald-500' : progress >= 50 ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{metric.icon}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            progress >= 100
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
          }`}
        >
          {progress}%
        </span>
      </div>
      <h3 className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">{metric.label}</h3>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
        {formatMetricValue(metric, value)}
      </p>
      <p className="text-xs text-slate-400">of {formatMetricValue(metric, Math.round(target))} target</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  );
}
