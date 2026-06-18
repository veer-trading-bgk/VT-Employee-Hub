'use client';

import { useRealTime } from '@/hooks/useRealTime';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { METRICS, dailyTarget, formatMetricValue } from '@/lib/metrics.config';
import { today } from '@/utils/date-utils';
import type { MyMetricsResponse } from '@/types';

interface RealTimeMetricsPanelProps {
  /** Whether to show controls (pause/resume/refresh) */
  showControls?: boolean;
  /** Polling interval in ms — default 30 s */
  intervalMs?: number;
}

export function RealTimeMetricsPanel({
  showControls = true,
  intervalMs = 30_000,
}: RealTimeMetricsPanelProps) {
  const { isLive, lastUpdated, nextRefreshIn, refresh, pause, resume } = useRealTime({
    queryKeys: [['rt-my-metrics']],
    intervalMs,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['rt-my-metrics'],
    queryFn: () => apiFetch<MyMetricsResponse>('/api/metrics/my?days=1'),
    refetchInterval: false, // controlled by useRealTime
  });

  const todayStr = today();
  const summary = METRICS.map((metric) => {
    const value = data?.data?.[todayStr]?.[metric.key] ?? 0;
    const target = dailyTarget(metric);
    const pct = target > 0 ? Math.min(Math.round((value / target) * 100), 999) : 0;
    return { metric, value, target, pct };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isLive ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} />
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            Real-Time Metrics
          </span>
          {isLive && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdated.toLocaleTimeString()}
              {isLive && ` · next in ${nextRefreshIn}s`}
            </span>
          )}
          {showControls && (
            <div className="flex gap-1.5">
              <button
                onClick={refresh}
                title="Refresh now"
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                🔄
              </button>
              <button
                onClick={isLive ? pause : resume}
                title={isLive ? 'Pause polling' : 'Resume polling'}
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {isLive ? '⏸' : '▶️'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 dark:divide-slate-800 sm:grid-cols-3 lg:grid-cols-6">
        {METRICS.map(({ key, label, icon, color }, idx) => {
          const s = summary.find((m) => m.metric.key === key);
          const pct = s?.pct ?? 0;
          const value = s?.value ?? 0;
          const target = s?.target ?? 0;
          const barColor =
            pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';

          return (
            <div key={key} className="flex flex-col gap-1.5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-lg">{icon}</span>
                <span
                  className={`text-xs font-bold ${
                    pct >= 100
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : pct >= 60
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {pct}%
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
              {isLoading ? (
                <div className="h-6 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              ) : (
                <p
                  className="text-xl font-bold tabular-nums text-slate-900 dark:text-white transition-all duration-500"
                >
                  {formatMetricValue(s?.metric ?? METRICS[idx], value)}
                </p>
              )}
              <p className="text-[10px] text-slate-400">
                of {formatMetricValue(s?.metric ?? METRICS[idx], Math.round(target))}
              </p>
              {/* Progress bar */}
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
