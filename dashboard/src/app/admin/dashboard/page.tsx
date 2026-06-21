'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue } from '@/lib/metrics.config';
import { MonthlyTeamProgress } from '@/components/charts/MonthlyTeamProgress';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { daysLeftInMonth, currentMonthLabel } from '@/utils/date-utils';
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
  activeHeadcount?: number;
}

interface TargetsResponse {
  success: boolean;
  data: Record<string, { target: number; targetPeriod: 'day' | 'month' }>;
  isCustom: boolean;
}

const MEDAL = ['🥇', '🥈', '🥉'];

function toMonthlyTargetMap(data: TargetsResponse['data']): Record<string, number> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v.targetPeriod === 'month' ? v.target : v.target * 30,
    ])
  );
}

function toDailyTargetMap(data: TargetsResponse['data']): Record<string, number> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v.targetPeriod === 'day' ? v.target : +(v.target / 30).toFixed(2),
    ])
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400">
      {message}
    </div>
  );
}

interface TrialStatus {
  hasTrial: boolean; plan: string; daysLeft: number | null; isExpired: boolean;
}

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: trialData } = useQuery<TrialStatus>({
    queryKey: ['trial-status'],
    queryFn: () => apiFetch('/api/companies/trial'),
    enabled: !!user?.companyId,
    staleTime: 60_000 * 10,
  });

  const { data: teamData, isLoading: teamLoading, isError: teamError } = useQuery({
    queryKey: ['admin-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: 30_000,
  });

  const { data: lbData, isLoading: lbLoading, isError: lbError } = useQuery({
    queryKey: ['admin-leaderboard-monthly'],
    queryFn: () => apiFetch<LeaderboardResponse>('/api/metrics/leaderboard'),
    refetchInterval: 60_000,
  });

  const { data: targetsData, isError: targetsError } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 5 * 60 * 1000,
  });

  const teamEntries = useMemo(
    () => (teamData ? Object.entries(teamData.data) : []),
    [teamData]
  );

  const dailyTargets = useMemo(
    () => targetsData ? toDailyTargetMap(targetsData.data) : (teamData?.targets ?? {}),
    [targetsData, teamData]
  );

  const monthlyTargets = useMemo(
    () => targetsData ? toMonthlyTargetMap(targetsData.data) : {},
    [targetsData]
  );

  const lbEntries = useMemo(() => lbData?.data ?? [], [lbData]);

  // activeHeadcount = active agent/telecaller/intern employees (from employees table)
  // Falls back to lbEntries.length (MTD reporters) if not yet returned by API
  const teamSize = lbData?.activeHeadcount || lbEntries.length || teamEntries.length || 1;

  const metricTotals = useMemo(() => METRICS.map((m) => {
    const total = teamEntries.reduce((sum, [, entry]) => sum + (entry.metrics?.[m.key] ?? 0), 0);
    const target = (dailyTargets[m.key] ?? 0) * teamSize;
    const pct = target > 0 ? Math.round((total / target) * 100) : 0;
    return { ...m, total, target, pct };
  }), [teamEntries, dailyTargets, teamSize]);

  const monthlyChartData = useMemo(() => METRICS.map((m) => {
    const total = lbEntries.reduce((sum, entry) => sum + (entry.metrics[m.key] ?? 0), 0);
    const mTarget = (monthlyTargets[m.key] ?? lbData?.monthlyTargets?.[m.key] ?? 0) * (lbEntries.length || 1);
    const pct = mTarget > 0 ? Math.min(Math.round((total / mTarget) * 100), 999) : 0;
    return { label: m.label, icon: m.icon, value: total, target: mTarget, progress: pct, color: m.color, unit: m.unit };
  }), [lbEntries, monthlyTargets, lbData]);

  const todayTop5 = useMemo(() => teamEntries
    .map(([userId, entry]) => {
      const avgScore = Math.round(
        METRICS.reduce((sum, m) => {
          const v = entry.metrics?.[m.key] ?? 0;
          const t = dailyTargets[m.key] || 1;
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
    .slice(0, 5),
  [teamEntries, dailyTargets]);

  const barData = useMemo(() => metricTotals.map((m) => ({
    name: m.key.toUpperCase(),
    actual: m.total,
    target: Math.round(m.target),
  })), [metricTotals]);

  const overallPct = useMemo(() =>
    metricTotals.length > 0
      ? Math.round(metricTotals.reduce((s, m) => s + m.pct, 0) / metricTotals.length)
      : 0,
  [metricTotals]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-team-summary'] });
    queryClient.invalidateQueries({ queryKey: ['admin-leaderboard-monthly'] });
    queryClient.invalidateQueries({ queryKey: ['admin-targets'] });
  }, [queryClient]);

  return (
    <>
      <Navbar title="Admin Dashboard" />
      <div className="space-y-6 p-4 md:p-8">

        {/* Trial banner */}
        {trialData?.hasTrial && !trialData.isExpired && (trialData.daysLeft ?? 14) <= 7 && (
          <div className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm
            ${(trialData.daysLeft ?? 7) <= 2
              ? 'bg-rose-950/50 border border-rose-800 text-rose-300'
              : 'bg-amber-950/40 border border-amber-700/50 text-amber-300'}`}>
            <span>
              ⏳ Your free trial ends in{' '}
              <strong>{trialData.daysLeft} day{trialData.daysLeft === 1 ? '' : 's'}</strong>.
            </span>
            <Link href="/admin/billing" className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500 transition">
              Upgrade
            </Link>
          </div>
        )}
        {trialData?.isExpired && (
          <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm bg-rose-950/60 border border-rose-700 text-rose-300">
            <span>⚠️ Trial expired. <strong>Upgrade now</strong> to keep your data and access.</span>
            <Link href="/admin/billing" className="shrink-0 rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-500 transition">
              Upgrade Now
            </Link>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Overview — {currentMonthLabel()}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {daysLeftInMonth()} days left · {teamSize} performers
              {targetsData?.isCustom && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                  Custom targets active
                </span>
              )}
            </p>
          </div>
          <button
            onClick={refresh}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Error banners */}
        {teamError    && <ErrorBanner message="Failed to load today's team metrics. Data may be stale." />}
        {lbError      && <ErrorBanner message="Failed to load monthly leaderboard data." />}
        {targetsError && <ErrorBanner message="Failed to load targets — showing defaults." />}

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Logged Today" value={teamEntries.length} icon="👥" accent="indigo" loading={teamLoading} />
          <StatsCard title="Daily Progress" value={`${overallPct}%`} icon="🎯"
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
          ) : teamError ? null : teamEntries.length === 0 ? (
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
                    <div
                      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                      role="progressbar"
                      aria-valuenow={Math.min(m.pct, 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${m.label} progress`}
                    >
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

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* Today actual vs target bar chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Target vs Actual (Today)</h2>
            {teamLoading ? <Loading size="sm" /> : teamError ? (
              <p className="py-8 text-center text-sm text-rose-400">Failed to load</p>
            ) : barData.length === 0 ? (
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
              <Link href="/leaderboard" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Full MTD →
              </Link>
            </div>
            {teamLoading ? <Loading size="sm" /> : teamError ? (
              <p className="py-8 text-center text-sm text-rose-400">Failed to load</p>
            ) : todayTop5.length === 0 ? (
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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-white">Monthly Team Progress</h2>
            <span className="text-xs text-slate-400">{currentMonthLabel()}</span>
          </div>
          {lbLoading ? <Loading size="sm" /> : lbError ? (
            <p className="py-4 text-center text-sm text-rose-400">Failed to load monthly data</p>
          ) : (
            <MonthlyTeamProgress data={monthlyChartData} teamSize={teamSize} />
          )}
        </div>

      </div>
    </>
  );
}
