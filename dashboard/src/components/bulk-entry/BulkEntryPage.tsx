'use client';

import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue } from '@/lib/metrics.config';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';

const BULK_METRIC_KEYS = METRICS.filter((m) => m.unit === 'count').map((m) => m.key);

interface Performer {
  id: string;
  name: string;
  email: string;
  role?: string;
}

interface MetricRow {
  employeeId: string;
  name: string;
  metrics: Record<string, number>;
  date: string;
  notes: string;
}

interface Props {
  /** API endpoint that returns { success, data: Performer[] } */
  performersUrl: string;
  /** Href for the "Employee Directory" link shown in CSV instructions */
  directoryHref?: string;
  /** Page title shown in Navbar */
  title?: string;
}

const TODAY = new Date().toISOString().split('T')[0];
const CSV_HEADER = ['employeeId', 'name', ...BULK_METRIC_KEYS, 'date', 'notes'].join(',');

function emptyRow(): MetricRow {
  return {
    employeeId: '',
    name: '',
    metrics: Object.fromEntries(BULK_METRIC_KEYS.map((k) => [k, 0])),
    date: TODAY,
    notes: '',
  };
}

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ' +
  'dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export function BulkEntryPage({ performersUrl, directoryHref, title = 'Bulk Metrics Entry' }: Props) {
  const { metrics } = useMetricsConfig();
  const bulkMetrics = useMemo(() => metrics.filter((m) => BULK_METRIC_KEYS.includes(m.key)), [metrics]);
  const [mode, setMode] = useState<'form' | 'csv'>('form');
  const [form, setForm] = useState<MetricRow>(emptyRow());
  const [empSearch, setEmpSearch] = useState('');
  const [showEmpList, setShowEmpList] = useState(false);
  const [entries, setEntries] = useState<MetricRow[]>([]);
  const [csvText, setCsvText] = useState('');
  const [csvErrors, setCsvErrors] = useState<string[]>([]);

  const { data: perfData } = useQuery({
    queryKey: ['bulk-entry-performers', performersUrl],
    queryFn: () =>
      apiFetch<{ success: boolean; data: Performer[] }>(performersUrl).catch(() => ({
        success: true,
        data: [] as Performer[],
      })),
    staleTime: 5 * 60 * 1000,
  });

  const performers = perfData?.data ?? [];

  const filteredPerfs = useMemo(() => {
    const q = empSearch.toLowerCase();
    return performers
      .filter((e) => e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [performers, empSearch]);

  const perfIdSet = useMemo(() => new Set(performers.map((e) => e.id)), [performers]);

  const selectPerformer = (p: Performer) => {
    setForm((f) => ({ ...f, employeeId: p.id, name: p.name }));
    setEmpSearch(p.name);
    setShowEmpList(false);
  };

  const { mutate: submit, isPending } = useMutation<{ count: number }, Error, MetricRow[]>({
    mutationFn: (rows) =>
      apiFetch<{ count: number }>('/api/metrics/bulk-entry', {
        method: 'POST',
        body: JSON.stringify({ entries: rows }),
      }),
    onSuccess: (data) => {
      toast.success(`✅ ${data.count} metric entries submitted`);
      setEntries([]);
      setForm(emptyRow());
      setEmpSearch('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addRow = () => {
    if (!form.employeeId.trim() || !form.name.trim()) {
      toast.error('Select a team member first');
      return;
    }
    setEntries((prev) => [...prev, { ...form, metrics: { ...form.metrics } }]);
    setForm(emptyRow());
    setEmpSearch('');
    toast.success('Row added to batch');
  };

  const parseCSV = () => {
    if (!csvText.trim()) { toast.error('Paste CSV data first'); return; }

    const result = Papa.parse<Record<string, string>>(csvText.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      transform: (v) => v.trim(),
    });

    const errors: string[] = [];
    const parsed: MetricRow[] = [];

    result.errors.forEach((e) => errors.push(`Row ${e.row}: ${e.message}`));

    result.data.forEach((row, i) => {
      const rowNum = i + 2;
      const employeeId = row['employeeid'] || row['employee_id'] || row['id'] || '';
      const name = row['name'] || '';

      if (!employeeId) { errors.push(`Row ${rowNum}: missing employeeId`); return; }
      if (performers.length > 0 && !perfIdSet.has(employeeId)) {
        errors.push(`Row ${rowNum}: employee "${employeeId}" not found`);
      }

      const metrics: Record<string, number> = {};
      bulkMetrics.forEach((m) => {
        const raw = row[m.key] ?? row[m.label.toLowerCase().replace(/\s+/g, '_')] ?? '0';
        const val = parseFloat(raw) || 0;
        if (val < 0) errors.push(`Row ${rowNum}: ${m.key} cannot be negative`);
        metrics[m.key] = Math.max(0, val);
      });

      parsed.push({ employeeId, name, metrics, date: row['date'] || TODAY, notes: row['notes'] || '' });
    });

    setCsvErrors(errors);

    if (parsed.length === 0) { toast.error('No valid rows found'); return; }
    setEntries(parsed);
    errors.length > 0
      ? toast.warning(`Parsed ${parsed.length} rows with ${errors.length} warning(s)`)
      : toast.success(`Parsed ${parsed.length} rows — review then submit`);
  };

  const totals = entries.reduce<Record<string, number>>(
    (acc, row) => {
      bulkMetrics.forEach((m) => { acc[m.key] = (acc[m.key] ?? 0) + (row.metrics[m.key] ?? 0); });
      return acc;
    },
    Object.fromEntries(bulkMetrics.map((m) => [m.key, 0]))
  );

  return (
    <>
      <Navbar title={title} showBack />
      <div className="space-y-6 p-4 md:p-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Log metrics for performers — {bulkMetrics.map((m) => m.label).join(', ')}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex w-fit rounded-lg border border-slate-200 dark:border-slate-700">
          {(['form', 'csv'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-5 py-2 text-sm font-medium transition first:rounded-l-lg last:rounded-r-lg ${
                mode === m
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {m === 'form' ? '📝 Manual Entry' : '📤 CSV Upload'}
            </button>
          ))}
        </div>

        {/* Manual form */}
        {mode === 'form' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">Add Single Entry</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">

              {/* Performer picker */}
              <div className="relative sm:col-span-2" onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowEmpList(false);
              }}>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Team Member <span className="text-rose-500">*</span>
                </label>
                <input
                  value={empSearch}
                  onChange={(e) => {
                    setEmpSearch(e.target.value);
                    setShowEmpList(true);
                    if (!e.target.value) setForm((f) => ({ ...f, employeeId: '', name: '' }));
                  }}
                  onFocus={() => setShowEmpList(true)}
                  placeholder="Search by name or email…"
                  className={inputCls}
                  autoComplete="off"
                />
                {form.employeeId && (
                  <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    ✓ {form.name}
                  </p>
                )}

                {showEmpList && empSearch && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
                    {filteredPerfs.length > 0 ? filteredPerfs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => selectPerformer(p)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 first:rounded-t-xl last:rounded-b-xl"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                          {p.name?.[0]?.toUpperCase() ?? '?'}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white">{p.name}</p>
                          <p className="truncate text-xs text-slate-400">{p.email}</p>
                        </div>
                        {p.role && (
                          <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                            {p.role}
                          </span>
                        )}
                      </button>
                    )) : (
                      <p className="px-3 py-3 text-sm text-slate-400">No performers found</p>
                    )}
                  </div>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
                <input
                  type="date"
                  value={form.date}
                  max={TODAY}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className={inputCls}
                />
              </div>

              {/* Metric fields */}
              {bulkMetrics.map((m) => (
                <div key={m.key}>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    {m.icon} {m.label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={form.metrics[m.key] ?? 0}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        metrics: { ...f.metrics, [m.key]: parseInt(e.target.value) || 0 },
                      }))
                    }
                    className={inputCls}
                  />
                </div>
              ))}

              {/* Notes */}
              <div className="sm:col-span-2 md:col-span-4">
                <label className="mb-1 block text-xs font-medium text-slate-500">Notes (optional)</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Any remarks for this entry…"
                  className={inputCls}
                />
              </div>
            </div>

            <button
              onClick={addRow}
              className="mt-4 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-[0.98] transition-all"
            >
              + Add to Batch
            </button>
          </div>
        )}

        {/* CSV upload */}
        {mode === 'csv' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">Paste CSV Data</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Expected header:{' '}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">
                {CSV_HEADER}
              </code>
            </p>
            {directoryHref && (
              <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
                Use employee IDs from the{' '}
                <a href={directoryHref} className="underline">Employee Directory</a>.
                Quoted fields and commas in values are supported.
              </p>
            )}
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={8}
              placeholder={`${CSV_HEADER}\nemp_1234567890,Priya Sharma,5,3,2,0,0,1,${TODAY},Strong day`}
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); setCsvErrors([]); }}
            />

            {csvErrors.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="mb-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {csvErrors.length} warning(s) — fix before submitting:
                </p>
                <ul className="space-y-0.5">
                  {csvErrors.map((err, i) => (
                    <li key={i} className="text-xs text-amber-700 dark:text-amber-300">• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={parseCSV}
              className="mt-3 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              📥 Parse CSV
            </button>
          </div>
        )}

        {/* Preview & submit */}
        {entries.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Batch Preview
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                  {entries.length} entries
                </span>
              </h2>
              <button onClick={() => setEntries([])} className="text-xs text-rose-500 hover:text-rose-700 hover:underline">
                Clear all
              </button>
            </div>

            {/* Mobile: card list */}
            <div className="space-y-2 sm:hidden">
              {entries.map((row, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{row.name || row.employeeId}</p>
                    <p className="text-xs text-slate-400">{row.date}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {bulkMetrics.filter(m => (row.metrics[m.key] ?? 0) > 0).map((m) => (
                        <span key={m.key} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                          {m.icon} {m.key.toUpperCase()}: {row.metrics[m.key]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setEntries((e) => e.filter((_, j) => j !== i))}
                    className="mt-0.5 text-rose-400 hover:text-rose-600"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-500 dark:border-slate-800">
                    <th className="pb-2 pr-4">Employee</th>
                    {bulkMetrics.map((m) => (
                      <th key={m.key} className="pb-2 pr-3 whitespace-nowrap">{m.icon} {m.label}</th>
                    ))}
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900 dark:text-white">{row.name || row.employeeId}</p>
                        <p className="text-xs text-slate-400">{row.employeeId.slice(0, 14)}…</p>
                      </td>
                      {bulkMetrics.map((m) => (
                        <td key={m.key} className="py-2.5 pr-3 tabular-nums text-slate-700 dark:text-slate-300">
                          {row.metrics[m.key] ?? 0}
                        </td>
                      ))}
                      <td className="py-2.5 pr-4 text-xs text-slate-500">{row.date}</td>
                      <td className="py-2.5">
                        <button
                          onClick={() => setEntries((e) => e.filter((_, j) => j !== i))}
                          className="text-rose-400 hover:text-rose-600 transition"
                          aria-label="Remove row"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals summary */}
            <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50"
              style={{ gridTemplateColumns: `repeat(${Math.min(bulkMetrics.length, 6)}, minmax(0, 1fr))` }}>
              {bulkMetrics.map((m) => (
                <div key={m.key} className="text-center">
                  <p className="text-[11px] text-slate-400">{m.icon} {m.key.toUpperCase()}</p>
                  <p className="text-lg font-bold" style={{ color: m.color }}>
                    {formatMetricValue(m, totals[m.key] ?? 0)}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => submit(entries)}
              disabled={isPending}
              className="mt-5 w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {isPending ? '⏳ Submitting…' : `✅ Submit ${entries.length} Entries`}
            </button>
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && performers.length === 0 && perfData && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-2xl mb-2">👥</p>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No performers available</p>
            <p className="mt-1 text-xs text-slate-400">
              {performersUrl.includes('my-team')
                ? 'Ask an admin to assign team members to you.'
                : 'No active performers found in the system.'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
