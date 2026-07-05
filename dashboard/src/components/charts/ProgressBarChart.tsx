'use client';

export type MetricUnit = 'count' | 'currency';

export interface ProgressRow {
  label: string;
  icon: string;
  value: number;
  /** Daily target */
  target: number;
  /** 0–999+ */
  progress: number;
  color: string;
  unit: MetricUnit;
}

interface ProgressBarChartProps {
  data: ProgressRow[];
  /**
   * StatusBadge and the percentage color both assume `progress` is a
   * goal-vs-target metric (Excellent/On Track/Needs Attention). For a plain
   * category distribution (e.g. a hot/warm/cold share of total), that framing
   * is misleading, so callers showing a distribution rather than a goal
   * should pass `false`. Defaults to `true` to preserve existing callers.
   */
  showStatusBadge?: boolean;
}

function fmtVal(unit: MetricUnit, v: number): string {
  return unit === 'currency'
    ? `₹${Math.round(v).toLocaleString('en-IN')}`
    : v.toLocaleString('en-IN');
}

function StatusBadge({ progress }: { progress: number }) {
  if (progress >= 100)
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
        Excellent
      </span>
    );
  if (progress >= 70)
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
        On Track
      </span>
    );
  if (progress > 0)
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
        Needs Attention
      </span>
    );
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      Not Started
    </span>
  );
}

export function ProgressBarChart({ data, showStatusBadge = true }: ProgressBarChartProps) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No metrics configured.</p>;
  }

  return (
    <div className="space-y-4">
      {data.map((row) => (
        <div key={row.label}>
          {/* Header: icon + label | value/target + % */}
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="flex-shrink-0 text-base leading-none">{row.icon}</span>
              <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                {row.label}
              </span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {fmtVal(row.unit, row.value)} / {fmtVal(row.unit, Math.round(row.target))}
              </span>
              <span
                className={`text-xs font-bold tabular-nums ${
                  !showStatusBadge ? 'text-slate-700 dark:text-slate-300'
                  : row.progress >= 100 ? 'text-emerald-600 dark:text-emerald-400'
                  : row.progress >= 70 ? 'text-amber-600 dark:text-amber-400'
                  : row.progress >  0  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {row.progress}%
              </span>
            </div>
          </div>

          {/* Always-visible bar track — fill is zero-width for 0% but track stays */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(row.progress, 100)}%`,
                backgroundColor: row.color,
                minWidth: row.progress > 0 ? '4px' : '0',
              }}
            />
          </div>

          {showStatusBadge && (
            <div className="mt-1.5">
              <StatusBadge progress={row.progress} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
