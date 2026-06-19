'use client';

import { exportToCsv } from '@/lib/csv';
import type { MetricRecord } from '@/types';
import { getMetricConfig, formatMetricValue } from '@/lib/metrics.config';

interface DataTableProps {
  records: MetricRecord[];
  filename?: string;
}

export function DataTable({ records, filename = 'metrics_export.csv' }: DataTableProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900 dark:text-white">Raw Data</h3>
        <button
          onClick={() => exportToCsv(filename, records)}
          disabled={records.length === 0}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Mobile card view */}
      <div className="space-y-2.5 sm:hidden">
        {records.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No records found.</p>
        ) : (
          records.map((r) => {
            const cfg = getMetricConfig(r.metric_type);
            return (
              <div
                key={r.metricId}
                className="rounded-lg border border-slate-100 p-3 dark:border-slate-800"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {cfg?.label ?? r.metric_type}
                  </span>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.verified
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    {r.verified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                <p className="text-xl font-bold text-slate-900 dark:text-white">
                  {cfg ? formatMetricValue(cfg, r.value) : r.value}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                  <span>{r.date}</span>
                  <span className="capitalize">{r.enteredFrom}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-400 dark:border-slate-800">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Metric</th>
              <th className="py-2 pr-4 font-medium">Value</th>
              <th className="py-2 pr-4 font-medium">Source</th>
              <th className="py-2 font-medium">Verified</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400">
                  No records found.
                </td>
              </tr>
            )}
            {records.map((r) => {
              const cfg = getMetricConfig(r.metric_type);
              return (
                <tr
                  key={r.metricId}
                  className="border-b border-slate-100 text-slate-700 last:border-0 dark:border-slate-800/50 dark:text-slate-300"
                >
                  <td className="py-2 pr-4">{r.date}</td>
                  <td className="py-2 pr-4">{cfg?.label ?? r.metric_type}</td>
                  <td className="py-2 pr-4 font-medium">{cfg ? formatMetricValue(cfg, r.value) : r.value}</td>
                  <td className="py-2 pr-4 capitalize">{r.enteredFrom}</td>
                  <td className="py-2">{r.verified ? '✅' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
