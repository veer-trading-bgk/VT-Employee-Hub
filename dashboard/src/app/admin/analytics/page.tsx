'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Loading } from '@/components/common/Loading';
import { EmptyState } from '@/components/common/EmptyState';
import { apiFetch } from '@/lib/api';
import { calcPoints, formatMetricValue } from '@/lib/metrics.config';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { exportTableToCsv, printToPdf } from '@/utils/export';
import { currentMonthLabel, daysLeftInMonth } from '@/utils/date-utils';
import { formatCurrency } from '@/utils/formatters';

// ── Types ─────────────────────────────────────────────────────────────────────
type TrendRow = { date: string } & Record<string, number>;
type EmployeeRow = { userId: string; name?: string; email?: string; points?: number } & Record<string, number>;

interface AnalyticsResponse {
  meta: { daysBack: number; totalRecords: number; activePerformerCount: number; generatedAt: string };
  performanceTrend: TrendRow[];
  metricTotals: { metric: string; key?: string; actual: number; target: number; pct: number }[];
  conversionFunnel: { name: string; value: number; fill: string }[];
  cohortAnalysis: { month: string; employees: number; revenue: number; growth: number; avgPerformance: number }[];
  topEmployees: EmployeeRow[];
}

interface Employee {
  id: string;
  name: string;
  email: string;
}

const DAYS_OPTIONS = [7, 14, 30, 60, 90] as const;
type DaysOption = (typeof DAYS_OPTIONS)[number];

// Default to first 3 metric keys for the line chart
const DEFAULT_SELECTED = ['kyc', 'demat', 'mf'];

