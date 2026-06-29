'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List } from 'lucide-react';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch, ApiClientError } from '@/lib/api';
import { CrmSubNav } from '@/components/layout/CrmSubNav';
import { calculateScore, scoreBadge } from '@/utils/leadScore';
import { useDebounce } from '@/hooks/useDebounce';
import { SkeletonCard, SkeletonRow } from '@/components/common/Skeleton';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

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
  messageCount?: number;
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

const SOURCES = ['manual', 'referral', 'whatsapp', 'walk_in', 'social', 'webinar', 'whatsapp_ai'];
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', referral: 'Referral', whatsapp: 'WhatsApp',
  walk_in: 'Walk-in', social: 'Social', webinar: 'Webinar', whatsapp_ai: 'WA AI',
};

const AVATAR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];
function avatarColor(name?: string) {
  if (!name) return '#94a3b8';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

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
  if (m < 1) return 'Just now';
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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addStage, setAddStage] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<{ existingLeadId: string; existingName: string } | null>(null);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', source: 'manual', notes: '',
    assignedTo: '', closureDeadline: '', tags: '', productInterest: [] as string[],
  });
  const [listPage, setListPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState('');

  const debouncedSearch = useDebounce(search, 300);
  const debouncedAssignee = useDebounce(filterAssignee, 300);

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  // Kanban: all leads (capped at 500 server-side). List: server-paginated with server-side filters.
  const LIST_PAGE_SIZE = 50;
  const { data: leadsData, isLoading } = useQuery({
    queryKey: view === 'list'
      ? ['crm-leads', 'list', listPage, debouncedSearch, debouncedAssignee, dateFrom, dateTo]
      : ['crm-leads', 'kanban'],
    queryFn: () => {
      if (view === 'list') {
        const params = new URLSearchParams({ page: String(listPage), pageSize: String(LIST_PAGE_SIZE) });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (debouncedAssignee) params.set('assignedTo', debouncedAssignee);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        return apiFetch<{ success: boolean; leads: Lead[]; total: number; pages: number; truncated?: boolean }>(`/api/crm/leads?${params}`);
      }
      return apiFetch<{ success: boolean; leads: Lead[]; total: number; truncated?: boolean }>('/api/crm/leads');
    },
    staleTime: 30_000,
    placeholderData: view === 'list' ? (prev: any) => prev : undefined,
  });

  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Array<{ id: string; label: string; color: string }> }>('/api/tags'),
    staleTime: 5 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) => ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role));
  const tagCatalog = tagCatalogData?.tags ?? [];

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
      toast.success('Lead added');
    },
    onError: (err) => {
      if (!(err instanceof ApiClientError && err.status === 409)) toast.error('Failed to add lead');
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onMutate: async ({ leadId, stage }) => {
      await queryClient.cancelQueries({ queryKey: ['crm-leads'] });
      const snapshots = queryClient.getQueriesData<{ leads: Lead[]; total: number }>({ queryKey: ['crm-leads'] });
      queryClient.setQueriesData({ queryKey: ['crm-leads'] }, (old: any) => {
        if (!old?.leads) return old;
        return { ...old, leads: old.leads.map((l: Lead) => l.leadId === leadId ? { ...l, stage } : l) };
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]: [any, any]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['crm-leads'] }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ leadId, assignedTo }: { leadId: string; assignedTo: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo, assignedToName: employees.find((e) => e.id === assignedTo)?.name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-leads'] }),
    onError: () => toast.error('Failed to assign lead'),
  });

  const bulkStageMutation = useMutation({
    mutationFn: async ({ leadIds, stage }: { leadIds: string[]; stage: string }) => {
      await Promise.all(leadIds.map((id) => apiFetch(`/api/crm/leads/${id}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-leads'] }); setSelectedIds(new Set()); },
    onError: () => toast.error('Failed to update stages'),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ leadIds, assignedTo }: { leadIds: string[]; assignedTo: string }) => {
      const assignedToName = employees.find((e) => e.id === assignedTo)?.name;
      await Promise.all(leadIds.map((id) =>
        apiFetch(`/api/crm/leads/${id}/assign`, { method: 'PUT', body: JSON.stringify({ assignedTo, assignedToName }) })
      ));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-leads'] }); setSelectedIds(new Set()); },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (leadIds: string[]) => {
      await Promise.all(leadIds.map((id) => apiFetch(`/api/crm/leads/${id}`, { method: 'DELETE' })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-leads'] }); setSelectedIds(new Set()); },
    onError: () => toast.error('Failed to delete leads'),
  });

  // Reset list pagination when filters or view change
  useEffect(() => { setListPage(1); }, [view, debouncedSearch, debouncedAssignee, dateFrom, dateTo]);

  // Escape closes add lead modal
  useEffect(() => {
    if (!showAddForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowAddForm(false); setDuplicateWarning(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddForm]);

  const rawLeads = leadsData?.leads ?? [];
  const totalLeads = leadsData?.total ?? 0;
  const listPages = (leadsData as any)?.pages ?? 1;
  const kanbanTruncated = !!(leadsData as any)?.truncated;
  const tagById = (id: string) => tagCatalog.find((t) => t.id === id);

  // Kanban: client-side filter (instant, no refetch). List: already server-filtered.
  const kanbanFiltered = rawLeads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !search || l.name.toLowerCase().includes(q) || l.phone.includes(q) || l.email?.toLowerCase().includes(q);
    const matchAssignee = !filterAssignee || l.assignedTo === filterAssignee;
    return matchSearch && matchAssignee;
  });

  const byStage = Object.fromEntries(stages.map((s) => [s.key, kanbanFiltered.filter((l) => l.stage === s.key)]));

  const openAdd = (stageKey: string) => {
    setAddStage(stageKey);
    setShowAddForm(true);
  };

  const exportCsv = useCallback(() => {
    const rows = rawLeads.map((l) => ({
      Name: l.name,
      Phone: l.phone,
      Email: l.email ?? '',
      Stage: stages.find((s) => s.key === l.stage)?.label ?? l.stage,
      Assigned: l.assignedToName ?? '',
      Deadline: l.closureDeadline ?? '',
      Source: l.source ?? '',
      Updated: new Date(l.updatedAt).toLocaleDateString('en-IN'),
    }));
    const headers = Object.keys(rows[0] ?? {});
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => `"${(r as any)[h]}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [rawLeads, stages]);

  const toggleProduct = (p: string) => {
    setForm((f) => ({
      ...f,
      productInterest: f.productInterest.includes(p) ? f.productInterest.filter((x) => x !== p) : [...f.productInterest, p],
    }));
  };

  return (
    <ErrorBoundary>
    <>
      <Navbar title="CRM" showBack />
      <CrmSubNav />
      <div className="bg-slate-50 dark:bg-slate-950">
        <div className="flex h-[calc(100vh-97px)] flex-col">

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
              <button onClick={() => setView('kanban')}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700'}`}>
                <LayoutGrid className="h-3.5 w-3.5" />Kanban
              </button>
              <button onClick={() => setView('list')}
                className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700'}`}>
                <List className="h-3.5 w-3.5" />List
              </button>
            </div>

            <input placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />

            {view === 'list' && (
              <div className="flex items-center gap-1">
                <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setListPage(1); }}
                  title="Created from"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" />
                <span className="text-xs text-slate-400">–</span>
                <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setListPage(1); }}
                  title="Created to"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" />
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(''); setDateTo(''); setListPage(1); }}
                    className="flex items-center gap-0.5 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                    Clear dates
                  </button>
                )}
              </div>
            )}

            <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <option value="">All owners</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>

            <div className="ml-auto flex items-center gap-2">
              {view === 'list' && rawLeads.length > 0 && (
                <button onClick={exportCsv}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  ↓ CSV
                </button>
              )}
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

          {/* Kanban truncated warning — shown when >500 leads exist */}
          {!isLoading && view === 'kanban' && kanbanTruncated && (
            <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs dark:border-amber-900/30 dark:bg-amber-900/10">
              <span className="text-amber-500">⚠</span>
              <span className="text-amber-700 dark:text-amber-400">
                Showing first 500 of {totalLeads} leads.{' '}
                <button className="font-semibold underline" onClick={() => setView('list')}>Switch to List view</button>
                {' '}with search/filters to see all.
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-1 gap-0 overflow-x-auto p-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="mr-3 flex w-[280px] flex-shrink-0 flex-col rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-2 h-8 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((j) => <SkeletonCard key={j} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : view === 'kanban' ? (
            // ── Kanban ──────────────────────────────────────────────────────────
            <div className="flex flex-1 gap-0 overflow-x-auto p-4">
              {stages.map((stage) => {
                const colLeads = byStage[stage.key] ?? [];
                const todayStr = new Date().toISOString().slice(0, 10);
                const overdueCount = colLeads.filter((l) => l.closureDeadline && l.closureDeadline < todayStr).length;
                const stageIdx = stages.findIndex((s) => s.key === stage.key);
                return (
                  <div
                    key={stage.key}
                    className={`mr-3 flex w-[280px] flex-shrink-0 flex-col overflow-hidden rounded-xl border bg-white transition-colors dark:bg-slate-900 ${dragOverStage === stage.key ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/10' : 'border-slate-200 dark:border-slate-800'}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.key); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverStage(null);
                      const leadId = dragLeadId.current;
                      if (!leadId) return;
                      const lead = rawLeads.find((l) => l.leadId === leadId);
                      if (lead && lead.stage !== stage.key) stageMutation.mutate({ leadId, stage: stage.key });
                      dragLeadId.current = null;
                    }}
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between rounded-t-xl px-3 py-2.5" style={{ borderTop: `3px solid ${stage.color}` }}>
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-white">{stage.label}
                          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            {colLeads.length}
                          </span>
                        </p>
                        {overdueCount > 0
                          ? <p className="text-[10px] font-semibold text-red-500">{overdueCount} overdue</p>
                          : <p className="text-[10px] text-slate-400">0 overdue</p>
                        }
                      </div>
                      <button onClick={() => openAdd(stage.key)}
                        className="rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800">
                        + Add
                      </button>
                    </div>

                    {/* Cards */}
                    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                      {colLeads.map((lead) => {
                        const dl = deadlineLabel(lead.closureDeadline);
                        const score = calculateScore(lead, stages);
                        const scoreColor = score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#3b82f6';
                        const scoreEmoji = score >= 70 ? '🔥' : score >= 40 ? '☀' : '❄';
                        const isAI = lead.source === 'whatsapp_ai';
                        const prevStage = stageIdx > 0 ? stages[stageIdx - 1] : null;
                        const nextStage = stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null;

                        return (
                          <div
                            key={lead.leadId}
                            className="group cursor-grab rounded-xl border border-slate-100 bg-slate-50 shadow-sm transition active:cursor-grabbing hover:border-indigo-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-indigo-700"
                            draggable
                            onDragStart={(e) => { dragLeadId.current = lead.leadId; e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnd={() => { dragLeadId.current = null; setDragOverStage(null); }}
                          >
                            {/* Card body — clickable to open lead */}
                            <Link href={`/admin/contacts/${lead.leadId}?from=crm`} className="block p-3">

                              {/* Name + avatar */}
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold leading-tight text-slate-900 dark:text-white line-clamp-1">{lead.name}</p>
                                <div
                                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                                  style={{ backgroundColor: avatarColor(lead.assignedToName) }}
                                >
                                  {initials(lead.assignedToName)}
                                </div>
                              </div>

                              {/* Phone */}
                              <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{lead.phone}</p>

                              {/* Tags + AI badge */}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {isAI && (
                                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
                                    🤖 AI
                                  </span>
                                )}
                                {lead.productInterest?.slice(0, 1).map((p) => (
                                  <span key={p} className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-600 dark:bg-sky-900/20 dark:text-sky-400">
                                    {PRODUCT_LABELS[p] ?? p}
                                  </span>
                                ))}
                                {lead.tags?.slice(0, 2).map((t) => {
                                  const tag = tagById(t);
                                  return (
                                    <span key={t} className="rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                                      style={{ backgroundColor: tag?.color ?? '#6366f1' }}>
                                      {tag?.label ?? t}
                                    </span>
                                  );
                                })}
                                {(lead.tags?.length ?? 0) > 2 && (
                                  <span className="text-[9px] text-slate-400">+{(lead.tags?.length ?? 0) - 2}</span>
                                )}
                              </div>

                              {/* Score bar */}
                              <div className="mt-2.5 flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${score}%`, backgroundColor: scoreColor }}
                                  />
                                </div>
                                <span className="text-[10px] font-bold tabular-nums" style={{ color: scoreColor }}>
                                  {scoreEmoji} {score}
                                </span>
                              </div>

                              {/* Footer: time + deadline + msg count */}
                              <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                                <span>{timeSince(lead.updatedAt)}</span>
                                {lead.messageCount != null && (
                                  <span className="flex items-center gap-0.5">
                                    <span>💬</span>{lead.messageCount}
                                  </span>
                                )}
                                {dl && <span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${dl.cls}`}>{dl.text}</span>}
                              </div>
                              {/* Workspace CTA — signals this card opens Customer 360 */}
                              <div className="mt-1.5 flex items-center justify-end border-t border-slate-100 pt-1.5 dark:border-slate-700/60">
                                <span className="text-[10px] font-semibold text-indigo-300 transition-colors group-hover:text-indigo-500 dark:text-indigo-800 dark:group-hover:text-indigo-400">
                                  Customer 360 ↗
                                </span>
                              </div>
                            </Link>

                            {/* Action bar — stays outside Link */}
                            <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1.5 dark:border-slate-800">
                              {/* ← Prev stage */}
                              <button
                                onClick={() => prevStage && stageMutation.mutate({ leadId: lead.leadId, stage: prevStage.key })}
                                disabled={!prevStage || stageMutation.isPending}
                                title={prevStage ? `← ${prevStage.label}` : undefined}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25 dark:hover:bg-slate-700"
                              >
                                ←
                              </button>

                              {/* WhatsApp — opens internal inbox for this lead */}
                              <Link
                                href={`/admin/whatsapp?leadId=${lead.leadId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] py-1.5 text-[11px] font-bold text-white transition hover:bg-[#1ebe5d]"
                              >
                                <svg className="h-3 w-3 fill-white flex-shrink-0" viewBox="0 0 24 24">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                                </svg>
                                WhatsApp
                              </Link>

                              {/* Call */}
                              <a
                                href={`tel:${lead.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                title="Call"
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20"
                              >
                                📞
                              </a>

                              {/* → Next stage */}
                              <button
                                onClick={() => nextStage && stageMutation.mutate({ leadId: lead.leadId, stage: nextStage.key })}
                                disabled={!nextStage || stageMutation.isPending}
                                title={nextStage ? `${nextStage.label} →` : undefined}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-25 dark:hover:bg-slate-700"
                              >
                                →
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // ── List view ────────────────────────────────────────────────────────
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-auto p-4">
                {selectedIds.size > 0 && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 dark:border-indigo-900/30 dark:bg-indigo-900/10">
                    <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{selectedIds.size} selected</span>
                    <select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}
                      className="ml-2 rounded border border-indigo-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-indigo-700 dark:bg-slate-800 dark:text-white">
                      <option value="">Move to stage…</option>
                      {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <button onClick={() => { if (bulkStage) bulkStageMutation.mutate({ leadIds: [...selectedIds], stage: bulkStage }); }}
                      disabled={!bulkStage || bulkStageMutation.isPending}
                      className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                      Apply
                    </button>
                    <button onClick={() => { if (confirm(`Delete ${selectedIds.size} leads? This cannot be undone.`)) bulkDeleteMutation.mutate([...selectedIds]); }}
                      disabled={bulkDeleteMutation.isPending}
                      className="ml-auto rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
                      Delete {selectedIds.size}
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-3"><input type="checkbox" className="rounded" checked={selectedIds.size === rawLeads.length && rawLeads.length > 0} onChange={(e) => setSelectedIds(e.target.checked ? new Set(rawLeads.map((l) => l.leadId)) : new Set())} /></th>
                      {['Name', 'Phone', 'Score', 'Stage', 'Assigned', 'Deadline', 'Updated', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                    {isLoading ? (
                      [1,2,3,4,5].map((i) => <SkeletonRow key={i} />)
                    ) : rawLeads.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-16 text-center">
                          <p className="mb-2 text-4xl">📋</p>
                          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {debouncedSearch || debouncedAssignee || dateFrom || dateTo ? 'No leads match the current filters' : 'No leads yet'}
                          </p>
                          {!debouncedSearch && !debouncedAssignee && !dateFrom && !dateTo && (
                            <button onClick={() => openAdd(stages[0]?.key ?? '')}
                              className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                              + Add your first lead
                            </button>
                          )}
                        </td>
                      </tr>
                    ) : rawLeads.map((lead) => {
                      const stage = stages.find((s) => s.key === lead.stage);
                      const dl = deadlineLabel(lead.closureDeadline);
                      return (
                        <tr key={lead.leadId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3"><input type="checkbox" className="rounded" checked={selectedIds.has(lead.leadId)} onChange={(e) => { const next = new Set(selectedIds); e.target.checked ? next.add(lead.leadId) : next.delete(lead.leadId); setSelectedIds(next); }} /></td>
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{lead.name}</td>
                          <td className="px-4 py-3 tabular-nums text-slate-500">{lead.phone}</td>
                          <td className="px-4 py-3">
                            {(() => { const s = scoreBadge(calculateScore(lead, stages)); return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>; })()}
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
                            <Link href={`/admin/contacts/${lead.leadId}?from=crm`}
                              className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40">
                              Customer 360 →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
              {/* List pagination */}
              {listPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs text-slate-500">{totalLeads} leads total</p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setListPage((p) => p - 1)} disabled={listPage === 1}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
                      ‹ Prev
                    </button>
                    <span className="px-2 text-xs text-slate-500">{listPage} / {listPages}</span>
                    <button onClick={() => setListPage((p) => p + 1)} disabled={listPage === listPages}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
                      Next ›
                    </button>
                  </div>
                </div>
              )}
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
                    <Link href={`/admin/contacts/${duplicateWarning.existingLeadId}?from=crm`}
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
                <div>
                  <input placeholder="10-digit mobile *" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setDuplicateWarning(null); }}
                    className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:bg-slate-800 dark:text-white ${form.phone && form.phone.replace(/\D/g, '').length !== 10 ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-700'}`} />
                  {form.phone && form.phone.replace(/\D/g, '').length !== 10 && (
                    <p className="mt-0.5 text-[10px] text-red-500">Enter 10-digit mobile number</p>
                  )}
                </div>
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
                  {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s] ?? s}</option>)}
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
              <button onClick={() => addMutation.mutate({ ...form, phone: form.phone.replace(/\D/g, ''), stage: addStage })}
                disabled={!form.name.trim() || form.phone.replace(/\D/g, '').length !== 10 || addMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {addMutation.isPending ? 'Adding…' : 'Add Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
    </ErrorBoundary>
  );
}
