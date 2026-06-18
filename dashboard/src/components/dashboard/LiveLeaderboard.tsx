'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRealTime } from '@/hooks/useRealTime';
import { apiFetch } from '@/lib/api';
import { METRICS } from '@/lib/metrics.config';
import { Loading } from '@/components/common/Loading';
import { EmptyState } from '@/components/common/EmptyState';
import type { TeamSummaryResponse } from '@/types';

type Timeframe = 'today' | 'week' | 'month';

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  today: '📅 Today',
  week: '📊 This Week',
  month: '📈 This Month',
};

interface LeaderboardRow {
  rank: number;
  userId: string;
  email: string;
  metrics: Record<string, number>;
  avgScore: number;
  trend: 'up' | 'down' | 'stable';
}

const medalEmoji = (rank: number) => ['🥇', '🥈', '🥉'][rank] ?? `#${rank + 1}`;

export function LiveLeaderboard() {
  const [timeframe, setTimeframe] = useState<Timeframe>('today');

  const { isLive, lastUpdated, nextRefreshIn, refresh } = useRealTime({
    queryKeys: [['live-leaderboard', timeframe]],
    intervalMs: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['live-leaderboard', timeframe],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: false,
  });

  const targets = data?.targets ?? {};
  const teamEntries = data ? Object.entries(data.data) : [];

  // Build leaderboard rows
  const rows: LeaderboardRow[] = teamEntries
    .map(([userId, entry]) => {
      const avgScore = Math.round(
        METRICS.reduce((sum, m) => {
          const v = entry.metrics?.[m.key] ?? 0;
          const t = targets[m.key] ?? 1;
          return sum + (v / t) * 100;
        }, 0) / METRICS.length
      );
      return {
        rank: 0,
        userId,
        email: entry.email ?? userId,
        metrics: entry.metrics ?? {},
        avgScore,
        trend: 'stable' as const,
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isLive ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">🏆 Live Leaderboard</h2>
          {isLive && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              LIVE
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="hidden text-xs text-slate-400 sm:block">
              {lastUpdated.toLocaleTimeString()} · next in {nextRefreshIn}s
            </span>
          )}
          <button
            onClick={refresh}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Refresh"
          >
            🔄
          </button>
          {/* Timeframe tabs */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
            {(Object.entries(TIMEFRAME_LABELS) as [Timeframe, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTimeframe(key)}
                className={`px-2.5 py-1 text-xs font-medium transition first:rounded-l-lg last:rounded-r-lg ${
                  timeframe === key
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="p-6">
          <Loading size="sm" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="🏆" title="No data yet" description="Leaderboard appears once employees add metrics." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3">Demat</th>
                <th className="px-4 py-3">MF</th>
                <th className="px-4 py-3">Ins</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row) => {
                const isTop3 = row.rank <= 3;
                return (
                  <tr
                    key={row.userId}
                    className={`transition-colors ${
                      isTop3
                        ? 'bg-amber-50/60 dark:bg-amber-950/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="px-4 py-3 text-base font-bold">{medalEmoji(row.rank - 1)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                          {(row.email[0] ?? '?').toUpperCase()}
                        </div>
                        <span className="max-w-[120px] truncate text-sm font-medium text-slate-900 dark:text-white">
                          {row.email}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                      {row.metrics.kyc ?? 0}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                      {row.metrics.demat ?? 0}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                      {row.metrics.mf ?? 0}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                      {row.metrics.insurance ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          row.avgScore >= 100
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                            : row.avgScore >= 70
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
                        }`}
                      >
                        {row.avgScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-base">
                      {row.trend === 'up' ? '↑' : row.trend === 'down' ? '↓' : '→'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400 dark:border-slate-800">
            {rows.length} employees ranked · auto-refreshes every 30s
          </div>
        </div>
      )}
    </div>
  );
}
