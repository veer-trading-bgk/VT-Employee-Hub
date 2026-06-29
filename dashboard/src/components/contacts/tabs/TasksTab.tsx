'use client';

import { memo, useState, useMemo, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useCustomer360 } from '@/contexts/Customer360Context';
import { useContactMutations } from '@/hooks/useContactMutations';
import { FollowUpForm } from '@/components/ui/FollowUpForm';
import type { Followup } from '@/lib/contacts/types';

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function nDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

// ── Task grouping ─────────────────────────────────────────────────────────────

type TaskGroup = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later';

function classifyTask(date: string, today: string, tomorrow: string, weekOut: string): TaskGroup {
  if (date < today)    return 'overdue';
  if (date === today)  return 'today';
  if (date === tomorrow) return 'tomorrow';
  if (date <= weekOut) return 'thisWeek';
  return 'later';
}

const GROUP_META: Record<TaskGroup, { label: string; badge: string; border: string }> = {
  overdue:  {
    label:  'Overdue',
    badge:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
  },
  today: {
    label:  'Due Today',
    badge:  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
  },
  tomorrow: {
    label:  'Tomorrow',
    badge:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
  },
  thisWeek: {
    label:  'This Week',
    badge:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
  },
  later: {
    label:  'Later',
    badge:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
  },
};

