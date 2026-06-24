'use client';

import { useMemo, useState } from 'react';
import { formatMetricValue } from '@/lib/metrics.config';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import type { TeamSummaryEntry } from '@/types';

interface LeaderboardProps {
  data: Record<string, TeamSummaryEntry>;
}

export function Leaderboard({ data }: LeaderboardProps) {
  const { metrics } = useMetricsConfig();
  const [sortBy, setSortBy] = useState(metrics[0]?.key ?? 'kyc');

  const rows = useMemo(() => {
    return Object.entries(data)
      .map(([userId, entry]) => ({
        userId,
        email: entry.email,
        value: entry.metrics?.[sortBy] ?? 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [data, sortBy]);

  const metric = metrics.find((m) => m.key === sortBy) ?? metrics[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900 dark:text-white">🏆 Top 5</h3>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        >
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <ol className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-400">No data yet.</p>}
        {rows.map((row, i) => (
          <li
            key={row.userId}
            className="flex items-center justify-between rounded-lg px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  i === 0
                    ? 'bg-amber-400 text-white'
                    : i === 1
                    ? 'bg-slate-300 text-slate-700'
                    : i === 2
                    ? 'bg-amber-700 text-white'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                }`}
              >
                {i + 1}
              </span>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{row.email}</span>
            </div>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {formatMetricValue(metric, row.value)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
