'use client';

import { createContext, useContext, useState, useRef, useEffect, useCallback, Dispatch, SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, UseMutationResult, QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { useWsContext } from '@/contexts/WebSocketContext';
import { wsClient, type WsMessage } from '@/lib/wsClient';

// ── Types ─────────────────────────────────────────────────────────────────────
export type ChatStatus = 'open' | 'unassigned' | 'resolved';

export interface Conversation {
  type: 'lead' | 'unknown';
  leadId?: string;
  PK?: string;
  name?: string;
  waName?: string | null;
  agentName?: string | null;
  displayName?: string;
  phone: string;
  email?: string | null;
  source?: string | null;
  stage?: string | null;
  tags?: string[];
  notes?: string;
  assignedTo?: string | null;
  assignedToName?: string | null;
  pinned?: boolean;
  chatStatus: ChatStatus;
  lastMessageAt: string;
  lastMessagePreview?: string;
  lastMessageDirection?: 'inbound' | 'outbound';
  lastInboundAt?: string | null;
  createdAt?: string | null;
  unreadCount?: number;
}

export interface Message {
  SK: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sentByName?: string;
  timestamp: string;
  type?: string;
  mediaId?: string;
  mediaUrl?: string;
  s3Key?: string;
  mimeType?: string;
  filename?: string;
  authorName?: string;
  waMessageId?: string;
  msgStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  replyToWaMessageId?: string;
  replyToContent?: string;
  replyToDirection?: 'inbound' | 'outbound';
  replyToSenderName?: string | null;
}

export interface PipelineStage { key: string; label: string; color: string; }
export interface EmployeeRecord { id: string; name: string; role: string; }
export interface CannedResponse { id: string; title: string; body: string; shortcut?: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const IST = 'Asia/Kolkata';
const istDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: IST });

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5 * 60_000) return 'Just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  const d = new Date(iso);
  if (istDay(d) === istDay(new Date()))
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: IST });
  if (istDay(d) === istDay(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST });
}

export function avatarLetters(name?: string | null, phone?: string) {
  if (name) return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return (phone ?? '??').slice(-2);
}

export function is24hExpired(lastInboundAt?: string | null) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() > 24 * 3_600_000;
}

export const CHAT_STATUS_CHIP: Record<ChatStatus, string> = {
  open:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  unassigned: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export function playNotifTone() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch { /* blocked by browser autoplay policy or not supported */ }
}

// ── Context type ──────────────────────────────────────────────────────────────
export type TimelineItem = (Message & { _kind: 'message' }) | (Message & { _kind: 'note' });

interface InboxContextValue {
  selected: Conversation | null;
  selectConv: (conv: Conversation | null) => void;
  activeTab: ChatStatus | 'all' | 'unread';
  setActiveTab: Dispatch<SetStateAction<ChatStatus | 'all' | 'unread'>>;
  showSidebar: boolean;
  setShowSidebar: Dispatch<SetStateAction<boolean>>;
  editingName: boolean;
  nameInput: string;
  setEditingName: Dispatch<SetStateAction<boolean>>;
  setNameInput: Dispatch<SetStateAction<string>>;
  tabActive: boolean;
  conversations: Conversation[];
  counts: Record<string, number>;
  stages: PipelineStage[];
  employees: EmployeeRecord[];
  rawMessages: Message[];
  rawNotes: Message[];
  currentLead: any;
  canned: CannedResponse[];
  tagCatalog: Array<{ id: string; label: string; color: string }>;
  inboxLoading: boolean;
  isAvailable: boolean;
  activeConvKey: string | undefined;
  timeline: TimelineItem[];
  liveStage: string | undefined;
  liveAssignedTo: string;
  liveTags: string[];
  stageObj: PipelineStage | undefined;
  windowExpired: boolean;
  tagById: (tid: string) => { id: string; label: string; color: string } | undefined;
  stageMutation: UseMutationResult<any, Error, string>;
  assignMutation: UseMutationResult<any, Error, string>;
  tagMutation: UseMutationResult<any, Error, string[]>;
  resolveMutation: UseMutationResult<any, Error, void>;
  reopenMutation: UseMutationResult<any, Error, void>;
  noteMutation: UseMutationResult<any, Error, string>;
  autoAssignMutation: UseMutationResult<any, Error, void>;
  pinMutation: UseMutationResult<any, Error, string>;
  availMutation: UseMutationResult<any, Error, boolean>;
  nameMutation: UseMutationResult<any, Error, { leadId?: string; phone?: string; name: string }>;
  invalidate: () => void;
  qc: QueryClient;
  refetchCanned: () => void;
}

