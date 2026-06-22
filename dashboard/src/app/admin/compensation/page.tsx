'use client';

import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, formatMetricValue, getMetricConfig } from '@/lib/metrics.config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateEntry { value: number; type: 'flat' | 'percent'; }
interface BonusSlab { minBase: number; pct: number; }

interface PayrollEntry {
  userId: string;
  base: number;
  bonus: number;
  total: number;
  finalTotal?: number;
  adjustments?: number;
  avgAchievement?: number;
  metrics: Record<string, number>;
}

interface AdjustmentEntry {
  SK: string;
  userId: string;
  amount: number;
  reason: string;
  type: 'bonus' | 'deduction' | 'correction';
  addedAt: string;
}

interface PayrollResponse {
  month: string;
  count: number;
  payroll: PayrollEntry[];
  adjustments: AdjustmentEntry[];
  rates: Record<string, RateEntry>;
  bonusSlabs: BonusSlab[];
  status: string;
  fromSnapshot: boolean;
  totalBase?: number;
  totalBonus?: number;
  totalAdjustments?: number;
  totalPayout?: number;
  lockedAt?: string;
  lockedBy?: string;
  approvedAt?: string;
}

interface EmployeeMap { [id: string]: { name: string; email: string; role: string }; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${Math.abs(n).toLocaleString('en-IN')}`;
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

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    reviewing: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    locked: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  };
  return `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] ?? map.draft}`;
}

function statusLabel(status: string) {
  return { draft: 'Draft', reviewing: 'Under Review', approved: 'Approved', locked: 'Locked' }[status] ?? status;
}

function exportCSV(payroll: PayrollEntry[], empMap: EmployeeMap, month: string, rates: Record<string, RateEntry>) {
  const metricKeys = Object.keys(rates);
  const header = ['Name', 'Email', ...metricKeys.map((k) => getMetricConfig(k)?.label ?? k), 'Base (₹)', 'Bonus (₹)', 'Adjustments (₹)', 'Total (₹)'];
  const rows = payroll.map((entry) => {
    const emp = empMap[entry.userId] ?? {};
    return [
      emp.name ?? entry.userId,
      emp.email ?? '',
      ...metricKeys.map((k) => entry.metrics[k] ?? 0),
      entry.base,
      entry.bonus,
      entry.adjustments ?? 0,
      entry.finalTotal ?? entry.total,
    ].join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `payroll_${month}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CompensationPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthStr());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'total' | 'base' | 'bonus'>('total');

  // Edit rates
  const [editingRates, setEditingRates] = useState(false);
  const [draftRates, setDraftRates] = useState<Record<string, RateEntry>>({});
  const [draftSlabs, setDraftSlabs] = useState<BonusSlab[]>([{ minBase: 50000, pct: 10 }]);

  // Adjustments
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjUserId, setAdjUserId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjType, setAdjType] = useState<'bonus' | 'deduction' | 'correction'>('bonus');

  const isCurrentMonth = month === currentMonthStr();

  const { data: payrollData, isLoading: payrollLoading } = useQuery({
    queryKey: ['admin-payroll', month],
    queryFn: () => apiFetch<PayrollResponse>(`/api/compensation/payroll?month=${month}`),
    staleTime: 2 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: { id: string; name: string; email: string; role: string }[] }>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const saveRatesMutation = useMutation({
    mutationFn: (body: { rates: Record<string, RateEntry>; bonusSlabs: BonusSlab[] }) =>
      apiFetch('/api/compensation/rates', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-payroll'] }); setEditingRates(false); },
  });

  const resetRatesMutation = useMutation({
    mutationFn: () => apiFetch('/api/compensation/rates', { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-payroll'] }); setEditingRates(false); },
  });

  const snapshotMutation = useMutation({
    mutationFn: () => apiFetch('/api/compensation/payroll/snapshot', { method: 'POST', body: JSON.stringify({ month }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-payroll', month] }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiFetch('/api/compensation/payroll/status', { method: 'PUT', body: JSON.stringify({ month, status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-payroll', month] }),
  });

  const unlockMutation = useMutation({
    mutationFn: () => apiFetch('/api/compensation/payroll/unlock', { method: 'POST', body: JSON.stringify({ month }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-payroll', month] }),
  });

  const addAdjMutation = useMutation({
    mutationFn: (body: { userId: string; month: string; amount: number; reason: string; type: string }) =>
      apiFetch('/api/compensation/adjustments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payroll', month] });
      setShowAdjForm(false); setAdjUserId(''); setAdjAmount(''); setAdjReason(''); setAdjType('bonus');
    },
  });

  const deleteAdjMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/compensation/adjustments/${encodeURIComponent(id)}?month=${month}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-payroll', month] }),
  });

  const empMap: EmployeeMap = Object.fromEntries(
    (empData?.data ?? []).map((e) => [e.id, { name: e.name, email: e.email, role: e.role }])
  );

  const payroll = payrollData?.payroll ?? [];
  const rates = payrollData?.rates ?? {};
  const bonusSlabs = payrollData?.bonusSlabs ?? [{ minBase: 50000, pct: 10 }];
  const status = payrollData?.status ?? 'draft';
  const isLocked = status === 'locked';
  const adjustments = payrollData?.adjustments ?? [];

  const filtered = payroll
    .filter((entry) => {
      if (!search) return true;
      const emp = empMap[entry.userId];
      const q = search.toLowerCase();
      return emp?.name?.toLowerCase().includes(q) || emp?.email?.toLowerCase().includes(q) || entry.userId.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.finalTotal ?? b.total) - (a.finalTotal ?? a.total));

  const totalBase = payrollData?.totalBase ?? payroll.reduce((s, e) => s + e.base, 0);
  const totalBonus = payrollData?.totalBonus ?? payroll.reduce((s, e) => s + e.bonus, 0);
  const totalAdj = payrollData?.totalAdjustments ?? payroll.reduce((s, e) => s + (e.adjustments ?? 0), 0);
  const totalPayout = payrollData?.totalPayout ?? payroll.reduce((s, e) => s + (e.finalTotal ?? e.total), 0);

  const rateKeys = Object.keys(rates).length > 0 ? Object.keys(rates) : METRICS.map((m) => m.key);

  function openEditor() {
    setDraftRates(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, { ...v }])));
    setDraftSlabs(bonusSlabs.map(s => ({ ...s })));
    setEditingRates(true);
  }

  function setDraftValue(key: string, value: number) {
    setDraftRates((r) => ({ ...r, [key]: { ...r[key], value } }));
  }
  function setDraftType(key: string, type: 'flat' | 'percent') {
    setDraftRates((r) => ({ ...r, [key]: { ...r[key], type } }));
  }
  function updateSlab(i: number, field: keyof BonusSlab, value: number) {
    setDraftSlabs(s => s.map((sl, idx) => idx === i ? { ...sl, [field]: value } : sl));
  }
  function addSlab() {
    setDraftSlabs(s => [...s, { minBase: 0, pct: 0 }]);
  }
  function removeSlab(i: number) {
    setDraftSlabs(s => s.filter((_, idx) => idx !== i));
  }

  function submitAdj() {
    const amount = parseFloat(adjAmount);
    if (!adjUserId || isNaN(amount) || !adjReason.trim()) return;
    const finalAmount = adjType === 'deduction' ? -Math.abs(amount) : Math.abs(amount);
    addAdjMutation.mutate({ userId: adjUserId, month, amount: finalAmount, reason: adjReason.trim(), type: adjType });
  }

  return (
    <>
      <Navbar title="Compensation & Payroll" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-6">

          {/* Header row */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Compensation & Payroll</h1>
              <div className="mt-1 flex items-center gap-2">
                <span className={statusBadge(status)}>{statusLabel(status)}</span>
                {payrollData?.fromSnapshot && <span className="text-xs text-slate-400">Snapshot</span>}
                {isLocked && payrollData?.lockedAt && (
                  <span className="text-xs text-slate-400">Locked {new Date(payrollData.lockedAt).toLocaleDateString('en-IN')}</span>
                )}
              </div>
            </div>

            {/* Month picker */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => setMonth(prevMonth(month))}
                className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ‹
              </button>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="border-0 bg-transparent text-sm font-medium text-slate-700 outline-none dark:text-slate-300"
              />
              <button
                onClick={() => setMonth(nextMonth(month))}
                disabled={isCurrentMonth}
                className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
              >
                ›
              </button>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {!isLocked && (
                <button
                  onClick={openEditor}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                >
                  ⚙️ Edit Rates
                </button>
              )}
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-payroll', month] })}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                🔄 Refresh
              </button>
              <button
                onClick={() => payrollData && exportCSV(filtered, empMap, month, rates)}
                disabled={!payrollData || filtered.length === 0}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                ⬇️ Export CSV
              </button>
            </div>
          </div>

          {/* Approval workflow */}
          {payroll.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium">Workflow:</span>
                {['draft', 'reviewing', 'approved', 'locked'].map((s, i, arr) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className={s === status ? 'font-semibold text-indigo-600 dark:text-indigo-400' : ''}>
                      {statusLabel(s)}
                    </span>
                    {i < arr.length - 1 && <span className="text-slate-300 dark:text-slate-700">→</span>}
                  </span>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                {status === 'draft' && (
                  <button
                    onClick={() => snapshotMutation.mutate()}
                    disabled={snapshotMutation.isPending}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {snapshotMutation.isPending ? 'Creating…' : '📸 Create Snapshot'}
                  </button>
                )}
                {status === 'reviewing' && (
                  <>
                    <button
                      onClick={() => statusMutation.mutate('draft')}
                      disabled={statusMutation.isPending}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
                    >
                      ↩ Revert
                    </button>
                    <button
                      onClick={() => statusMutation.mutate('approved')}
                      disabled={statusMutation.isPending}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {statusMutation.isPending ? 'Updating…' : '✓ Approve'}
                    </button>
                  </>
                )}
                {status === 'approved' && (
                  <>
                    <button
                      onClick={() => statusMutation.mutate('reviewing')}
                      disabled={statusMutation.isPending}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
                    >
                      ↩ Revert
                    </button>
                    <button
                      onClick={() => { if (confirm(`Lock payroll for ${month}? This will notify all employees via Telegram and cannot be undone.`)) statusMutation.mutate('locked'); }}
                      disabled={statusMutation.isPending}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {statusMutation.isPending ? 'Locking…' : '🔒 Lock & Notify'}
                    </button>
                  </>
                )}
                {status === 'locked' && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      🔒 Payroll finalised
                    </span>
                    <button
                      onClick={() => { if (confirm(`Unlock payroll for ${month}? This will revert it to Approved status.`)) unlockMutation.mutate(); }}
                      disabled={unlockMutation.isPending}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      {unlockMutation.isPending ? 'Unlocking…' : '🔓 Unlock'}
                    </button>
                    {unlockMutation.isError && <p className="text-xs text-red-500">Unlock failed</p>}
                  </div>
                )}
                {(snapshotMutation.isError || statusMutation.isError) && (
                  <p className="self-center text-xs text-red-500">Action failed. Try again.</p>
                )}
              </div>
            </div>
          )}

          {/* Edit Rates Panel */}
          {editingRates && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-300">Edit Incentive Rates</h2>
                <button onClick={() => setEditingRates(false)} className="text-xs text-slate-400 hover:text-slate-600">✕ Cancel</button>
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
                        <div className="flex rounded border border-slate-200 text-xs dark:border-slate-700">
                          <button
                            onClick={() => setDraftType(key, 'flat')}
                            className={`px-2 py-0.5 ${!isPercent ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >₹</button>
                          <button
                            onClick={() => setDraftType(key, 'percent')}
                            className={`px-2 py-0.5 ${isPercent ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                          >%</button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isPercent && <span className="text-sm text-slate-400">₹</span>}
                        <input
                          type="number" min={0} max={isPercent ? 100 : undefined} step={isPercent ? 0.1 : 1}
                          value={draft.value}
                          onChange={(e) => setDraftValue(key, Number(e.target.value))}
                          className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        {isPercent && <span className="text-sm text-slate-400">%</span>}
                        {!isPercent && <span className="whitespace-nowrap text-xs text-slate-400">/ unit</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tiered bonus slabs (Point 7) */}
              <div className="mb-4 rounded-lg border border-amber-100 bg-white p-4 dark:border-amber-800 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Performance Bonus Slabs</p>
                  <button
                    onClick={addSlab}
                    className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
                  >
                    + Add Slab
                  </button>
                </div>
                <div className="space-y-2">
                  {draftSlabs
                    .sort((a, b) => a.minBase - b.minBase)
                    .map((slab, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-28 text-xs text-slate-500">Base ≥ ₹</span>
                        <input
                          type="number" min={0} value={slab.minBase}
                          onChange={(e) => updateSlab(i, 'minBase', Number(e.target.value))}
                          className="w-28 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <span className="text-xs text-slate-500">→ Bonus</span>
                        <input
                          type="number" min={0} max={100} step={0.5} value={slab.pct}
                          onChange={(e) => updateSlab(i, 'pct', Number(e.target.value))}
                          className="w-16 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <span className="text-xs text-slate-500">%</span>
                        {draftSlabs.length > 1 && (
                          <button onClick={() => removeSlab(i)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                        )}
                      </div>
                    ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">Highest qualifying slab applies. Multiple slabs let you reward top performers progressively.</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => saveRatesMutation.mutate({ rates: draftRates, bonusSlabs: draftSlabs })}
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
                {saveRatesMutation.isError && <p className="self-center text-xs text-red-500">Save failed. Try again.</p>}
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Base Incentive</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(totalBase)}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">Performance Bonus</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-blue-700 dark:text-blue-300">{fmt(totalBonus)}</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-orange-600 dark:text-orange-400">Adjustments</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${totalAdj >= 0 ? 'text-orange-700 dark:text-orange-300' : 'text-red-700 dark:text-red-300'}`}>
                {totalAdj >= 0 ? '+' : '−'}{fmt(totalAdj)}
              </p>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-900/20">
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Total Payout</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmt(totalPayout)}</p>
            </div>
          </div>

          {/* Current rates reference */}
          {!editingRates && Object.keys(rates).length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Current Rates</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(rates).map(([key, rate]) => {
                  const cfg = getMetricConfig(key);
                  return (
                    <div key={key} className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                      <span>{cfg?.icon}</span>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{cfg?.label ?? key}</span>
                      <span className="text-xs font-bold text-emerald-600">{fmtRate(rate)}</span>
                    </div>
                  );
                })}
                {bonusSlabs.sort((a, b) => a.minBase - b.minBase).map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 dark:border-blue-800 dark:bg-blue-900/20">
                    <span>🎁</span>
                    <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Base ≥ {fmt(s.minBase)}</span>
                    <span className="text-xs font-bold text-blue-600">+{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Adjustments section (Point 8) */}
          {!isLocked && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Manual Adjustments</p>
                <button
                  onClick={() => setShowAdjForm((v) => !v)}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400"
                >
                  {showAdjForm ? '✕ Cancel' : '+ Add Adjustment'}
                </button>
              </div>

              {showAdjForm && (
                <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/50">
                  <select
                    value={adjUserId}
                    onChange={(e) => setAdjUserId(e.target.value)}
                    className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <option value="">Select employee…</option>
                    {(empData?.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-1">
                    <select
                      value={adjType}
                      onChange={(e) => setAdjType(e.target.value as typeof adjType)}
                      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                    >
                      <option value="bonus">Bonus</option>
                      <option value="deduction">Deduction</option>
                      <option value="correction">Correction</option>
                    </select>
                    <div className="flex flex-1 items-center gap-1">
                      <span className="text-sm text-slate-400">₹</span>
                      <input
                        type="number" min={0} placeholder="Amount"
                        value={adjAmount}
                        onChange={(e) => setAdjAmount(e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <input
                    type="text" placeholder="Reason…"
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    onClick={submitAdj}
                    disabled={!adjUserId || !adjAmount || !adjReason || addAdjMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {addAdjMutation.isPending ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )}

              {adjustments.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {adjustments.map((adj) => {
                    const emp = empMap[adj.userId];
                    const isPos = adj.amount >= 0;
                    return (
                      <div key={adj.SK} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${adj.type === 'bonus' ? 'bg-emerald-100 text-emerald-700' : adj.type === 'deduction' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                            {adj.type}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{emp?.name ?? adj.userId}</p>
                            <p className="text-xs text-slate-400">{adj.reason}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`tabular-nums text-sm font-semibold ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isPos ? '+' : '−'}{fmt(adj.amount)}
                          </span>
                          <button
                            onClick={() => deleteAdjMutation.mutate(adj.SK)}
                            className="text-xs text-red-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No adjustments this month</p>
              )}
            </div>
          )}

          {/* Search + sort */}
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Search employee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-56 flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
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
              <p className="text-sm text-slate-400">No payroll data for {month}</p>
              {!isCurrentMonth && <p className="mt-1 text-xs text-slate-300 dark:text-slate-600">Try a different month or check if metrics have been entered</p>}
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
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Adj</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-indigo-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                    {filtered.map((entry, i) => {
                      const emp = empMap[entry.userId];
                      const finalTotal = entry.finalTotal ?? entry.total;
                      return (
                        <tr key={entry.userId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900 dark:text-white">{emp?.name ?? entry.userId}</p>
                            {emp?.email && <p className="text-xs text-slate-400">{emp.email}</p>}
                            {entry.avgAchievement != null && (
                              <p className={`text-xs font-medium ${entry.avgAchievement >= 100 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                🎯 {entry.avgAchievement}% target
                              </p>
                            )}
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
                          <td className="px-4 py-3 text-right tabular-nums">
                            {entry.adjustments && entry.adjustments !== 0 ? (
                              <span className={entry.adjustments > 0 ? 'text-emerald-600' : 'text-red-500'}>
                                {entry.adjustments > 0 ? '+' : '−'}{fmt(entry.adjustments)}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold text-indigo-700 dark:text-indigo-300">
                            {fmt(finalTotal)}
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
                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{totalMetric}</p>
                            {totalMetric > 0 && <p className="text-xs font-bold text-emerald-600">{fmt(totalAmount)}</p>}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-slate-200">{fmt(totalBase)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-600 dark:text-blue-400">{fmt(totalBonus)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-orange-600 dark:text-orange-400">
                        {totalAdj !== 0 ? `${totalAdj >= 0 ? '+' : '−'}${fmt(totalAdj)}` : '—'}
                      </td>
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
