'use client';

import { AppShell } from '@/components/layout/AppShell';
import { MetricCard } from '@/components/ui/MetricCard';
import { MetricCardSkeleton, ChartSkeleton } from '@/components/ui/Skeleton';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ProgressBarChart } from '@/components/charts/ProgressBarChart';
import { useMyMetrics } from '@/hooks/useMetrics';
import { InsightsPanel } from '@/components/ai/InsightsPanel';
import { Navbar } from '@/components/layout/Navbar';
import { monthlyTarget } from '@/lib/metrics.config';

export default function DashboardPage() {
  const { summary, error, loading, refetch } = useMyMetrics();

  const monthlyData = summary.map((s) => {
    const monthTotal = s.history.reduce((sum, h) => sum + h.value, 0);
    const mTarget    = monthlyTarget(s.metric);
    const monthPct   = mTarget > 0 ? Math.min(Math.round((monthTotal / mTarget) * 100), 999) : 0;
    return {
      label:    s.metric.label,
      icon:     s.metric.icon,
      value:    monthTotal,
      target:   mTarget,
      progress: monthPct,
      color:    s.metric.color,
      unit:     s.metric.unit,
    };
  });

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
                  <MetricCard
                    key={s.metric.key}
                    metric={s.metric}
                    value={s.value}
                    target={s.target}
                    progress={s.progress}
                  />
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
              <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">
                Daily Progress
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Today vs daily targets</p>
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

          {/* 30-Day Totals — same style as Daily Progress */}
          <ErrorBoundary>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">
                Monthly Progress
              </h3>
              <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">30-day totals vs monthly targets</p>
              {loading ? (
                <ChartSkeleton />
              ) : (
                <ProgressBarChart data={monthlyData} />
              )}
            </div>
          </ErrorBoundary>
        </div>
      </div>
    </AppShell>
  );
}
