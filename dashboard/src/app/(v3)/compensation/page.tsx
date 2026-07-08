'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, ChevronLeft, ChevronRight, Download, Search, Lock, Unlock, TrendingUp } from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { getMetricConfig, formatMetricValue } from '@/lib/metrics.config';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateEntry { value: number; type: 'flat' | 'percent'; }
interface BonusSlab { minBase: number; pct: number; }

interface PayrollEntry {
  userId: string;
  fixedBase: number;
  incentive: number;
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
}

interface BreakdownEntry { value: number; rate: RateEntry; amount: number; }

interface CompensationResponse {
  month: string;
  breakdown: Record<string, BreakdownEntry>;
  fixedBase: number;
  incentiveTotal: number;
  baseCompensation: number;
  performanceBonus: number;
  totalCompensation: number;
  projectedTotal: number;
  bonusSlabs: BonusSlab[];
  qualifyingSlab: BonusSlab | null;
  nextSlab: BonusSlab | null;
  daysElapsed: number;
  daysInMonth: number;
}

interface HistoryEntry { month: string; base: number; bonus: number; adjustments: number; total: number; status: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return `₹${Math.abs(n).toLocaleString('en-IN')}`; }
function fmtRate(r: RateEntry) { return r.type === 'percent' ? `${r.value}%` : `${fmt(r.value)}/unit`; }

function currentMonthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function adjMonth(m: string, delta: number) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(adjMonth(month, -1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[140px] text-center text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {monthLabel(month)}
      </span>
      <button onClick={() => onChange(adjMonth(month, 1))} disabled={month === currentMonthStr()} className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-30 dark:border-neutral-700 dark:hover:bg-neutral-800">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

const STATUS_STEPS = ['draft', 'reviewing', 'approved', 'locked'] as const;
type PayrollStatus = typeof STATUS_STEPS[number];

function statusBadge(s: string) {
  const map: Record<string, 'default' | 'warning' | 'primary' | 'success'> = {
    draft: 'default', reviewing: 'warning', approved: 'primary', locked: 'success',
  };
  return map[s] ?? 'default';
}
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', reviewing: 'Under Review', approved: 'Approved', locked: 'Locked' };

// ── Employee compensation view ─────────────────────────────────────────────────

function EmployeeCompensationView() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthStr());

  const { data, isLoading, isError } = useQuery({
    queryKey: ['emp-compensation', user?.id, month],
    queryFn: () => apiFetch<CompensationResponse>(`/api/compensation/calculate/${user?.id}?month=${month}`),
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['emp-comp-history', user?.id],
    queryFn: () => apiFetch<{ success: boolean; history: HistoryEntry[] }>(`/api/compensation/history/${user?.id}`),
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const history = historyData?.history ?? [];
  const breakdown = data?.breakdown ?? {};
  const breakdownKeys = Object.keys(breakdown);
  const progressToNext = data?.nextSlab ? Math.min(Math.round((data.baseCompensation / data.nextSlab.minBase) * 100), 100) : 100;
  const isCurrentMonth = month === currentMonthStr();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">My Compensation</p>
        <MonthNav month={month} onChange={setMonth} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <Card><p className="text-sm text-error-500 text-center py-4">Could not load compensation data</p></Card>
      ) : data ? (
        <>
          {/* Hero total */}
          <div className="rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 p-5 text-white shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-200">{monthLabel(month)}</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{fmt(data.totalCompensation)}</p>
            <p className="mt-0.5 text-sm text-primary-200">Total earned this month</p>
            <div className={cn('mt-4 grid gap-3', data.fixedBase > 0 ? 'grid-cols-3' : 'grid-cols-2')}>
              {data.fixedBase > 0 && (
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-xs text-primary-200">Fixed Stipend</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">{fmt(data.fixedBase)}</p>
                </div>
              )}
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-xs text-primary-200">{data.fixedBase > 0 ? 'Metric Incentive' : 'Base Incentive'}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{fmt(data.incentiveTotal ?? data.baseCompensation)}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-xs text-primary-200">Performance Bonus</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {data.performanceBonus > 0 ? `+${fmt(data.performanceBonus)}` : '—'}
                </p>
                {data.qualifyingSlab && <p className="text-xs text-primary-300">+{data.qualifyingSlab.pct}% slab</p>}
              </div>
            </div>
            {isCurrentMonth && data.daysElapsed < data.daysInMonth && (
              <div className="mt-3 rounded-xl bg-white/10 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-primary-200">Projected Month-End</p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums">{fmt(data.projectedTotal)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-primary-300">Day {data.daysElapsed} of {data.daysInMonth}</p>
                    <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-white/20">
                      <div className="h-full rounded-full bg-white" style={{ width: `${Math.round(data.daysElapsed / data.daysInMonth * 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bonus slab progress */}
          {data.nextSlab ? (
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-primary-700 dark:text-primary-400">Next Bonus Slab</p>
                <p className="text-xs text-primary-600 dark:text-primary-400">+{data.nextSlab.pct}% when base ≥ {fmt(data.nextSlab.minBase)}</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-primary-50 dark:bg-primary-900/30">
                <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: `${progressToNext}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-primary-500">
                <span>{fmt(data.baseCompensation)}</span>
                <span>{fmt(data.nextSlab.minBase - data.baseCompensation)} to go</span>
              </div>
            </Card>
          ) : data.qualifyingSlab ? (
            <Card><p className="text-sm font-semibold text-success-700 dark:text-success-400">Top bonus slab reached (+{data.qualifyingSlab.pct}%)</p></Card>
          ) : null}

          {/* Metric breakdown */}
          {breakdownKeys.length > 0 && (
            <Card noPadding>
              <p className="border-b border-neutral-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                Breakdown by Metric
              </p>
              <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
                {breakdownKeys.map((key) => {
                  const entry = breakdown[key];
                  const cfg = getMetricConfig(key);
                  return (
                    <li key={key} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{cfg?.icon ?? '📊'}</span>
                        <div>
                          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{cfg?.label ?? key}</p>
                          <p className="text-xs text-neutral-400">{cfg?.unit === 'currency' ? fmt(entry.value) : entry.value} units · {fmtRate(entry.rate)}</p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-success-600 dark:text-success-400">{fmt(entry.amount)}</p>
                    </li>
                  );
                })}
                {data.fixedBase > 0 && (
                  <li className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">💼</span>
                      <div>
                        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Fixed Stipend</p>
                        <p className="text-xs text-neutral-400">Monthly base salary</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-neutral-600 dark:text-neutral-400">{fmt(data.fixedBase)}</p>
                  </li>
                )}
              </ul>
              <div className="flex items-center justify-between rounded-b-xl border-t border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-800/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Base Total</p>
                <p className="text-sm font-bold tabular-nums text-neutral-800 dark:text-neutral-200">{fmt(data.baseCompensation)}</p>
              </div>
            </Card>
          )}

          {breakdownKeys.length === 0 && (
            <Card>
              <div className="py-8 text-center">
                <TrendingUp className="mx-auto h-8 w-8 text-neutral-300 mb-2" />
                <p className="text-sm text-neutral-400">No metrics recorded for {monthLabel(month)}</p>
                <p className="mt-1 text-xs text-neutral-300 dark:text-neutral-600">Submit daily entries to see compensation here</p>
              </div>
            </Card>
          )}
        </>
      ) : null}

      {/* History */}
      {history.length > 0 && (
        <Card noPadding>
          <p className="border-b border-neutral-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            Payout History
          </p>
          <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
            {history.map((h) => (
              <li key={h.month}
                className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30"
                onClick={() => setMonth(h.month)}>
                <div>
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{monthLabel(h.month)}</p>
                  <p className="text-xs text-neutral-400">
                    Base {fmt(h.base)}
                    {h.bonus > 0 && ` + Bonus ${fmt(h.bonus)}`}
                    {h.adjustments !== 0 && ` ${h.adjustments > 0 ? '+' : '−'}Adj ${fmt(Math.abs(h.adjustments))}`}
                  </p>
                </div>
                <div className="text-right">
                  {h.status === 'no_data' ? (
                    <p className="text-xs text-neutral-300 dark:text-neutral-600">No data</p>
                  ) : (
                    <>
                      <p className="text-sm font-bold tabular-nums text-primary-700 dark:text-primary-300">{fmt(h.total)}</p>
                      <Badge variant={statusBadge(h.status)}>{STATUS_LABEL[h.status] ?? h.status}</Badge>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Admin payroll view ────────────────────────────────────────────────────────

function AdminCompensationView({ canMutate }: { canMutate: boolean }) {
  const qc = useQueryClient();
  const { metrics, getMetricConfig } = useMetricsConfig();
  const [month, setMonth]       = useState(currentMonthStr());
  const [search, setSearch]     = useState('');
  const [editRates, setEditRates] = useState(false);
  const [draftRates, setDraftRates] = useState<Record<string, RateEntry>>({});
  const [draftSlabs, setDraftSlabs] = useState<BonusSlab[]>([{ minBase: 50000, pct: 10 }]);
  const [showAdj, setShowAdj]   = useState(false);
  const [adjUserId, setAdjUserId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjType, setAdjType]   = useState<'bonus' | 'deduction' | 'correction'>('bonus');

  const { data: payrollData, isLoading } = useQuery({
    queryKey: ['admin-payroll', month],
    queryFn: () => apiFetch<PayrollResponse>(`/api/compensation/payroll?month=${month}`),
    staleTime: 2 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['v3-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: { id: string; name: string; email: string; role: string }[] }>('/api/admin/employees')
      .catch(() => ({ success: true, data: [] as { id: string; name: string; email: string; role: string }[] })),
    staleTime: 10 * 60_000,
  });

  const saveRatesMut = useMutation({
    mutationFn: (body: { rates: Record<string, RateEntry>; bonusSlabs: BonusSlab[] }) =>
      apiFetch('/api/compensation/rates', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payroll'] }); setEditRates(false); toast.success('Rates saved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const snapshotMut = useMutation({
    mutationFn: () => apiFetch('/api/compensation/payroll/snapshot', { method: 'POST', body: JSON.stringify({ month }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payroll', month] }); toast.success('Snapshot created'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (status: string) =>
      apiFetch('/api/compensation/payroll/status', { method: 'PUT', body: JSON.stringify({ month, status }) }),
    onSuccess: (_, status) => { qc.invalidateQueries({ queryKey: ['admin-payroll', month] }); toast.success(`Status: ${STATUS_LABEL[status] ?? status}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlockMut = useMutation({
    mutationFn: () => apiFetch('/api/compensation/payroll/unlock', { method: 'POST', body: JSON.stringify({ month }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payroll', month] }); toast.success('Payroll unlocked'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addAdjMut = useMutation({
    mutationFn: (body: { userId: string; month: string; amount: number; reason: string; type: string }) =>
      apiFetch('/api/compensation/adjustments', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-payroll', month] });
      setShowAdj(false); setAdjUserId(''); setAdjAmount(''); setAdjReason(''); setAdjType('bonus');
      toast.success('Adjustment added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delAdjMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/compensation/adjustments/${encodeURIComponent(id)}?month=${month}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payroll', month] }); toast.success('Adjustment removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const empMap = Object.fromEntries((empData?.data ?? []).map((e) => [e.id, e]));
  const payroll   = payrollData?.payroll ?? [];
  const rates     = payrollData?.rates ?? {};
  const bonusSlabs = payrollData?.bonusSlabs ?? [{ minBase: 50000, pct: 10 }];
  const status    = (payrollData?.status ?? 'draft') as PayrollStatus;
  const isLocked  = status === 'locked';
  const adjs      = payrollData?.adjustments ?? [];
  const rateKeys  = Object.keys(rates).length > 0 ? Object.keys(rates) : metrics.map((m) => m.key);

  const filtered  = payroll
    .filter((e) => {
      if (!search) return true;
      const emp = empMap[e.userId];
      const q = search.toLowerCase();
      return emp?.name?.toLowerCase().includes(q) || emp?.email?.toLowerCase().includes(q) || e.userId.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.finalTotal ?? b.total) - (a.finalTotal ?? a.total));

  const totalBase    = payrollData?.totalBase    ?? payroll.reduce((s, e) => s + e.base, 0);
  const totalBonus   = payrollData?.totalBonus   ?? payroll.reduce((s, e) => s + e.bonus, 0);
  const totalAdj     = payrollData?.totalAdjustments ?? payroll.reduce((s, e) => s + (e.adjustments ?? 0), 0);
  const totalPayout  = payrollData?.totalPayout  ?? payroll.reduce((s, e) => s + (e.finalTotal ?? e.total), 0);

  function openEditor() {
    setDraftRates(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, { ...v }])));
    setDraftSlabs(bonusSlabs.map((s) => ({ ...s })));
    setEditRates(true);
  }

  function exportCSV() {
    const rows = [['Name', 'Email', 'Base (₹)', 'Bonus (₹)', 'Adjustments (₹)', 'Total (₹)']];
    filtered.forEach((e) => {
      const emp = empMap[e.userId];
      rows.push([emp?.name ?? e.userId, emp?.email ?? '', String(e.base), String(e.bonus), String(e.adjustments ?? 0), String(e.finalTotal ?? e.total)]);
    });
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `payroll_${month}.csv`;
    a.click();
  }

  function submitAdj() {
    const amount = parseFloat(adjAmount);
    if (!adjUserId || isNaN(amount) || !adjReason.trim()) return;
    const finalAmount = adjType === 'deduction' ? -Math.abs(amount) : Math.abs(amount);
    addAdjMut.mutate({ userId: adjUserId, month, amount: finalAmount, reason: adjReason.trim(), type: adjType });
  }

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Base Incentive',     value: fmt(totalBase),   color: 'text-success-700 dark:text-success-300' },
          { label: 'Performance Bonus',  value: fmt(totalBonus),  color: 'text-primary-700 dark:text-primary-300' },
          { label: 'Adjustments',        value: `${totalAdj >= 0 ? '+' : '−'}${fmt(totalAdj)}`, color: totalAdj >= 0 ? 'text-warning-700' : 'text-error-600' },
          { label: 'Total Payout',       value: fmt(totalPayout), color: 'text-neutral-900 dark:text-neutral-100 text-xl font-bold' },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <p className={cn('text-xl font-bold tabular-nums', color)}>{value}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {/* Header bar */}
      <Card noPadding>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <MonthNav month={month} onChange={setMonth} />
            {payrollData && (
              <Badge variant={statusBadge(status)}>{STATUS_LABEL[status] ?? status}</Badge>
            )}
            {payrollData?.fromSnapshot && <span className="text-xs text-neutral-400">Snapshot</span>}
          </div>
          <div className="flex items-center gap-2">
            {!isLocked && canMutate && <Button size="sm" variant="secondary" onClick={openEditor}>Edit Rates</Button>}
            <Button size="sm" variant="ghost" iconLeft={<Download className="h-3.5 w-3.5" />} onClick={exportCSV} disabled={filtered.length === 0}>CSV</Button>
          </div>
        </div>

        {/* Workflow strip — status steps are read-only (visible to manager too);
            the action buttons are all checkRole(['admin']) on the backend, so
            they're gated to canMutate only. */}
        {payroll.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <div className="flex items-center gap-2 text-xs">
              {STATUS_STEPS.map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  <span className={cn('font-medium', s === status ? 'text-primary-600 dark:text-primary-400 font-bold' : 'text-neutral-400')}>
                    {STATUS_LABEL[s]}
                  </span>
                  {i < STATUS_STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-neutral-300" />}
                </span>
              ))}
            </div>
            {canMutate && (
              <div className="ml-auto flex gap-2">
                {status === 'draft' && (
                  <Button size="sm" loading={snapshotMut.isPending} onClick={() => snapshotMut.mutate()}>Create Snapshot</Button>
                )}
                {status === 'reviewing' && (
                  <>
                    <Button size="sm" variant="secondary" loading={statusMut.isPending} onClick={() => statusMut.mutate('draft')}>Revert</Button>
                    <Button size="sm" loading={statusMut.isPending} onClick={() => statusMut.mutate('approved')}>Approve</Button>
                  </>
                )}
                {status === 'approved' && (
                  <>
                    <Button size="sm" variant="secondary" loading={statusMut.isPending} onClick={() => statusMut.mutate('reviewing')}>Revert</Button>
                    <Button size="sm" variant="danger" iconLeft={<Lock className="h-3.5 w-3.5" />} loading={statusMut.isPending}
                      onClick={() => { if (confirm(`Lock payroll for ${month}? This notifies all employees via Telegram.`)) statusMut.mutate('locked'); }}>
                      Lock & Notify
                    </Button>
                  </>
                )}
                {status === 'locked' && (
                  <Button size="sm" variant="secondary" iconLeft={<Unlock className="h-3.5 w-3.5" />} loading={unlockMut.isPending}
                    onClick={() => { if (confirm(`Unlock payroll for ${month}?`)) unlockMut.mutate(); }}>
                    Unlock
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Rate editor — only reachable via the Edit Rates button above, which is
          already canMutate-gated, but gated here too as defense in depth. */}
      {canMutate && editRates && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Edit Incentive Rates</p>
            <button onClick={() => setEditRates(false)} className="text-xs text-neutral-400 hover:text-neutral-600">✕ Cancel</button>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rateKeys.map((key) => {
              const cfg = getMetricConfig(key);
              const draft = draftRates[key] ?? { value: 0, type: 'flat' as const };
              return (
                <div key={key} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{cfg?.icon} {cfg?.label ?? key}</p>
                    <div className="flex rounded border border-neutral-200 dark:border-neutral-700 text-[10px] overflow-hidden">
                      {(['flat', 'percent'] as const).map((t) => (
                        <button key={t} onClick={() => setDraftRates((r) => ({ ...r, [key]: { ...r[key], type: t } }))}
                          className={cn('px-2 py-0.5', draft.type === t ? 'bg-primary-600 text-white' : 'text-neutral-500')}>
                          {t === 'flat' ? '₹' : '%'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input type="number" min={0} step={draft.type === 'percent' ? 0.1 : 1} value={draft.value}
                    onChange={(e) => setDraftRates((r) => ({ ...r, [key]: { ...r[key], value: Number(e.target.value) } }))}
                    className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                </div>
              );
            })}
          </div>
          {/* Bonus slabs */}
          <div className="mb-4 rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase text-neutral-500">Performance Bonus Slabs</p>
              <button onClick={() => setDraftSlabs((s) => [...s, { minBase: 0, pct: 0 }])}
                className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700">
                + Add
              </button>
            </div>
            <div className="space-y-2">
              {draftSlabs.sort((a, b) => a.minBase - b.minBase).map((slab, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-neutral-500 whitespace-nowrap">Base ≥ ₹</span>
                  <input type="number" value={slab.minBase} onChange={(e) => setDraftSlabs((s) => s.map((sl, j) => j === i ? { ...sl, minBase: Number(e.target.value) } : sl))}
                    className="w-24 rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                  <span className="text-neutral-500">→ Bonus</span>
                  <input type="number" min={0} max={100} value={slab.pct} onChange={(e) => setDraftSlabs((s) => s.map((sl, j) => j === i ? { ...sl, pct: Number(e.target.value) } : sl))}
                    className="w-14 rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
                  <span className="text-neutral-500">%</span>
                  {draftSlabs.length > 1 && (
                    <button onClick={() => setDraftSlabs((s) => s.filter((_, j) => j !== i))} className="text-error-400 hover:text-error-600">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Button size="sm" loading={saveRatesMut.isPending} onClick={() => saveRatesMut.mutate({ rates: draftRates, bonusSlabs: draftSlabs })}>
            Save Rates
          </Button>
        </Card>
      )}

      {/* Current rates reference */}
      {!editRates && Object.keys(rates).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(rates).map(([key, rate]) => {
            const cfg = getMetricConfig(key);
            return (
              <div key={key} className="flex items-center gap-1.5 rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
                <span>{cfg?.icon}</span>
                <span className="text-xs text-neutral-600 dark:text-neutral-400">{cfg?.label ?? key}</span>
                <span className="text-xs font-bold text-success-600">{fmtRate(rate)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Adjustments */}
      {!isLocked && (
        <Card noPadding>
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Manual Adjustments</p>
            {canMutate && (
              <Button size="sm" variant="secondary" onClick={() => setShowAdj((v) => !v)}>
                {showAdj ? 'Cancel' : '+ Add Adjustment'}
              </Button>
            )}
          </div>
          {canMutate && showAdj && (
            <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <select value={adjUserId} onChange={(e) => setAdjUserId(e.target.value)}
                  className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                  <option value="">Select employee…</option>
                  {(empData?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <div className="flex gap-1">
                  <select value={adjType} onChange={(e) => setAdjType(e.target.value as typeof adjType)}
                    className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                    <option value="bonus">Bonus</option>
                    <option value="deduction">Deduction</option>
                    <option value="correction">Correction</option>
                  </select>
                  <input type="number" placeholder="₹ Amount" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" />
                </div>
                <input placeholder="Reason…" value={adjReason} onChange={(e) => setAdjReason(e.target.value)}
                  className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" />
                <Button size="sm" loading={addAdjMut.isPending} disabled={!adjUserId || !adjAmount || !adjReason} onClick={submitAdj}>Add</Button>
              </div>
            </div>
          )}
          {adjs.length === 0 ? (
            <div className="py-6 text-center text-xs text-neutral-400">No adjustments this month</div>
          ) : (
            <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
              {adjs.map((adj) => {
                const emp = empMap[adj.userId];
                const isPos = adj.amount >= 0;
                return (
                  <li key={adj.SK} className="flex items-center gap-3 px-4 py-3">
                    <Badge variant={adj.type === 'bonus' ? 'success' : adj.type === 'deduction' ? 'error' : 'default'}>{adj.type}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{emp?.name ?? adj.userId}</p>
                      <p className="text-xs text-neutral-400 truncate">{adj.reason}</p>
                    </div>
                    <span className={cn('text-sm font-semibold tabular-nums', isPos ? 'text-success-600' : 'text-error-500')}>
                      {isPos ? '+' : '−'}{fmt(adj.amount)}
                    </span>
                    {canMutate && (
                      <button onClick={() => delAdjMut.mutate(adj.SK)} className="text-xs text-error-400 hover:text-error-600">✕</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee…"
          className="h-10 w-full rounded-xl border border-neutral-200 bg-white pl-9 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
      </div>

      {/* Payroll table */}
      {isLoading ? (
        <Card><Skeleton className="h-40 w-full" /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <Wallet className="mx-auto h-8 w-8 text-neutral-300 mb-2" />
            <p className="text-sm text-neutral-400">No payroll data for {monthLabel(month)}</p>
          </div>
        </Card>
      ) : (
        <Card noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-neutral-400">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-neutral-400">Employee</th>
                  {rateKeys.map((key) => {
                    const cfg = getMetricConfig(key);
                    return (
                      <th key={key} className="px-4 py-3 text-right text-xs font-semibold uppercase text-neutral-400">
                        {cfg?.icon} {cfg?.label ?? key}
                      </th>
                    );
                  })}
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-neutral-400">Base</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-neutral-400">Bonus</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-neutral-400">Adj</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-primary-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
                {filtered.map((entry, i) => {
                  const emp = empMap[entry.userId];
                  const finalTotal = entry.finalTotal ?? entry.total;
                  return (
                    <tr key={entry.userId} className="hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30">
                      <td className="px-4 py-3 text-xs text-neutral-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={emp?.name ?? entry.userId} size={24} />
                          <div>
                            <p className="font-medium text-neutral-900 dark:text-neutral-100">{emp?.name ?? entry.userId}</p>
                            {emp?.email && <p className="text-xs text-neutral-400">{emp.email}</p>}
                          </div>
                        </div>
                      </td>
                      {rateKeys.map((key) => {
                        const cfg = getMetricConfig(key);
                        const val = entry.metrics[key] ?? 0;
                        const rate = rates[key];
                        const amount = rate ? (rate.type === 'percent' ? Math.round(val * rate.value / 100) : Math.round(val * rate.value)) : 0;
                        return (
                          <td key={key} className="px-4 py-3 text-right tabular-nums">
                            <p className="font-medium text-neutral-700 dark:text-neutral-300">
                              {cfg ? formatMetricValue(cfg, val) : val}
                            </p>
                            {val > 0 && <p className="text-xs text-success-600">{fmt(amount)}</p>}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-200">{fmt(entry.base)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-primary-600 dark:text-primary-400">{entry.bonus > 0 ? `+${fmt(entry.bonus)}` : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {entry.adjustments && entry.adjustments !== 0 ? (
                          <span className={entry.adjustments > 0 ? 'text-success-600' : 'text-error-500'}>
                            {entry.adjustments > 0 ? '+' : '−'}{fmt(entry.adjustments)}
                          </span>
                        ) : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-primary-700 dark:text-primary-300">{fmt(finalTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/50">
                  <td colSpan={2 + rateKeys.length} className="px-4 py-3 text-xs font-semibold uppercase text-neutral-500">
                    Team Total ({filtered.length})
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-success-700 dark:text-success-300 tabular-nums">{fmt(totalBase)}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary-600 dark:text-primary-400 tabular-nums">{fmt(totalBonus)}</td>
                  <td className="px-4 py-3 text-right font-bold text-warning-600 tabular-nums">{totalAdj !== 0 ? `${totalAdj >= 0 ? '+' : '−'}${fmt(totalAdj)}` : '—'}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary-700 dark:text-primary-300 tabular-nums">{fmt(totalPayout)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CompensationPage() {
  const { user } = useAuth();
  const role = user?.role;
  // Raw role, not v3Role — v3Role collapses 'manager' and 'team_lead' into one
  // bucket, which would wrongly grant team_lead the same payroll-table access
  // as manager. GET /api/compensation/payroll and GET /adjustments are both
  // checkRole(['admin', 'manager']) (+ superadmin bypass) — team_lead is not
  // in that list, so team_lead must fall through to the personal comp view,
  // same as agent/telecaller/intern.
  const canViewPayroll   = role === 'admin' || role === 'manager' || role === 'superadmin';
  // The 5 mutating actions inside the payroll view (Edit Rates, Create
  // Snapshot, Lock & Notify, Unlock, Add Adjustment — plus Delete Rates/
  // Delete Adjustment, same gate) are all checkRole(['admin']) only —
  // manager gets read access to the table, not these actions.
  const canMutatePayroll = role === 'admin' || role === 'superadmin';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <Wallet className="h-5 w-5 text-primary-600" />
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Compensation</h1>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {canViewPayroll ? <AdminCompensationView canMutate={canMutatePayroll} /> : <EmployeeCompensationView />}
        </div>
      </div>
    </div>
  );
}
