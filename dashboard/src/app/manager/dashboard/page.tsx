'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Navbar } from '@/components/layout/Navbar';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Loading } from '@/components/common/Loading';
import { EmptyState } from '@/components/common/EmptyState';
import { apiFetch } from '@/lib/api';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { daysLeftInMonth, currentMonthLabel } from '@/utils/date-utils';
import type { TeamSummaryResponse } from '@/types';

export default function ManagerDashboardPage() {
  const { metrics } = useMetricsConfig();
  const { data: teamData, isLoading } = useQuery({
    queryKey: ['manager-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: 30_000,
  });

  const teamEntries = teamData ? Object.entries(teamData.data) : [];
  const targets = teamData?.targets ?? {};

  const metricTotals = metrics.map((m) => {
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
        metrics.reduce((s, m) => s + ((entry.metrics?.[m.key] ?? 0) / (targets[m.key] ?? 1)) * 100, 0) / metrics.length
      );
      return { userId, name: (entry as unknown as { name?: string }).name ?? entry.email ?? userId, email: entry.email ?? userId, avgScore, metrics: entry.metrics ?? {} };
    })
    .sort((a, b) => b.avgScore - a.avgScore);

  return (
    <>
      <Navbar title="Manager Dashboard" />
      <div className="space-y-6 p-4 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            My Team — {currentMonthLabel()}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {teamEntries.length} employees · {daysLeftInMonth()} days left · {atRisk.length} at risk
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatsCard title="Team Members" value={teamEntries.length} icon="👥" accent="indigo" loading={isLoading} />
          <StatsCard title="Avg Performance" value={`${overallPct}%`} icon="📊" accent={overallPct >= 80 ? 'emerald' : 'amber'} loading={isLoading} />
          <StatsCard title="At Risk" value={atRisk.length} icon="⚠️" accent="rose" loading={isLoading} />
          <StatsCard title="Days Left" value={daysLeftInMonth()} icon="📅" accent="blue" loading={isLoading} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Performance bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Team Metric Totals</h2>
            {isLoading ? (
              <Loading size="sm" />
            ) : teamEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No entries recorded today yet</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Charts will populate once team members log metrics.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {metricTotals.map((m) => {
                  const badge =
                    m.pct >= 100 ? { label: 'Excellent',       cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' }
                    : m.pct >= 70 ? { label: 'On Track',        cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' }
                    : m.pct >  0  ? { label: 'Needs Attention', cls: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' }
                    :               { label: 'Not Started',      cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
                  return (
                    <div key={m.key}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="flex-shrink-0 text-base leading-none">{m.icon}</span>
                          <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{m.label}</span>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <span className="text-[11px] tabular-nums text-slate-500">total: {m.total}</span>
                          <span className={`text-xs font-bold tabular-nums ${m.pct >= 100 ? 'text-emerald-600' : m.pct >= 70 ? 'text-amber-600' : m.pct > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{m.pct}%</span>
                        </div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(m.pct, 100)}%`, backgroundColor: m.color, minWidth: m.pct > 0 ? '3px' : '0' }} />
                      </div>
                      <div className="mt-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* At risk employees */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
              ⚠️ At Risk Employees (Below 70%)
            </h2>
            {isLoading ? (
              <Loading size="sm" />
            ) : atRisk.length === 0 ? (
              <EmptyState icon="✅" title="All on track!" description="No employees are currently below 70% performance." />
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
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{(entry as unknown as { name?: string }).name ?? entry.email ?? userId}</p>
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

        {/* Team leaderboard */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">🏆 Team Leaderboard</h2>
          {isLoading ? (
            <Loading size="sm" />
          ) : leaderboard.length === 0 ? (
            <EmptyState icon="🏆" title="No data yet" />
          ) : (
            <>
              {/* Mobile: card list */}
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
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                      <th className="pb-3 pr-4">Rank</th>
                      <th className="pb-3 pr-4">Employee</th>
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

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          🔒 <strong>Manager access:</strong> You can view your team&apos;s metrics. Contact an admin to add/remove employees or change assignments.
        </div>
      </div>
    </>
  );
}
