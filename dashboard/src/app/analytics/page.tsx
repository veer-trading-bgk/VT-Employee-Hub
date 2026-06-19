'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { TrendLineChart } from '@/components/charts/TrendLineChart';
import { DataTable } from '@/components/ui/DataTable';
import { DateRangeFilter } from '@/components/ui/DateRangeFilter';
import { ErrorMessage } from '@/components/ui/ErrorMessage';
import { ChartSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { useMyMetrics, useRoleScopedMetrics } from '@/hooks/useMetrics';
import { METRICS } from '@/lib/metrics.config';
import { Navbar } from '@/components/layout/Navbar';

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const { summary, raw, error, loading, refetch } = useMyMetrics(days);
  const { team } = useRoleScopedMetrics();

  const selected = summary.find((s) => s.metric.key === metricKey);
  const trendData = (selected?.history ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ date: r.date.slice(5), value: r.value }));

  const allRecords = useMemo(() => {
    if (!raw) return [];
    const out: import('@/types').MetricRecord[] = [];
    Object.entries(raw.data).forEach(([date, dayData]) => {
      Object.entries(dayData).forEach(([metric_type, value]) => {
        out.push({ PK: '', SK: `${date}#${metric_type}`, metricId: `${date}#${metric_type}`, userId: '', metric_type, value, date, enteredAt: '', enteredFrom: 'web', verified: false });
      });
    });
    return out;
  }, [raw]);

  const teamAverage = useMemo(() => {
    if (!team.data) return 0;
    const values = Object.values(team.data.data)
      .map((e) => e.metrics?.[metricKey] ?? 0)
      .filter((v) => v > 0);
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [team.data, metricKey]);

  const myProgressVsTeam = teamAverage > 0 ? Math.round(((selected?.value ?? 0) / teamAverage) * 100) : 0;

  return (
    <AppShell>
      <Navbar title="Analytics" showBack />
      <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Deep dive into a single metric</p>
        </div>
        <DateRangeFilter value={days} onChange={setDays} />
      </div>

      {error && <ErrorMessage message={error.message} onRetry={refetch} />}

      <div className="mb-6 flex items-center gap-2">
        <label className="text-sm text-slate-500 dark:text-slate-400">Metric:</label>
        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value)}
          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
          <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">
            {selected?.metric.label} - {days}-Day Trend
          </h3>
          {loading ? (
            <ChartSkeleton />
          ) : trendData.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-400">No history for this range.</p>
          ) : (
            <TrendLineChart data={trendData} color={selected?.metric.color ?? '#6366f1'} />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-2 text-center font-semibold text-slate-900 dark:text-white">You vs Team Average</h3>
          {team.loading ? (
            <ChartSkeleton height={160} />
          ) : (
            <GaugeChart value={myProgressVsTeam} label="of team avg" />
          )}
          <p className="mt-2 text-center text-xs text-slate-400">
            Team unavailable to telecallers shows 0 if no data.
          </p>
        </div>
      </div>

      <div className="mt-6">
        {loading ? <TableSkeleton rows={8} /> : <DataTable records={allRecords} filename={`my_metrics_${days}d.csv`} />}
      </div>
      </div>
    </AppShell>
  );
}
