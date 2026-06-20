'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Loading } from '@/components/common/Loading';
import { EmptyState } from '@/components/common/EmptyState';
import { apiFetch } from '@/lib/api';
import { METRICS, dailyTarget, monthlyTarget, formatMetricValue } from '@/lib/metrics.config';
import { ProgressBarChart } from '@/components/charts/ProgressBarChart';
import { useAuth } from '@/context/AuthContext';
import { daysLeftInMonth, currentMonthLabel, today } from '@/utils/date-utils';
import { toast } from 'sonner';
import type { MyMetricsResponse, VerificationStatus } from '@/types';

export default function EmployeeDashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [addForm, setAddForm] = useState({ metric_type: 'kyc', value: '' });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['my-metrics-30'],
    queryFn: () => apiFetch<MyMetricsResponse>('/api/metrics/my?days=30'),
    refetchInterval: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: ({ metric_type, value }: { metric_type: string; value: number }) =>
      apiFetch<{ data?: { total?: number; metric_type?: string } }>('/api/metrics/add', {
        method: 'POST',
        body: JSON.stringify({ metric_type, value }),
      }),
    onSuccess: (res) => {
      const total = res?.data?.total;
      const mt = res?.data?.metric_type ?? addForm.metric_type;
      toast.success(total != null ? `${mt.toUpperCase()} today: ${total}` : 'Metric added!');
      queryClient.invalidateQueries({ queryKey: ['my-metrics-30'] });
      setAddForm({ metric_type: 'kyc', value: '' });
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const todayStr = today();
  const allDates = data?.data ?? {};
  const todayStatuses = (data?.statuses?.[todayStr] ?? {}) as Record<string, VerificationStatus>;
  // API returns live daily targets from /api/metrics/my — use these over hardcoded config
  const apiTargets = (data?.targets ?? {}) as Record<string, number>;
  const summary = METRICS.map((metric) => {
    const todayValue = allDates[todayStr]?.[metric.key] ?? 0;
    const monthTotal = Object.values(allDates).reduce(
      (sum, dayData) => sum + (dayData[metric.key] ?? 0),
      0
    );
    const target = apiTargets[metric.key] ?? dailyTarget(metric);
    const mTarget = target * 30;
    const progress = target > 0 ? Math.min(Math.round((todayValue / target) * 100), 999) : 0;
    const monthPct = mTarget > 0 ? Math.min(Math.round((monthTotal / mTarget) * 100), 999) : 0;
    return { metric, value: todayValue, target, mTarget, progress, monthTotal, monthPct };
  });

  const avgProgress = summary.length > 0 ? Math.round(summary.reduce((s, m) => s + m.progress, 0) / summary.length) : 0;
  const metricsHit = summary.filter((m) => m.progress >= 100).length;

  const handleAddMetric = () => {
    const v = parseFloat(addForm.value);
    if (isNaN(v) || v <= 0) {
      toast.error('Enter a valid positive number.');
      return;
    }
    addMutation.mutate({ metric_type: addForm.metric_type, value: v });
  };

  return (
    <>
      <Navbar title="My Dashboard" />
      <div className="space-y-6 p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Welcome, {user?.name?.split(' ')[0]}! 👋
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {currentMonthLabel()} · {daysLeftInMonth()} days left
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
          >
            {showForm ? 'Cancel' : '+ Add Today\'s Metrics'}
          </button>
        </div>

        {/* Add metrics form */}
        {showForm && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-900/50 dark:bg-indigo-950/20">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Add Metric Entry</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <select
                value={addForm.metric_type}
                onChange={(e) => setAddForm((f) => ({ ...f, metric_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:w-auto"
              >
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.icon} {m.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Value"
                value={addForm.value}
                onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:w-32"
              />
              <button
                onClick={handleAddMetric}
                disabled={addMutation.isPending}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
              >
                {addMutation.isPending ? 'Adding…' : 'Add Entry'}
              </button>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Today's Avg" value={`${avgProgress}%`} icon="🎯" accent={avgProgress >= 100 ? 'emerald' : avgProgress >= 60 ? 'amber' : 'rose'} loading={isLoading} />
          <StatsCard title="Metrics Hit Today" value={`${metricsHit}/${METRICS.length}`} icon="✅" accent="emerald" loading={isLoading} />
          <StatsCard title="Days Left" value={daysLeftInMonth()} icon="📅" accent="blue" loading={isLoading} />
          <StatsCard title="Role" value={user?.role ?? '–'} icon="👤" accent="purple" loading={isLoading} />
        </div>

        {/* Today's metrics cards */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Today&apos;s Progress</h2>
          {isLoading ? (
            <Loading />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.map(({ metric, value, target, progress }) => {
                const status = todayStatuses[metric.key];
                const isRejected = status === 'rejected';
                const barColor = isRejected
                  ? 'bg-rose-300 dark:bg-rose-800'
                  : progress >= 100 ? 'bg-emerald-500' : progress >= 70 ? 'bg-amber-500' : progress > 0 ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700';
                const borderCls = isRejected ? 'border-rose-300 dark:border-rose-800' : 'border-slate-200 dark:border-slate-800';
                const badge =
                  progress >= 100 ? { label: 'Excellent',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' }
                  : progress >= 70 ? { label: 'On Track',         cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' }
                  : progress >  0  ? { label: 'Needs Attention',  cls: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' }
                  :                  { label: 'Not Started',       cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
                const statusChip = status === 'approved'
                  ? { label: '✓ Approved', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' }
                  : status === 'rejected'
                  ? { label: '✕ Rejected', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' }
                  : status === 'pending'
                  ? { label: '⏳ Pending',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' }
                  : null;
                return (
                  <div
                    key={metric.key}
                    className={`rounded-xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${borderCls}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{metric.icon}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                        progress >= 100 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                        : progress >= 70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                        : progress >  0  ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}>
                        {progress}%
                      </span>
                    </div>
                    <h3 className="mt-3 text-sm font-medium text-slate-500 dark:text-slate-400">{metric.label}</h3>
                    {statusChip && (
                      <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusChip.cls}`}>
                        {statusChip.label}
                      </span>
                    )}
                    <p className={`mt-1 text-2xl font-bold ${isRejected ? 'text-slate-400 dark:text-slate-600 line-through' : 'text-slate-900 dark:text-white'}`}>
                      {formatMetricValue(metric, value)}
                    </p>
                    <p className="text-xs text-slate-400">of {formatMetricValue(metric, Math.round(target))} target</p>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${Math.min(progress, 100)}%`, minWidth: progress > 0 ? '4px' : '0' }}
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {isRejected && (
                        <a href="/employee/daily-entry" className="text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                          Fix →
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Monthly progress */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">Monthly Progress</h2>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">This month&apos;s totals vs monthly targets</p>
          {isLoading ? (
            <Loading size="sm" />
          ) : (
            <ProgressBarChart
              data={summary.map(({ metric, monthTotal, monthPct, mTarget }) => ({
                label:    metric.label,
                icon:     metric.icon,
                value:    monthTotal,
                target:   mTarget,
                progress: monthPct,
                color:    metric.color,
                unit:     metric.unit,
              }))}
            />
          )}
        </div>
      </div>
    </>
  );
}
