import { formatMetricValue, type MetricConfig } from '@/lib/metrics.config';

interface MetricCardProps {
  metric: MetricConfig;
  value: number;       // today's logged total
  target: number;      // daily target
  progress: number;    // 0-100+
  yesterday?: number;  // shown as subtle hint
  // Input mode — when provided, card becomes an entry widget
  inputValue?: string;
  onInputChange?: (v: string) => void;
  disabled?: boolean;
}

export function MetricCard({
  metric,
  value,
  target,
  progress,
  yesterday,
  inputValue,
  onInputChange,
  disabled,
}: MetricCardProps) {
  const isEntry = onInputChange !== undefined;
  const done    = progress >= 100;
  const mid     = progress >= 60;

  const barColor  = done ? 'bg-emerald-500' : mid ? 'bg-amber-400' : 'bg-rose-400';
  const ringColor = done
    ? 'border-emerald-200 dark:border-emerald-800'
    : 'border-slate-200 dark:border-slate-800';

  return (
    <div
      className={`group rounded-xl border bg-white p-4 shadow-sm transition-all duration-200
        dark:bg-slate-900
        ${isEntry ? 'hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800' : 'hover:shadow-md'}
        ${done ? ringColor : 'border-slate-200 dark:border-slate-800'}
      `}
    >
      {/* Top row: icon + label + % badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl leading-none flex-shrink-0">{metric.icon}</span>
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 truncate">
            {metric.label}
          </span>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums
            ${done
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
        >
          {progress}%
        </span>
      </div>

      {/* Logged value */}
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white leading-none">
        {formatMetricValue(metric, value)}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
        of {formatMetricValue(metric, Math.round(target))} daily target
        {yesterday !== undefined && yesterday > 0 && (
          <span className="ml-2 text-slate-300 dark:text-slate-600">
            · yest: {formatMetricValue(metric, yesterday)}
          </span>
        )}
      </p>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {/* Input — only in entry mode */}
      {isEntry && (
        <input
          type="number"
          inputMode="numeric"
          min="0"
          placeholder={value > 0 ? 'Add more…' : 'Enter…'}
          value={inputValue ?? ''}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={disabled}
          className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium
            text-slate-900 placeholder-slate-400 outline-none transition
            focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20
            disabled:cursor-not-allowed disabled:opacity-50
            dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500
            dark:focus:border-indigo-500 dark:focus:bg-slate-900"
        />
      )}
    </div>
  );
}
