'use client';

import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue, getMetricConfig } from '@/lib/metrics.config';

interface PayrollEntry {
  userId: string;
  base: number;
  bonus: number;
  total: number;
  metrics: Record<string, number>;
}

interface RateEntry {
  value: number;
  type: 'flat' | 'percent';
}

interface RatesConfig {
  rates: Record<string, RateEntry>;
  bonusThreshold: number;
  bonusPct: number;
}

interface PayrollResponse extends RatesConfig {
  month: string;
  count: number;
  payroll: PayrollEntry[];
}

interface EmployeeMap {
  [id: string]: { name: string; email: string; role: string };
}

interface EmployeesResponse {
  success: boolean;
  data: { id: string; name: string; email: string; role: string }[];
}

function fmt(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function calcAmount(metricValue: number, rate: RateEntry | undefined): number {
  if (!rate) return 0;
  return rate.type === 'percent'
    ? Math.round(metricValue * rate.value / 100)
    : Math.round(metricValue * rate.value);
}

function fmtRate(rate: RateEntry): string {
  return rate.type === 'percent' ? `${rate.value}% of value` : `${fmt(rate.value)} / unit`;
}

function exportCSV(payroll: PayrollEntry[], empMap: EmployeeMap, month: string, rates: Record<string, RateEntry>) {
  const metricKeys = Object.keys(rates);
  const header = ['Name', 'Email', ...metricKeys.map((k) => getMetricConfig(k)?.label ?? k), 'Base (₹)', 'Bonus (₹)', 'Total (₹)'];
  const rows = payroll.map((entry) => {
    const emp = empMap[entry.userId] ?? {};
    return [
      emp.name ?? entry.userId,
      emp.email ?? '',
      ...metricKeys.map((k) => entry.metrics[k] ?? 0),
      entry.base,
      entry.bonus,
      entry.total,
    ].join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payroll_${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CompensationPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'total' | 'base' | 'bonus'>('total');
  const [editingRates, setEditingRates] = useState(false);
  const [draftRates, setDraftRates] = useState<Record<string, RateEntry>>({});
  const [draftThreshold, setDraftThreshold] = useState(50000);
  const [draftBonusPct, setDraftBonusPct] = useState(10);

  const { data: payrollData, isLoading: payrollLoading } = useQuery({
    queryKey: ['admin-payroll'],
    queryFn: () => apiFetch<PayrollResponse>('/api/compensation/payroll'),
    staleTime: 5 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<EmployeesResponse>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const saveRatesMutation = useMutation({
    mutationFn: (body: { rates: Record<string, RateEntry>; bonusThreshold: number; bonusPct: number }) =>
      apiFetch('/api/compensation/rates', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payroll'] });
      setEditingRates(false);
    },
  });

  const resetRatesMutation = useMutation({
    mutationFn: () => apiFetch('/api/compensation/rates', { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payroll'] });
      setEditingRates(false);
    },
  });

  const empMap: EmployeeMap = Object.fromEntries(
    (empData?.data ?? []).map((e) => [e.id, { name: e.name, email: e.email, role: e.role }])
  );

  const payroll = payrollData?.payroll ?? [];
  const rates = payrollData?.rates ?? {};
  const bonusThreshold = payrollData?.bonusThreshold ?? 50000;
  const bonusPct = payrollData?.bonusPct ?? 10;

  const filtered = payroll
    .filter((entry) => {
      if (!search) return true;
      const emp = empMap[entry.userId];
      const q = search.toLowerCase();
      return (
        emp?.name?.toLowerCase().includes(q) ||
        emp?.email?.toLowerCase().includes(q) ||
        entry.userId.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b[sortBy] - a[sortBy]);

  const totalBase = payroll.reduce((s, e) => s + e.base, 0);
  const totalBonus = payroll.reduce((s, e) => s + e.bonus, 0);
  const totalPayout = payroll.reduce((s, e) => s + e.total, 0);

  function openEditor() {
    setDraftRates(
      Object.fromEntries(
        Object.entries(rates).map(([k, v]) => [k, { ...v }])
      )
    );
    setDraftThreshold(bonusThreshold);
    setDraftBonusPct(bonusPct);
    setEditingRates(true);
  }

  function setDraftValue(key: string, value: number) {
    setDraftRates((r) => ({ ...r, [key]: { ...r[key], value } }));
  }

  function setDraftType(key: string, type: 'flat' | 'percent') {
    setDraftRates((r) => ({ ...r, [key]: { ...r[key], type } }));
  }

  const rateKeys = Object.keys(rates).length > 0 ? Object.keys(rates) : METRICS.map((m) => m.key);

  return (
    <>
      <Navbar title="Compensation & Payroll" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-6">

          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Compensation & Payroll</h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {payrollData?.month ? `Month: ${payrollData.month}` : 'Current month'} · {payrollData?.count ?? 0} employees
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={openEditor}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
              >
                ⚙️ Edit Rates
              </button>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-payroll'] })}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                🔄 Refresh
              </button>
              <button
                onClick={() => payrollData && exportCSV(filtered, empMap, payrollData.month, rates)}
                disabled={!payrollData || filtered.length === 0}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                ⬇️ Export CSV
              </button>
            </div>
          </div>

          {/* Edit Rates Panel */}
          {editingRates && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-300">Edit Incentive Rates</h2>
                <button
                  onClick={() => setEditingRates(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  ✕ Cancel
                </button>
              </div>

              {/* Per-metric rates */}
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {rateKeys.map((key) => {
                  const cfg = getMetricConfig(key);
                  const draft = draftRates[key] ?? { value: 0, type: 'flat' as const };
                  const isPercent = draft.type === 'percent';
                  return (
                    <div key={key} className="rounded-lg border border-amber-100 bg-white p-3 dark:border-amber-800 dark:bg-slate-900">
                      <div className="mb-2 flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                          <span>{cfg?.icon}</span>
                          <span>{cfg?.label ?? key}</span>
                        </label>
                        {/* flat / % toggle */}
                        <div className="flex rounded border border-slate-200 text-xs dark:border-slate-700">
                          <button
                            onClick={() => setDraftType(key, 'flat')}
                            className={`px-2 py-0.5 ${!isPercent ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            ₹
                          </button>
                          <button
                            onClick={() => setDraftType(key, 'percent')}
                            className={`px-2 py-0.5 ${isPercent ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >
                            %
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isPercent && <span className="text-sm text-slate-400">₹</span>}
                        <input
                          type="number"
                          min={0}
                          max={isPercent ? 100 : undefined}
                          step={isPercent ? 0.1 : 1}
                          value={draft.value}
                          onChange={(e) => setDraftValue(key, Number(e.target.value))}
                          className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        {isPercent && <span className="text-sm text-slate-400">%</span>}
                        {!isPercent && <span className="whitespace-nowrap text-xs text-slate-400">/ unit</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bonus config */}
              <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-amber-100 bg-white p-4 dark:border-amber-800 dark:bg-slate-900">
                <p className="w-full text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Performance Bonus</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Threshold (Base ≥)</label>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-400">₹</span>
                    <input
                      type="number"
                      min={0}
                      value={draftThreshold}
                      onChange={(e) => setDraftThreshold(Number(e.target.value))}
                      className="w-36 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Bonus %</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draftBonusPct}
                      onChange={(e) => setDraftBonusPct(Number(e.target.value))}
                      className="w-20 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <span className="text-sm text-slate-400">%</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => saveRatesMutation.mutate({ rates: draftRates, bonusThreshold: draftThreshold, bonusPct: draftBonusPct })}
                  disabled={saveRatesMutation.isPending}
                  className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {saveRatesMutation.isPending ? 'Saving…' : 'Save Rates'}
                </button>
                <button
                  onClick={() => { if (confirm('Reset all rates to defaults?')) resetRatesMutation.mutate(); }}
                  disabled={resetRatesMutation.isPending}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Reset to Defaults
                </button>
                {saveRatesMutation.isError && (
                  <p className="self-center text-xs text-red-500">Save failed. Try again.</p>
                )}
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-800 dark:bg-emerald-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Total Base Incentive</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(totalBase)}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">Total Performance Bonus</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-300">{fmt(totalBonus)}</p>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800 dark:bg-indigo-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Total Payout</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmt(totalPayout)}</p>
            </div>
          </div>

          {/* Incentive rate reference */}
          {!editingRates && Object.keys(rates).length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Current Incentive Rates
              </p>
              <div className="flex flex-wrap gap-3">
                {Object.entries(rates).map(([key, rate]) => {
                  const cfg = getMetricConfig(key);
                  return (
                    <div key={key} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                      <span className="text-base">{cfg?.icon}</span>
                      <div>
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{cfg?.label ?? key}</p>
                        <p className="text-xs font-bold text-emerald-600">{fmtRate(rate)}</p>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
                  <span className="text-base">🎁</span>
                  <div>
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Performance Bonus</p>
                    <p className="text-xs font-bold text-blue-600">+{bonusPct}% if base ≥ {fmt(bonusThreshold)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Search employee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-56 flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <option value="total">Sort: Total Payout</option>
              <option value="base">Sort: Base Incentive</option>
              <option value="bonus">Sort: Bonus</option>
            </select>
          </div>

          {/* Table */}
          {payrollLoading ? (
            <div className="flex justify-center py-20"><Loading /></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-20 text-center dark:border-slate-700">
              <p className="text-sm text-slate-400">No payroll data for this month yet</p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Employee</th>
                      {rateKeys.map((key) => {
                        const cfg = getMetricConfig(key);
                        const rate = rates[key];
                        return (
                          <th key={key} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                            <p>{cfg?.icon} {cfg?.label ?? key}</p>
                            {rate && <p className="text-slate-300 dark:text-slate-600">{fmtRate(rate)}</p>}
                          </th>
                        );
                      })}
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Base</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Bonus</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-indigo-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                    {filtered.map((entry, i) => {
                      const emp = empMap[entry.userId];
                      return (
                        <tr key={entry.userId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-white">{emp?.name ?? entry.userId}</p>
                            {emp?.email && <p className="text-xs text-slate-400">{emp.email}</p>}
                          </td>
                          {rateKeys.map((key) => {
                            const cfg = getMetricConfig(key);
                            const metricValue = entry.metrics[key] ?? 0;
                            const amount = calcAmount(metricValue, rates[key]);
                            return (
                              <td key={key} className="px-4 py-3 text-right tabular-nums">
                                <p className="font-medium text-slate-700 dark:text-slate-300">
                                  {cfg ? formatMetricValue(cfg, metricValue) : metricValue}
                                </p>
                                {metricValue > 0 && (
                                  <p className="text-xs text-emerald-600 dark:text-emerald-400">{fmt(amount)}</p>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800 dark:text-slate-200">
                            {fmt(entry.base)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-blue-600 dark:text-blue-400">
                            {entry.bonus > 0 ? `+${fmt(entry.bonus)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300">
                            {fmt(entry.total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                      <td colSpan={2} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Team Total ({filtered.length} employees)
                      </td>
                      {rateKeys.map((key) => {
                        const totalMetric = filtered.reduce((s, e) => s + (e.metrics[key] ?? 0), 0);
                        const totalAmount = calcAmount(totalMetric, rates[key]);
                        return (
                          <td key={key} className="px-4 py-3 text-right tabular-nums">
                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                              {getMetricConfig(key)?.unit === 'currency' ? fmt(totalMetric) : totalMetric}
                            </p>
                            {totalMetric > 0 && (
                              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{fmt(totalAmount)}</p>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-slate-200">{fmt(totalBase)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-600 dark:text-blue-400">{fmt(totalBonus)}</td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-700 dark:text-indigo-300">{fmt(totalPayout)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
