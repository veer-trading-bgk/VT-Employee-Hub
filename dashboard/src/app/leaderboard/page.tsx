'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS } from '@/lib/metrics.config';
import { useAuth } from '@/context/AuthContext';
import { currentMonthLabel } from '@/utils/date-utils';

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

function avgProgress(metrics: Record<string, number>, targets: Record<string, number>): number {
  const vals = METRICS.map((m) => {
    const t = targets[m.key] ?? 1;
    return Math.min(((metrics[m.key] ?? 0) / t) * 100, 100);
  });
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export default function LeaderboardPage() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-monthly'],
    queryFn: () => apiFetch<LeaderboardResponse>('/api/metrics/leaderboard'),
    refetchInterval: 60_000,
  });

  const entries = data?.data ?? [];
  const targets = data?.monthlyTargets ?? {};

  return (
    <AppShell>
      <Navbar title="Leaderboard" showBack />
      <div className="p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">🏆 Leaderboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {currentMonthLabel()} · {entries.length} employee{entries.length !== 1 ? 's' : ''} · ranked by points
          </p>
        </div>

        {isLoading ? (
          <Loading />
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-4xl">🏆</p>
            <p className="mt-3 text-base font-semibold text-slate-700 dark:text-slate-300">
              No data for {currentMonthLabel()} yet
            </p>
            <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
              Rankings will appear once employees log metrics.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const isMe = entry.userId === user?.id;
              const avg = avgProgress(entry.metrics, targets);
              const pctColor =
                avg >= 100 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                : avg >= 70 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                : avg > 0   ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
                :              'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
              const barFill =
                avg >= 100 ? '#10b981' : avg >= 70 ? '#f59e0b' : avg > 0 ? '#f43f5e' : '#94a3b8';
              const rankBadge =
                entry.rank === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                : entry.rank === 2 ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                : entry.rank === 3 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';

              return (
                <div
                  key={entry.userId}
                  className={`rounded-xl border p-4 transition-colors ${
                    isMe
                      ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/30'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  {/* Row header: rank + name + points */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${rankBadge}`}
                      >
                        {entry.rank <= 3 ? MEDAL[entry.rank - 1] : `#${entry.rank}`}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {entry.name}
                          </p>
                          {isMe && (
                            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                              You
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                          {entry.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span
                        className={`text-lg font-bold tabular-nums ${
                          entry.rank === 1
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        {entry.points.toLocaleString('en-IN')} pts
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pctColor}`}>
                        {avg}%
                      </span>
                    </div>
                  </div>

                  {/* Overall progress bar */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(avg, 100)}%`,
                        backgroundColor: barFill,
                        minWidth: avg > 0 ? '4px' : '0',
                      }}
                    />
                  </div>

                  {/* Key metric snapshot — first 4 metrics */}
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                    {METRICS.slice(0, 4).map((m) => (
                      <span key={m.key} className="text-[11px] text-slate-500 dark:text-slate-400">
                        {m.icon}{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {entry.metrics[m.key] ?? 0}
                        </span>{' '}
                        {m.label.split(' ')[0]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
          Points formula: count metrics × weight + currency metrics ÷ weight · Refreshes every 60 s
        </p>
      </div>
    </AppShell>
  );
}
