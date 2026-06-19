'use client';

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
import { useState } from 'react';

export default function DashboardPage() {
  const { summary, error, loading, refetch } = useMyMetrics();
  const [selectedMetric, setSelectedMetric] = useState<string>('kyc');

  const trendSeries = summary.find((s) => s.metric.key === selectedMetric);
  const trendData = (trendSeries?.history ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date.slice(5), value: r.value }));

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
                  <MetricCard metric={s.metric} value={s.value} target={s.target} progress={s.progress} />
                </button>
              ))}
        </div>
      </ErrorBoundary>

      <div className="mt-8 mb-6">
        <InsightsPanel />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ErrorBoundary>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">Daily Progress (All Metrics)</h3>
            {loading ? (
              <ChartSkeleton />
            ) : (
              <ProgressBarChart
                data={summary.map((s) => ({ label: s.metric.label, progress: s.progress, color: s.metric.color }))}
              />
            )}
          </div>
        </ErrorBoundary>

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
            ) : trendData.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">No history yet for this metric.</p>
            ) : (
              <TrendLineChart data={trendData} color={trendSeries?.metric.color ?? '#6366f1'} />
            )}
          </div>
        </ErrorBoundary>
      </div>
      </div>
    </AppShell>
  );
}
