'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, monthlyTarget, formatMetricValue } from '@/lib/metrics.config';
import { ProgressBarChart } from '@/components/charts/ProgressBarChart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { daysLeftInMonth, currentMonthLabel } from '@/utils/date-utils';
import { RealTimeMetricsPanel } from '@/components/dashboard/RealTimeMetricsPanel';
import type { TeamSummaryResponse } from '@/types';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  points: number;
  metrics: Record<string, number>;
}

interface LeaderboardResponse {
  success: boolean;
  month: string;
  data: LeaderboardEntry[];
  monthlyTargets: Record<string, number>;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();

  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['admin-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: 30_000,
  });

  const { data: lbData, isLoading: lbLoading } = useQuery({
    queryKey: ['admin-leaderboard-monthly'],
    queryFn: () => apiFetch<LeaderboardResponse>('/api/metrics/leaderboard'),
    refetchInterval: 60_000,
  });

  const teamEntries = teamData ? Object.entries(teamData.data) : [];
  const targets = teamData?.targets ?? {};
  const lbEntries = lbData?.data ?? [];

  // Today's per-metric team totals
  const metricTotals = METRICS.map((m) => {
    const total = teamEntries.reduce((sum, [, entry]) => sum + (entry.metrics?.[m.key] ?? 0), 0);
    const target = (targets[m.key] ?? 0) * teamEntries.length;
    const pct = target > 0 ? Math.round((total / target) * 100) : 0;
    return { ...m, total, target, pct };
  });

  // Monthly team totals aggregated from MTD leaderboard data
  const monthlyChartData = METRICS.map((m) => {
    const total = lbEntries.reduce((sum, entry) => sum + (entry.metrics[m.key] ?? 0), 0);
    const mTarget = monthlyTarget(m) * (lbEntries.length || 1);
    const pct = mTarget > 0 ? Math.min(Math.round((total / mTarget) * 100), 999) : 0;
    return { label: m.label, icon: m.icon, value: total, target: mTarget, progress: pct, color: m.color, unit: m.unit };
  });

  // Today's top performers for compact leaderboard panel
  const todayTop5 = teamEntries
    .map(([userId, entry]) => {
      const avgScore = Math.round(
        METRICS.reduce((sum, m) => {
          const v = entry.metrics?.[m.key] ?? 0;
          const t = targets[m.key] ?? 1;
          return sum + (v / t) * 100;
        }, 0) / METRICS.length
      );
      return {
        userId,
        name: (entry as unknown as { name?: string }).name ?? entry.email ?? userId,
        avgScore,
        metrics: entry.metrics ?? {},
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 5);

  const barData = metricTotals.map((m) => ({
    name: m.key.toUpperCase(),
    actual: m.total,
    target: Math.round(m.target),
  }));

  const overallPct = metricTotals.length > 0
    ? Math.round(metricTotals.reduce((s, m) => s + m.pct, 0) / metricTotals.length)
    : 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-team-summary'] });
    queryClient.invalidateQueries({ queryKey: ['admin-leaderboard-monthly'] });
  };

  return (
    <>
      <Navbar title="Admin Dashboard" />
      <div className="space-y-6 p-4 md:p-8">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Overview — {currentMonthLabel()}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {daysLeftInMonth()} days left · {teamEntries.length} active employees
            </p>
          </div>
          <button
            onClick={refresh}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Active Employees" value={teamEntries.length} icon="👥" accent="indigo" loading={teamLoading} />
          <StatsCard title="Today's Target" value={`${overallPct}%`} icon="🎯"
            accent={overallPct >= 80 ? 'emerald' : overallPct >= 50 ? 'amber' : 'rose'} loading={teamLoading} />
          <StatsCard title="Days Left" value={daysLeftInMonth()} icon="📅" accent="blue" loading={teamLoading} />
          <StatsCard title="Metrics Tracked" value={METRICS.length} icon="📊" accent="purple" loading={false} />
        </div>

        {/* Today's per-metric cards */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
            Today&apos;s Metric Totals (Team)
          </h2>
          {teamLoading ? (
            <Loading />
          ) : teamEntries.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No entries recorded today yet</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Progress will appear once team members start logging metrics.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {metricTotals.map((m) => {
                const badge =
                  m.pct >= 100 ? { label: 'Excellent',       cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' }
                  : m.pct >= 70 ? { label: 'On Track',        cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' }
                  : m.pct >  0  ? { label: 'Needs Attention', cls: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' }
                  :               { label: 'Not Started',      cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
                return (
                  <div key={m.key} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xl">{m.icon}</span>
                      <span className={`text-xs font-bold tabular-nums ${
                        m.pct >= 100 ? 'text-emerald-600' : m.pct >= 70 ? 'text-amber-600' : m.pct > 0 ? 'text-rose-600' : 'text-slate-400'
                      }`}>{m.pct}%</span>
                    </div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.label}</p>
                    <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
                      {formatMetricValue(m, m.total)}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(m.pct, 100)}%`, backgroundColor: m.color, minWidth: m.pct > 0 ? '3px' : '0' }}
                      />
                    </div>
                    <div className="mt-2">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Real-time metrics panel */}
        <RealTimeMetricsPanel />

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* Today actual vs target bar chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Target vs Actual (Today)</h2>
            {teamLoading ? <Loading size="sm" /> : barData.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [v, name === 'actual' ? 'Actual' : 'Target']} />
                  <Bar dataKey="target" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top performers today — compact panel */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">🏆 Top Performers (Today)</h2>
              <a href="/leaderboard" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Full MTD →
              </a>
            </div>
            {teamLoading ? <Loading size="sm" /> : todayTop5.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
            ) : (
              <div className="space-y-2">
                {todayTop5.map((entry, i) => (
                  <div
                    key={entry.userId}
                    className={`flex items-center gap-3 rounded-lg p-3 ${
                      i === 0 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-slate-50 dark:bg-slate-800/50'
                    }`}
                  >
                    <span className="w-8 text-center text-lg">{MEDAL[i] ?? `#${i + 1}`}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{entry.name}</p>
                      <p className="text-xs text-slate-500">KYC: {entry.metrics.kyc ?? 0} · Demat: {entry.metrics.demat ?? 0}</p>
                    </div>
                    <span className={`text-sm font-bold ${
                      entry.avgScore >= 100 ? 'text-emerald-600' : entry.avgScore >= 70 ? 'text-amber-600' : 'text-rose-600'
                    }`}>
                      {entry.avgScore}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Monthly team progress — MTD from leaderboard */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-white">Monthly Team Progress</h2>
            <span className="text-xs text-slate-400">{lbEntries.length} employees · {currentMonthLabel()}</span>
          </div>
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            Team MTD totals vs combined monthly targets
          </p>
          {lbLoading ? <Loading size="sm" /> : (
            <ProgressBarChart data={monthlyChartData} />
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { href: '/admin/employees',  label: 'Manage Employees', icon: '👥' },
            { href: '/admin/analytics',  label: 'Analytics',        icon: '📈' },
            { href: '/leaderboard',      label: 'Full Leaderboard', icon: '🏆' },
            { href: '/admin/bulk-entry', label: 'Bulk Entry',       icon: '📝' },
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
