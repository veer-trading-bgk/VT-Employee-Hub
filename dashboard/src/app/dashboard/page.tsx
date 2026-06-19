'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { MetricCard } from '@/components/ui/MetricCard';
import { MetricCardSkeleton, ChartSkeleton } from '@/components/ui/Skeleton';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ProgressBarChart } from '@/components/charts/ProgressBarChart';
import { TrendLineChart } from '@/components/charts/TrendLineChart';
import { useMyMetrics } from '@/hooks/useMetrics';
import { InsightsPanel } from '@/components/ai/InsightsPanel';
import { Navbar } from '@/components/layout/Navbar';

function computeTrendStats(history: { date: string; value: number }[]) {
  const vals     = history.map((h) => h.value);
  const nonZero  = vals.filter((v) => v > 0);
  if (nonZero.length === 0) return null;

  const avg   = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  const max   = Math.max(...vals);
  const maxIdx = vals.lastIndexOf(max);
  const maxDate = history[maxIdx]?.date.slice(5) ?? '';

  // Streak: consecutive days with an entry, counting backwards from today
  let streak = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i] > 0) streak++;
    else break;
  }

  // Trend direction: compare last-7-days avg vs prior-7-days avg
  const last7Avg  = vals.slice(-7).reduce((a, b) => a + b, 0) / 7;
  const prior7Avg = vals.slice(-14, -7).reduce((a, b) => a + b, 0) / 7;
  const delta     = prior7Avg > 0 ? ((last7Avg - prior7Avg) / prior7Avg) * 100 : 0;

  const trend    = delta >= 10 ? '↑ Improving' : delta <= -10 ? '↓ Declining' : '→ Stable';
  const trendCls = delta >= 10
    ? 'text-emerald-600 dark:text-emerald-400'
    : delta <= -10
    ? 'text-rose-500 dark:text-rose-400'
    : 'text-slate-500 dark:text-slate-400';

  return { avg: avg.toFixed(1), max, maxDate, streak, trend, trendCls, daysLogged: nonZero.length };
}

export default function DashboardPage() {
  const { summary, error, loading, refetch } = useMyMetrics();
  const [selectedMetric, setSelectedMetric] = useState<string>('kyc');

  const trendSeries = summary.find((s) => s.metric.key === selectedMetric);
  // Gap-filled by useMyMetrics — already sorted oldest→newest, no slice/sort needed
  const trendData   = (trendSeries?.history ?? []).map((r) => ({ date: r.date.slice(5), value: r.value }));

  const noData     = trendData.every((d) => d.value === 0);
  const firstEntry = !noData && trendData.filter((d) => d.value > 0).length === 1;
  const trendStats = noData ? null : computeTrendStats(trendSeries?.history ?? []);

  return (
    <AppShell>
      <Navbar title="Dashboard" showBack />
      <div className="p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Today&apos;s metrics vs targets</p>
          </div>
        </div>

        {error && <ErrorMessage message={error.message} onRetry={refetch} />}

        {/* Metric cards grid */}
        <ErrorBoundary>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <MetricCardSkeleton key={i} />)
              : summary.map((s) => (
                  <button
                    key={s.metric.key}
                    onClick={() => setSelectedMetric(s.metric.key)}
                    className="text-left"
                  >
                    <MetricCard
                      metric={s.metric}
                      value={s.value}
                      target={s.target}
                      progress={s.progress}
                    />
                  </button>
                ))}
          </div>
        </ErrorBoundary>

        <div className="mt-8 mb-6">
          <InsightsPanel />
        </div>

        <div className="mt-2 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Daily Progress — metric rows, always-visible bars */}
          <ErrorBoundary>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">
                Daily Progress (All Metrics)
              </h3>
              {loading ? (
                <ChartSkeleton />
              ) : (
                <ProgressBarChart
                  data={summary.map((s) => ({
                    label:    s.metric.label,
                    icon:     s.metric.icon,
                    value:    s.value,
                    target:   s.target,
                    progress: s.progress,
                    color:    s.metric.color,
                    unit:     s.metric.unit,
                  }))}
                />
              )}
            </div>
          </ErrorBoundary>

          {/* 30-Day Trend */}
          <ErrorBoundary>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 dark:text-white">30-Day Trend</h3>
                <select
                  value={selectedMetric}
                  onChange={(e) => setSelectedMetric(e.target.value)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {summary.map((s) => (
                    <option key={s.metric.key} value={s.metric.key}>
                      {s.metric.label}
                    </option>
                  ))}
                </select>
              </div>

              {loading ? (
                <ChartSkeleton height={260} />
              ) : noData ? (
                /* Zero entries in 30 days */
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-2xl">📈</p>
                  <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                    No activity in the last 30 days
                  </p>
                  <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                    Start entering daily metrics to see your trend.
                  </p>
                </div>
              ) : (
                <>
                  {/* Stats bar — shown only when there's enough data */}
                  {trendStats && !firstEntry && (
                    <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60 sm:grid-cols-4">
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Avg / day</p>
                        <p className="font-bold text-slate-900 dark:text-white">{trendStats.avg}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Best day</p>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {trendStats.max} <span className="font-normal text-slate-400">({trendStats.maxDate})</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Streak</p>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {trendStats.streak} {trendStats.streak === 1 ? 'day' : 'days'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Trend</p>
                        <p className={`font-bold ${trendStats.trendCls}`}>{trendStats.trend}</p>
                      </div>
                    </div>
                  )}

                  <TrendLineChart
                    data={trendData}
                    color={trendSeries?.metric.color ?? '#6366f1'}
                  />

                  {firstEntry && (
                    <p className="mt-2 text-center text-xs text-slate-400 dark:text-slate-500">
                      First entry logged! Keep going to build your 30-day trend.
                    </p>
                  )}
                </>
              )}
            </div>
          </ErrorBoundary>
        </div>
      </div>
    </AppShell>
  );
}
