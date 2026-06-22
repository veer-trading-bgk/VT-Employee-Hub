'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export interface Lead {
  PK: string;
  leadId: string;
  name: string;
  phone: string;
  email?: string;
  stage: string;
  productInterest: string[];
  source: string;
  notes: string;
  assignedTo: string;
  assignedToName?: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string;
}

interface StatsResponse {
  success: boolean;
  total: number;
  byStage: Record<string, number>;
  convertedToday: number;
  stages: string[];
}

const STAGES: { key: string; label: string; color: string; bg: string; border: string }[] = [
  { key: 'new',        label: 'New',         color: 'text-slate-600',   bg: 'bg-slate-50',   border: 'border-slate-200' },
  { key: 'contacted',  label: 'Contacted',   color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  { key: 'interested', label: 'Interested',  color: 'text-violet-600',  bg: 'bg-violet-50',  border: 'border-violet-200' },
  { key: 'kyc_done',   label: 'KYC Done',    color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  { key: 'demat_done', label: 'Demat Done',  color: 'text-orange-600',  bg: 'bg-orange-50',  border: 'border-orange-200' },
  { key: 'converted',  label: 'Converted',   color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { key: 'churned',    label: 'Churned',     color: 'text-red-500',     bg: 'bg-red-50',     border: 'border-red-200' },
];

const PRODUCT_LABELS: Record<string, string> = {
  kyc: 'KYC', demat: 'Demat', mf: 'MF', insurance: 'Insurance', pms: 'PMS', algo: 'Algo',
};

function StageChip({ stage }: { stage: string }) {
  const s = STAGES.find((x) => x.key === stage);
  if (!s) return null;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.color} ${s.bg} border ${s.border}`}>
      {s.label}
    </span>
  );
}

function timeSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AdminCrmPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'manual', notes: '', assignedTo: '' });

  const { data: leadsData, isLoading } = useQuery({
    queryKey: ['crm-leads'],
    queryFn: () => apiFetch<{ success: boolean; leads: Lead[] }>('/api/crm/leads'),
    staleTime: 30_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['crm-stats'],
    queryFn: () => apiFetch<StatsResponse>('/api/crm/stats'),
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (body: typeof form) => apiFetch('/api/crm/leads', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      setShowAddForm(false);
      setForm({ name: '', phone: '', email: '', source: 'manual', notes: '', assignedTo: '' });
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-leads'] }),
  });

  const leads = leadsData?.leads ?? [];
  const filtered = leads.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.name.toLowerCase().includes(q) || l.phone.includes(q) || l.email?.toLowerCase().includes(q);
  });

  return (
    <>
      <Navbar title="CRM" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-5 p-4 pb-10">

          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Lead Pipeline</h1>
              <p className="text-sm text-slate-500">{statsData?.total ?? 0} leads · {statsData?.convertedToday ?? 0} converted today</p>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {(['kanban', 'list'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                    {v === 'kanban' ? '⬛ Kanban' : '☰ List'}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAddForm(true)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
                + Add Lead
              </button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {STAGES.map((s) => (
              <div key={s.key} className={`flex-shrink-0 rounded-xl border px-3 py-2 text-center ${s.bg} ${s.border} dark:bg-opacity-10`}>
                <p className={`text-lg font-bold ${s.color}`}>{statsData?.byStage?.[s.key] ?? 0}</p>
                <p className="text-[10px] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <input placeholder="Search by name, phone, email…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />

          {isLoading ? (
            <div className="flex justify-center py-20"><Loading /></div>
          ) : view === 'kanban' ? (
            // ── Kanban ──────────────────────────────────────────────────────────
            <div className="flex gap-3 overflow-x-auto pb-4">
              {STAGES.map((s) => {
                const colLeads = filtered.filter((l) => l.stage === s.key);
                return (
                  <div key={s.key} className={`flex w-64 flex-shrink-0 flex-col rounded-xl border ${s.border} ${s.bg} dark:bg-opacity-5`}>
                    <div className={`flex items-center justify-between border-b ${s.border} px-3 py-2`}>
                      <span className={`text-xs font-semibold uppercase tracking-wide ${s.color}`}>{s.label}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${s.color} ${s.bg} border ${s.border}`}>{colLeads.length}</span>
                    </div>
                    <div className="flex flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: '65vh' }}>
                      {colLeads.length === 0 && (
                        <p className="py-4 text-center text-xs text-slate-400">Empty</p>
                      )}
                      {colLeads.map((lead) => (
                        <Link key={lead.leadId} href={`/admin/crm/${lead.leadId}`}
                          className="group rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{lead.name}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{lead.phone}</p>
                          {lead.productInterest?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {lead.productInterest.map((p) => (
                                <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">{PRODUCT_LABELS[p] ?? p}</span>
                              ))}
                            </div>
                          )}
                          <div className="mt-2 flex items-center justify-between">
                            <p className="text-[10px] text-slate-400">{timeSince(lead.updatedAt)}</p>
                            {/* Quick stage move */}
                            <select
                              value={lead.stage}
                              onClick={(e) => e.preventDefault()}
                              onChange={(e) => { e.preventDefault(); stageMutation.mutate({ leadId: lead.leadId, stage: e.target.value }); }}
                              className="rounded border border-slate-200 bg-slate-50 py-0.5 text-[10px] text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            >
                              {STAGES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                            </select>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // ── List view ────────────────────────────────────────────────────────
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Products</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Stage</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Updated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center text-sm text-slate-400">No leads found</td></tr>
                  ) : filtered.map((lead) => (
                    <tr key={lead.leadId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{lead.name}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-500">{lead.phone}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(lead.productInterest ?? []).map((p) => (
                            <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">{PRODUCT_LABELS[p] ?? p}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3"><StageChip stage={lead.stage} /></td>
                      <td className="px-4 py-3 text-xs text-slate-400">{timeSince(lead.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/crm/${lead.leadId}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Lead Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">New Lead</h2>
              <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="space-y-3">
              <input placeholder="Full Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              <input placeholder="WhatsApp Phone *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              <input placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                <option value="manual">Manual Entry</option>
                <option value="referral">Referral</option>
                <option value="whatsapp">WhatsApp Inbound</option>
                <option value="walk_in">Walk-in</option>
                <option value="social">Social Media</option>
              </select>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            </div>
            {addMutation.isError && (
              <p className="mt-2 text-xs text-red-500">Failed to add lead. Check inputs.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowAddForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={() => addMutation.mutate(form)} disabled={!form.name || !form.phone || addMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {addMutation.isPending ? 'Adding…' : 'Add Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
