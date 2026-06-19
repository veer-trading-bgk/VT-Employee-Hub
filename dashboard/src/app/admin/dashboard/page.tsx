'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { EmptyState } from '@/components/common/EmptyState';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue } from '@/lib/metrics.config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { formatCurrency, formatPercent, formatRelativeTime } from '@/utils/formatters';
import { daysLeftInMonth, currentMonthLabel } from '@/utils/date-utils';
import { RealTimeMetricsPanel } from '@/components/dashboard/RealTimeMetricsPanel';
import { LiveLeaderboard } from '@/components/dashboard/LiveLeaderboard';
import type { TeamSummaryResponse, MyMetricsResponse } from '@/types';

function getRoleLabel(role: string) {
  const labels: Record<string, string> = { admin: 'Admin', manager: 'Manager', telecaller: 'Telecaller' };
  return labels[role] ?? role;
}

export default function AdminDashboardPage() {
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['admin-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: 30_000,
  });

  const { data: allMetrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['admin-all-metrics'],
    queryFn: () => apiFetch<MyMetricsResponse>('/api/metrics/all'),
  });

  const loading = teamLoading || metricsLoading;
  const teamEntries = teamData ? Object.entries(teamData.data) : [];
  const targets = teamData?.targets ?? {};

  // Build per-metric totals
  const metricTotals = METRICS.map((m) => {
    const total = teamEntries.reduce((sum, [, entry]) => sum + (entry.metrics?.[m.key] ?? 0), 0);
    const target = (targets[m.key] ?? 0) * teamEntries.length;
    const pct = target > 0 ? Math.round((total / target) * 100) : 0;
    return { label: m.label, key: m.key, total, target, pct, icon: m.icon, color: m.color };
  });

  // Build leaderboard from team summary (score = sum of pct across metrics)
  const leaderboard = teamEntries
    .map(([userId, entry]) => {
      const scores = METRICS.map((m) => {
        const v = entry.metrics?.[m.key] ?? 0;
        const t = targets[m.key] ?? 1;
        return (v / t) * 100;
      });
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      return { userId, name: (entry as unknown as { name?: string }).name ?? entry.email ?? userId, email: entry.email ?? userId, avgScore: Math.round(avgScore), metrics: entry.metrics ?? {} };
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);

  // Bar chart data for top metrics
  const barData = metricTotals.map((m) => ({
    name: m.key.toUpperCase(),
    actual: m.total,
    target: Math.round(m.target),
    pct: m.pct,
  }));

  const overallPct =
    metricTotals.length > 0
      ? Math.round(metricTotals.reduce((s, m) => s + m.pct, 0) / metricTotals.length)
      : 0;

  const activeEmployees = teamEntries.length;

  // Recent audit activity stub (we'll wire this properly later)
  const recentActivities: { action: string; email: string; time: Date }[] = [];

  const medalEmoji = (rank: number) => ['🥇', '🥈', '🥉'][rank] ?? `#${rank + 1}`;

  return (
    <>
      <Navbar title="Admin Dashboard" showBack />
      <div className="space-y-6 p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Overview — {currentMonthLabel()}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {daysLeftInMonth()} days left in month · {activeEmployees} active employees
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Active Employees" value={activeEmployees} icon="👥" accent="indigo" loading={loading} />
          <StatsCard title="Overall Target" value={`${overallPct}%`} icon="🎯" accent={overallPct >= 80 ? 'emerald' : overallPct >= 50 ? 'amber' : 'rose'} loading={loading} />
          <StatsCard title="Days Left" value={daysLeftInMonth()} icon="📅" accent="blue" loading={loading} />
          <StatsCard title="Metrics Tracked" value={METRICS.length} icon="📊" accent="purple" loading={loading} />
        </div>

        {/* Per-metric progress cards */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
            Today&apos;s Metric Totals (Team)
          </h2>
          {loading ? (
            <Loading />
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {metricTotals.map((m) => (
                <div
                  key={m.key}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xl">{m.icon}</span>
                    <span
                      className={`text-xs font-bold ${
                        m.pct >= 100
                          ? 'text-emerald-600'
                          : m.pct >= 60
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {m.pct}%
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.label}</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{m.total}</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(m.pct, 100)}%`, backgroundColor: m.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Real-time metrics panel */}
        <RealTimeMetricsPanel />

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Bar chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
              Target vs Actual (Today)
            </h2>
            {loading ? (
              <Loading size="sm" />
            ) : barData.length === 0 ? (
              <EmptyState icon="📊" title="No data yet" description="Metrics will appear once team members add entries." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v, name) => [v, name === 'actual' ? 'Actual' : 'Target']}
                  />
                  <Bar dataKey="target" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top performers */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
              🏆 Today&apos;s Leaderboard (Top 5)
            </h2>
            {loading ? (
              <Loading size="sm" />
            ) : leaderboard.length === 0 ? (
              <EmptyState icon="🏆" title="No data yet" description="Leaderboard updates when metrics are entered." />
            ) : (
              <div className="space-y-2">
                {leaderboard.slice(0, 5).map((entry, i) => (
                  <div
                    key={entry.userId}
                    className={`flex items-center gap-3 rounded-lg p-3 ${
                      i === 0
                        ? 'bg-amber-50 dark:bg-amber-950/30'
                        : 'bg-slate-50 dark:bg-slate-800/50'
                    }`}
                  >
                    <span className="w-8 text-center text-lg">{medalEmoji(i)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {entry.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        KYC: {entry.metrics.kyc ?? 0} · Demat: {entry.metrics.demat ?? 0}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-bold ${
                        entry.avgScore >= 100
                          ? 'text-emerald-600'
                          : entry.avgScore >= 70
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {entry.avgScore}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live auto-refreshing leaderboard */}
        <LiveLeaderboard />

        {/* Full leaderboard table */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
            Full Team Performance
          </h2>
          {loading ? (
            <Loading size="sm" />
          ) : leaderboard.length === 0 ? (
            <EmptyState icon="👥" title="No employees yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="pb-3 pr-4">Rank</th>
                    <th className="pb-3 pr-4">Employee</th>
                    {METRICS.slice(0, 4).map((m) => (
                      <th key={m.key} className="pb-3 pr-4">
                        {m.icon} {m.key.toUpperCase()}
                      </th>
                    ))}
                    <th className="pb-3">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.userId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 pr-4">{medalEmoji(i)}</td>
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900 dark:text-white">{entry.name}</p>
                        <p className="text-xs text-slate-400">{entry.email}</p>
                      </td>
                      {METRICS.slice(0, 4).map((m) => (
                        <td key={m.key} className="py-2.5 pr-4 text-slate-700 dark:text-slate-300">
                          {entry.metrics[m.key] ?? 0}
                        </td>
                      ))}
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            entry.avgScore >= 100
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                              : entry.avgScore >= 70
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                              : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
                          }`}
                        >
                          {entry.avgScore}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { href: '/admin/employees', label: 'Manage Employees', icon: '👥' },
            { href: '/admin/analytics', label: 'Analytics', icon: '📈' },
            { href: '/leaderboard', label: 'Full Leaderboard', icon: '🏆' },
            { href: '/settings', label: 'Settings', icon: '⚙️' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30"
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
