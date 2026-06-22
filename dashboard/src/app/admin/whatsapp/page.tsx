'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
type ChatStatus = 'open' | 'unassigned' | 'resolved';

interface Conversation {
  type: 'lead' | 'unknown';
  leadId?: string;
  PK?: string;
  name?: string;
  phone: string;
  email?: string | null;
  source?: string | null;
  stage?: string | null;
  tags?: string[];
  notes?: string;
  assignedTo?: string | null;
  assignedToName?: string | null;
  chatStatus: ChatStatus;
  lastMessageAt: string;
  lastMessagePreview?: string;
  lastMessageDirection?: 'inbound' | 'outbound';
  lastInboundAt?: string | null;
  createdAt?: string | null;
}

interface Message {
  SK: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sentByName?: string;
  timestamp: string;
  type?: string;
  authorName?: string;
}

interface PipelineStage { key: string; label: string; color: string; }
interface EmployeeRecord { id: string; name: string; role: string; }
interface CannedResponse { id: string; title: string; body: string; shortcut?: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function avatarLetters(name?: string | null, phone?: string) {
  if (name) return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return (phone ?? '??').slice(-2);
}

function is24hExpired(lastInboundAt?: string | null) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() > 24 * 3_600_000;
}

const STATUS_COLORS: Record<ChatStatus, string> = {
  open: 'bg-emerald-500',
  unassigned: 'bg-amber-400',
  resolved: 'bg-slate-300',
};