const InboxContext = createContext<InboxContextValue | null>(null);

export function useInbox() {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within InboxProvider');
  return ctx;
}

export function InboxProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { connected: wsConnected } = useWsContext();
  const searchParams = useSearchParams();
  const deepLinkLeadId = searchParams.get('leadId');
  const deepLinkPhone = searchParams.get('phone');

  const [activeTab, setActiveTab] = useState<ChatStatus | 'all' | 'unread'>('open');
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [tabActive, setTabActive] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const lastActivityRef = useRef<string>(new Date(Date.now() - 60_000).toISOString());
  // Keep a ref so the deep-link effect can read current selected without triggering on every click
  const selectedRef = useRef<Conversation | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    const handleVisibility = () => setTabActive(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const selectConv = useCallback((conv: Conversation | null) => {
    setSelected(conv);
    // window.history.replaceState updates the URL bar silently — no Next.js navigation,
    // no page flash. useSearchParams() does not update (it only changes on real navigations),
    // so the deep-link effect is never triggered by clicks.
    // The URL is still correct on page refresh, preserving conversation restore.
    if (conv) {
      const param = conv.type === 'lead' && conv.leadId
        ? `?leadId=${conv.leadId}`
        : `?phone=${encodeURIComponent(conv.phone)}`;
      window.history.replaceState(null, '', param);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: inboxData, isLoading: inboxLoading } = useQuery({
    queryKey: ['wa-inbox', activeTab],
    queryFn: () => apiFetch<{ success: boolean; conversations: Conversation[]; counts: Record<string, number> }>(
      `/api/whatsapp/inbox?status=${activeTab === 'all' ? 'all' : activeTab}`
    ),
    refetchInterval: tabActive ? (wsConnected ? 30_000 : 8_000) : 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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

  const activeConvKey = selected?.type === 'lead' ? selected.leadId : selected?.phone;
  const { data: convData } = useQuery({
    queryKey: ['wa-conv', activeConvKey],
    queryFn: async () => {
      const url = selected!.type === 'lead'
        ? `/api/crm/leads/${selected!.leadId}`
        : `/api/whatsapp/inbox/unknown/${selected!.phone}/messages`;
      return selected!.type === 'lead'
        ? apiFetch<{ lead: any; messages: Message[]; internalNotes: Message[] }>(url)
        : apiFetch<{ messages: Message[] }>(url);
    },
    enabled: !!selected,
    // When WS is live, the WS handler calls refetchQueries for the active conv on
    // each inbound message. Disable scheduled polling to avoid redundant requests;
    // resume at 3 s as fallback when WS drops.
    refetchInterval: wsConnected ? false : 3_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const { data: cannedData, refetch: refetchCannedRaw } = useQuery({
    queryKey: ['wa-canned'],
    queryFn: () => apiFetch<{ responses: CannedResponse[] }>('/api/whatsapp/inbox/canned'),
    staleTime: 60_000,
  });

  const refetchCanned = useCallback(() => { refetchCannedRaw(); }, [refetchCannedRaw]);

  const { data: availData } = useQuery({
    queryKey: ['wa-availability'],
    queryFn: () => apiFetch<{ available: boolean }>('/api/whatsapp/agent/availability'),
    staleTime: 30_000,
  });
  const isAvailable = availData?.available ?? true;

  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Array<{ id: string; label: string; color: string }> }>('/api/tags'),
    staleTime: 5 * 60_000,
  });
  const tagCatalog = tagCatalogData?.tags ?? [];
  const tagById = useCallback((tid: string) => tagCatalog.find((t) => t.id === tid), [tagCatalog]);

  const conversations = inboxData?.conversations ?? [];
  const counts = inboxData?.counts ?? { open: 0, unassigned: 0, resolved: 0, unread: 0 };
  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role)
  );
  const rawMessages: Message[] = (convData as any)?.messages ?? [];
  const rawNotes: Message[] = (convData as any)?.internalNotes ?? [];
  const currentLead = selected?.type === 'lead' ? (convData as any)?.lead : null;
  const canned: CannedResponse[] = cannedData?.responses ?? [];

  const timeline: TimelineItem[] = [
    ...rawMessages.map((m) => ({ ...m, _kind: 'message' as const })),
    ...rawNotes.map((n) => ({ ...n, _kind: 'note' as const })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const liveStage = currentLead?.stage ?? selected?.stage ?? undefined;
  const liveAssignedTo = currentLead?.assignedTo ?? selected?.assignedTo ?? '';
  const liveTags: string[] = currentLead?.tags ?? selected?.tags ?? [];
  const stageObj = stages.find((s) => s.key === liveStage);
  const windowExpired = is24hExpired(currentLead?.lastInboundAt ?? selected?.lastInboundAt);

  // Deep-link effect — runs only when URL params or conversation list changes, NOT on every
  // selectConv() call. Using selectedRef (not selected) prevents the effect from firing when
  // the user clicks a conversation and temporarily creates a URL/state mismatch while
  // router.replace() propagates asynchronously through useSearchParams().
  useEffect(() => {
    if (!conversations.length) return;
    if (deepLinkLeadId && selectedRef.current?.leadId !== deepLinkLeadId) {
      const match = conversations.find((c) => c.leadId === deepLinkLeadId);
      if (match) { setSelected(match); }
      else if (activeTab !== 'all') { setActiveTab('all'); }
    } else if (deepLinkPhone && selectedRef.current?.phone !== deepLinkPhone) {
      const match = conversations.find((c) => c.phone === deepLinkPhone);
      if (match) { setSelected(match); }
      else if (activeTab !== 'all') { setActiveTab('all'); }
    }
  }, [deepLinkLeadId, deepLinkPhone, conversations, activeTab]);

  // lastActivity watermark effect
  useEffect(() => {
    if (conversations.length === 0) return;
    const latest = conversations[0]?.lastMessageAt;
    if (latest && latest > lastActivityRef.current) {
      lastActivityRef.current = latest;
    }
  }, [conversations]);

  // Ping loop effect — pauses when tab is hidden to avoid hammering the API
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function ping() {
      if (cancelled) return;
      if (!tabActive || wsConnected) {
        // Tab hidden or WS is live — WS push handles instant updates; ping is fallback only
        timer = setTimeout(ping, wsConnected ? 15_000 : 2_000);
        return;
      }
      try {
        const data = await apiFetch<{ hasNew: boolean; latestAt: string | null }>(
          `/api/whatsapp/inbox/ping?since=${encodeURIComponent(lastActivityRef.current)}`
        );
        if (data.hasNew) {
          if (data.latestAt) lastActivityRef.current = data.latestAt;
          playNotifTone();
          qc.invalidateQueries({ queryKey: ['wa-inbox'] });
          qc.invalidateQueries({ queryKey: ['wa-conv'] });
        }
      } catch {
        // ignore transient network errors
      }
      if (!cancelled) timer = setTimeout(ping, 2_000);
    }

    timer = setTimeout(ping, 2_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [qc, tabActive, wsConnected]);

  // Visibility change invalidation effect
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      if (activeConvKey) qc.invalidateQueries({ queryKey: ['wa-conv', activeConvKey] });
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [qc, activeConvKey]);

  // WS reconnect: refetch the active conversation to show messages that arrived
  // while the socket was down. wa-inbox is already handled by WebSocketContext's
  // $open handler; here we cover the open conversation pane.
  useEffect(() => {
    const onReconnect = () => {
      if (activeConvKey) qc.refetchQueries({ queryKey: ['wa-conv', activeConvKey] });
    };
    wsClient.on('$open', onReconnect);
    return () => wsClient.off('$open', onReconnect);
  }, [qc, activeConvKey]);

  // WS real-time handler: when a message arrives for the currently-open conversation,
  // immediately refetch its data. refetchQueries goes through React Query's normal
  // data flow and reliably triggers a re-render; setQueryData from outside React's
  // event system can be batched/deferred and was causing 20-30 s UI lag.
  useEffect(() => {
    const handler = (wsMsg: WsMessage) => {
      playNotifTone();

      const payload = wsMsg as WsMessage & {
        conversationId?: string | null;
        phone?: string;
        from?: string | number;
        isUnknown?: boolean;
      };

      if (!activeConvKey) return;

      const isActiveConv = payload.isUnknown
        ? (payload.phone === activeConvKey || String(payload.from) === activeConvKey)
        : payload.conversationId === activeConvKey;

      if (isActiveConv) {
        qc.refetchQueries({ queryKey: ['wa-conv', activeConvKey] });
      }
    };

    wsClient.on('whatsapp_message', handler);
    return () => wsClient.off('whatsapp_message', handler);
  }, [qc, activeConvKey]);



  // Reset editingName when conversation changes
  useEffect(() => {
    setEditingName(false);
  }, [activeConvKey]);

  // Mark-read effect
  useEffect(() => {
    if (!selected?.leadId) return;
    const lastInbound = rawMessages.filter((m) => m.direction === 'inbound' && m.waMessageId).at(-1);
    if (!lastInbound?.waMessageId) return;
    apiFetch(`/api/whatsapp/inbox/${selected.leadId}/mark-read`, {
      method: 'POST',
      body: JSON.stringify({ lastWaMessageId: lastInbound.waMessageId }),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvKey, rawMessages.length]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    qc.invalidateQueries({ queryKey: ['wa-conv', activeConvKey] });
  }, [qc, activeConvKey]);

  const stageMutation = useMutation({
    mutationFn: (stage: string) => apiFetch(`/api/crm/leads/${selected!.leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage }) }),
    onSuccess: invalidate,
  });

  const assignMutation = useMutation({
    mutationFn: (assignedTo: string) => apiFetch(`/api/crm/leads/${selected!.leadId}/assign`, {
      method: 'PUT', body: JSON.stringify({ assignedTo, assignedToName: employees.find((e) => e.id === assignedTo)?.name }),
    }),
    onSuccess: () => {
      setActiveTab('open'); // assign always sets chatStatus='open'; stay on that tab
      invalidate();
    },
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
    onSuccess: () => { invalidate(); },
  });

  const autoAssignMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/inbox/auto-assign', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-inbox'] }),
  });

  const pinMutation = useMutation({
    mutationFn: (leadId: string) => apiFetch(`/api/whatsapp/inbox/${leadId}/pin`, { method: 'PUT' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-inbox'] }),
  });

  const availMutation = useMutation({
    mutationFn: (av: boolean) => apiFetch('/api/whatsapp/agent/availability', { method: 'PUT', body: JSON.stringify({ available: av }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-availability'] }),
  });

  const nameMutation = useMutation({
    mutationFn: ({ leadId, phone, name }: { leadId?: string; phone?: string; name: string }) =>
      apiFetch('/api/whatsapp/contact/name', { method: 'PUT', body: JSON.stringify({ leadId, phone, name }) }),
    onSuccess: (_, vars) => {
      setEditingName(false);
      setSelected((s) => s ? {
        ...s,
        displayName: vars.name,
        name: vars.leadId ? vars.name : s.name,
        agentName: vars.phone ? vars.name : s.agentName,
      } : s);
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    },
    onError: () => toast.error('Failed to rename contact'),
  });

  const value: InboxContextValue = {
    selected,
    selectConv,
    activeTab,
    setActiveTab,
    showSidebar,
    setShowSidebar,
    editingName,
    nameInput,
    setEditingName,
    setNameInput,
    tabActive,
    conversations,
    counts,
    stages,
    employees,
    rawMessages,
    rawNotes,
    currentLead,
    canned,
    tagCatalog,
    inboxLoading,
    isAvailable,
    activeConvKey,
    timeline,
    liveStage,
    liveAssignedTo,
    liveTags,
    stageObj,
    windowExpired,
    tagById,
    stageMutation,
    assignMutation,
    tagMutation,
    resolveMutation,
    reopenMutation,
    noteMutation,
    autoAssignMutation,
    pinMutation,
    availMutation,
    nameMutation,
    invalidate,
    qc,
    refetchCanned,
  };

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}