// ── Custom funnel bar ─────────────────────────────────────────────────────────
function FunnelBar({ name, value, maxValue, fill }: { name: string; value: number; maxValue: number; fill: string }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const dropPct = maxValue > 0 && value < maxValue ? Math.round((1 - value / maxValue) * 100) : 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{name}</span>
      <div className="relative h-24 w-16 rounded-lg" style={{ backgroundColor: `${fill}22` }}>
        <div
          className="absolute bottom-0 left-0 right-0 rounded-lg transition-all duration-700"
          style={{ height: `${pct}%`, backgroundColor: fill }}
        />
      </div>
      <span className="text-sm font-bold text-slate-900 dark:text-white">{value}</span>
      {dropPct > 0 && <span className="text-[10px] text-rose-500">-{dropPct}%</span>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminAnalyticsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { metrics } = useMetricsConfig();

  useEffect(() => {
    if (user?.role === 'superadmin') router.replace('/platform/analytics');
  }, [user, router]);

  const [days, setDays] = useState<DaysOption>(30);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(DEFAULT_SELECTED);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-analytics', days],
    queryFn: () => apiFetch<AnalyticsResponse>(`/api/analytics?days=${days}`),
    staleTime: 1000 * 60 * 5,
  });

  // Employee list for name lookup
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: Employee[] }>('/api/admin/employees')
      .catch(() => ({ success: true, data: [] as Employee[] })),
    staleTime: 1000 * 60 * 10,
  });

  const empNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (empData?.data ?? []).forEach((e) => { map[e.id] = e.name; });
    return map;
  }, [empData]);

  const trend = data?.performanceTrend ?? [];
  const metricTotals = data?.metricTotals ?? [];
  const funnel = data?.conversionFunnel ?? [];
  const cohort = data?.cohortAnalysis ?? [];
  const top = data?.topEmployees ?? [];

  const funnelMax = funnel[0]?.value ?? 1;
  const totalRecords = data?.meta?.totalRecords ?? 0;
  const activePerformerCount = data?.meta?.activePerformerCount ?? 0;
  const overallPct = metricTotals.length > 0
    ? Math.round(metricTotals.reduce((s, m) => s + (m.pct ?? 0), 0) / metricTotals.length)
    : 0;

  const ranked = top
    .map((e) => ({
      ...e,
      userId: e.userId ?? '',
      name: e.name ?? empNameMap[e.userId ?? ''] ?? e.email ?? e.userId,
      points: e.points ?? calcPoints(e as Record<string, number>),
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  const medalEmoji = (rank: number) => ['🥇', '🥈', '🥉'][rank] ?? `#${rank + 1}`;

  const toggleMetric = (key: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(key)
        ? prev.length > 1 ? prev.filter((k) => k !== key) : prev  // keep at least one
        : [...prev, key]
    );
  };

  if (isError) {
    return (
      <>
        <Navbar title="Advanced Analytics" showBack />
        <div className="p-4 md:p-8">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/20">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="font-semibold text-rose-700 dark:text-rose-400">Failed to load analytics data</p>
            <p className="mt-1 text-sm text-rose-600 dark:text-rose-500">
              {error instanceof Error ? error.message : 'Unable to reach the analytics API.'}
            </p>
            <button onClick={() => refetch()} className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar title="Advanced Analytics" />
      <div className="space-y-6 p-4 md:p-8 print:p-4">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Analytics — {currentMonthLabel()}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {totalRecords.toLocaleString()} metric records · {activePerformerCount > 0 ? `${activePerformerCount} performers · ` : ''}{daysLeftInMonth()} days left
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {/* Days filter */}
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
              {DAYS_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 text-xs font-medium transition first:rounded-l-lg last:rounded-r-lg ${
                    days === d
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              onClick={() => exportTableToCsv(
                metricTotals.map((m) => ({ metric: m.metric, actual: m.actual, target: m.target, pct: m.pct })),
                `vt_analytics_${days}d`
              )}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              📥 Export CSV
            </button>
            <button
              onClick={() => printToPdf(`VT Analytics ${days}d`)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              🖨️ Print PDF
            </button>
            <button
              onClick={() => refetch()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* KPI stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Records Analysed" value={totalRecords.toLocaleString()} icon="📊" accent="indigo" loading={isLoading} />
          <StatsCard title="Overall Progress" value={`${overallPct}%`} icon="🎯" accent={overallPct >= 80 ? 'emerald' : overallPct >= 50 ? 'amber' : 'rose'} loading={isLoading} />
          <StatsCard title="Active Metrics" value={metrics.length} icon="📈" accent="blue" loading={isLoading} />
          <StatsCard title="Period" value={`${days} days`} icon="📅" accent="purple" loading={isLoading} />
        </div>

        {/* Metric totals table */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
            Performance Summary ({days}-Day Period)
          </h2>
          {isLoading ? <Loading size="sm" /> : metricTotals.length === 0 ? (
            <EmptyState icon="📊" title="No data" description="No metrics recorded in this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-3 pr-6">Metric</th>
                    <th className="pb-3 pr-6">Actual</th>
                    <th className="pb-3 pr-6">Target</th>
                    <th className="pb-3 pr-6">Progress</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {metricTotals.map((m) => {
                    const cfg = metrics.find((mx) => mx.label === m.metric || mx.key === m.key);
                    return (
                      <tr key={m.metric} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-3 pr-6 font-medium text-slate-900 dark:text-white">
                          {cfg ? `${cfg.icon} ${cfg.label}` : m.metric}
                        </td>
                        <td className="py-3 pr-6 tabular-nums text-slate-700 dark:text-slate-300">
                          {cfg ? formatMetricValue(cfg, m.actual ?? 0) : (m.actual ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 pr-6 tabular-nums text-slate-500">
                          {cfg ? formatMetricValue(cfg, m.target ?? 0) : (m.target ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 pr-6">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className={`h-full rounded-full ${(m.pct ?? 0) >= 100 ? 'bg-emerald-500' : (m.pct ?? 0) >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                style={{ width: `${Math.min(m.pct ?? 0, 100)}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-xs font-bold text-slate-700 dark:text-slate-300">{m.pct ?? 0}%</span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className={`text-xs font-semibold ${(m.pct ?? 0) >= 100 ? 'text-emerald-600' : (m.pct ?? 0) >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>
                            {(m.pct ?? 0) >= 100 ? '✅ On Target' : (m.pct ?? 0) >= 60 ? '⏳ In Progress' : '⚠️ Behind'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* Daily trend line — with metric selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <h2 className="font-semibold text-slate-900 dark:text-white">{days}-Day Trend</h2>
              <div className="flex flex-wrap gap-1">
                {metrics.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => toggleMetric(m.key)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                      selectedMetrics.includes(m.key)
                        ? 'text-white'
                        : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                    }`}
                    style={selectedMetrics.includes(m.key) ? { backgroundColor: m.color } : {}}
                    title={m.label}
                  >
                    {m.icon}
                  </button>
                ))}
              </div>
            </div>
            {isLoading ? <Loading size="sm" /> : trend.length < 2 ? (
              <EmptyState icon="📈" title="Not enough data" description="Add metrics over multiple days to see trends." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={(l) => `Date: ${l}`} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {metrics.filter((m) => selectedMetrics.includes(m.key)).map((m) => (
                    <Line key={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Metric totals bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Actual vs Target ({days}d)</h2>
            {isLoading ? <Loading size="sm" /> : metricTotals.length === 0 ? (
              <EmptyState icon="📊" title="No data" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={metricTotals} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="metric" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="target" name="Target" fill="#e2e8f0" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="actual" name="Actual" fill="#6366f1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Employee participation (formerly "Conversion Funnel") */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">
            Employee Participation Rate
          </h2>
          <p className="mb-6 text-xs text-slate-500 dark:text-slate-400">
            How many employees have logged each metric type in the period
          </p>
          {isLoading ? <Loading size="sm" /> : funnel.every((f) => f.value === 0) ? (
            <EmptyState icon="📊" title="No participation data" description="Employees haven't logged metrics yet." />
          ) : (
            <div className="flex items-end justify-around gap-4 px-4 pb-2">
              {funnel.map((f) => (
                <FunnelBar key={f.name} {...f} maxValue={funnelMax} />
              ))}
            </div>
          )}
          {!isLoading && funnel.some((f) => f.value > 0) && (
            <div className="mt-4 flex justify-around text-center text-xs text-slate-500 dark:text-slate-400">
              {funnel.map((f, i) => (
                <div key={f.name}>
                  {i > 0 && funnel[i - 1].value > 0 && (
                    <span className="font-semibold text-rose-500">
                      Drop: {Math.round((1 - f.value / funnel[i - 1].value) * 100)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cohort analysis */}
        {cohort.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">Monthly Cohort Analysis</h2>
              <button
                onClick={() => exportTableToCsv(cohort, 'vt_cohort')}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 print:hidden"
              >
                📥 Export
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-3 pr-6">Month</th>
                    <th className="pb-3 pr-6">Employees</th>
                    <th className="pb-3 pr-6">Avg KYC Score</th>
                    <th className="pb-3 pr-6">Insurance Revenue</th>
                    <th className="pb-3">M-o-M Growth</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {cohort.map((row) => (
                    <tr key={row.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 pr-6 font-medium text-slate-900 dark:text-white">{row.month}</td>
                      <td className="py-2.5 pr-6 tabular-nums text-slate-700 dark:text-slate-300">{row.employees ?? 0}</td>
                      <td className="py-2.5 pr-6 tabular-nums text-slate-700 dark:text-slate-300">{row.avgPerformance ?? 0}</td>
                      <td className="py-2.5 pr-6 tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(row.revenue ?? 0)}</td>
                      <td className="py-2.5">
                        <span className={`text-sm font-bold ${(row.growth ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {(row.growth ?? 0) >= 0 ? '+' : ''}{row.growth ?? 0}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Top performers — shows employee names, no bonus column */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-white">
              🏆 Top Performers ({days}-Day Period)
            </h2>
            <button
              onClick={() => exportTableToCsv(ranked, `vt_leaderboard_${days}d`)}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 print:hidden"
            >
              📥 Export
            </button>
          </div>
          {isLoading ? <Loading size="sm" /> : ranked.length === 0 ? (
            <EmptyState icon="🏆" title="No data yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-3 pr-4">Rank</th>
                    <th className="pb-3 pr-4">Employee</th>
                    {metrics.map((m) => (
                      <th key={m.key} className="pb-3 pr-4">{m.icon} {m.label}</th>
                    ))}
                    <th className="pb-3">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ranked.map((row, i) => (
                    <tr
                      key={row.userId}
                      className={`transition-colors ${i < 3 ? 'bg-amber-50/50 dark:bg-amber-950/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                    >
                      <td className="py-2.5 pr-4 text-base font-bold">{medalEmoji(i)}</td>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
                        {row.email && <p className="text-xs text-slate-400">{row.email}</p>}
                      </td>
                      {metrics.map((m) => (
                        <td key={m.key} className="py-2.5 pr-4 tabular-nums text-slate-700 dark:text-slate-300">
                          {formatMetricValue(m, (row as unknown as Record<string, number>)[m.key] ?? 0)}
                        </td>
                      ))}
                      <td className="py-2.5">
                        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                          ⭐ {row.points}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 px-1 text-xs text-slate-400">
                Points: {metrics.map((m) => `${m.label}×${m.unit === 'currency' ? `÷${m.pointsWeight.toLocaleString()}` : m.pointsWeight}`).join(' + ')}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
