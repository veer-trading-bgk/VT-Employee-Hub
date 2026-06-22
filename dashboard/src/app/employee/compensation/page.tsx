'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { getMetricConfig } from '@/lib/metrics.config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateEntry { value: number; type: 'flat' | 'percent'; }
interface BonusSlab { minBase: number; pct: number; }

interface BreakdownEntry {
  value: number;
  rate: RateEntry;
  amount: number;
}

interface CompensationResponse {
  month: string;
  breakdown: Record<string, BreakdownEntry>;
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

interface HistoryEntry {
  month: string;
  base: number;
  bonus: number;
  adjustments: number;
  total: number;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${Math.abs(n).toLocaleString('en-IN')}`;
}

function fmtRate(rate: RateEntry): string {
  return rate.type === 'percent' ? `${rate.value}% of value` : `${fmt(rate.value)} / unit`;
}

function currentMonthStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
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

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    locked:   'text-emerald-600 dark:text-emerald-400',
    approved: 'text-blue-600 dark:text-blue-400',
    reviewing:'text-amber-600 dark:text-amber-400',
    draft:    'text-slate-400',
    no_data:  'text-slate-300 dark:text-slate-600',
  };
  return map[status] ?? 'text-slate-400';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EmployeeCompensationPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthStr());
  const isCurrentMonth = month === currentMonthStr();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['emp-compensation', user?.id, month],
    queryFn: () => apiFetch<CompensationResponse>(`/api/compensation/calculate/${user?.id}?month=${month}`),
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['emp-comp-history', user?.id],
    queryFn: () => apiFetch<{ success: boolean; userId: string; history: HistoryEntry[] }>(`/api/compensation/history/${user?.id}`),
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const history = historyData?.history ?? [];
  const breakdown = data?.breakdown ?? {};
  const breakdownKeys = Object.keys(breakdown);

  const progressToNext = data && data.nextSlab
    ? Math.min(Math.round((data.baseCompensation / data.nextSlab.minBase) * 100), 100)
    : 100;

  return (
    <>
      <Navbar title="My Compensation" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-5 p-4 pb-10">

          {/* Month picker */}
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white">My Compensation</h1>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => setMonth(prevMonth(month))}
                className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >‹</button>
              <span className="min-w-32 text-center text-sm font-medium text-slate-700 dark:text-slate-300">
                {monthLabel(month)}
              </span>
              <button
                onClick={() => setMonth(nextMonth(month))}
                disabled={isCurrentMonth}
                className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
              >›</button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16"><Loading /></div>
          ) : isError ? (
            <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center dark:border-red-900/30 dark:bg-red-900/10">
              <p className="text-sm text-red-500">Could not load compensation data</p>
            </div>
          ) : data ? (
            <>
              {/* Hero totals */}
              <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 p-5 text-white shadow-lg dark:from-indigo-700 dark:to-indigo-900">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200">{monthLabel(month)}</p>
                <p className="mt-1 text-4xl font-bold tabular-nums">{fmt(data.totalCompensation)}</p>
                <p className="mt-0.5 text-sm text-indigo-200">Total earned this month</p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/10 p-3">
                    <p className="text-xs text-indigo-200">Base Incentive</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{fmt(data.baseCompensation)}</p>
                  </div>
                  <div className="rounded-xl bg-white/10 p-3">
                    <p className="text-xs text-indigo-200">Performance Bonus</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">
                      {data.performanceBonus > 0 ? `+${fmt(data.performanceBonus)}` : '—'}
                    </p>
                    {data.qualifyingSlab && (
                      <p className="text-xs text-indigo-300">+{data.qualifyingSlab.pct}% slab</p>
                    )}
                  </div>
                </div>

                {/* Point 11: Projected payout */}
                {isCurrentMonth && data.daysElapsed < data.daysInMonth && (
                  <div className="mt-3 rounded-xl bg-white/10 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-indigo-200">Projected Month-End</p>
                        <p className="mt-0.5 text-xl font-bold tabular-nums">{fmt(data.projectedTotal)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-indigo-300">Day {data.daysElapsed} of {data.daysInMonth}</p>
                        <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-white/20">
                          <div
                            className="h-full rounded-full bg-white"
                            style={{ width: `${Math.round(data.daysElapsed / data.daysInMonth * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bonus slab progress */}
              {data.nextSlab && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/10">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Next Bonus Slab</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      +{data.nextSlab.pct}% when base ≥ {fmt(data.nextSlab.minBase)}
                    </p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${progressToNext}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-blue-500">
                    <span>{fmt(data.baseCompensation)}</span>
                    <span>{fmt(data.nextSlab.minBase)} needed ({fmt(data.nextSlab.minBase - data.baseCompensation)} to go)</span>
                  </div>
                </div>
              )}
              {!data.nextSlab && data.qualifyingSlab && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/10">
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    🏆 Top bonus slab reached (+{data.qualifyingSlab.pct}%)
                  </p>
                </div>
              )}

              {/* Metric breakdown */}
              {breakdownKeys.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <p className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">
                    Breakdown by Metric
                  </p>
                  <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                    {breakdownKeys.map((key) => {
                      const entry = breakdown[key];
                      const cfg = getMetricConfig(key);
                      return (
                        <div key={key} className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{cfg?.icon ?? '📊'}</span>
                            <div>
                              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{cfg?.label ?? key}</p>
                              <p className="text-xs text-slate-400">
                                {cfg?.unit === 'currency' ? fmt(entry.value) : entry.value} units · {fmtRate(entry.rate)}
                              </p>
                            </div>
                          </div>
                          <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {fmt(entry.amount)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between rounded-b-xl border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Base Total</p>
                    <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-200">{fmt(data.baseCompensation)}</p>
                  </div>
                </div>
              )}

              {breakdownKeys.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center dark:border-slate-700">
                  <p className="text-sm text-slate-400">No metrics recorded for {monthLabel(month)}</p>
                  <p className="mt-1 text-xs text-slate-300 dark:text-slate-600">Submit your daily entries to see compensation here</p>
                </div>
              )}
            </>
          ) : null}

          {/* History (Point 10) */}
          {history.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <p className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800">
                Payout History
              </p>
              <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                {history.map((h) => (
                  <div
                    key={h.month}
                    className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    onClick={() => setMonth(h.month)}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{monthLabel(h.month)}</p>
                      <p className="text-xs text-slate-400">
                        Base {fmt(h.base)}
                        {h.bonus > 0 && ` + Bonus ${fmt(h.bonus)}`}
                        {h.adjustments !== 0 && ` ${h.adjustments > 0 ? '+' : '−'}Adj ${fmt(h.adjustments)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      {h.status === 'no_data' ? (
                        <p className="text-xs text-slate-300 dark:text-slate-600">No data</p>
                      ) : (
                        <>
                          <p className="text-sm font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmt(h.total)}</p>
                          <p className={`text-xs ${statusColor(h.status)}`}>{h.status}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
