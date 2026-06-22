'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';

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
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string;
}

interface Message {
  SK: string;
  messageId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  type: string;
  sentBy?: string;
  sentByName?: string;
  timestamp: string;
  waMessageId?: string;
}

interface LeadDetailResponse {
  success: boolean;
  lead: Lead;
  messages: Message[];
}

interface Followup {
  PK: string;
  SK: string;
  leadId: string;
  date: string;
  note: string;
  assignedTo: string;
  done: boolean;
}

const STAGES = [
  { key: 'new',        label: 'New' },
  { key: 'contacted',  label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'kyc_done',   label: 'KYC Done' },
  { key: 'demat_done', label: 'Demat Done' },
  { key: 'converted',  label: 'Converted' },
  { key: 'churned',    label: 'Churned' },
];

const PRODUCTS = ['kyc', 'demat', 'mf', 'insurance', 'pms', 'algo'];
const PRODUCT_LABELS: Record<string, string> = {
  kyc: 'KYC', demat: 'Demat', mf: 'MF', insurance: 'Insurance', pms: 'PMS', algo: 'Algo',
};

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-slate-100 text-slate-600',
  contacted: 'bg-blue-100 text-blue-600',
  interested: 'bg-violet-100 text-violet-600',
  kyc_done: 'bg-amber-100 text-amber-700',
  demat_done: 'bg-orange-100 text-orange-700',
  converted: 'bg-emerald-100 text-emerald-700',
  churned: 'bg-red-100 text-red-500',
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [msgText, setMsgText] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});
  const [fuDate, setFuDate] = useState('');
  const [fuNote, setFuNote] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'followups' | 'info'>('chat');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-lead', id],
    queryFn: () => apiFetch<LeadDetailResponse>(`/api/crm/leads/${id}`),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const { data: followupsData } = useQuery({
    queryKey: ['crm-followups', id],
    queryFn: () => apiFetch<{ success: boolean; followups: Followup[] }>(`/api/crm/followups?days=30`),
    staleTime: 30_000,
  });

  const lead = data?.lead;
  const messages = data?.messages ?? [];
  const followups = (followupsData?.followups ?? []).filter((f) => f.leadId === id);

  useEffect(() => {
    if (lead) setEditForm({ name: lead.name, phone: lead.phone, email: lead.email, notes: lead.notes, productInterest: lead.productInterest });
  }, [lead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const stageMutation = useMutation({
    mutationFn: (stage: string) => apiFetch(`/api/crm/leads/${id}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-lead', id] }),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Lead>) => apiFetch(`/api/crm/leads/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-lead', id] }); setEditing(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/crm/leads/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-leads'] }); router.push('/admin/crm'); },
  });

  const sendMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ leadPK: lead?.PK, message: msgText }) }),
    onSuccess: () => { setMsgText(''); queryClient.invalidateQueries({ queryKey: ['crm-lead', id] }); },
  });

  const followupMutation = useMutation({
    mutationFn: () => apiFetch(`/api/crm/leads/${id}/followup`, { method: 'POST', body: JSON.stringify({ date: fuDate, note: fuNote }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-followups', id] }); setFuDate(''); setFuNote(''); },
  });

  const doneMutation = useMutation({
    mutationFn: ({ date, leadId }: { date: string; leadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${leadId}/done`, { method: 'PUT' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-followups', id] }),
  });

  if (isLoading) return <><Navbar title="Lead" showBack /><div className="flex justify-center py-20"><Loading /></div></>;
  if (!lead) return <><Navbar title="Lead" showBack /><p className="p-8 text-center text-slate-400">Lead not found.</p></>;

  const toggleProduct = (p: string) => {
    const cur = editForm.productInterest ?? [];
    setEditForm({ ...editForm, productInterest: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  };

  return (
    <>
      <Navbar title={lead.name} showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl p-4 pb-10">

          {/* Lead header card */}
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">{lead.name}</h1>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_COLORS[lead.stage]}`}>
                    {STAGES.find((s) => s.key === lead.stage)?.label}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">📱 {lead.phone}{lead.email ? ` · ✉ ${lead.email}` : ''}</p>
                {lead.productInterest?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lead.productInterest.map((p) => (
                      <span key={p} className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {PRODUCT_LABELS[p] ?? p}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Stage selector */}
              <div className="flex items-center gap-2">
                <select
                  value={lead.stage}
                  onChange={(e) => stageMutation.mutate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button onClick={() => setEditing(!editing)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  {editing ? 'Cancel' : '✏️ Edit'}
                </button>
                <button onClick={() => { if (confirm('Delete this lead?')) deleteMutation.mutate(); }}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-500 hover:bg-red-100 dark:border-red-900 dark:bg-red-900/20">
                  🗑
                </button>
              </div>
            </div>

            {/* Edit form */}
            {editing && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="grid grid-cols-2 gap-3">
                  <input value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="Name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <input value={editForm.phone ?? ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    placeholder="Phone" className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
                <input value={editForm.email ?? ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  placeholder="Email" className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white w-full" />
                <div className="flex flex-wrap gap-2">
                  {PRODUCTS.map((p) => (
                    <button key={p} onClick={() => toggleProduct(p)}
                      className={`rounded-full px-3 py-1 text-xs font-medium border transition ${(editForm.productInterest ?? []).includes(p) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-500 hover:border-indigo-300'}`}>
                      {PRODUCT_LABELS[p]}
                    </button>
                  ))}
                </div>
                <textarea value={editForm.notes ?? ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Notes" rows={2}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                <button onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="mb-4 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {(['chat', 'followups', 'info'] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${activeTab === t ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                {t === 'chat' ? '💬 Chat' : t === 'followups' ? '📅 Follow-ups' : 'ℹ️ Info'}
              </button>
            ))}
          </div>

          {/* Chat tab */}
          {activeTab === 'chat' && (
            <div className="flex flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={{ height: '60vh' }}>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <p className="py-10 text-center text-sm text-slate-400">No messages yet. Send the first one!</p>
                )}
                {messages.map((msg) => (
                  <div key={msg.SK} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      msg.direction === 'outbound'
                        ? 'rounded-br-sm bg-indigo-600 text-white'
                        : 'rounded-bl-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                    }`}>
                      <p>{msg.content}</p>
                      <p className={`mt-1 text-[10px] ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {msg.direction === 'outbound' && msg.sentByName ? `${msg.sentByName} · ` : ''}
                        {new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Message input */}
              <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                <div className="flex gap-2">
                  <input
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && msgText.trim()) { e.preventDefault(); sendMutation.mutate(); } }}
                    placeholder={`Message ${lead.name} on WhatsApp…`}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    onClick={() => sendMutation.mutate()}
                    disabled={!msgText.trim() || sendMutation.isPending}
                    className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {sendMutation.isPending ? '…' : '➤'}
                  </button>
                </div>
                {sendMutation.isError && <p className="mt-1 text-xs text-red-500">Failed to send. Check WhatsApp configuration.</p>}
              </div>
            </div>
          )}

          {/* Follow-ups tab */}
          {activeTab === 'followups' && (
            <div className="space-y-4">
              {/* Add follow-up */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Schedule Follow-up</p>
                <div className="flex gap-2">
                  <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <input value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="Note (optional)"
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <button onClick={() => followupMutation.mutate()} disabled={!fuDate || followupMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    Add
                  </button>
                </div>
              </div>

              {/* Follow-up list */}
              <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {followups.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-400">No follow-ups scheduled.</p>
                ) : (
                  <div className="divide-y divide-slate-50 dark:divide-slate-800/50">
                    {followups.map((fu) => (
                      <div key={fu.SK} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className={`text-sm font-medium ${fu.done ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>
                            {new Date(fu.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </p>
                          {fu.note && <p className="text-xs text-slate-400">{fu.note}</p>}
                        </div>
                        {!fu.done && (
                          <button onClick={() => doneMutation.mutate({ date: fu.date, leadId: id })}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20">
                            Done ✓
                          </button>
                        )}
                        {fu.done && <span className="text-xs text-emerald-500">✓ Done</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Info tab */}
          {activeTab === 'info' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
              {[
                ['Source', lead.source],
                ['Created', new Date(lead.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })],
                ['Last updated', new Date(lead.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })],
                ...(lead.convertedAt ? [['Converted', new Date(lead.convertedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })] as [string, string]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-50 pb-2 text-sm dark:border-slate-800">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{value}</span>
                </div>
              ))}
              {lead.notes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{lead.notes}</p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
