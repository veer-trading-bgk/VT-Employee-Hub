'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, dailyTarget } from '@/lib/metrics.config';
import { useAuth } from '@/context/AuthContext';
import { daysLeftInMonth, currentMonthLabel, today } from '@/utils/date-utils';
import { toast } from 'sonner';
import { useMetricOrder } from '@/hooks/useMetricOrder';
import { SortableMetricCard, DragOverlayCard } from '@/components/ui/SortableMetricCard';
import type { MyMetricsResponse, VerificationStatus } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Followup {
  leadId: string;
  leadName?: string;
  leadPhone?: string;
  date: string;
  note?: string;
  done?: boolean;
}

interface CompensationSummary {
  incentiveTotal: number;
  projectedTotal: number;
  totalCompensation: number;
  fixedBase: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function greetingByTime() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function performanceBadge(avg: number) {
  if (avg >= 100) return { label: 'Excellent', cls: 'bg-emerald-500 text-white', icon: '🔥' };
  if (avg >= 70)  return { label: 'On Track',  cls: 'bg-amber-500 text-white',   icon: '☀️' };
  if (avg >= 40)  return { label: 'Needs Push', cls: 'bg-orange-500 text-white', icon: '⚡' };
  return                 { label: 'Behind',     cls: 'bg-rose-500 text-white',    icon: '❄️' };
}

function fmt(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiBar({ label, icon, value, target, progress }: {
  label: string; icon: string; value: number; target: number; progress: number;
}) {
  const color =
    progress >= 100 ? 'bg-emerald-500' :
    progress >= 70  ? 'bg-amber-500' :
    progress > 0    ? 'bg-rose-500' :
    'bg-slate-300 dark:bg-slate-700';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{icon}</span>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
          progress >= 100 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
          progress >= 70  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
          progress > 0    ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' :
          'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
        }`}>{progress}%</span>
      </div>
      <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
      <p className="text-[10px] text-slate-400 mb-2">
        of {target > 0 && target < 1 ? target.toFixed(1) : Math.round(target)} target
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(progress, 100)}%`, minWidth: progress > 0 ? '4px' : '0' }} />
      </div>
    </div>
  );
}

