'use client';

import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Loading } from '@/components/common/Loading';
import { EmptyState } from '@/components/common/EmptyState';
import { apiFetch } from '@/lib/api';
import { METRICS } from '@/lib/metrics.config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { daysLeftInMonth, currentMonthLabel } from '@/utils/date-utils';
import type { TeamSummaryResponse } from '@/types';

export default function TeamLeadDashboardPage() {
  const { data: teamData, isLoading } = useQuery({
    queryKey: ['team-lead-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: 30_000,
  });

  const teamEntries = teamData ? Object.entries(teamData.data) : [];
  const targets = teamData?.targets ?? {};

  const metricTotals = METRICS.map((m) => {
    const total = teamEntries.reduce((sum, [, e]) => sum + (e.metrics?.[m.key] ?? 0), 0);
    const target = (targets[m.key] ?? 0) * teamEntries.length;
    const pct = target > 0 ? Math.round((total / target) * 100) : 0;
    return { label: m.label, key: m.key, total, pct, icon: m.icon, color: m.color };
  });

  const overallPct =
    metricTotals.length > 0
      ? Math.round(metricTotals.reduce((s, m) => s + m.pct, 0) / metricTotals.length)
      : 0;

  const atRisk = teamEntries.filter(([, e]) => {
    const kycPct = ((e.metrics?.kyc ?? 0) / (targets.kyc ?? 1)) * 100;
    return kycPct < 70;
  });

  const barData = metricTotals.map((m) => ({
    name: m.key.toUpperCase(),
    total: m.total,
    pct: m.pct,
  }));

  const medalEmoji = (rank: number) => ['🥇', '🥈', '🥉'][rank] ?? `#${rank + 1}`;
  const leaderboard = teamEntries
    .map(([userId, entry]) => {
      const avgScore = Math.round(
        METRICS.reduce((s, m) => s + ((entry.metrics?.[m.key] ?? 0) / (targets[m.key] ?? 1)) * 100, 0) / METRICS.length
      );
      return {
        userId,
        name: (entry as unknown as { name?: string }).name ?? entry.email ?? userId,
        email: entry.email ?? userId,
        avgScore,
        metrics: entry.metrics ?? {},
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore);

  return (
    <>
      <Navbar title="Team Lead Dashboard" />
      <div className="space-y-6 p-4 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            My Team — {currentMonthLabel()}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {teamEntries.length} members · {daysLeftInMonth()} days left · {atRisk.length} at risk
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Team Members" value={teamEntries.length} icon="👥" accent="cyan" loading={isLoading} />
          <StatsCard title="Avg Performance" value={`${overallPct}%`} icon="📊" accent={overallPct >= 80 ? 'emerald' : 'amber'} loading={isLoading} />
          <StatsCard title="At Risk" value={atRisk.length} icon="⚠️" accent="rose" loading={isLoading} />
          <StatsCard title="Days Left" value={daysLeftInMonth()} icon="📅" accent="blue" loading={isLoading} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Team Metric Totals</h2>
            {isLoading ? (
              <Loading size="sm" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
              ⚠️ At Risk Members (Below 70%)
            </h2>
            {isLoading ? (
              <Loading size="sm" />
            ) : atRisk.length === 0 ? (
              <EmptyState icon="✅" title="All on track!" description="No members are currently below 70% performance." />
            ) : (
              <div className="space-y-2">
                {atRisk.map(([userId, entry]) => {
                  const pct = Math.round(((entry.metrics?.kyc ?? 0) / (targets.kyc ?? 1)) * 100);
                  return (
                    <div
                      key={userId}
                      className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 dark:border-rose-900/30 dark:bg-rose-950/20"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          {(entry as unknown as { name?: string }).name ?? entry.email ?? userId}
                        </p>
                        <p className="text-xs text-slate-500">KYC: {entry.metrics?.kyc ?? 0}</p>
                      </div>
                      <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">🏆 Team Leaderboard</h2>
          {isLoading ? (
            <Loading size="sm" />
          ) : leaderboard.length === 0 ? (
            <EmptyState icon="🏆" title="No data yet" />
          ) : (
            <>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 sm:hidden">
                {leaderboard.map((entry, i) => (
                  <div key={entry.userId} className="flex items-center gap-3 py-3">
                    <span className="w-7 flex-shrink-0 text-center text-lg">{medalEmoji(i)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{entry.name}</p>
                      <p className="text-xs text-slate-400">KYC {entry.metrics.kyc ?? 0} · Demat {entry.metrics.demat ?? 0} · MF {entry.metrics.mf ?? 0}</p>
                    </div>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${entry.avgScore >= 100 ? 'bg-emerald-100 text-emerald-700' : entry.avgScore >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                      {entry.avgScore}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                      <th className="pb-3 pr-4">Rank</th>
                      <th className="pb-3 pr-4">Member</th>
                      <th className="pb-3 pr-4">KYC</th>
                      <th className="pb-3 pr-4">Demat</th>
                      <th className="pb-3 pr-4">MF</th>
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
                        <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-400">{entry.metrics.kyc ?? 0}</td>
                        <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-400">{entry.metrics.demat ?? 0}</td>
                        <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-400">{entry.metrics.mf ?? 0}</td>
                        <td className="py-2.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${entry.avgScore >= 100 ? 'bg-emerald-100 text-emerald-700' : entry.avgScore >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                            {entry.avgScore}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-800 dark:border-cyan-900/50 dark:bg-cyan-950/20 dark:text-cyan-300">
          🔒 <strong>Team Lead access:</strong> You can view and verify your team&apos;s metrics. Contact a manager to add/remove employees.
        </div>
      </div>
    </>
  );
}
