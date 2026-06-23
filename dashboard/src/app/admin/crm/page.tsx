'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch, ApiClientError } from '@/lib/api';

export interface PipelineStage {
  key: string;
  label: string;
  color: string;
  order: number;
}

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
  tags: string[];
  closureDeadline?: string;
  assignedTo: string;
  assignedToName?: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string;
}

interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  role: string;
}

const PRODUCT_LABELS: Record<string, string> = {
  kyc: 'KYC', demat: 'Demat', mf: 'MF', insurance: 'Insurance', pms: 'PMS', algo: 'Algo',
};

const SOURCES = ['manual', 'referral', 'whatsapp', 'walk_in', 'social', 'webinar'];

function deadlineLabel(d?: string | null) {
  if (!d) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  if (d < today) return { text: `Overdue ${Math.abs(diff)}d`, cls: 'text-red-500 bg-red-50 dark:bg-red-900/20' };
  if (diff <= 3) return { text: `Due in ${diff}d`, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' };
  return { text: new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), cls: 'text-slate-500 bg-slate-100 dark:bg-slate-800' };
}

function initials(name?: string) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
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
  const queryClient = useQueryClient();
  const dragLeadId = useRef<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addStage, setAddStage] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<{ existingLeadId: string; existingName: string } | null>(null);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', source: 'manual', notes: '',
    assignedTo: '', closureDeadline: '', tags: '', productInterest: [] as string[],
  });

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  const { data: leadsData, isLoading } = useQuery({
    queryKey: ['crm-leads'],
    queryFn: () => apiFetch<{ success: boolean; leads: Lead[] }>('/api/crm/leads'),
    staleTime: 30_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) => ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role));

  const addMutation = useMutation({
    mutationFn: async (body: typeof form & { stage: string }) => {
      try {
        return await apiFetch('/api/crm/leads', {
          method: 'POST',
          retries: 0,
          body: JSON.stringify({
            ...body,
            tags: body.tags ? body.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
            assignedToName: employees.find((e) => e.id === body.assignedTo)?.name,
          }),
        });
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 409) {
          const b = err.body ?? {};
          setDuplicateWarning({
            existingLeadId: (b.existingLeadId as string) ?? '',
            existingName: (b.existingName as string) ?? 'an existing lead',
          });
        }
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
      setShowAddForm(false);
      setDuplicateWarning(null);
      setForm({ name: '', phone: '', email: '', source: 'manual', notes: '', assignedTo: '', closureDeadline: '', tags: '', productInterest: [] });
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-leads'] }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ leadId, assignedTo }: { leadId: string; assignedTo: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo, assignedToName: employees.find((e) => e.id === assignedTo)?.name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-leads'] }),
  });

  const leads = leadsData?.leads ?? [];
  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !search || l.name.toLowerCase().includes(q) || l.phone.includes(q) || l.email?.toLowerCase().includes(q);
    const matchAssignee = !filterAssignee || l.assignedTo === filterAssignee;
    return matchSearch && matchAssignee;
  });

  const byStage = Object.fromEntries(stages.map((s) => [s.key, filtered.filter((l) => l.stage === s.key)]));

  const openAdd = (stageKey: string) => {
    setAddStage(stageKey);
    setShowAddForm(true);
  };

  const toggleProduct = (p: string) => {
    setForm((f) => ({
      ...f,
      productInterest: f.productInterest.includes(p) ? f.productInterest.filter((x) => x !== p) : [...f.productInterest, p],
    }));
  };

  return (
    <>
      <Navbar title="CRM" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="flex h-[calc(100vh-56px)] flex-col">

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
              {(['kanban', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400' : 'text-slate-500'}`}>
                  {v === 'kanban' ? '⬛ Kanban' : '☰ List'}
                </button>
              ))}
            </div>

            <input placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />

            <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <option value="">All owners</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>

            <div className="ml-auto flex items-center gap-2">
              <Link href="/admin/crm/settings"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                ⚙ Settings
              </Link>
              <Link href="/admin/crm/import"
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
                ↑ Import CSV
              </Link>
              <button onClick={() => openAdd(stages[0]?.key ?? '')}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">
                + Add Lead
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center"><Loading /></div>
          ) : view === 'kanban' ? (
            // ── Kanban ──────────────────────────────────────────────────────────
            <div className="flex flex-1 gap-0 overflow-x-auto p-4">
              {stages.map((stage) => {
                const colLeads = byStage[stage.key] ?? [];
                return (
                  <div
                    key={stage.key}
                    className={`mr-3 flex w-[220px] flex-shrink-0 flex-col rounded-xl border bg-white transition-colors dark:bg-slate-900 ${dragOverStage === stage.key ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/10' : 'border-slate-200 dark:border-slate-800'}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.key); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverStage(null);
                      const leadId = dragLeadId.current;
                      if (!leadId) return;
                      const lead = leads.find((l) => l.leadId === leadId);
                      if (lead && lead.stage !== stage.key) stageMutation.mutate({ leadId, stage: stage.key });
                      dragLeadId.current = null;
                    }}
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between rounded-t-xl px-3 py-2.5" style={{ borderTop: `3px solid ${stage.color}` }}>
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-white">{stage.label}</p>
                        <p className="text-[10px] text-slate-400">{colLeads.length} contacts</p>
                      </div>
                      <button onClick={() => openAdd(stage.key)}
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800">
                        + Add
                      </button>
                    </div>

                    {/* Cards */}
                    <div className="flex flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                      {colLeads.map((lead) => {
                        const dl = deadlineLabel(lead.closureDeadline);
                        return (
                          <Link
                            key={lead.leadId}
                            href={`/admin/crm/${lead.leadId}`}
                            draggable
                            onDragStart={(e) => { dragLeadId.current = lead.leadId; e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnd={() => { dragLeadId.current = null; setDragOverStage(null); }}
                            className="block cursor-grab rounded-lg border border-slate-100 bg-slate-50 p-2.5 transition active:cursor-grabbing hover:border-indigo-200 hover:shadow-sm dark:border-slate-800 dark:bg-slate-800/50">
                            <div className="flex items-start justify-between gap-1">
                              <p className="text-xs font-semibold leading-tight text-slate-900 dark:text-white line-clamp-1">{lead.name}</p>
                              <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[8px] font-bold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
                                {initials(lead.assignedToName)}
                              </div>
                            </div>
                            <p className="mt-0.5 text-[10px] text-slate-400">{lead.phone}</p>

                            {lead.tags?.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {lead.tags.slice(0, 2).map((t) => (
                                  <span key={t} className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400">{t}</span>
                                ))}
                                {lead.tags.length > 2 && <span className="text-[9px] text-slate-400">+{lead.tags.length - 2}</span>}
                              </div>
                            )}

                            <div className="mt-1.5 flex items-center justify-between">
                              {dl ? (
                                <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${dl.cls}`}>{dl.text}</span>
                              ) : (
                                <span className="text-[9px] text-slate-300">{timeSince(lead.updatedAt)}</span>
                              )}
                              <div className="flex gap-1">
                                <button
                                  onClick={(e) => { e.preventDefault(); /* navigate to chat */ }}
                                  className="rounded p-0.5 text-[10px] text-slate-400 hover:text-indigo-500">💬</button>
                              </div>
                            </div>

                            {/* Quick assign */}
                            <select
                              value={lead.assignedTo}
                              onClick={(e) => e.preventDefault()}
                              onChange={(e) => { e.preventDefault(); assignMutation.mutate({ leadId: lead.leadId, assignedTo: e.target.value }); }}
                              className="mt-1.5 w-full rounded border border-slate-200 bg-white py-0.5 text-[9px] text-slate-500 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                              <option value="">Unassigned</option>
                              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // ── List view ────────────────────────────────────────────────────────
            <div className="flex-1 overflow-auto p-4">
              <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      {['Name', 'Phone', 'Tags', 'Stage', 'Assigned', 'Deadline', 'Updated', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} className="py-16 text-center text-sm text-slate-400">No leads found</td></tr>
                    ) : filtered.map((lead) => {
                      const stage = stages.find((s) => s.key === lead.stage);
                      const dl = deadlineLabel(lead.closureDeadline);
                      return (
                        <tr key={lead.leadId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{lead.name}</td>
                          <td className="px-4 py-3 tabular-nums text-slate-500">{lead.phone}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(lead.tags ?? []).slice(0, 2).map((t) => (
                                <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-500 dark:bg-indigo-900/30">{t}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {stage && (
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: stage.color }}>
                                {stage.label}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <select value={lead.assignedTo}
                              onChange={(e) => assignMutation.mutate({ leadId: lead.leadId, assignedTo: e.target.value })}
                              className="rounded border border-slate-200 bg-slate-50 py-1 px-2 text-xs text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              <option value="">Unassigned</option>
                              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            {dl && <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${dl.cls}`}>{dl.text}</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">{timeSince(lead.updatedAt)}</td>
                          <td className="px-4 py-3">
                            <Link href={`/admin/crm/${lead.leadId}`}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700">
                              Open →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Lead Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">New Lead</h2>
              <button onClick={() => { setShowAddForm(false); setDuplicateWarning(null); }} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {/* Duplicate phone warning */}
            {duplicateWarning && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                <span className="mt-0.5 text-amber-500">⚠</span>
                <div className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-300">
                  <span className="font-semibold">Duplicate phone detected.</span> This number already exists as{' '}
                  <span className="font-semibold">{duplicateWarning.existingName}</span>.{' '}
                  {duplicateWarning.existingLeadId && (
                    <Link href={`/admin/crm/${duplicateWarning.existingLeadId}`}
                      className="underline hover:text-amber-600"
                      onClick={() => { setShowAddForm(false); setDuplicateWarning(null); }}>
                      Open existing lead →
                    </Link>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Full Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                <input placeholder="WhatsApp Phone *" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setDuplicateWarning(null); }}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              </div>
              <input placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />

              <div className="grid grid-cols-2 gap-3">
                <select value={addStage} onChange={(e) => setAddStage(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  <option value="">Assign to…</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  {SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <input type="date" value={form.closureDeadline} onChange={(e) => setForm({ ...form, closureDeadline: e.target.value })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              </div>

              <input placeholder="Tags (comma separated, e.g. AI interested, webinar)" value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />

              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PRODUCT_LABELS).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => toggleProduct(key)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium border transition ${form.productInterest.includes(key) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:border-indigo-300 dark:border-slate-700'}`}>
                    {label}
                  </button>
                ))}
              </div>

              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowAddForm(false); setDuplicateWarning(null); }} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
              <button onClick={() => addMutation.mutate({ ...form, stage: addStage })}
                disabled={!form.name || !form.phone || addMutation.isPending}
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
