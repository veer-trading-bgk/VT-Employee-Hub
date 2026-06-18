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

      <div className="overflow-x-auto">
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
