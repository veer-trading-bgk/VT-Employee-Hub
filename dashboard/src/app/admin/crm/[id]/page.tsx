'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import type { PipelineStage } from '../page';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Lead {
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
  chatStatus?: 'open' | 'unassigned' | 'resolved';
  lastInboundAt?: string | null;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string;
}

interface Message {
  SK: string;
  direction?: 'inbound' | 'outbound';
  content: string;
  sentByName?: string;
  authorName?: string;
  timestamp: string;
  type?: string;
}

interface EmployeeRecord { id: string; name: string; role: string; }

const PRODUCTS = ['kyc', 'demat', 'mf', 'insurance', 'pms', 'algo'];
const PRODUCT_LABELS: Record<string, string> = {
  kyc: 'KYC', demat: 'Demat', mf: 'MF', insurance: 'Insurance', pms: 'PMS', algo: 'Algo',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', import: 'Import', whatsapp: 'WhatsApp', referral: 'Referral',
  website: 'Website', facebook: 'Facebook', instagram: 'Instagram',
};

function is24hExpired(lastInboundAt?: string | null) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() > 24 * 3_600_000;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CHAT_STATUS_STYLE: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unassigned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [msgText, setMsgText] = useState('');
  const [inputMode, setInputMode] = useState<'reply' | 'note'>('reply');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});
  const [fuDate, setFuDate] = useState('');
  const [fuNote, setFuNote] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'followups' | 'info'>('chat');
  const [newTag, setNewTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['crm-lead', id],
    queryFn: () => apiFetch<{ success: boolean; lead: Lead; messages: Message[]; internalNotes: Message[] }>(`/api/crm/leads/${id}`),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 10 * 60_000,
  });

  const { data: followupsData } = useQuery({
    queryKey: ['crm-followups', id],
    queryFn: () => apiFetch<{ success: boolean; followups: any[] }>(`/api/crm/followups?days=30&leadId=${id}`),
    staleTime: 30_000,
  });

  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Array<{ id: string; label: string; color: string }> }>('/api/tags'),
    staleTime: 5 * 60_000,
  });

  const lead = data?.lead;
  const rawMessages = data?.messages ?? [];
  const rawNotes = data?.internalNotes ?? [];
  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role)
  );
  const followups = followupsData?.followups ?? [];
  const tagCatalog = tagCatalogData?.tags ?? [];
  const tagById = (tid: string) => tagCatalog.find((t) => t.id === tid);
  const currentStage = stages.find((s) => s.key === lead?.stage);
  const windowExpired = is24hExpired(lead?.lastInboundAt);
  const chatStatus = lead?.chatStatus ?? (lead?.assignedTo ? 'open' : 'unassigned');

  // Merged timeline sorted by timestamp
  const timeline = [
    ...rawMessages.map((m) => ({ ...m, _kind: 'message' as const })),
    ...rawNotes.map((n) => ({ ...n, _kind: 'note' as const })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  useEffect(() => {
    if (lead) {
      setEditForm({
        name: lead.name,
        phone: lead.phone,
        email: lead.email ?? '',
        notes: lead.notes,
        productInterest: lead.productInterest ?? [],
        tags: lead.tags ?? [],
        closureDeadline: lead.closureDeadline ?? '',
      });
    }
  }, [lead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline.length]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm-lead', id] });

  const stageMutation = useMutation({
    mutationFn: (stage: string) => apiFetch(`/api/crm/leads/${id}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: invalidate,
  });

  const assignMutation = useMutation({
    mutationFn: (assignedTo: string) =>
      apiFetch(`/api/crm/leads/${id}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo, assignedToName: employees.find((e) => e.id === assignedTo)?.name }),
      }),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Lead>) => apiFetch(`/api/crm/leads/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); setEditing(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/crm/leads/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-leads'] }); router.push('/admin/crm'); },
  });

  const sendMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ leadPK: lead?.PK, message: msgText }) }),
    onSuccess: () => { setMsgText(''); invalidate(); },
  });

  const noteMutation = useMutation({
    mutationFn: (content: string) => apiFetch(`/api/whatsapp/inbox/${id}/note`, { method: 'POST', body: JSON.stringify({ content }) }),
    onSuccess: () => { setMsgText(''); invalidate(); },
  });

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/api/whatsapp/inbox/${id}/resolve`, { method: 'PUT' }),
    onSuccess: invalidate,
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiFetch(`/api/whatsapp/inbox/${id}/reopen`, { method: 'PUT' }),
    onSuccess: invalidate,
  });

  const followupMutation = useMutation({
    mutationFn: () => apiFetch(`/api/crm/leads/${id}/followup`, { method: 'POST', body: JSON.stringify({ date: fuDate, note: fuNote }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm-followups', id] }); setFuDate(''); setFuNote(''); },
  });

  const doneMutation = useMutation({
    mutationFn: ({ date, leadId }: { date: string; leadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${leadId}/done`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-followups', id] }),
  });

  async function handleAddTag() {
    const label = newTag.trim();
    if (!label || addingTag) return;
    setAddingTag(true);
    try {
      let tagId: string;
      const found = tagCatalog.find((t) => t.label.toLowerCase() === label.toLowerCase());
      if (found) {
        tagId = found.id;
      } else {
        const res = await apiFetch<{ success: boolean; tag: { id: string } }>('/api/tags', {
          method: 'POST',
          body: JSON.stringify({ label, color: '#6366f1' }),
        });
        tagId = res.tag.id;
        qc.invalidateQueries({ queryKey: ['tag-catalog'] });
      }
      if (!(lead?.tags ?? []).includes(tagId)) {
        updateMutation.mutate({ tags: [...(lead?.tags ?? []), tagId] } as any);
      }
      setNewTag('');
    } catch { /* silent */ } finally { setAddingTag(false); }
  }

  function handleSend() {
    if (!msgText.trim()) return;
    if (inputMode === 'note') noteMutation.mutate(msgText);
    else sendMutation.mutate();
  }

  const isSending = sendMutation.isPending || noteMutation.isPending;
  const canSend = msgText.trim().length > 0 && !isSending && (inputMode === 'note' || !windowExpired);

  if (isLoading) return <><Navbar title="Lead" showBack /><div className="flex justify-center py-20"><Loading /></div></>;
  if (!lead) return <><Navbar title="Lead" showBack /><p className="p-8 text-center text-slate-400">Lead not found.</p></>;

  return (
    <>
      <Navbar title={lead.name} showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl p-4 pb-10">

          {/* ── Header card ──────────────────────────────────────────────── */}
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-4">

              {/* Left — identity */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">{lead.name}</h1>
                  {currentStage && (
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: currentStage.color }}>
                      {currentStage.label}
                    </span>
                  )}
                  {chatStatus && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${CHAT_STATUS_STYLE[chatStatus] ?? ''}`}>
                      {chatStatus}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-500">
                  <span>📱 {lead.phone}</span>
                  {lead.email && <span>✉ {lead.email}</span>}
                  {lead.source && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-500 dark:bg-slate-800">{SOURCE_LABELS[lead.source] ?? lead.source}</span>}
                </div>

                {/* Product interest chips */}
                {(lead.productInterest ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(lead.productInterest ?? []).map((p) => (
                      <span key={p} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {PRODUCT_LABELS[p] ?? p}
                      </span>
                    ))}
                  </div>
                )}

                {/* Tags */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(lead.tags ?? []).map((t) => {
                    const tag = tagById(t);
                    return (
                      <span key={t} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: tag?.color ?? '#6366f1' }}>
                        {tag?.label ?? t}
                        <button onClick={() => updateMutation.mutate({ tags: (lead.tags ?? []).filter((x) => x !== t) } as any)}
                          className="opacity-70 hover:opacity-100">×</button>
                      </span>
                    );
                  })}
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(); }}
                    disabled={addingTag}
                    placeholder="+ tag"
                    className="h-6 w-16 rounded-full border border-dashed border-slate-300 bg-transparent px-2 text-xs text-slate-500 outline-none focus:border-indigo-400 disabled:opacity-50 dark:border-slate-600" />
                </div>

                {lead.closureDeadline && (
                  <p className="mt-1.5 text-xs text-slate-400">
                    🗓 Closure: {new Date(lead.closureDeadline + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>

              {/* Right — controls */}
              <div className="flex flex-col gap-2 min-w-[160px]">
                <select value={lead.stage} onChange={(e) => stageMutation.mutate(e.target.value)}
                  style={currentStage ? { borderColor: currentStage.color } : {}}
                  className="rounded-lg border bg-white px-3 py-2 text-sm font-medium outline-none dark:bg-slate-800 dark:text-white">
                  {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>

                <select value={lead.assignedTo}
                  onChange={(e) => assignMutation.mutate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  <option value="">Unassigned</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>

                {/* Chat status actions */}
                <div className="flex gap-1.5">
                  {chatStatus !== 'resolved' ? (
                    <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}
                      className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400">
                      ✓ Resolve
                    </button>
                  ) : (
                    <button onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}
                      className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                      ↺ Reopen
                    </button>
                  )}
                  <button onClick={() => setEditing(!editing)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    {editing ? '✕' : '✏'}
                  </button>
                  <button onClick={() => { if (confirm(`Delete ${lead.name}?`)) deleteMutation.mutate(); }}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20">
                    🗑
                  </button>
                </div>

                {/* WA inbox link */}
                <Link href={`/admin/whatsapp?leadId=${lead.leadId}`}
                  className="rounded-lg border border-slate-200 py-1.5 text-center text-xs text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  Open in Inbox ↗
                </Link>
              </div>
            </div>

            {/* Inline edit form */}
            {editing && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="grid grid-cols-2 gap-3">
                  <input value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="Name"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <input value={editForm.phone ?? ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    placeholder="Phone"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input value={editForm.email ?? ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    placeholder="Email"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <input type="date" value={editForm.closureDeadline ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, closureDeadline: e.target.value })}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRODUCTS.map((p) => (
                    <button key={p} type="button"
                      onClick={() => {
                        const cur = editForm.productInterest ?? [];
                        setEditForm({ ...editForm, productInterest: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
                      }}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${(editForm.productInterest ?? []).includes(p) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}>
                      {PRODUCT_LABELS[p]}
                    </button>
                  ))}
                </div>
                <textarea value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Notes" rows={2}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                <button
                  onClick={() => updateMutation.mutate({ name: editForm.name, phone: editForm.phone, email: editForm.email, notes: editForm.notes, productInterest: editForm.productInterest, closureDeadline: editForm.closureDeadline } as any)}
                  disabled={updateMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>

          {/* ── Tabs ────────────────────────────────────────────────────── */}
          <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {([
              { key: 'chat' as const,      label: '💬 Chat',        count: timeline.length },
              { key: 'followups' as const, label: '📅 Follow-ups',  count: followups.length },
              { key: 'info' as const,      label: 'ℹ Info',         count: undefined },
            ] as { key: 'chat' | 'followups' | 'info'; label: string; count?: number }[]).map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* ── Chat tab ────────────────────────────────────────────────── */}
          {activeTab === 'chat' && (
            <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" style={{ height: '58vh' }}>

              {/* 24h window warning + template picker */}
              {windowExpired && inputMode === 'reply' && !showTemplatePicker && (
                <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                  <span>⚠</span>
                  <p className="flex-1 text-xs text-amber-700 dark:text-amber-400">
                    Customer last replied <strong>{timeAgo(lead.lastInboundAt!)}</strong>. The 24-hour window expired.
                  </p>
                  <button onClick={() => setShowTemplatePicker(true)}
                    className="flex-shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-amber-700">
                    Send Template
                  </button>
                </div>
              )}
              {windowExpired && inputMode === 'reply' && showTemplatePicker && (
                <div className="border-b border-amber-100 p-3 dark:border-amber-900/30">
                  <TemplatePicker
                    leadId={lead.leadId}
                    phone={lead.phone}
                    onSent={() => { setShowTemplatePicker(false); qc.invalidateQueries({ queryKey: ['crm-lead', id] }); }}
                    onCancel={() => setShowTemplatePicker(false)}
                  />
                </div>
              )}

              {/* Timeline */}
              <div className="flex-1 overflow-y-auto space-y-2 p-4">
                {timeline.length === 0 && (
                  <p className="py-10 text-center text-sm text-slate-400">No messages yet. Start the conversation below.</p>
                )}

                {timeline.map((item) => {
                  if (item._kind === 'note') {
                    return (
                      <div key={item.SK} className="flex justify-center">
                        <div className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">🔒 Internal note · {item.authorName ?? 'Team'}</p>
                          <p className="mt-0.5 whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">{item.content}</p>
                          <p className="mt-1 text-[10px] text-amber-500">
                            {new Date(item.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={item.SK} className={`flex ${item.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        item.direction === 'outbound'
                          ? 'rounded-br-sm bg-indigo-600 text-white'
                          : 'rounded-bl-sm bg-slate-100 text-slate-900 shadow-none ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                      }`}>
                        <p className="whitespace-pre-wrap break-words">{item.content}</p>
                        <p className={`mt-1 text-[10px] ${item.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-400'}`}>
                          {item.direction === 'outbound' && item.sentByName ? `${item.sentByName} · ` : ''}
                          {new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="flex-shrink-0 border-t border-slate-100 dark:border-slate-800">
                {/* Reply / Note toggle */}
                <div className="flex border-b border-slate-50 dark:border-slate-800/50">
                  {(['reply', 'note'] as const).map((m) => (
                    <button key={m} onClick={() => { setInputMode(m); setMsgText(''); }}
                      className={`px-4 py-2 text-xs font-semibold capitalize transition ${
                        inputMode === m
                          ? m === 'note' ? 'border-b-2 border-amber-500 text-amber-600' : 'border-b-2 border-indigo-600 text-indigo-600'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}>
                      {m === 'reply' ? '💬 Reply' : '🔒 Note'}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 p-3">
                  <textarea
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && canSend) { e.preventDefault(); handleSend(); } }}
                    disabled={windowExpired && inputMode === 'reply'}
                    rows={1}
                    placeholder={
                      windowExpired && inputMode === 'reply'
                        ? '24h window expired — switch to Note'
                        : inputMode === 'note'
                          ? 'Internal note (not sent to customer)…'
                          : `Message ${lead.name} on WhatsApp…`
                    }
                    className={`flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm outline-none ${
                      inputMode === 'note'
                        ? 'border-amber-200 bg-amber-50 focus:border-amber-400 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-white'
                        : windowExpired
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                          : 'border-slate-200 bg-slate-50 focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
                    }`}
                  />
                  <button onClick={handleSend} disabled={!canSend}
                    className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-40 ${inputMode === 'note' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                    {isSending ? '…' : inputMode === 'note' ? '🔒' : '➤'}
                  </button>
                </div>
                {(sendMutation.isError || noteMutation.isError) && (
                  <p className="px-3 pb-2 text-xs text-red-500">Failed — check WhatsApp connection in CRM Settings.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Follow-ups tab ───────────────────────────────────────────── */}
          {activeTab === 'followups' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Schedule Follow-up</p>
                <div className="flex flex-wrap gap-2">
                  <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} min={new Date().toISOString().slice(0, 10)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <input value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="What to follow up on…"
                    className="flex-1 min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <button onClick={() => followupMutation.mutate()} disabled={!fuDate || followupMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    Add
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                {followups.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <span className="mb-2 text-3xl">📅</span>
                    <p className="text-sm text-slate-400">No follow-ups scheduled for this lead.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
                    {followups.map((fu: any) => {
                      const isPast = fu.date < new Date().toISOString().slice(0, 10);
                      return (
                        <div key={fu.SK} className="flex items-center justify-between px-4 py-3.5">
                          <div>
                            <p className={`text-sm font-semibold ${fu.done ? 'text-slate-400 line-through' : isPast ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>
                              {isPast && !fu.done && '⚠ '}
                              {new Date(fu.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </p>
                            {fu.note && <p className="mt-0.5 text-xs text-slate-400">{fu.note}</p>}
                          </div>
                          {fu.done ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">✓ Done</span>
                          ) : (
                            <button onClick={() => doneMutation.mutate({ date: fu.date, leadId: id })}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-400">
                              Mark Done ✓
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Info tab ─────────────────────────────────────────────────── */}
          {activeTab === 'info' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Contact & Pipeline</p>
                <div className="space-y-2.5">
                  {([
                    ['Source', SOURCE_LABELS[lead.source] ?? lead.source],
                    ['Assigned to', lead.assignedToName || '—'],
                    ['Chat status', chatStatus],
                    ['Products', (lead.productInterest ?? []).map((p) => PRODUCT_LABELS[p] ?? p).join(', ') || '—'],
                    ['Stage', currentStage?.label ?? lead.stage],
                    ...(lead.closureDeadline ? [['Closure deadline', new Date(lead.closureDeadline + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })]] as [string, string][] : []),
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between border-b border-slate-50 pb-2 text-sm last:border-0 dark:border-slate-800">
                      <span className="text-slate-400">{label}</span>
                      <span className="font-medium capitalize text-slate-700 dark:text-slate-300">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Timeline</p>
                <div className="space-y-2.5 text-sm">
                  {([
                    ['Created', new Date(lead.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
                    ['Last updated', new Date(lead.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })],
                    ...(lead.convertedAt ? [['Converted', new Date(lead.convertedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })]] as [string, string][] : []),
                    ...(lead.lastInboundAt ? [['Last WA reply', new Date(lead.lastInboundAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]] as [string, string][] : []),
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between border-b border-slate-50 pb-2 text-sm last:border-0 dark:border-slate-800">
                      <span className="text-slate-400">{label}</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {lead.notes && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">CRM Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{lead.notes}</p>
                </div>
              )}

              {/* WhatsApp status card */}
              <div className={`rounded-2xl border p-4 ${windowExpired ? 'border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-900/10' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-900/10'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{windowExpired ? '⚠' : '✅'}</span>
                  <div>
                    <p className={`text-sm font-semibold ${windowExpired ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                      WhatsApp window {windowExpired ? 'expired' : 'active'}
                    </p>
                    {lead.lastInboundAt && (
                      <p className={`text-xs ${windowExpired ? 'text-amber-600 dark:text-amber-500' : 'text-emerald-600 dark:text-emerald-500'}`}>
                        Last reply: {timeAgo(lead.lastInboundAt)}
                      </p>
                    )}
                    {!lead.lastInboundAt && <p className="text-xs text-slate-400">No inbound messages yet</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
