'use client';

import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue } from '@/lib/metrics.config';

// Only count-type metrics appear as bulk-entry columns (currency metrics like
// insurance are entered per employee via their own daily-entry form).
const BULK_METRICS = METRICS.filter((m) => m.unit === 'count');

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface MetricRow {
  employeeId: string;
  name: string;
  metrics: Record<string, number>;
  date: string;
  notes: string;
}

const TODAY = new Date().toISOString().split('T')[0];

function emptyRow(): MetricRow {
  return {
    employeeId: '',
    name: '',
    metrics: Object.fromEntries(BULK_METRICS.map((m) => [m.key, 0])),
    date: TODAY,
    notes: '',
  };
}

const CSV_HEADER = ['employeeId', 'name', ...BULK_METRICS.map((m) => m.key), 'date', 'notes'].join(',');

export default function BulkEntryPage() {
  const [mode, setMode] = useState<'form' | 'csv'>('form');
  const [form, setForm] = useState<MetricRow>(emptyRow());
  const [empSearch, setEmpSearch] = useState('');
  const [showEmpList, setShowEmpList] = useState(false);
  const [entries, setEntries] = useState<MetricRow[]>([]);
  const [csvText, setCsvText] = useState('');

  // Fetch employee list for the picker
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: Employee[] }>('/api/admin/employees')
      .catch(() => ({ success: true, data: [] as Employee[] })),
    staleTime: 1000 * 60 * 5,
  });

  const employees = empData?.data ?? [];

  const filteredEmps = useMemo(() => {
    const q = empSearch.toLowerCase();
    return employees.filter((e) =>
      e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [employees, empSearch]);

  const selectEmployee = (emp: Employee) => {
    setForm((f) => ({ ...f, employeeId: emp.id, name: emp.name }));
    setEmpSearch(emp.name);
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
      toast.error('Select an employee first');
      return;
    }
    setEntries((prev) => [...prev, { ...form, metrics: { ...form.metrics } }]);
    setForm(emptyRow());
    setEmpSearch('');
    toast.success('Row added');
  };

  const parseCSV = () => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) { toast.error('CSV needs a header row + data rows'); return; }
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const parsed: MetricRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map((v) => v.trim());
      const get = (k: string) => vals[headers.indexOf(k)] ?? '';
      const metrics = Object.fromEntries(
        BULK_METRICS.map((m) => [m.key, parseInt(get(m.key)) || 0])
      );
      parsed.push({
        employeeId: get('employeeid'),
        name: get('name'),
        metrics,
        date: get('date') || TODAY,
        notes: get('notes'),
      });
    }
    setEntries(parsed);
    toast.success(`Parsed ${parsed.length} rows`);
  };

  const totals = entries.reduce<Record<string, number>>(
    (acc, row) => {
      BULK_METRICS.forEach((m) => { acc[m.key] = (acc[m.key] ?? 0) + (row.metrics[m.key] ?? 0); });
      return acc;
    },
    Object.fromEntries(BULK_METRICS.map((m) => [m.key, 0]))
  );

  const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

  return (
    <>
      <Navbar title="Bulk Metrics Entry" showBack />
      <div className="space-y-6 p-4 md:p-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bulk Metrics Entry</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Enter metrics for multiple employees — {BULK_METRICS.map((m) => m.label).join(', ')}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex w-fit rounded-lg border border-slate-200 dark:border-slate-700">
          {(['form', 'csv'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-5 py-2 text-sm font-medium transition first:rounded-l-lg last:rounded-r-lg ${
                mode === m ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
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

              {/* Employee picker */}
              <div className="sm:col-span-2 relative">
                <label className="block text-xs font-medium text-slate-500 mb-1">Employee *</label>
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
                  <p className="mt-0.5 text-[11px] text-slate-400">ID: {form.employeeId.slice(0, 16)}…</p>
                )}
                {showEmpList && empSearch && filteredEmps.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {filteredEmps.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        onMouseDown={() => selectEmployee(emp)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                          {emp.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white">{emp.name}</p>
                          <p className="truncate text-xs text-slate-400">{emp.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showEmpList && empSearch && filteredEmps.length === 0 && employees.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-400 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    No employees found
                  </div>
                )}
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className={inputCls}
                />
              </div>

              {/* Dynamic metric fields */}
              {BULK_METRICS.map((m) => (
                <div key={m.key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {m.icon} {m.label}
                  </label>
                  <input
                    type="number"
                    min="0"
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

              {/* Notes full width */}
              <div className="sm:col-span-2 md:col-span-4">
                <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <button
              onClick={addRow}
              className="mt-4 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              + Add Row
            </button>
          </div>
        )}

        {/* CSV upload */}
        {mode === 'csv' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">Paste CSV Data</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Header:{' '}
              <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">
                {CSV_HEADER}
              </code>
            </p>
            <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">
              Use employee IDs from the{' '}
              <a href="/admin/employees" className="underline">Employee Directory</a>.
            </p>
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={6}
              placeholder={`${CSV_HEADER}\nEMP001,Priya Sharma,5,3,2,0,0,1,2,1,2026-06-17,Strong day`}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <button
              onClick={parseCSV}
              className="mt-3 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              📥 Parse CSV
            </button>
          </div>
        )}

        {/* Preview table */}
        {entries.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Preview ({entries.length} entries)
              </h2>
              <button onClick={() => setEntries([])} className="text-xs text-rose-500 hover:underline">
                Clear all
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Employee</th>
                    {BULK_METRICS.map((m) => (
                      <th key={m.key} className="pb-2 pr-4">{m.icon} {m.label}</th>
                    ))}
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
                        <p className="text-xs text-slate-500">{row.employeeId.slice(0, 12)}…</p>
                      </td>
                      {BULK_METRICS.map((m) => (
                        <td key={m.key} className="py-2.5 pr-4 tabular-nums text-slate-700 dark:text-slate-300">
                          {row.metrics[m.key] ?? 0}
                        </td>
                      ))}
                      <td className="py-2.5 pr-4 text-xs text-slate-500">{row.date}</td>
                      <td className="py-2.5">
                        <button
                          onClick={() => setEntries((e) => e.filter((_, j) => j !== i))}
                          className="text-rose-500 hover:text-rose-700"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div
              className="mt-4 grid gap-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-800"
              style={{ gridTemplateColumns: `repeat(${Math.min(BULK_METRICS.length, 6)}, minmax(0, 1fr))` }}
            >
              {BULK_METRICS.map((m) => (
                <div key={m.key}>
                  <p className="text-xs text-slate-500">{m.icon} {m.label}</p>
                  <p className="text-xl font-bold" style={{ color: m.color }}>
                    {formatMetricValue(m, totals[m.key] ?? 0)}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => submit(entries)}
              disabled={isPending}
              className="mt-5 w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isPending ? '⏳ Submitting…' : `✅ Submit ${entries.length} Entries`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