const GROUP_ORDER: TaskGroup[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later'];

function fuKey(fu: Followup): string {
  return `${fu.date}|${fu.leadId}`;
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

interface TaskCardProps {
  fu: Followup;
  group: TaskGroup;
  assignedToName?: string | null;
  isDoning: boolean;
  isCreating: boolean;
  reschedulingKey: string | null;
  rescheduleDate: string;
  onDone: (fu: Followup) => void;
  onStartReschedule: (key: string) => void;
  onCancelReschedule: () => void;
  onConfirmReschedule: (fu: Followup, newDate: string) => void;
  onRescheduleDateChange: (date: string) => void;
}

const TaskCard = memo(function TaskCard({
  fu,
  group,
  assignedToName,
  isDoning,
  isCreating,
  reschedulingKey,
  rescheduleDate,
  onDone,
  onStartReschedule,
  onCancelReschedule,
  onConfirmReschedule,
  onRescheduleDateChange,
}: TaskCardProps) {
  const key  = fuKey(fu);
  const meta = GROUP_META[group];
  const isRescheduling = reschedulingKey === key;

  return (
    <li className={`rounded-xl border bg-white p-3 dark:bg-slate-900 ${meta.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
              {meta.label}
            </span>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {fmtDate(fu.date)}
            </span>
          </div>
          {fu.note && (
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{fu.note}</p>
          )}
          {assignedToName && (
            <p className="mt-1 text-[10px] text-slate-400">
              Assigned: {assignedToName}
            </p>
          )}
        </div>

        {!isRescheduling && (
          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
            <button
              onClick={() => onDone(fu)}
              disabled={isDoning}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
              aria-label={`Mark ${fu.date} task done`}
            >
              Done ✓
            </button>
            <button
              onClick={() => onStartReschedule(key)}
              disabled={isCreating}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
              aria-label={`Reschedule ${fu.date} task`}
            >
              Reschedule
            </button>
          </div>
        )}
      </div>

      {isRescheduling && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 dark:border-indigo-900/50 dark:bg-indigo-950/20">
          <span className="flex-shrink-0 text-[11px] text-slate-500">New date:</span>
          <input
            type="date"
            autoFocus
            value={rescheduleDate}
            min={todayISO()}
            onChange={(e) => onRescheduleDateChange(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            aria-label="New date for rescheduled task"
          />
          <button
            onClick={() => onConfirmReschedule(fu, rescheduleDate)}
            disabled={!rescheduleDate || isCreating}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {isCreating ? '…' : 'Confirm'}
          </button>
          <button
            onClick={onCancelReschedule}
            className="rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
});

// ── CompletedCard ─────────────────────────────────────────────────────────────

interface CompletedCardProps {
  fu: Followup;
  isCreating: boolean;
  onReopen: (fu: Followup) => void;
}

const CompletedCard = memo(function CompletedCard({ fu, isCreating, onReopen }: CompletedCardProps) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3 opacity-70 dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            Completed
          </span>
          <span className="text-xs font-medium text-slate-500 line-through dark:text-slate-500">
            {fmtDate(fu.date)}
          </span>
        </div>
        {fu.note && (
          <p className="mt-1 text-[11px] text-slate-400 line-through">{fu.note}</p>
        )}
      </div>
      <button
        onClick={() => onReopen(fu)}
        disabled={isCreating}
        className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
        aria-label={`Reopen ${fu.date} task`}
      >
        Reopen
      </button>
    </li>
  );
});

// ── TasksPanel ────────────────────────────────────────────────────────────────

function TasksPanel() {
  const { leadId, contact, followups, refreshFollowups } = useCustomer360();
  const { createTask } = useContactMutations(leadId);

  const [reschedulingKey, setReschedulingKey] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate]   = useState('');
  const [showCompleted, setShowCompleted]     = useState(false);

  const doneMutation = useMutation({
    mutationFn: ({ date, fuLeadId }: { date: string; fuLeadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${fuLeadId}/done`, { method: 'PUT' }),
    onSuccess: () => { refreshFollowups(); toast.success('Marked done'); },
    onError:   () => toast.error('Failed to mark done'),
  });

  // ── Derived ───────────────────────────────────────────────────────────
  const { grouped, pendingCount, overdueCount, completedCount, completedTasks } =
    useMemo(() => {
      const today    = todayISO();
      const tomorrow = nDaysISO(1);
      const weekOut  = nDaysISO(7);

      const pending   = followups.filter((f) => !f.done).sort((a, b) => a.date.localeCompare(b.date));
      const completed = followups.filter((f) =>  f.done).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
      const overdue   = pending.filter((f) => f.date < today).length;

      const grp: Record<TaskGroup, Followup[]> = {
        overdue: [], today: [], tomorrow: [], thisWeek: [], later: [],
      };
      pending.forEach((f) => grp[classifyTask(f.date, today, tomorrow, weekOut)].push(f));

      return {
        grouped:        grp,
        pendingCount:   pending.length,
        overdueCount:   overdue,
        completedCount: followups.filter((f) => f.done).length,
        completedTasks: completed,
      };
    }, [followups]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleCreate = useCallback(
    ({ date, note }: { date: string; note: string }, reset: () => void) => {
      createTask.mutate({ date, note }, {
        onSuccess: () => { refreshFollowups(); toast.success('Task added'); reset(); },
      });
    },
    [createTask, refreshFollowups]
  );

  const handleDone = useCallback(
    (fu: Followup) => {
      doneMutation.mutate({ date: fu.date, fuLeadId: fu.leadId });
    },
    [doneMutation]
  );

  const handleReopen = useCallback(
    (fu: Followup) => {
      createTask.mutate({ date: todayISO(), note: fu.note || '' }, {
        onSuccess: () => { refreshFollowups(); toast.success('Reopened as new task'); },
      });
    },
    [createTask, refreshFollowups]
  );

  const handleStartReschedule = useCallback((key: string) => {
    setReschedulingKey(key);
    setRescheduleDate('');
  }, []);

  const handleCancelReschedule = useCallback(() => {
    setReschedulingKey(null);
    setRescheduleDate('');
  }, []);

  const handleConfirmReschedule = useCallback(
    (fu: Followup, newDate: string) => {
      if (!newDate) return;
      createTask.mutate({ date: newDate, note: fu.note || '' }, {
        onSuccess: () => {
          doneMutation.mutate({ date: fu.date, fuLeadId: fu.leadId }, {
            onSuccess: () => {
              setReschedulingKey(null);
              setRescheduleDate('');
              refreshFollowups();
              toast.success('Rescheduled');
            },
          });
        },
      });
    },
    [createTask, doneMutation, refreshFollowups]
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">

        {/* ── Stats row ─────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center rounded-xl border border-slate-100 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
            <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{pendingCount}</span>
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pending</span>
          </div>
          <div className={`flex flex-col items-center rounded-xl border p-3 text-center ${
            overdueCount > 0
              ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20'
              : 'border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900'
          }`}>
            <span className={`text-lg font-bold ${overdueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
              {overdueCount}
            </span>
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Overdue</span>
          </div>
          <div className="flex flex-col items-center rounded-xl border border-slate-100 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
            <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{completedCount}</span>
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Completed</span>
          </div>
        </div>

        {/* ── Create task form ──────────────────────────────────── */}
        <FollowUpForm
          onSubmit={handleCreate}
          isLoading={createTask.isPending}
          minDate={todayISO()}
          label="Add Task"
          placeholder="Task description…"
        />

        {/* ── Pending task groups ───────────────────────────────── */}
        {pendingCount === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">All caught up</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              No pending tasks for this contact.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {GROUP_ORDER.map((groupId) => {
              const tasks = grouped[groupId];
              if (tasks.length === 0) return null;
              const meta = GROUP_META[groupId];
              return (
                <section key={groupId} aria-labelledby={`group-${groupId}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      id={`group-${groupId}`}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.badge}`}
                    >
                      {meta.label} ({tasks.length})
                    </span>
                  </div>
                  <ul className="space-y-2" role="list" aria-label={`${meta.label} tasks`}>
                    {tasks.map((fu) => (
                      <TaskCard
                        key={fuKey(fu)}
                        fu={fu}
                        group={groupId}
                        assignedToName={contact?.assignedToName}
                        isDoning={doneMutation.isPending}
                        isCreating={createTask.isPending}
                        reschedulingKey={reschedulingKey}
                        rescheduleDate={rescheduleDate}
                        onDone={handleDone}
                        onStartReschedule={handleStartReschedule}
                        onCancelReschedule={handleCancelReschedule}
                        onConfirmReschedule={handleConfirmReschedule}
                        onRescheduleDateChange={setRescheduleDate}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {/* ── Completed tasks (collapsible) ─────────────────────── */}
        {completedTasks.length > 0 && (
          <section aria-label="Completed tasks">
            <button
              onClick={() => setShowCompleted((p) => !p)}
              className="flex w-full items-center gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/80"
              aria-expanded={showCompleted}
            >
              <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Completed ({completedCount})
              </span>
              <span className="text-[10px] text-slate-400" aria-hidden="true">
                {showCompleted ? '▼' : '▶'}
              </span>
            </button>
            {showCompleted && (
              <ul className="mt-2 space-y-2" role="list" aria-label="Completed tasks">
                {completedTasks.map((fu) => (
                  <CompletedCard
                    key={`done-${fuKey(fu)}`}
                    fu={fu}
                    isCreating={createTask.isPending}
                    onReopen={handleReopen}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Reserved extension slot ───────────────────────────── */}
        <div data-slot="tasks-workflow" className="hidden" aria-hidden="true" />

      </div>
    </div>
  );
}

export const TasksTab = memo(TasksPanel);