// ── Canned Response Picker ────────────────────────────────────────────────────
function CannedPicker({
  responses, filter, onSelect, onClose,
}: {
  responses: CannedResponse[];
  filter: string;
  onSelect: (body: string) => void;
  onClose: () => void;
}) {
  const filtered = responses.filter(
    (r) => !filter || r.title.toLowerCase().includes(filter) || (r.shortcut ?? '').includes(filter)
  );
  if (filtered.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-full max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {filtered.map((r) => (
        <button key={r.id} onClick={() => onSelect(r.body)}
          className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">{r.title}</span>
            {r.shortcut && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-mono text-slate-500 dark:bg-slate-800">/{r.shortcut}</span>}
          </div>
          <span className="truncate text-xs text-slate-400">{r.body}</span>
        </button>
      ))}
    </div>
  );
}

// ── Add Canned Response Modal ─────────────────────────────────────────────────
function CannedModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!title.trim() || !body.trim()) return;
    setLoading(true);
    try {
      await apiFetch('/api/whatsapp/inbox/canned', { method: 'POST', body: JSON.stringify({ title, body, shortcut }) });
      onSaved();
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h3 className="mb-4 text-base font-bold text-slate-900 dark:text-white">New Canned Response</h3>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Greeting)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="Shortcut (e.g. greet) — optional"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message body…" rows={4}
            className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <p className="text-xs text-slate-400">Use <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{'{{name}}'}</code> for contact name</p>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2 text-sm text-slate-500 dark:border-slate-700">Cancel</button>
          <button onClick={save} disabled={loading || !title.trim() || !body.trim()}
            className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WhatsAppInboxPage() {
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<ChatStatus | 'all'>('open');
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [search, setSearch] = useState('');
  const [msgText, setMsgText] = useState('');
  const [inputMode, setInputMode] = useState<'reply' | 'note'>('reply');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState('');
  const [showCannedModal, setShowCannedModal] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [quickNote, setQuickNote] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: inboxData, isLoading: inboxLoading } = useQuery({
    queryKey: ['wa-inbox', activeTab],
    queryFn: () => apiFetch<{ success: boolean; conversations: Conversation[]; counts: Record<string, number> }>(
      `/api/whatsapp/inbox?status=${activeTab === 'all' ? 'all' : activeTab}`
    ),
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

  const convKey = selected?.type === 'lead' ? selected.leadId : selected?.phone;
  const { data: convData } = useQuery({
    queryKey: ['wa-conv', convKey],
    queryFn: () =>
      selected!.type === 'lead'
        ? apiFetch<{ lead: any; messages: Message[]; internalNotes: Message[] }>(`/api/crm/leads/${selected!.leadId}`)
        : apiFetch<{ messages: Message[] }>(`/api/whatsapp/inbox/unknown/${selected!.phone}/messages`),
    enabled: !!selected,
    refetchInterval: 8_000,
    staleTime: 0,
  });

  const { data: cannedData, refetch: refetchCanned } = useQuery({
    queryKey: ['wa-canned'],
    queryFn: () => apiFetch<{ responses: CannedResponse[] }>('/api/whatsapp/inbox/canned'),
    staleTime: 60_000,
  });

  const conversations = inboxData?.conversations ?? [];
  const counts = inboxData?.counts ?? { open: 0, unassigned: 0, resolved: 0 };
  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role)
  );
  const rawMessages: Message[] = (convData as any)?.messages ?? [];
  const rawNotes: Message[] = (convData as any)?.internalNotes ?? [];
  const currentLead = selected?.type === 'lead' ? (convData as any)?.lead : null;
  const canned: CannedResponse[] = cannedData?.responses ?? [];

  // Merge messages + notes into timeline sorted by timestamp
  const timeline = [
    ...rawMessages.map((m) => ({ ...m, _kind: 'message' as const })),
    ...rawNotes.map((n) => ({ ...n, _kind: 'note' as const })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const liveStage = currentLead?.stage ?? selected?.stage;
  const liveAssignedTo = currentLead?.assignedTo ?? selected?.assignedTo ?? '';
  const liveTags: string[] = currentLead?.tags ?? selected?.tags ?? [];
  const stageObj = stages.find((s) => s.key === liveStage);
  const windowExpired = is24hExpired(selected?.lastInboundAt ?? currentLead?.lastInboundAt);

  const filtered = conversations.filter(
    (c) => !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline.length]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
  }, [qc, convKey]);

  const stageMutation = useMutation({
    mutationFn: (stage: string) => apiFetch(`/api/crm/leads/${selected!.leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: invalidate,
  });

  const assignMutation = useMutation({
    mutationFn: (assignedTo: string) => apiFetch(`/api/crm/leads/${selected!.leadId}/assign`, {
      method: 'PUT', body: JSON.stringify({ assignedTo, assignedToName: employees.find((e) => e.id === assignedTo)?.name }),
    }),
    onSuccess: invalidate,
  });

  const tagMutation = useMutation({
    mutationFn: (tags: string[]) => apiFetch(`/api/crm/leads/${selected!.leadId}`, { method: 'PUT', body: JSON.stringify({ tags }) }),
    onSuccess: invalidate,
  });

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/api/whatsapp/inbox/${selected!.leadId}/resolve`, { method: 'PUT' }),
    onSuccess: () => { setSelected((s) => s ? { ...s, chatStatus: 'resolved' } : s); invalidate(); },
  });

  const reopenMutation = useMutation({
    mutationFn: () => apiFetch(`/api/whatsapp/inbox/${selected!.leadId}/reopen`, { method: 'PUT' }),
    onSuccess: () => { setSelected((s) => s ? { ...s, chatStatus: 'open' } : s); invalidate(); },
  });

  const noteMutation = useMutation({
    mutationFn: (content: string) => apiFetch(`/api/whatsapp/inbox/${selected!.leadId}/note`, { method: 'POST', body: JSON.stringify({ content }) }),
    onSuccess: () => { setMsgText(''); invalidate(); },
  });

  const autoAssignMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/inbox/auto-assign', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-inbox'] }),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      selected!.type === 'lead'
        ? apiFetch('/api/whatsapp/send', { method: 'POST', body: JSON.stringify({ leadPK: selected!.PK, message: msgText }) })
        : apiFetch(`/api/whatsapp/inbox/unknown/${selected!.phone}/send`, { method: 'POST', body: JSON.stringify({ message: msgText }) }),
    onSuccess: () => { setMsgText(''); setShowCanned(false); invalidate(); },
  });

  function handleSend() {
    if (!msgText.trim()) return;
    if (inputMode === 'note') { noteMutation.mutate(msgText); }
    else { sendMutation.mutate(); }
    setMsgText('');
  }

  function handleMsgChange(val: string) {
    setMsgText(val);
    if (val.startsWith('/')) {
      setShowCanned(true);
      setCannedSearch(val.slice(1).toLowerCase());
    } else {
      setShowCanned(false);
      setCannedSearch('');
    }
  }

  const isProcessing = sendMutation.isPending || noteMutation.isPending;
  const canSend = msgText.trim().length > 0 && !isProcessing && (inputMode === 'note' || !windowExpired);

  // ── Tabs config ───────────────────────────────────────────────────────────
  const TABS: { key: ChatStatus | 'all'; label: string; count?: number }[] = [
    { key: 'open',       label: 'Open',       count: counts.open },
    { key: 'unassigned', label: 'Unassigned', count: counts.unassigned },
    { key: 'resolved',   label: 'Resolved',   count: counts.resolved },
  ];

  return (
    <>
      <Navbar title="WhatsApp Inbox" />
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-slate-50 dark:bg-slate-950">

        {/* ══ LEFT PANEL — conversation list ══════════════════════════════════ */}
        <div className={`flex w-full flex-shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:w-[288px] ${selected ? 'hidden md:flex' : 'flex'}`}>

          {/* Search */}
          <div className="border-b border-slate-100 p-3 dark:border-slate-800">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 dark:border-slate-800">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}>
                {tab.label}
                {(tab.count ?? 0) > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    activeTab === tab.key ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                  }`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Auto-assign button (unassigned tab) */}
          {activeTab === 'unassigned' && counts.unassigned > 0 && (
            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <button onClick={() => autoAssignMutation.mutate()} disabled={autoAssignMutation.isPending}
                className="w-full rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {autoAssignMutation.isPending ? 'Assigning…' : `⚡ Auto-Assign ${counts.unassigned} Chats`}
              </button>
            </div>
          )}

          {/* Conversation list */}
          <div className="flex-1 divide-y divide-slate-50 overflow-y-auto dark:divide-slate-800/50">
            {inboxLoading && <p className="p-6 text-center text-sm text-slate-400">Loading…</p>}
            {!inboxLoading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center p-10 text-center">
                <span className="mb-3 text-4xl">💬</span>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {activeTab === 'resolved' ? 'No resolved conversations' : activeTab === 'unassigned' ? 'All chats are assigned' : 'No open conversations'}
                </p>
              </div>
            )}
            {filtered.map((conv) => {
              const key = conv.type === 'lead' ? conv.leadId! : `unk-${conv.phone}`;
              const stage = stages.find((s) => s.key === conv.stage);
              const isActive = selected
                ? conv.type === 'lead' ? selected.leadId === conv.leadId : selected.phone === conv.phone && selected.type === 'unknown'
                : false;
              const assigneeInitials = conv.assignedToName?.split(' ').map((n) => n[0]).join('').slice(0, 2) ?? '';

              return (
                <button key={key} onClick={() => { setSelected(conv); setMsgText(''); setInputMode('reply'); }}
                  className={`relative flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/10' : ''}`}>

                  {/* Avatar with status dot */}
                  <div className="relative flex-shrink-0">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${conv.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                      {avatarLetters(conv.name, conv.phone)}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 ${STATUS_COLORS[conv.chatStatus]}`} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <p className={`truncate text-sm font-semibold ${conv.lastMessageDirection === 'inbound' ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>
                        {conv.name ?? conv.phone}
                      </p>
                      <span className="flex-shrink-0 text-[10px] text-slate-400">{conv.lastMessageAt ? timeAgo(conv.lastMessageAt) : ''}</span>
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5">
                      {conv.type === 'unknown' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">New</span>}
                      {stage && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: stage.color }}>{stage.label}</span>}
                      {conv.assignedToName && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{assigneeInitials}</span>}
                    </div>

                    {conv.lastMessagePreview && (
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {conv.lastMessageDirection === 'outbound' ? '↗ ' : ''}{conv.lastMessagePreview}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ══ MIDDLE PANEL — chat ═════════════════════════════════════════════ */}
        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col">

            {/* Chat header */}
            <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <button onClick={() => setSelected(null)} className="mr-1 flex-shrink-0 text-slate-400 hover:text-slate-600 md:hidden">←</button>

              <div className="relative flex-shrink-0">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${selected.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                  {avatarLetters(currentLead?.name ?? selected.name, selected.phone)}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-900 ${STATUS_COLORS[selected.chatStatus]}`} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {currentLead?.name ?? selected.name ?? selected.phone}
                  </p>
                  {stageObj && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: stageObj.color }}>
                      {stageObj.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{selected.phone}</p>
              </div>

              {/* Action buttons */}
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {selected.type === 'lead' && selected.chatStatus !== 'resolved' && (
                  <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-400">
                    ✓ Resolve
                  </button>
                )}
                {selected.type === 'lead' && selected.chatStatus === 'resolved' && (
                  <button onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    ↺ Reopen
                  </button>
                )}
                {selected.type === 'lead' && (
                  <Link href={`/admin/crm/${selected.leadId}`}
                    className="hidden rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 sm:block">
                    CRM ↗
                  </Link>
                )}
                {selected.type === 'unknown' && (
                  <button className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">
                    + Add to CRM
                  </button>
                )}
                <button onClick={() => setShowSidebar((v) => !v)}
                  className={`hidden rounded-lg border px-2.5 py-1.5 text-xs lg:block ${showSidebar ? 'border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400' : 'border-slate-200 text-slate-400 hover:bg-slate-50 dark:border-slate-700'}`}>
                  ☰ Info
                </button>
              </div>
            </div>

            {/* 24h window warning */}
            {windowExpired && inputMode === 'reply' && (
              <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                <span className="text-base">⚠</span>
                <p className="flex-1 text-xs text-amber-700 dark:text-amber-400">
                  Customer last replied <strong>{timeAgo(selected.lastInboundAt ?? currentLead?.lastInboundAt ?? '')}</strong> ago. The 24-hour window has expired — use a WhatsApp Template to re-initiate.
                </p>
                <button className="flex-shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white opacity-50 cursor-not-allowed">
                  Send Template
                </button>
              </div>
            )}

            {/* Timeline */}
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {timeline.length === 0 && <p className="py-12 text-center text-sm text-slate-400">No messages yet.</p>}
              {timeline.map((item) => {
                if (item._kind === 'note') {
                  return (
                    <div key={item.SK} className="flex justify-center">
                      <div className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/10">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">🔒 Internal note · {item.authorName}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">{item.content}</p>
                        <p className="mt-1 text-[10px] text-amber-500">{new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={item.SK} className={`flex ${item.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      item.direction === 'outbound'
                        ? 'rounded-br-sm bg-indigo-600 text-white'
                        : 'rounded-bl-sm bg-white text-slate-900 shadow-none ring-1 ring-slate-100 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
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

            {/* Input area */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {/* Reply / Note tabs */}
              <div className="flex border-b border-slate-100 dark:border-slate-800">
                {(['reply', 'note'] as const).map((m) => (
                  <button key={m} onClick={() => { setInputMode(m); setMsgText(''); setShowCanned(false); }}
                    className={`px-4 py-2 text-xs font-semibold capitalize transition-colors ${
                      inputMode === m
                        ? m === 'note' ? 'border-b-2 border-amber-500 text-amber-600 dark:text-amber-400' : 'border-b-2 border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}>
                    {m === 'reply' ? '💬 Reply' : '🔒 Note'}
                  </button>
                ))}
                {inputMode === 'reply' && canned.length > 0 && (
                  <button onClick={() => setShowCannedModal(true)}
                    className="ml-auto px-4 py-2 text-xs text-slate-400 hover:text-indigo-600">
                    ⚡ Canned
                  </button>
                )}
                {inputMode === 'reply' && canned.length === 0 && (
                  <button onClick={() => setShowCannedModal(true)}
                    className="ml-auto px-4 py-2 text-xs text-slate-400 hover:text-indigo-600">
                    + Add Canned
                  </button>
                )}
              </div>

              <div className="relative p-3">
                {showCanned && inputMode === 'reply' && (
                  <CannedPicker
                    responses={canned}
                    filter={cannedSearch}
                    onSelect={(body) => { setMsgText(body); setShowCanned(false); inputRef.current?.focus(); }}
                    onClose={() => setShowCanned(false)}
                  />
                )}
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    value={msgText}
                    onChange={(e) => handleMsgChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && canSend) { e.preventDefault(); handleSend(); } if (e.key === 'Escape') setShowCanned(false); }}
                    disabled={windowExpired && inputMode === 'reply'}
                    placeholder={
                      windowExpired && inputMode === 'reply' ? '24h window expired — switch to Template or leave a Note'
                      : inputMode === 'note' ? '🔒 Internal note (not sent to customer)…'
                      : `Type / for canned responses, or write a message…`
                    }
                    className={`flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-1 dark:text-white ${
                      inputMode === 'note'
                        ? 'border-amber-200 bg-amber-50 focus:border-amber-400 focus:ring-amber-200 dark:border-amber-900/30 dark:bg-amber-900/10'
                        : windowExpired
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                          : 'border-slate-200 bg-slate-50 focus:border-indigo-400 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800'
                    }`}
                  />
                  <button onClick={handleSend} disabled={!canSend}
                    className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-40 ${
                      inputMode === 'note' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}>
                    {isProcessing ? '…' : inputMode === 'note' ? '🔒' : '➤'}
                  </button>
                </div>
                {(sendMutation.isError || noteMutation.isError) && (
                  <p className="mt-1 text-xs text-red-500">Failed — check WhatsApp connection in CRM Settings.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 flex-col items-center justify-center gap-3 md:flex">
            <span className="text-5xl">💬</span>
            <p className="text-slate-400">Select a conversation to start</p>
          </div>
        )}

        {/* ══ RIGHT PANEL — contact sidebar ══════════════════════════════════ */}
        {selected && showSidebar && (
          <div className="hidden w-[268px] flex-shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">

            {/* Contact Info */}
            <div className="border-b border-slate-100 p-4 dark:border-slate-800">
              <div className="mb-3 flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white ${selected.type === 'unknown' ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                  {avatarLetters(currentLead?.name ?? selected.name, selected.phone)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{currentLead?.name ?? selected.name ?? selected.phone}</p>
                  <p className="text-xs text-slate-400">{selected.phone}</p>
                  {selected.email && <p className="truncate text-xs text-slate-400">{selected.email}</p>}
                </div>
              </div>

              {selected.type === 'lead' && (
                <Link href={`/admin/crm/${selected.leadId}`}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
                  View CRM Profile ↗
                </Link>
              )}
            </div>

            {/* Stage + Assign (leads only) */}
            {selected.type === 'lead' && (
              <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Pipeline</p>
                <select value={liveStage ?? ''}
                  onChange={(e) => stageMutation.mutate(e.target.value)}
                  style={stageObj ? { borderColor: stageObj.color } : {}}
                  className="mb-2.5 w-full rounded-lg border bg-white px-3 py-2 text-xs font-semibold outline-none dark:bg-slate-800 dark:text-white">
                  {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select value={liveAssignedTo}
                  onChange={(e) => assignMutation.mutate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  <option value="">Unassigned</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            )}

            {/* Tags */}
            {selected.type === 'lead' && (
              <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Tags</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {liveTags.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                      {t}
                      <button onClick={() => tagMutation.mutate(liveTags.filter((x) => x !== t))}
                        className="text-indigo-300 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTag.trim()) {
                        tagMutation.mutate([...liveTags, newTag.trim()]);
                        setNewTag('');
                      }
                    }}
                    placeholder="Add tag + Enter"
                    className="flex-1 rounded-lg border border-dashed border-slate-300 bg-transparent px-2.5 py-1.5 text-[11px] outline-none focus:border-indigo-400 dark:border-slate-600 dark:text-white" />
                </div>
              </div>
            )}

            {/* Quick note */}
            {selected.type === 'lead' && (
              <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Quick Note</p>
                <textarea value={quickNote} onChange={(e) => setQuickNote(e.target.value)} rows={3}
                  placeholder="Add a private note…"
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                <button
                  onClick={() => { if (quickNote.trim()) { noteMutation.mutate(quickNote); setQuickNote(''); } }}
                  disabled={!quickNote.trim()}
                  className="mt-2 w-full rounded-lg bg-amber-500 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40">
                  Save Note
                </button>
              </div>
            )}

            {/* Meta info */}
            <div className="p-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Details</p>
              <div className="space-y-2 text-xs">
                {selected.source && <div className="flex justify-between"><span className="text-slate-400">Source</span><span className="font-medium capitalize text-slate-700 dark:text-slate-300">{selected.source}</span></div>}
                <div className="flex justify-between"><span className="text-slate-400">Status</span>
                  <span className={`font-semibold capitalize ${selected.chatStatus === 'open' ? 'text-emerald-600' : selected.chatStatus === 'resolved' ? 'text-slate-400' : 'text-amber-600'}`}>{selected.chatStatus}</span>
                </div>
                {selected.createdAt && <div className="flex justify-between"><span className="text-slate-400">Created</span><span className="text-slate-500">{new Date(selected.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>}
                <div className="flex justify-between"><span className="text-slate-400">WhatsApp</span>
                  <span className={`font-semibold ${windowExpired ? 'text-red-500' : 'text-emerald-600'}`}>{windowExpired ? '24h expired' : 'Active'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showCannedModal && (
        <CannedModal
          onClose={() => setShowCannedModal(false)}
          onSaved={() => { refetchCanned(); setShowCannedModal(false); }}
        />
      )}
    </>
  );
}
