'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import type { Lead } from '@/app/admin/crm/page';

const STAGES = [
  { key: 'new',        label: 'New',        color: 'bg-slate-100 text-slate-600' },
  { key: 'contacted',  label: 'Contacted',  color: 'bg-blue-100 text-blue-600' },
  { key: 'interested', label: 'Interested', color: 'bg-violet-100 text-violet-600' },
  { key: 'kyc_done',   label: 'KYC Done',   color: 'bg-amber-100 text-amber-700' },
  { key: 'demat_done', label: 'Demat Done', color: 'bg-orange-100 text-orange-700' },
  { key: 'converted',  label: 'Converted',  color: 'bg-emerald-100 text-emerald-700' },
  { key: 'churned',    label: 'Churned',    color: 'bg-red-100 text-red-500' },
];

const PRODUCT_LABELS: Record<string, string> = {
  kyc: 'KYC', demat: 'Demat', mf: 'MF', insurance: 'Insurance', pms: 'PMS', algo: 'Algo',
};

function timeSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface Followup {
  leadId: string;
  leadName?: string;
  leadPhone?: string;
  date: string;
  note?: string;
  done?: boolean;
}

type FollowupPriority = 'overdue' | 'today' | 'upcoming';

function classifyFollowup(date: string): FollowupPriority {
  const today = todayISO();
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}

const PRIORITY_CONFIG: Record<FollowupPriority, { label: string; badge: string; ring: string }> = {
  overdue:  { label: '🔴 Overdue',  badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',    ring: 'border-red-200 dark:border-red-800' },
  today:    { label: '🟠 Today',    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', ring: 'border-orange-200 dark:border-orange-800' },
  upcoming: { label: '🟢 Upcoming', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', ring: 'border-emerald-200 dark:border-emerald-800' },
};

function FollowupCard({ fu, onDone }: { fu: Followup & { priority: FollowupPriority }; onDone: (fu: Followup) => void }) {
  const cfg = PRIORITY_CONFIG[fu.priority];
  return (
    <div className={`flex items-start justify-between gap-3 rounded-xl border bg-white p-4 dark:bg-slate-900 ${cfg.ring}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900 dark:text-white">{fu.leadName ?? fu.leadId}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badge}`}>
            {PRIORITY_CONFIG[fu.priority].label}
          </span>
        </div>
        {fu.leadPhone && <p className="mt-0.5 text-xs text-slate-400">📱 {fu.leadPhone}</p>}
        {fu.note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 italic">"{fu.note}"</p>}
        <p className="mt-1 text-[10px] text-slate-400">Due: {fu.date}</p>
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <Link
          href={`/employee/crm/${fu.leadId}`}
          className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400"
        >
          Open →
        </Link>
        {(fu.priority === 'overdue' || fu.priority === 'today') && (
          <button
            onClick={() => onDone(fu)}
            className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400"
          >
            ✓ Done
          </button>
        )}
      </div>
    </div>
  );
}

export default function EmployeeCrmPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [fuFilter, setFuFilter] = useState<'all' | FollowupPriority>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['emp-crm-leads'],
    queryFn: () => apiFetch<{ success: boolean; leads: Lead[] }>('/api/crm/leads'),
    staleTime: 30_000,
  });

  const { data: fuData, isLoading: fuLoading } = useQuery({
    queryKey: ['emp-followups'],
    queryFn: () => apiFetch<{ success: boolean; followups: Followup[] }>('/api/crm/followups'),
    staleTime: 60_000,
  });

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp-crm-leads'] }),
  });

  const doneMutation = useMutation({
    mutationFn: ({ date, leadId }: { date: string; leadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${leadId}/done`, { method: 'PUT' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp-followups'] }),
  });

  const leads = data?.leads ?? [];

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !search || l.name.toLowerCase().includes(q) || l.phone.includes(q);
    const matchStage = !stageFilter || l.stage === stageFilter;
    return matchSearch && matchStage;
  });

  const byStage = Object.fromEntries(STAGES.map((s) => [s.key, leads.filter((l) => l.stage === s.key).length]));

  // Classify follow-ups
  const rawFollowups = (fuData?.followups ?? []).filter((f) => !f.done);
  const classified = rawFollowups
    .map((f) => ({ ...f, priority: classifyFollowup(f.date) }))
    .sort((a, b) => {
      const order: Record<FollowupPriority, number> = { overdue: 0, today: 1, upcoming: 2 };
      return order[a.priority] - order[b.priority] || a.date.localeCompare(b.date);
    });

  const overdueCount  = classified.filter((f) => f.priority === 'overdue').length;
  const todayCount    = classified.filter((f) => f.priority === 'today').length;
  const upcomingCount = classified.filter((f) => f.priority === 'upcoming').length;

  const visibleFollowups = fuFilter === 'all' ? classified : classified.filter((f) => f.priority === fuFilter);

  return (
    <>
      <Navbar title="My Leads" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">

          {/* ── Follow-up Priority Section ── */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Follow-up Queue</h2>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['all', `All (${classified.length})`],
                  ['overdue', `🔴 Overdue (${overdueCount})`],
                  ['today', `🟠 Today (${todayCount})`],
                  ['upcoming', `🟢 Upcoming (${upcomingCount})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFuFilter(key)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                      fuFilter === key
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {fuLoading ? (
              <Loading size="sm" />
            ) : classified.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No pending follow-ups</p>
            ) : visibleFollowups.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">None in this category</p>
            ) : (
              <div className="space-y-2">
                {visibleFollowups.map((fu) => (
                  <FollowupCard
                    key={`${fu.date}-${fu.leadId}`}
                    fu={fu}
                    onDone={(f) => doneMutation.mutate({ date: f.date, leadId: f.leadId })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── All Leads ── */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold text-slate-900 dark:text-white">All My Leads</h1>
              <p className="text-sm text-slate-500">{leads.length} assigned to you</p>
            </div>
          </div>

          {/* Stage pills */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setStageFilter('')}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition ${!stageFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
              All ({leads.length})
            </button>
            {STAGES.map((s) => (
              <button key={s.key} onClick={() => setStageFilter(stageFilter === s.key ? '' : s.key)}
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition ${stageFilter === s.key ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
                {s.label} {byStage[s.key] > 0 ? `(${byStage[s.key]})` : ''}
              </button>
            ))}
          </div>

          <input placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />

          {isLoading ? (
            <div className="flex justify-center py-12"><Loading /></div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No leads found.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((lead) => {
                const stage = STAGES.find((s) => s.key === lead.stage);
                return (
                  <div key={lead.leadId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900 dark:text-white">{lead.name}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stage?.color}`}>{stage?.label}</span>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-400">📱 {lead.phone}</p>
                        {lead.productInterest?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {lead.productInterest.map((p) => (
                              <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">{PRODUCT_LABELS[p] ?? p}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-[10px] text-slate-400">{timeSince(lead.updatedAt)}</p>
                        <select value={lead.stage}
                          onChange={(e) => stageMutation.mutate({ leadId: lead.leadId, stage: e.target.value })}
                          className="rounded-lg border border-slate-200 bg-slate-50 py-1 px-2 text-[10px] text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {STAGES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2 border-t border-slate-50 pt-3 dark:border-slate-800">
                      <Link href={`/employee/crm/${lead.leadId}`}
                        className="flex-1 rounded-lg bg-indigo-50 py-2 text-center text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-400">
                        💬 Open Chat
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
