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

export default function EmployeeCrmPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['emp-crm-leads'],
    queryFn: () => apiFetch<{ success: boolean; leads: Lead[] }>('/api/crm/leads'),
    staleTime: 30_000,
  });

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emp-crm-leads'] }),
  });

  const leads = data?.leads ?? [];

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !search || l.name.toLowerCase().includes(q) || l.phone.includes(q);
    const matchStage = !stageFilter || l.stage === stageFilter;
    return matchSearch && matchStage;
  });

  const byStage = Object.fromEntries(STAGES.map((s) => [s.key, leads.filter((l) => l.stage === s.key).length]));

  return (
    <>
      <Navbar title="My Leads" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold text-slate-900 dark:text-white">My Leads</h1>
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
