'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';

interface MetricRow {
  employeeId: string;
  name: string;
  kyc: number;
  demat: number;
  mf: number;
  insurance: number;
  date: string;
  notes: string;
}

const EMPTY_ROW: MetricRow = {
  employeeId: '', name: '', kyc: 0, demat: 0, mf: 0, insurance: 0,
  date: new Date().toISOString().split('T')[0], notes: '',
};

export default function BulkEntryPage() {
  const [mode, setMode] = useState<'form' | 'csv'>('form');
  const [form, setForm] = useState<MetricRow>({ ...EMPTY_ROW });
  const [entries, setEntries] = useState<MetricRow[]>([]);
  const [csvText, setCsvText] = useState('');

  const { mutate: submit, isPending } = useMutation<{ count: number }, Error, MetricRow[]>({
    mutationFn: (rows) =>
      apiFetch<{ count: number }>('/api/metrics/bulk-entry', {
        method: 'POST',
        body: JSON.stringify({ entries: rows }),
      }),
    onSuccess: (data) => {
      toast.success(`✅ ${data.count} metric entries submitted`);
      setEntries([]);
      setForm({ ...EMPTY_ROW });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addRow = () => {
    if (!form.employeeId || !form.name) {
      toast.error('Employee ID and Name are required');
      return;
    }
    setEntries((prev) => [...prev, { ...form }]);
    setForm({ ...EMPTY_ROW });
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
      parsed.push({
        employeeId: get('employeeid'),
        name: get('name'),
        kyc: parseInt(get('kyc')) || 0,
        demat: parseInt(get('demat')) || 0,
        mf: parseInt(get('mf')) || 0,
        insurance: parseInt(get('insurance')) || 0,
        date: get('date') || EMPTY_ROW.date,
        notes: get('notes'),
      });
    }
    setEntries(parsed);
    toast.success(`Parsed ${parsed.length} rows`);
  };

  const totals = entries.reduce(
    (s, e) => ({ kyc: s.kyc + e.kyc, demat: s.demat + e.demat, mf: s.mf + e.mf, insurance: s.insurance + e.insurance }),
    { kyc: 0, demat: 0, mf: 0, insurance: 0 }
  );

  return (
    <>
      <Navbar title="Bulk Metrics Entry" showBack />
      <div className="space-y-6 p-4 md:p-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bulk Metrics Entry</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Enter KYC, Demat, MF, and Insurance data for multiple employees
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 w-fit">
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
              {[
                { key: 'employeeId', label: 'Employee ID', type: 'text', span: '' },
                { key: 'name', label: 'Full Name', type: 'text', span: '' },
                { key: 'date', label: 'Date', type: 'date', span: '' },
                { key: 'kyc', label: 'KYC', type: 'number', span: '' },
                { key: 'demat', label: 'Demat', type: 'number', span: '' },
                { key: 'mf', label: 'MF Orders', type: 'number', span: '' },
                { key: 'insurance', label: 'Insurance (₹)', type: 'number', span: '' },
                { key: 'notes', label: 'Notes', type: 'text', span: 'sm:col-span-2 md:col-span-4' },
              ].map(({ key, label, type, span }) => (
                <div key={key} className={span}>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</label>
                  <input
                    type={type}
                    value={String((form as unknown as Record<string, unknown>)[key] ?? '')}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        [key]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              ))}
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
              Header: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">employeeId,name,kyc,demat,mf,insurance,date,notes</code>
            </p>
            <textarea
              className="w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              rows={6}
              placeholder={`employeeId,name,kyc,demat,mf,insurance,date,notes\nEMP001,Priya Sharma,5,3,2,25000,2026-06-17,Strong day`}
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
              <button
                onClick={() => setEntries([])}
                className="text-xs text-rose-500 hover:underline"
              >
                Clear all
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="pb-2 pr-4">Employee</th>
                    <th className="pb-2 pr-4">KYC</th>
                    <th className="pb-2 pr-4">Demat</th>
                    <th className="pb-2 pr-4">MF</th>
                    <th className="pb-2 pr-4">Insurance</th>
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
                        <p className="text-xs text-slate-500">{row.employeeId}</p>
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">{row.kyc}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{row.demat}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{row.mf}</td>
                      <td className="py-2.5 pr-4 tabular-nums">₹{row.insurance.toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-xs text-slate-500">{row.date}</td>
                      <td className="py-2.5">
                        <button
                          onClick={() => setEntries((e) => e.filter((_, j) => j !== i))}
                          className="text-rose-500 hover:text-rose-700 text-sm"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals bar */}
            <div className="mt-4 grid grid-cols-4 gap-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              {([['kyc', 'KYC', 'text-indigo-600'], ['demat', 'Demat', 'text-emerald-600'], ['mf', 'MF', 'text-amber-600'], ['insurance', 'Ins (₹)', 'text-pink-600']] as const).map(([k, label, cls]) => (
                <div key={k}>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className={`text-xl font-bold ${cls}`}>
                    {k === 'insurance' ? `₹${totals[k].toLocaleString()}` : totals[k]}
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
