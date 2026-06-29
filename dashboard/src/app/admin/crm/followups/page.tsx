'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import { CrmSubNav } from '@/components/layout/CrmSubNav';

interface Followup {
  leadId: string;
  leadName?: string;
  leadPhone?: string;
  date: string;
  note: string;
  assignedTo: string;
  done: boolean;
  createdAt: string;
}

function dayLabel(date: string) {
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return 'Overdue';
  if (date === today) return 'Today';
  const diff = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (diff === 1) return 'Tomorrow';
  if (diff <= 7) return 'This Week';
  return 'Later';
}

const GROUP_ORDER = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later'];
const GROUP_STYLE: Record<string, string> = {
  Overdue:   'border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-900/10',
  Today:     'border-indigo-200 bg-indigo-50 dark:border-indigo-900/30 dark:bg-indigo-900/10',
  Tomorrow:  'border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-900/10',
  'This Week':'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
  Later:     'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
};
const GROUP_LABEL_STYLE: Record<string, string> = {
  Overdue:   'text-red-600 dark:text-red-400',
  Today:     'text-indigo-600 dark:text-indigo-400',
  Tomorrow:  'text-amber-600 dark:text-amber-400',
  'This Week':'text-slate-600 dark:text-slate-400',
  Later:     'text-slate-500 dark:text-slate-500',
};

export default function FollowupsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'overdue' | 'today'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['followups-global'],
    queryFn: () => apiFetch<{ success: boolean; followups: Followup[] }>('/api/crm/followups?days=30&overdue=true'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const doneMutation = useMutation({
    mutationFn: ({ date, leadId }: { date: string; leadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${leadId}/done`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['followups-global'] }),
  });

  const all = data?.followups ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const visible = filter === 'overdue'
    ? all.filter((f) => f.date < today)
    : filter === 'today'
      ? all.filter((f) => f.date === today)
      : all;

  const grouped = GROUP_ORDER.reduce((acc, g) => {
    acc[g] = visible.filter((f) => dayLabel(f.date) === g);
    return acc;
  }, {} as Record<string, Followup[]>);

  const overdueCount = all.filter((f) => f.date < today).length;
  const todayCount = all.filter((f) => f.date === today).length;

  return (
    <>
      <Navbar title="Follow-ups" showBack />
      <CrmSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-3xl p-4 pb-10">

          {/* Stats strip */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              { label: 'Total pending', value: all.length, color: 'text-slate-700 dark:text-slate-200' },
              { label: 'Overdue', value: overdueCount, color: overdueCount > 0 ? 'text-red-600' : 'text-slate-400' },
              { label: 'Today', value: todayCount, color: todayCount > 0 ? 'text-indigo-600' : 'text-slate-400' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Filter pills */}
          <div className="mb-4 flex gap-2">
            {(['all', 'overdue', 'today'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition capitalize ${
                  filter === f
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}>
                {f === 'all' ? `All (${all.length})` : f === 'overdue' ? `Overdue (${overdueCount})` : `Today (${todayCount})`}
              </button>
            ))}
          </div>

          {isLoading && (
            <div className="flex justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          )}

          {!isLoading && visible.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
              <span className="mb-3 text-4xl">📅</span>
              <p className="text-sm font-medium text-slate-500">No follow-ups</p>
              <p className="mt-1 text-xs text-slate-400">Schedule follow-ups from individual lead pages</p>
            </div>
          )}

          {GROUP_ORDER.map((group) => {
            const items = grouped[group];
            if (!items?.length) return null;
            return (
              <div key={group} className="mb-6">
                <div className="mb-2 flex items-center gap-2">
                  <p className={`text-xs font-bold uppercase tracking-wide ${GROUP_LABEL_STYLE[group]}`}>{group}</p>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((fu) => (
                    <div key={`${fu.date}-${fu.leadId}`}
                      className={`flex items-start gap-3 rounded-2xl border p-4 ${GROUP_STYLE[group]}`}>
                      <div className="mt-0.5 flex-shrink-0">
                        <input type="checkbox" checked={fu.done}
                          onChange={() => doneMutation.mutate({ date: fu.date, leadId: fu.leadId })}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/contacts/${fu.leadId}?tab=tasks&from=crm`}
                            className="text-sm font-semibold text-slate-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400">
                            {fu.leadName ?? fu.leadId}
                          </Link>
                          {fu.leadPhone && <span className="text-xs text-slate-400">{fu.leadPhone}</span>}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${GROUP_LABEL_STYLE[group]}`}>
                            {new Date(fu.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                        {fu.note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{fu.note}</p>}
                      </div>
                      <Link href={`/admin/contacts/${fu.leadId}?tab=tasks&from=crm`}
                        className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
                        Open →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
