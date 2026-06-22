'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';

interface Conversation {
  type: 'lead' | 'unknown';
  leadId?: string;
  PK?: string;
  name?: string;
  phone: string;
  stage?: string;
  assignedTo?: string;
  assignedToName?: string;
  lastMessageAt: string;
  lastMessagePreview?: string;
  lastMessageDirection?: 'inbound' | 'outbound';
}

interface Message {
  SK: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sentByName?: string;
  timestamp: string;
}

interface PipelineStage { key: string; label: string; color: string; }
interface EmployeeRecord { id: string; name: string; role: string; }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function avatar(name?: string, phone?: string) {
  if (name) return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  if (phone) return phone.slice(-2);
  return '?';
}

// ── Add to CRM modal ─────────────────────────────────────────────────────────
function AddToCrmModal({
  phone,
  stages,
  employees,
  onClose,
  onCreated,
}: {
  phone: string;
  stages: PipelineStage[];
  employees: EmployeeRecord[];
  onClose: () => void;
  onCreated: (lead: any) => void;
}) {
  const [name, setName] = useState('');
  const [stage, setStage] = useState(stages[0]?.key ?? '');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setLoading(true);
    setErr('');
    try {
      const res = await apiFetch<{ success: boolean; lead: any }>('/api/crm/leads', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || phone, phone, stage, assignedTo: assignedTo || undefined, source: 'whatsapp' }),
      });
      onCreated(res.lead);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create lead');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-white">Add to CRM</h3>
        <div className="space-y-3">
          <div>
            <p className="mb-0.5 text-xs font-medium text-slate-400">Phone</p>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{phone}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={phone}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Pipeline Stage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Assign to</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="">Unassigned</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {loading ? 'Adding…' : 'Add to CRM'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function WhatsAppInboxPage() {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [search, setSearch] = useState('');
  const [msgText, setMsgText] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: inboxData, isLoading: inboxLoading } = useQuery({
    queryKey: ['wa-inbox'],
    queryFn: () => apiFetch<{ success: boolean; conversations: Conversation[] }>('/api/whatsapp/inbox'),
    refetchInterval: 12_000,
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

  // Messages + lead detail for the selected conversation
  const convKey = selected?.type === 'lead' ? selected.leadId : selected?.phone;
  const { data: convData } = useQuery({
    queryKey: ['wa-conv', convKey],
    queryFn: () =>
      selected!.type === 'lead'
        ? apiFetch<{ success: boolean; lead: any; messages: Message[] }>(`/api/crm/leads/${selected!.leadId}`)
        : apiFetch<{ success: boolean; messages: Message[] }>(`/api/whatsapp/inbox/unknown/${selected!.phone}/messages`),
    enabled: !!selected,
    refetchInterval: 8_000,
    staleTime: 0,
  });

  const conversations = inboxData?.conversations ?? [];
  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role)
  );
  const messages: Message[] = (convData as any)?.messages ?? [];
  const currentLead = selected?.type === 'lead' ? (convData as any)?.lead : null;

  const liveStage = currentLead?.stage ?? selected?.stage;
  const liveAssignedTo = currentLead?.assignedTo ?? selected?.assignedTo ?? '';
  const stageObj = stages.find((s) => s.key === liveStage);

  const filtered = conversations.filter(
    (c) =>
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['wa-conv', convKey] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ leadId, assignedTo }: { leadId: string; assignedTo: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo, assignedToName: employees.find((e) => e.id === assignedTo)?.name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['wa-conv', convKey] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      selected!.type === 'lead'
        ? apiFetch('/api/whatsapp/send', {
            method: 'POST',
            body: JSON.stringify({ leadPK: selected!.PK, message: msgText }),
          })
        : apiFetch(`/api/whatsapp/inbox/unknown/${selected!.phone}/send`, {
            method: 'POST',
            body: JSON.stringify({ message: msgText }),
          }),
    onSuccess: () => {
      setMsgText('');
      queryClient.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      queryClient.invalidateQueries({ queryKey: ['wa-inbox'] });
    },
  });

  return (
    <>
      <Navbar title="WhatsApp Inbox" />
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-slate-50 dark:bg-slate-950">

        {/* ── Left: conversation list ─────────────────────────────────────── */}
        <div className={`flex w-full flex-shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:w-80 ${selected ? 'hidden md:flex' : 'flex'}`}>
          <div className="border-b border-slate-100 p-3 dark:border-slate-800">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          </div>

          <div className="flex-1 divide-y divide-slate-50 overflow-y-auto dark:divide-slate-800/50">
            {inboxLoading && (
              <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
            )}
            {!inboxLoading && filtered.length === 0 && (
              <div className="p-8 text-center">
                <div className="mb-2 text-4xl">💬</div>
                <p className="text-sm text-slate-400">
                  {conversations.length === 0 ? 'No WhatsApp conversations yet.' : 'No matches.'}
                </p>
                {conversations.length === 0 && (
                  <p className="mt-1 text-xs text-slate-300 dark:text-slate-600">
                    Connect WhatsApp in CRM Settings to start receiving messages.
                  </p>
                )}
              </div>
            )}

            {filtered.map((conv) => {
              const key = conv.type === 'lead' ? conv.leadId! : `unk-${conv.phone}`;
              const stage = stages.find((s) => s.key === conv.stage);
              const isActive = selected
                ? conv.type === 'lead'
                  ? selected.leadId === conv.leadId
                  : selected.phone === conv.phone && selected.type === 'unknown'
                : false;

              return (
                <button key={key} onClick={() => { setSelected(conv); setMsgText(''); }}
                  className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/10' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${conv.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                    {avatar(conv.name, conv.phone)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {conv.name ?? conv.phone}
                      </p>
                      {conv.lastMessageAt && (
                        <span className="flex-shrink-0 text-[10px] text-slate-400">{timeAgo(conv.lastMessageAt)}</span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5">
                      {conv.type === 'unknown' && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          New
                        </span>
                      )}
                      {stage && (
                        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white" style={{ backgroundColor: stage.color }}>
                          {stage.label}
                        </span>
                      )}
                    </div>

                    {conv.lastMessagePreview && (
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {conv.lastMessageDirection === 'outbound' ? '↗ ' : ''}
                        {conv.lastMessagePreview}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: chat panel ───────────────────────────────────────────── */}
        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Chat header */}
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => setSelected(null)}
                className="mr-1 flex-shrink-0 text-slate-400 hover:text-slate-600 md:hidden">←</button>

              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${selected.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                {avatar(selected.name ?? currentLead?.name, selected.phone)}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {selected.name ?? currentLead?.name ?? selected.phone}
                </p>
                <p className="text-xs text-slate-400">{selected.phone}</p>
              </div>

              {/* Stage + assign for known leads */}
              {selected.type === 'lead' && (
                <div className="flex flex-shrink-0 items-center gap-2">
                  <select value={liveStage ?? ''}
                    onChange={(e) => stageMutation.mutate({ leadId: selected.leadId!, stage: e.target.value })}
                    style={stageObj ? { borderColor: stageObj.color, color: stageObj.color } : {}}
                    className="rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold outline-none focus:ring-1 dark:bg-slate-800">
                    {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>

                  <select value={liveAssignedTo}
                    onChange={(e) => assignMutation.mutate({ leadId: selected.leadId!, assignedTo: e.target.value })}
                    className="hidden rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white sm:block">
                    <option value="">Unassigned</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>

                  <Link href={`/admin/crm/${selected.leadId}`}
                    className="hidden items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 sm:flex">
                    CRM ↗
                  </Link>
                </div>
              )}

              {selected.type === 'unknown' && (
                <button onClick={() => setShowAdd(true)}
                  className="flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                  + Add to CRM
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="py-12 text-center text-sm text-slate-400">No messages yet.</p>
              )}
              {messages.map((msg) => (
                <div key={msg.SK} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    msg.direction === 'outbound'
                      ? 'rounded-br-sm bg-indigo-600 text-white'
                      : 'rounded-bl-sm bg-white text-slate-900 dark:bg-slate-800 dark:text-white'
                  }`}>
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    <p className={`mt-1 text-[10px] ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {msg.direction === 'outbound' && msg.sentByName ? `${msg.sentByName} · ` : ''}
                      {new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex gap-2">
                <input value={msgText} onChange={(e) => setMsgText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && msgText.trim()) {
                      e.preventDefault();
                      sendMutation.mutate();
                    }
                  }}
                  placeholder={`Message ${selected.name ?? currentLead?.name ?? selected.phone} on WhatsApp…`}
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                <button onClick={() => sendMutation.mutate()}
                  disabled={!msgText.trim() || sendMutation.isPending}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                  {sendMutation.isPending ? '…' : '➤'}
                </button>
              </div>
              {sendMutation.isError && (
                <p className="mt-1 text-xs text-red-500">Failed to send — check WhatsApp connection in CRM Settings.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center md:flex">
            <div className="text-center">
              <div className="mb-3 text-5xl">💬</div>
              <p className="text-slate-400">Select a conversation to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {showAdd && selected?.type === 'unknown' && (
        <AddToCrmModal
          phone={selected.phone}
          stages={stages}
          employees={employees}
          onClose={() => setShowAdd(false)}
          onCreated={(lead) => {
            queryClient.invalidateQueries({ queryKey: ['wa-inbox'] });
            setShowAdd(false);
            setSelected({
              type: 'lead',
              leadId: lead.leadId,
              PK: lead.PK,
              name: lead.name,
              phone: lead.phone,
              stage: lead.stage,
              lastMessageAt: selected.lastMessageAt,
            });
          }}
        />
      )}
    </>
  );
}
