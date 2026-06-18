import { exportToCsv } from '@/lib/csv';

export { exportToCsv };

/** Print the current page to PDF via the browser's native print dialog */
export function printToPdf(title?: string) {
  const prevTitle = document.title;
  if (title) document.title = title;
  window.print();
  document.title = prevTitle;
}

/** Export a table to CSV — alias with a datestamp filename */
export function exportTableToCsv<T extends object>(rows: T[], baseName: string) {
  const date = new Date().toISOString().split('T')[0];
  exportToCsv(`${baseName}_${date}.csv`, rows);
}

/** Convert metrics summary into exportable rows */
export interface MetricExportRow {
  metric: string;
  value: number | string;
  target: number | string;
  progress_pct: number;
  date: string;
}

export function buildMetricExportRows(
  summary: { metric: { label: string }; value: number; target: number; progress: number }[]
): MetricExportRow[] {
  const date = new Date().toISOString().split('T')[0];
  return summary.map((s) => ({
    metric: s.metric.label,
    value: s.value,
    target: Math.round(s.target),
    progress_pct: s.progress,
    date,
  }));
}

/** Convert team leaderboard data into exportable rows */
export interface LeaderboardExportRow {
  rank: number;
  employee: string;
  kyc: number;
  demat: number;
  mf: number;
  insurance: number;
  avg_score_pct: number;
}

export function buildLeaderboardExportRows(
  rows: { rank: number; email: string; metrics: Record<string, number>; avgScore: number }[]
): LeaderboardExportRow[] {
  return rows.map((r) => ({
    rank: r.rank,
    employee: r.email,
    kyc: r.metrics.kyc ?? 0,
    demat: r.metrics.demat ?? 0,
    mf: r.metrics.mf ?? 0,
    insurance: r.metrics.insurance ?? 0,
    avg_score_pct: r.avgScore,
  }));
}