function FollowupItem({ fu, onDone }: { fu: Followup & { priority: 'overdue' | 'today' | 'upcoming' }; onDone: () => void }) {
  const cfg = {
    overdue:  { badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',       dot: '🔴', label: 'Overdue' },
    today:    { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', dot: '🟠', label: 'Today' },
    upcoming: { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', dot: '🟢', label: 'Upcoming' },
  }[fu.priority];

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-50 dark:border-slate-800 last:border-0">
      <span className="text-base flex-shrink-0">{cfg.dot}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{fu.leadName ?? fu.leadId}</p>
        {fu.note && <p className="text-[10px] text-slate-400 truncate">"{fu.note}"</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badge}`}>{cfg.label}</span>
        {fu.priority !== 'upcoming' && (
          <button onClick={onDone}
            className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400">
            ✓
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [addForm, setAddForm] = useState({ metric_type: 'kyc', value: '' });
  const [showForm, setShowForm] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showComp, setShowComp] = useState(false);

  const { order, sortedMetrics, saveOrder, resetOrder, isCustomOrder } =
    useMetricOrder(user?.id ?? 'guest');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['my-metrics-30'],
    queryFn: () => apiFetch<MyMetricsResponse>('/api/metrics/my?days=30'),
    refetchInterval: 60_000,
  });

  const { data: fuData } = useQuery({
    queryKey: ['emp-followups-dash'],
    queryFn: () => apiFetch<{ success: boolean; followups: Followup[] }>('/api/crm/followups'),
    staleTime: 2 * 60_000,
    enabled: !!user,
  });

  const { data: compData } = useQuery({
    queryKey: ['emp-comp-dash', user?.id, currentMonthStr()],
    queryFn: () => apiFetch<CompensationSummary>(`/api/compensation/calculate/${user?.id}?month=${currentMonthStr()}`),
    staleTime: 5 * 60_000,
    enabled: !!user?.id,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: ({ metric_type, value }: { metric_type: string; value: number }) =>
      apiFetch<{ data?: { total?: number; metric_type?: string } }>('/api/metrics/add', {
        method: 'POST',
        body: JSON.stringify({ metric_type, value }),
      }),
    onSuccess: (res) => {
      const total = res?.data?.total;
      const mt = res?.data?.metric_type ?? addForm.metric_type;
      toast.success(total != null ? `${mt.toUpperCase()} today: ${total}` : 'Metric added!');
      queryClient.invalidateQueries({ queryKey: ['my-metrics-30'] });
      queryClient.invalidateQueries({ queryKey: ['my-metrics-entry'] });
      setAddForm({ metric_type: 'kyc', value: '' });
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doneMutation = useMutation({
    mutationFn: ({ date, leadId }: { date: string; leadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${leadId}/done`, { method: 'PUT' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp-followups-dash'] }),
  });

  // ── Derived data ──────────────────────────────────────────────────────────
  const todayStr = today();
  const allDates = data?.data ?? {};
  const todayStatuses = (data?.statuses?.[todayStr] ?? {}) as Record<string, VerificationStatus>;
  const apiTargets = (data?.targets ?? {}) as Record<string, number>;

  const sortedSummary = useMemo(() =>
    sortedMetrics.map((metric) => {
      const todayValue = allDates[todayStr]?.[metric.key] ?? 0;
      const monthTotal = Object.values(allDates).reduce(
        (sum, dayData) => sum + (dayData[metric.key] ?? 0), 0,
      );
      const target   = apiTargets[metric.key] ?? dailyTarget(metric);
      const mTarget  = target * 30;
      const progress = target > 0 ? Math.min(Math.round((todayValue / target) * 100), 999) : 0;
      const monthPct = mTarget > 0 ? Math.min(Math.round((monthTotal / mTarget) * 100), 999) : 0;
      return { metric, value: todayValue, target, mTarget, progress, monthTotal, monthPct };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedMetrics, allDates, todayStr, apiTargets],
  );

  const avgProgress = sortedSummary.length > 0
    ? Math.round(sortedSummary.reduce((s, m) => s + m.progress, 0) / sortedSummary.length)
    : 0;
  const metricsHit  = sortedSummary.filter((m) => m.progress >= 100).length;
  const badge       = performanceBadge(avgProgress);

  const activeItem  = activeId
    ? sortedSummary.find((s) => s.metric.key === activeId) ?? null
    : null;

  // Follow-ups: overdue + today
  const todayDate = todayISO();
  const urgentFollowups = (fuData?.followups ?? [])
    .filter((f) => !f.done && f.date <= todayDate)
    .map((f) => ({ ...f, priority: f.date < todayDate ? 'overdue' as const : 'today' as const }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const handleAddMetric = () => {
    const v = parseFloat(addForm.value);
    if (isNaN(v) || v <= 0) { toast.error('Enter a valid positive number.'); return; }
    addMutation.mutate({ metric_type: addForm.metric_type, value: v });
  };

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(active.id as string);
    const newIdx = order.indexOf(over.id as string);
    saveOrder(arrayMove(order, oldIdx, newIdx));
  };

  return (
    <>
      <Navbar title="My Dashboard" />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-5 p-4 pb-10">

          {/* ── Mission Header ─────────────────────────────────────────────── */}
          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 p-5 text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-indigo-200">{greetingByTime()},</p>
                <h1 className="truncate text-xl font-bold">{user?.name?.split(' ')[0]} 👋</h1>
                <p className="mt-0.5 text-xs text-indigo-300">
                  {currentMonthLabel()} · {daysLeftInMonth()} days left
                </p>
              </div>
              {!isLoading && (
                <div className={`flex-shrink-0 rounded-xl px-3 py-2 text-center ${badge.cls} bg-white/20`}>
                  <p className="text-lg leading-none">{badge.icon}</p>
                  <p className="mt-0.5 text-xs font-bold">{badge.label}</p>
                </div>
              )}
            </div>

            {/* Score bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-indigo-200">Today's Score</span>
                <span className="text-sm font-bold tabular-nums">{avgProgress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white/80 transition-all duration-700"
                  style={{ width: `${Math.min(avgProgress, 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-indigo-300">
                {metricsHit} of {METRICS.length} targets hit today
              </p>
            </div>

            {/* Quick actions */}
            <div className="mt-4 flex gap-2">
              <Link href="/employee/daily-entry"
                className="flex-1 rounded-xl bg-white/20 py-2.5 text-center text-xs font-semibold backdrop-blur hover:bg-white/30 transition">
                ✏️ Daily Entry
              </Link>
              <Link href="/employee/crm"
                className="flex-1 rounded-xl bg-white/20 py-2.5 text-center text-xs font-semibold backdrop-blur hover:bg-white/30 transition">
                🤝 My Leads
              </Link>
              <Link href="/employee/attendance"
                className="flex-1 rounded-xl bg-white/20 py-2.5 text-center text-xs font-semibold backdrop-blur hover:bg-white/30 transition">
                📅 Check-In
              </Link>
            </div>
          </div>

          {/* ── Follow-ups Due ─────────────────────────────────────────────── */}
          {urgentFollowups.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800/40 dark:bg-orange-900/10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  📞 Follow-ups Due
                  <span className="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {urgentFollowups.length}
                  </span>
                </h2>
                <Link href="/employee/crm"
                  className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                  View all →
                </Link>
              </div>
              {urgentFollowups.slice(0, 5).map((fu) => (
                <FollowupItem
                  key={`${fu.date}-${fu.leadId}`}
                  fu={fu}
                  onDone={() => doneMutation.mutate({ date: fu.date, leadId: fu.leadId })}
                />
              ))}
            </div>
          )}

          {/* ── Monthly Incentive Card ─────────────────────────────────────── */}
          {compData && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">My Earnings</h2>
                <button
                  onClick={() => setShowComp((v) => !v)}
                  aria-label={showComp ? 'Hide amounts' : 'Reveal amounts'}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition"
                >
                  {showComp ? '🙈 Hide' : '👁 Reveal'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-emerald-200 bg-white p-4 dark:border-emerald-800/40 dark:bg-slate-900">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Earned This Month</p>
                  <p className="mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {showComp ? fmt(compData.incentiveTotal) : '₹ •••••'}
                  </p>
                  <p className="text-[10px] text-slate-400">incentive</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-white p-4 dark:border-indigo-800/40 dark:bg-slate-900">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Projected Pay</p>
                  <p className="mt-1 text-xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {showComp ? fmt(compData.projectedTotal) : '₹ •••••'}
                  </p>
                  <p className="text-[10px] text-slate-400">if trend holds</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Today's Targets ───────────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Today&apos;s Targets</h2>
              <div className="flex items-center gap-2">
                {isCustomOrder && !showReorder && (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
                    Custom order
                  </span>
                )}
                {showReorder && isCustomOrder && (
                  <button onClick={resetOrder} className="text-xs text-slate-400 hover:text-rose-500 transition">
                    Reset
                  </button>
                )}
                <button
                  onClick={() => { setShowForm((v) => !v); setShowReorder(false); }}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  {showForm ? 'Cancel' : '+ Add'}
                </button>
                <button
                  onClick={() => { setShowReorder((v) => !v); setShowForm(false); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    showReorder
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {showReorder ? '✓ Done' : '↕'}
                </button>
              </div>
            </div>

            {/* Add metric form */}
            {showForm && (
              <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <select
                    value={addForm.metric_type}
                    onChange={(e) => setAddForm((f) => ({ ...f, metric_type: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:w-auto"
                  >
                    {METRICS.map((m) => (
                      <option key={m.key} value={m.key}>{m.icon} {m.label}</option>
                    ))}
                  </select>
                  <input
                    type="number" min="0" step="1"
                    placeholder="Value"
                    value={addForm.value}
                    onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:w-28"
                  />
                  <button
                    onClick={handleAddMetric}
                    disabled={addMutation.isPending}
                    className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto"
                  >
                    {addMutation.isPending ? 'Adding…' : 'Add Entry'}
                  </button>
                </div>
              </div>
            )}

            {showReorder && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-2.5 dark:bg-indigo-950/30">
                <span className="text-indigo-400 text-sm">⠿</span>
                <p className="text-xs text-indigo-700 dark:text-indigo-300">
                  Drag to reorder — saves automatically and applies to Daily Entry too
                </p>
              </div>
            )}

            {isLoading ? (
              <Loading />
            ) : showReorder ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={order} strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {sortedSummary.map(({ metric, value, target, progress }) => (
                      <SortableMetricCard
                        key={metric.key}
                        id={metric.key}
                        metric={metric}
                        value={value}
                        target={target}
                        progress={progress}
                        verificationStatus={todayStatuses[metric.key]}
                      />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay adjustScale={false}>
                  {activeItem && (
                    <DragOverlayCard
                      metric={activeItem.metric}
                      value={activeItem.value}
                      target={activeItem.target}
                      progress={activeItem.progress}
                    />
                  )}
                </DragOverlay>
              </DndContext>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sortedSummary.map(({ metric, value, target, progress }) => (
                  <KpiBar
                    key={metric.key}
                    label={metric.label}
                    icon={metric.icon}
                    value={value}
                    target={target}
                    progress={progress}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Monthly Progress ──────────────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 font-semibold text-slate-900 dark:text-white">Month So Far</h2>
            <p className="mb-4 text-xs text-slate-400">Totals vs monthly targets</p>
            {isLoading ? (
              <Loading size="sm" />
            ) : (
              <div className="space-y-3">
                {sortedSummary.map(({ metric, monthTotal, monthPct, mTarget }) => (
                  <div key={metric.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {metric.icon} {metric.label}
                      </span>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {monthTotal} / {mTarget}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${metric.color}`}
                        style={{ width: `${Math.min(monthPct, 100)}%`, minWidth: monthPct > 0 ? '4px' : '0' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
