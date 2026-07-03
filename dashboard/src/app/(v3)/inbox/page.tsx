'use client';

import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  MessageSquare, Search, Send, MoreHorizontal, Phone,
  CheckCheck, Check, Clock, AlertCircle, Plus, X, ChevronLeft,
  FileText, Download, ZoomIn,
  Loader2, ChevronDown, Lock, AlertTriangle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ContactTags } from '@/components/tags/ContactTags';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Select } from '@/components/v3/ui/Select';
import { SkeletonRow, Skeleton } from '@/components/v3/ui/Skeleton';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { cn } from '@/lib/cn';
import { apiFetch, getMemoryToken, ApiClientError } from '@/lib/api';
import { format, isToday, isYesterday } from 'date-fns';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { wsClient } from '@/lib/wsClient';
import type { WsMessage } from '@/lib/wsClient';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { OwnerSelect } from '@/components/v3/ui/OwnerSelect';
import { useEmployeesList } from '@/hooks/useEmployeesList';
import { assignmentKey } from '@/hooks/useOwnerAssign';
import type { AssignmentRecord } from '@/hooks/useOwnerAssign';
import { ComposerToolbar } from '@/components/inbox/ComposerToolbar';
import { useAddNote, useEditNote, useDeleteNote, canModifyNote } from '@/hooks/useNoteMutations';
import { formatRelativeTime } from '@/utils/formatters';

// ── V2 API shapes (backend response shapes, never invented) ───────────────────

interface WaConversation {
  type: 'lead' | 'unknown';
  leadId?: string;
  PK?: string;
  name?: string;
  displayName?: string;
  phone: string;
  chatStatus: 'open' | 'unassigned' | 'resolved';
  lastMessageAt: string;
  lastMessagePreview?: string;
  lastMessageDirection?: 'inbound' | 'outbound';
  lastInboundAt?: string | null;
  unreadCount?: number;
  assignedTo?: string | null;
  assignedToName?: string | null;
  stage?: string | null;
  tags?: string[];
}

interface WaMessage {
  SK: string;
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'template' | 'flow_response';
  s3Key?: string;
  mediaId?: string;
  mediaUrl?: string;
  mimeType?: string;
  filename?: string;
  msgStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  sentByName?: string;
  templateId?: string;
  // Present when type === 'flow_response' — a completed WhatsApp Flow answer
  flowName?: string | null;
  flowFields?: FlowFieldItem[];
}

interface InternalNoteItem {
  SK: string;
  content: string;
  authorId?: string;
  authorName?: string;
  timestamp: string;
  editedAt?: string;
}

interface FlowFieldItem { key: string; label: string; value: string; }

type ConvTab = 'open' | 'unassigned' | 'resolved';

// ── Helpers ───────────────────────────────────────────────────────────────────

function convDisplayName(c: WaConversation) {
  return c.displayName || c.name || c.phone;
}

function msgDate(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMM');
}

function msgTime(iso: string) {
  return format(new Date(iso), 'h:mm a');
}

// ── WABA 24-hour customer service window ──────────────────────────────────────

const WABA_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CLOSING_SOON_MS = 60 * 60 * 1_000; // warn when <1 h remains

type WindowStatus = 'open' | 'closing-soon' | 'expired';

function getWindowRemainingMs(lastInboundAt?: string | null, now = Date.now()): number {
  if (!lastInboundAt) return 0;
  return Math.max(0, WABA_WINDOW_MS - (now - new Date(lastInboundAt).getTime()));
}

function getWindowStatus(lastInboundAt?: string | null, now = Date.now()): WindowStatus {
  const rem = getWindowRemainingMs(lastInboundAt, now);
  if (rem === 0) return 'expired';
  if (rem <= CLOSING_SOON_MS) return 'closing-soon';
  return 'open';
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function DeliveryIcon({ status }: { status?: WaMessage['msgStatus'] }) {
  if (status === 'read')      return <CheckCheck className="h-3.5 w-3.5 text-primary-300" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 text-white/60" aria-label="Delivered" />;
  if (status === 'sent')      return <Check className="h-3.5 w-3.5 text-white/60" aria-label="Sent" />;
  if (status === 'failed')    return <AlertCircle className="h-3.5 w-3.5 text-red-300" aria-label="Failed" />;
  return <Clock className="h-3.5 w-3.5 text-white/40" aria-label="Pending" />;
}

function WindowStatusChip({ lastInboundAt }: { lastInboundAt?: string | null }) {
  const status = getWindowStatus(lastInboundAt);
  if (status === 'open') return null;
  return (
    <span
      title={status === 'expired' ? '24-hour messaging window expired' : 'Window closing soon'}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none',
        status === 'expired'
          ? 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      )}>
      {status === 'expired'
        ? <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden />
        : <Clock className="h-2.5 w-2.5 shrink-0" aria-hidden />}
      {status !== 'expired' && 'Closing Soon'}
    </span>
  );
}

// ── Preview text cleaner ──────────────────────────────────────────────────────
// Backend stores bracket-encoded placeholders as preview text. Strip them for display.
function cleanPreview(preview?: string): string {
  if (!preview) return '';
  const m = preview.match(/^\[(Template|Campaign|Broadcast):\s*(.+?)\]$/i);
  if (m) return `${m[1]}: ${m[2]}`;
  return preview;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

interface LightboxItem { url: string; type: 'image' | 'video'; filename?: string }

function Lightbox({ item, onClose }: { item: LightboxItem; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handler);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Toolbar */}
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={item.url}
          download={item.filename ?? 'media'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Media */}
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3">
        {item.type === 'image' ? (
          <img
            src={item.url}
            alt={item.filename ?? 'image'}
            className="max-h-[85vh] max-w-[88vw] rounded-xl object-contain shadow-2xl"
            draggable={false}
          />
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[88vw] rounded-xl shadow-2xl"
          />
        )}
        {item.filename && (
          <p className="text-xs text-white/50">{item.filename}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Media renderer ────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function MediaRenderer({ message, isOut }: { message: WaMessage; isOut: boolean }) {
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  const { data: url, isLoading } = useQuery<string | null>({
    queryKey: ['media-url', message.s3Key ?? message.mediaId ?? message.mediaUrl],
    queryFn: async () => {
      if (message.s3Key) {
        const d = await apiFetch<{ url: string }>(`/api/whatsapp/s3-url?key=${encodeURIComponent(message.s3Key)}`);
        return d.url;
      }
      if (message.mediaUrl) return message.mediaUrl;
      if (message.mediaId) {
        const token = getMemoryToken();
        const res = await fetch(`${API_BASE}/api/whatsapp/media/${message.mediaId}`, {
          credentials: 'include',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        });
        if (!res.ok) throw new Error('Media unavailable');
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      }
      return null;
    },
    enabled: !!(message.s3Key || message.mediaId || message.mediaUrl),
    staleTime: 50 * 60_000,
    retry: 2,
  });

  const textColor = isOut ? 'text-white/80' : 'text-neutral-500';

  if (isLoading) {
    return (
      <div className={cn(
        'h-40 w-56 animate-pulse rounded-xl',
        isOut ? 'bg-white/20' : 'bg-neutral-200 dark:bg-neutral-700',
      )} />
    );
  }

  const type = message.type;
  const mime = message.mimeType ?? '';

  if (!url) {
    return <p className={cn('text-xs italic', textColor)}>Media unavailable</p>;
  }

  if (type === 'image' || mime.startsWith('image/')) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox({ url, type: 'image', filename: message.filename })}
          className="group relative block overflow-hidden rounded-xl"
          title="Click to view"
        >
          <img
            src={url}
            alt={message.filename ?? 'image'}
            className="max-h-60 max-w-[260px] rounded-xl object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition-colors group-hover:bg-black/20">
            <ZoomIn className="h-6 w-6 text-white opacity-0 drop-shadow-lg transition-opacity group-hover:opacity-100" />
          </div>
        </button>
        {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
      </>
    );
  }

  if (type === 'video' || mime.startsWith('video/')) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox({ url, type: 'video', filename: message.filename })}
          className="group relative block overflow-hidden rounded-xl"
          title="Click to play"
        >
          <video
            src={url}
            className="max-h-48 max-w-[260px] rounded-xl object-cover pointer-events-none"
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 transition-colors group-hover:bg-black/50">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
              <svg className="h-5 w-5 text-neutral-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </button>
        {lightbox && <Lightbox item={lightbox} onClose={() => setLightbox(null)} />}
      </>
    );
  }

  if (type === 'audio' || mime.startsWith('audio/')) {
    return <audio src={url} controls className="w-full min-w-[220px]" />;
  }

  // document / sticker / unknown — download button, no new tab
  return (
    <a
      href={url}
      download={message.filename ?? 'file'}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        isOut
          ? 'border-white/30 text-white hover:bg-white/10'
          : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate max-w-[180px]">{message.filename ?? 'Download file'}</span>
      <Download className="h-3.5 w-3.5 shrink-0 opacity-60" />
    </a>
  );
}

// ── Conversation List ─────────────────────────────────────────────────────────

function ConversationList({
  activeTab,
  onTabChange,
  activeId,
  onSelect,
}: {
  activeTab: ConvTab;
  onTabChange: (t: ConvTab) => void;
  activeId?: string;
  onSelect: (conv: WaConversation) => void;
}) {
  const [search, setSearch] = useState('');
  const qc = useQueryClient();
  const didAutoSelect = useRef(false);

  const { data, isLoading } = useQuery<{ conversations: WaConversation[]; counts: Record<string, number> }>({
    queryKey: ['wa-inbox', activeTab],
    queryFn: () => apiFetch(`/api/whatsapp/inbox?status=${activeTab}`),
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: { conversations: [], counts: {} },
  });

  const conversations = data?.conversations ?? [];
  const counts = data?.counts ?? {};

  // Auto-open the latest conversation on first load
  useEffect(() => {
    if (didAutoSelect.current || activeId || isLoading || conversations.length === 0) return;
    didAutoSelect.current = true;
    onSelect(conversations[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, activeId, isLoading]);

  // Request browser notification permission once
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Real-time: new WA message → refresh list + notify
  useEffect(() => {
    const handler = (msg: WsMessage) => {
      qc.invalidateQueries({ queryKey: ['wa-inbox', activeTab] });
      if (msg.direction !== 'inbound') return;
      const sender = (msg.name as string) || (msg.phone as string) || 'Customer';
      const body = (msg.content as string) || 'New WhatsApp message';
      toast.info(`New message from ${sender}`, { description: body.slice(0, 80), duration: 5000 });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`APForce: ${sender}`, { body: body.slice(0, 100), icon: '/favicon.ico' });
      }
    };
    wsClient.on('whatsapp_message', handler);
    return () => wsClient.off('whatsapp_message', handler);
  }, [qc, activeTab]);

  // Real-time: lead assigned or created → refresh inbox immediately so the
  // assigned employee sees the conversation without waiting for the 30s poll.
  useEffect(() => {
    const handler = () => { qc.invalidateQueries({ queryKey: ['wa-inbox'] }); };
    wsClient.on('lead_assigned', handler);
    wsClient.on('lead_created', handler);
    return () => {
      wsClient.off('lead_assigned', handler);
      wsClient.off('lead_created', handler);
    };
  }, [qc]);

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const name = convDisplayName(c).toLowerCase();
    return name.includes(search.toLowerCase()) || c.phone.includes(search);
  });

  const tabs: { id: ConvTab; label: string }[] = [
    { id: 'open',       label: 'Open'       },
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'resolved',   label: 'Resolved'   },
  ];

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
      {/* Header */}
      <div className="border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Inbox
          </h1>
          <Button size="sm" variant="ghost" iconLeft={<Plus className="h-4 w-4" />} aria-label="New conversation">
            New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="h-8 w-full rounded-lg border border-neutral-200 bg-neutral-50 pl-8 pr-3 text-xs placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors border-b-2',
              activeTab === tab.id
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
            )}
          >
            {tab.label}
            {(counts[tab.id] ?? 0) > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-600 px-1 text-[9px] font-bold text-white">
                {counts[tab.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {isLoading ? (
          [0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} className="px-3" />)
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No conversations"
            description={search ? 'Try a different search' : 'Nothing here yet'}
            className="py-10"
          />
        ) : (
          filtered.map((conv) => {
            const convId = conv.leadId ?? conv.phone;
            const name = convDisplayName(conv);
            const hasUnread = (conv.unreadCount ?? 0) > 0;
            return (
              <button
                key={convId}
                onClick={() => onSelect(conv)}
                aria-selected={convId === activeId}
                className={cn(
                  'flex w-full items-start gap-2.5 border-b border-neutral-100 px-3 py-3 text-left transition-colors last:border-0 dark:border-neutral-800/50',
                  convId === activeId
                    ? 'bg-primary-50 dark:bg-primary-900/20'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/30',
                )}
              >
                <Avatar name={name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className={cn(
                      'truncate text-sm',
                      hasUnread
                        ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                        : 'font-medium text-neutral-800 dark:text-neutral-200',
                    )}>
                      {name}
                    </p>
                    {conv.lastMessageAt && (
                      <span className="shrink-0 text-[10px] text-neutral-400">
                        {msgDate(conv.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {cleanPreview(conv.lastMessagePreview) || conv.phone}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {hasUnread && (
                      <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-600 px-1 text-[9px] font-bold text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                    <WindowStatusChip lastInboundAt={conv.lastInboundAt} />
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Template message bubble ───────────────────────────────────────────────────

function TemplateBubble({ message, isOut }: { message: WaMessage; isOut: boolean }) {
  const qc = useQueryClient();
  const cached = qc.getQueryData<{ templates: WaTemplate[] }>(['wa-templates']);
  const tpl = cached?.templates.find((t) => t.id === message.templateId);

  // Extract category (Template/Campaign/Broadcast) and name from content placeholder
  const contentMatch = message.content?.match(/^\[(Template|Campaign|Broadcast):\s*(.+?)\]$/i);
  const contentCategory = contentMatch?.[1] ?? 'Template';
  const contentName = contentMatch?.[2];

  const displayName = tpl?.name ?? contentName ?? null;
  const headerLabel = displayName ? `${contentCategory} · ${displayName}` : contentCategory;

  return (
    <div className={cn(
      'max-w-[75%] rounded-2xl px-3 py-2.5 text-sm shadow-sm',
      isOut
        ? 'bg-primary-600 text-white rounded-br-sm'
        : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700',
    )}>
      <div className={cn(
        'mb-1.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide',
        isOut ? 'text-white/60' : 'text-neutral-400',
      )}>
        <FileText className="h-2.5 w-2.5" aria-hidden />
        {headerLabel}
      </div>
      {tpl?.bodyPreview ? (
        <p className="whitespace-pre-wrap break-words">{tpl.bodyPreview}</p>
      ) : displayName ? (
        <p className={cn('text-xs', isOut ? 'text-white/80' : 'text-neutral-600 dark:text-neutral-300')}>
          {displayName}
        </p>
      ) : (
        <p className={cn('text-xs italic', isOut ? 'text-white/60' : 'text-neutral-400')}>
          Template message
        </p>
      )}
      <div className={cn('mt-1 flex items-center gap-1', isOut ? 'justify-end' : 'justify-start')}>
        <span className={cn('text-[9px]', isOut ? 'text-white/70' : 'text-neutral-400')}>
          {msgTime(message.timestamp)}
        </span>
        {isOut && <DeliveryIcon status={message.msgStatus} />}
      </div>
    </div>
  );
}

// ── Flow response bubble — completed WhatsApp Flow answer, structured ─────────

function FlowResponseFields({ fields, isOut }: { fields: FlowFieldItem[]; isOut: boolean }) {
  return (
    <dl className="space-y-1">
      {fields.map((f) => (
        <div key={f.key}>
          <dt className={cn('text-[10px] font-medium uppercase tracking-wide', isOut ? 'text-white/70' : 'text-neutral-400')}>
            {f.label}
          </dt>
          <dd className="text-sm break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

// Content is a backend-generated placeholder — suppress it when media renders
const PLACEHOLDER_RE = /^\[(image|video|audio|document|sticker|voice|Broadcast:)/i;

function MessageBubble({ message }: { message: WaMessage }) {
  const isOut = message.direction === 'outbound';

  if (message.type === 'template') {
    return (
      <div className={cn('mb-1.5 flex', isOut ? 'justify-end' : 'justify-start')}>
        <TemplateBubble message={message} isOut={isOut} />
      </div>
    );
  }

  if (message.type === 'flow_response') {
    const hasFields = (message.flowFields?.length ?? 0) > 0;
    return (
      <div className={cn('mb-1.5 flex', isOut ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm',
            isOut
              ? 'bg-primary-600 text-white rounded-br-sm'
              : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700',
          )}
        >
          {message.flowName && (
            <p className={cn('mb-1 text-xs font-semibold', isOut ? 'text-white/90' : 'text-neutral-500')}>
              <span aria-hidden="true">📋</span> {message.flowName}
            </p>
          )}
          {hasFields ? (
            <FlowResponseFields fields={message.flowFields!} isOut={isOut} />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
          <div className={cn('mt-1 flex items-center gap-1', isOut ? 'justify-end' : 'justify-start')}>
            <span className={cn('text-[9px]', isOut ? 'text-white/70' : 'text-neutral-400')}>
              {msgTime(message.timestamp)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const isMedia = !!(message.type && message.type !== 'text');
  const hasMediaSource = !!(message.s3Key || message.mediaId || message.mediaUrl);
  const showText = message.content && !(isMedia && PLACEHOLDER_RE.test(message.content));

  return (
    <div className={cn('mb-1.5 flex', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          isOut
            ? 'bg-primary-600 text-white rounded-br-sm'
            : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700',
        )}
      >
        {isMedia && hasMediaSource && (
          <div className={cn(showText ? 'mb-1.5' : '')}>
            <MediaRenderer message={message} isOut={isOut} />
          </div>
        )}
        {isMedia && !hasMediaSource && (
          <p className={cn('text-xs italic', isOut ? 'text-white/70' : 'text-neutral-400')}>
            {message.content || `[${message.type ?? 'media'}]`}
          </p>
        )}
        {showText && (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}
        <div className={cn('mt-0.5 flex items-center gap-1', isOut ? 'justify-end' : 'justify-start')}>
          <span className={cn('text-[9px]', isOut ? 'text-white/70' : 'text-neutral-400')}>
            {msgTime(message.timestamp)}
          </span>
          {isOut && <DeliveryIcon status={message.msgStatus} />}
        </div>
      </div>
    </div>
  );
}

// ── Expired-window template picker ───────────────────────────────────────────

function ExpiredWindowSendBar({ conversation }: { conversation: WaConversation }) {
  const qc = useQueryClient();
  const convKey = conversation.leadId ?? conversation.phone;
  const [showPicker, setShowPicker] = useState(false);
  const [selectedTmplId, setSelectedTmplId] = useState('');

  const { data: tmplData, isLoading: tmplLoading } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ templates: WaTemplate[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
    enabled: showPicker,
  });
  const templates = tmplData?.templates ?? [];

  const sendTemplateMutation = useMutation({
    mutationFn: (templateId: string) => {
      const body: Record<string, string> = { templateId };
      if (conversation.type === 'lead' && conversation.PK) {
        body.leadPK = conversation.PK;
      } else {
        body.phone = conversation.phone;
      }
      return apiFetch('/api/whatsapp/send-template', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      setShowPicker(false);
      setSelectedTmplId('');
      toast.success('Template sent — conversation window re-opened');
    },
    onError: () => toast.error('Failed to send template. Check template configuration.'),
  });

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-800/60">
        <Lock className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Window closed · Send a template to re-open</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPicker((v) => !v)}
          className="shrink-0 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          {showPicker ? 'Cancel' : 'Send Template'}
        </Button>
      </div>

      {showPicker && (
        <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-3 space-y-2 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Choose a template to re-open this conversation
          </p>
          {tmplLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden />
              <span className="text-xs text-neutral-500">Loading templates…</span>
            </div>
          ) : templates.length === 0 ? (
            <p className="py-1 text-xs text-neutral-400">
              No approved templates found. Configure templates in Meta Business Manager.
            </p>
          ) : (
            <div className="scrollbar-thin max-h-48 space-y-1.5 overflow-y-auto">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTmplId(t.id === selectedTmplId ? '' : t.id)}
                  className={cn(
                    'w-full rounded-lg border p-2.5 text-left transition-colors',
                    selectedTmplId === t.id
                      ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
                      : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600',
                  )}
                >
                  <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{t.name}</p>
                  {t.bodyPreview && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-neutral-500">{t.bodyPreview}</p>
                  )}
                </button>
              ))}
            </div>
          )}
          {selectedTmplId && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => sendTemplateMutation.mutate(selectedTmplId)}
              loading={sendTemplateMutation.isPending}
              iconLeft={<Send className="h-4 w-4" />}
              className="w-full justify-center"
            >
              Send Template
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thread Pane ───────────────────────────────────────────────────────────────

function ThreadPane({
  conversation,
  onOpenSnapshot,
}: {
  conversation: WaConversation;
  onOpenSnapshot: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [now, setNow] = useState(Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live clock for WABA 24h window countdown (1-second tick)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const convKey = conversation.leadId ?? conversation.phone;
  const displayName = convDisplayName(conversation);

  const { data, isLoading } = useQuery<{ messages: WaMessage[] }>({
    queryKey: ['wa-conv', convKey],
    queryFn: () => {
      if (conversation.type === 'lead' && conversation.leadId) {
        return apiFetch(`/api/crm/leads/${conversation.leadId}`);
      }
      return apiFetch(`/api/whatsapp/inbox/unknown/${conversation.phone}/messages`);
    },
    staleTime: 0,
    refetchInterval: 5_000,
  });

  const messages = data?.messages ?? [];

  // Derive effective lastInboundAt from messages so the countdown resets instantly
  // when a new inbound message arrives via WebSocket without waiting for an inbox refetch.
  const effectiveLastInboundAt = (() => {
    const inbound = messages.filter((m) => m.direction === 'inbound');
    if (inbound.length > 0) return inbound[inbound.length - 1].timestamp;
    return conversation.lastInboundAt;
  })();

  const windowRemainingMs = getWindowRemainingMs(effectiveLastInboundAt, now);
  const windowExpired = windowRemainingMs === 0;
  const windowClosingSoon = !windowExpired && windowRemainingMs <= CLOSING_SOON_MS;

  // Mark conversation as read when opened (clears unread badge + sends read receipts)
  useEffect(() => {
    if ((conversation.unreadCount ?? 0) === 0) return;
    if (conversation.type === 'lead' && conversation.leadId) {
      apiFetch(`/api/whatsapp/inbox/${conversation.leadId}/mark-read`, { method: 'POST' })
        .then(() => qc.invalidateQueries({ queryKey: ['wa-inbox'] }))
        .catch(() => {});
    } else if (conversation.type === 'unknown') {
      apiFetch(`/api/whatsapp/inbox/unknown/${conversation.phone}/mark-read`, { method: 'POST' })
        .then(() => qc.invalidateQueries({ queryKey: ['wa-inbox'] }))
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convKey]);

  // Resolve / Reopen conversation (only available for CRM leads, not unknown contacts)
  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!conversation.leadId) return;
      const isOpen = conversation.chatStatus === 'open' || conversation.chatStatus === 'unassigned';
      await apiFetch(`/api/whatsapp/inbox/${conversation.leadId}/${isOpen ? 'resolve' : 'reopen'}`, { method: 'PUT' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.success(conversation.chatStatus === 'resolved' ? 'Conversation reopened' : 'Conversation resolved');
    },
    onError: () => toast.error('Failed to update conversation status'),
  });

  // Real-time: refetch when a WA message arrives for this conversation
  useEffect(() => {
    const handler = (wsMsg: WsMessage) => {
      const p = wsMsg as WsMessage & { conversationId?: string; phone?: string; from?: string };
      const isThis = conversation.type === 'lead'
        ? p.conversationId === conversation.leadId
        : (p.phone === conversation.phone || String(p.from) === conversation.phone);
      if (isThis) {
        qc.refetchQueries({ queryKey: ['wa-conv', convKey] });
      }
    };
    wsClient.on('whatsapp_message', handler);
    return () => wsClient.off('whatsapp_message', handler);
  }, [qc, convKey, conversation]);

  const sendMutation = useMutation({
    mutationFn: (text: string) => {
      if (conversation.type === 'lead' && conversation.PK) {
        return apiFetch('/api/whatsapp/send', {
          method: 'POST',
          body: JSON.stringify({ leadPK: conversation.PK, message: text }),
        });
      }
      return apiFetch(`/api/whatsapp/inbox/unknown/${conversation.phone}/send`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
    },
    onMutate: async (text) => {
      const optimistic: WaMessage = {
        SK: `opt-${Date.now()}`,
        direction: 'outbound',
        content: text,
        timestamp: new Date().toISOString(),
        msgStatus: 'sent',
      };
      qc.setQueryData<{ messages: WaMessage[] }>(['wa-conv', convKey], (old) => ({
        ...old,
        messages: [...(old?.messages ?? []), optimistic],
      }));
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      toast.error('Failed to send message. Try again.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleFileSelect(file: File) {
    setUploadFile(file);
    setIsUploading(true);
    try {
      // 1. Get presigned S3 PUT URL
      const { uploadUrl, key } = await apiFetch<{ uploadUrl: string; key: string }>(
        `/api/whatsapp/upload-url?mimeType=${encodeURIComponent(file.type)}&filename=${encodeURIComponent(file.name)}&fileSize=${file.size}`,
      );

      // 2. PUT file directly to S3 — XHR used (not fetch) to get upload progress events
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('S3 upload failed'));
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      // 3. Tell backend to send from S3 → Meta → recipient
      const body: Record<string, string> = {
        s3Key: key,
        mimeType: file.type,
        filename: file.name,
        ...(draft.trim() ? { caption: draft.trim() } : {}),
      };
      if (conversation.type === 'lead' && conversation.PK) {
        body.leadPK = conversation.PK;
      } else {
        body.phone = conversation.phone;
      }

      await apiFetch('/api/whatsapp/upload-send', { method: 'POST', body: JSON.stringify(body) });

      setDraft('');
      qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.success('Media sent');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to send media');
    } finally {
      setIsUploading(false);
      setUploadFile(null);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleSend() {
    if (!draft.trim()) return;
    sendMutation.mutate(draft.trim());
    setDraft('');
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Group messages by date
  const grouped: { date: string; messages: WaMessage[] }[] = [];
  for (const msg of messages) {
    const d = format(new Date(msg.timestamp), 'EEEE, d MMMM yyyy');
    const last = grouped[grouped.length - 1];
    if (last?.date === d) last.messages.push(msg);
    else grouped.push({ date: d, messages: [msg] });
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-900">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <Avatar name={displayName} size={32} />
        <div className="min-w-0 flex-1">
          {/* On xl+ (panel always visible) this acts as a label; on smaller screens it opens the panel */}
          <button
            onClick={onOpenSnapshot}
            className="text-sm font-semibold text-neutral-900 hover:text-primary-600 dark:text-neutral-100 xl:cursor-default xl:hover:text-neutral-900 xl:dark:hover:text-neutral-100"
          >
            {displayName}
          </button>
          <p className="text-xs text-neutral-500">{conversation.phone}</p>
        </div>
        <div className="flex items-center gap-1">
          {conversation.leadId && (
            <Button
              variant="ghost"
              size="sm"
              loading={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate()}
              className={cn(
                'text-xs font-medium',
                conversation.chatStatus === 'resolved'
                  ? 'text-success-600 hover:text-success-700'
                  : 'text-neutral-500 hover:text-neutral-700',
              )}
            >
              {conversation.chatStatus === 'resolved' ? 'Reopen' : 'Resolve'}
            </Button>
          )}
          <Button variant="ghost" size="sm" iconLeft={<Phone className="h-4 w-4" />} aria-label="Call contact" />
          <Button variant="ghost" size="sm" iconLeft={<MoreHorizontal className="h-4 w-4" />} aria-label="More options" />
        </div>
      </div>

      {/* WABA 24h window closing-soon banner (expired state is handled by the composer bar) */}
      {windowClosingSoon && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/40 dark:bg-amber-900/10" role="status">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Window closes in <strong>{formatCountdown(windowRemainingMs)}</strong> — reply before it expires.
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                <Skeleton className={cn('h-10 rounded-2xl', i % 2 === 0 ? 'w-48' : 'w-56')} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No messages yet" description="Start the conversation" />
        ) : (
          grouped.map(({ date, messages: dayMsgs }) => (
            <div key={date}>
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
                <span className="text-[10px] text-neutral-400">{date}</span>
                <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
              </div>
              {dayMsgs.map((msg) => (
                <MessageBubble key={msg.SK} message={msg} />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply bar */}
      <div className="border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        {windowExpired ? (
          <ExpiredWindowSendBar conversation={conversation} />
        ) : (
          <>
            {/* Upload progress indicator */}
            {isUploading && uploadFile && (
              <div className="mb-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300">
                <div className="flex items-center gap-2">
                  {uploadProgress > 0 && uploadProgress < 100
                    ? <span className="text-[10px] font-bold tabular-nums w-8 shrink-0">{uploadProgress}%</span>
                    : <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />}
                  <span className="truncate flex-1">Uploading &ldquo;{uploadFile.name}&rdquo;</span>
                </div>
                {uploadProgress > 0 && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-primary-200 dark:bg-primary-900">
                    <div
                      className="h-1 rounded-full bg-primary-600 transition-[width] duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Hidden file input — accept is set dynamically before .click() */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                  fileInputRef.current.accept = 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx';
                }
              }}
            />

            {/* Composer toolbar */}
            <ComposerToolbar
              conversation={conversation}
              draft={draft}
              onDraftChange={setDraft}
              onFileAccept={(accept) => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = accept;
                  fileInputRef.current.click();
                }
              }}
              onTemplateSent={() => {
                qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
                qc.invalidateQueries({ queryKey: ['wa-inbox'] });
              }}
              disabled={isUploading || sendMutation.isPending}
            />

            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                rows={1}
                className="scrollbar-thin max-h-24 flex-1 resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                style={{ minHeight: 40 }}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleSend}
                disabled={!draft.trim() || isUploading}
                loading={sendMutation.isPending}
                iconLeft={<Send className="h-4 w-4" />}
                aria-label="Send message"
              />
            </div>
            <p className="mt-1.5 text-[10px] text-neutral-400">WhatsApp · Enter to send · Shift+Enter for newline</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Unknown-contact employee picker ──────────────────────────────────────────
// Creates a CRM lead from an INBOX# unknown contact and assigns it in one step.

function UnknownContactAssignPicker({
  conversation,
  onConvUpdate,
  onInboxRefresh,
  onTabSwitch,
}: {
  conversation: WaConversation;
  onConvUpdate?: (u: Partial<WaConversation>) => void;
  onInboxRefresh: () => void;
  onTabSwitch?: (t: ConvTab) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const { employees, isLoading } = useEmployeesList({ enabled: editing });

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
      try { selectRef.current.showPicker?.(); } catch { /* ignore */ }
    }
  }, [editing]);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const employeeId = e.target.value;
    if (!employeeId) { setEditing(false); return; }
    const employee = employees.find((emp) => emp.id === employeeId);
    if (!employee) { setEditing(false); return; }

    setIsPending(true);
    try {
      const created = await apiFetch<{ success: boolean; lead: { leadId: string } }>(
        '/api/crm/leads',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: conversation.phone,
            name: conversation.name ?? conversation.displayName ?? conversation.phone,
            source: 'whatsapp',
            assignedTo: employeeId,
            assignedToName: employee.name,
          }),
        },
      );
      const newLeadId = created?.lead?.leadId;
      if (!newLeadId) throw new Error('No leadId returned');

      // Bridge message cache: copy INBOX# messages (keyed by phone) to the new
      // lead's cache key so the thread doesn't go blank while the refetch resolves.
      // GET /api/crm/leads/:id now also merges INBOX# messages server-side, so the
      // refetch will return the same complete history.
      const existingMsgs = qc.getQueryData<{ messages: WaMessage[] }>(['wa-conv', conversation.phone]);
      if (existingMsgs) {
        qc.setQueryData(['wa-conv', newLeadId], existingMsgs);
      }

      // Optimistic cache update: move conversation from Unassigned → Open immediately
      // so the list doesn't blank out while the server refetch resolves.
      // The backend fix (copying lastMessageAt from INBOX# into the new LEAD#) ensures
      // the server refetch also returns this conversation correctly.
      const optimisticConv: WaConversation = {
        ...conversation,
        leadId: newLeadId,
        type: 'lead',
        assignedTo: employeeId,
        assignedToName: employee.name,
        chatStatus: 'open',
      };
      qc.setQueryData<{ conversations: WaConversation[]; counts: Record<string, number> }>(
        ['wa-inbox', 'open'],
        (old) => {
          if (!old) return old;
          return {
            conversations: [optimisticConv, ...old.conversations.filter((c) => c.phone !== conversation.phone)],
            counts: { ...old.counts, open: (old.counts.open ?? 0) + 1 },
          };
        },
      );
      qc.setQueryData<{ conversations: WaConversation[]; counts: Record<string, number> }>(
        ['wa-inbox', 'unassigned'],
        (old) => {
          if (!old) return old;
          return {
            conversations: old.conversations.filter((c) => c.phone !== conversation.phone),
            counts: { ...old.counts, unassigned: Math.max(0, (old.counts.unassigned ?? 0) - 1) },
          };
        },
      );

      onConvUpdate?.({
        leadId: newLeadId,
        type: 'lead',
        assignedTo: employeeId,
        assignedToName: employee.name,
        chatStatus: 'open',
      });
      onTabSwitch?.('open');
      onInboxRefresh();
      toast.success('Contact created and assigned');
    } catch (err) {
      // 409 = this phone already has a CRM lead. Link the inbox conversation to
      // the existing lead instead of creating a duplicate.
      if (err instanceof ApiClientError && err.status === 409) {
        const existingLeadId = err.body?.existingLeadId as string | undefined;
        const existingName   = err.body?.existingName   as string | undefined;

        if (existingLeadId) {
          // Copy message cache to the existing lead key so the thread stays populated.
          const existingMsgs = qc.getQueryData<{ messages: WaMessage[] }>(['wa-conv', conversation.phone]);
          if (existingMsgs) qc.setQueryData(['wa-conv', existingLeadId], existingMsgs);

          // Move this conversation from Unassigned into Open under the existing lead.
          const linkedConv: WaConversation = {
            ...conversation,
            leadId: existingLeadId,
            type: 'lead',
            chatStatus: 'open',
          };
          qc.setQueryData<{ conversations: WaConversation[]; counts: Record<string, number> }>(
            ['wa-inbox', 'open'],
            (old) => {
              if (!old) return old;
              return {
                conversations: [linkedConv, ...old.conversations.filter((c) => c.phone !== conversation.phone)],
                counts: { ...old.counts, open: (old.counts.open ?? 0) + 1 },
              };
            },
          );
          qc.setQueryData<{ conversations: WaConversation[]; counts: Record<string, number> }>(
            ['wa-inbox', 'unassigned'],
            (old) => {
              if (!old) return old;
              return {
                conversations: old.conversations.filter((c) => c.phone !== conversation.phone),
                counts: { ...old.counts, unassigned: Math.max(0, (old.counts.unassigned ?? 0) - 1) },
              };
            },
          );

          onConvUpdate?.({ leadId: existingLeadId, type: 'lead', chatStatus: 'open' });
          onTabSwitch?.('open');
          onInboxRefresh();
          toast.info(
            existingName
              ? `This contact already exists as "${existingName}". Conversation linked to existing contact.`
              : 'This contact already exists. Conversation linked to existing contact.',
          );
        } else {
          // 409 but no leadId in body — unusual; tell user without being generic.
          toast.warning('This contact already exists in the system. Refresh the inbox to find them.');
        }
      } else {
        toast.error('Failed to assign contact');
      }
    } finally {
      setIsPending(false);
      setEditing(false);
    }
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" aria-hidden />
        <span className="text-sm text-neutral-500">Assigning…</span>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <select
          ref={selectRef}
          defaultValue=""
          onChange={handleChange}
          onBlur={() => setEditing(false)}
          disabled={isLoading}
          aria-label="Assign owner"
          className="w-full appearance-none rounded-md border border-primary-400 bg-white py-1 pl-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-neutral-900 dark:border-primary-600 dark:text-neutral-100"
        >
          <option value="" disabled>
            {isLoading ? 'Loading…' : 'Select employee'}
          </option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
      title="Click to assign"
    >
      <Avatar name="?" size={20} />
      <span className="flex-1 text-sm text-neutral-500">Unassigned — click to assign</span>
      <ChevronDown className="h-3.5 w-3.5 text-neutral-400 opacity-0 group-hover:opacity-60 transition-opacity" aria-hidden />
    </button>
  );
}

// ── Snapshot Panel ────────────────────────────────────────────────────────────

function CustomerSnapshotPanel({
  conversation,
  onClose,
  onConvUpdate,
  onTabSwitch,
}: {
  conversation: WaConversation;
  onClose: () => void;
  onConvUpdate?: (u: Partial<WaConversation>) => void;
  onTabSwitch?: (t: ConvTab) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const canEditOwner = ['owner', 'admin'].includes(v3Role);
  const { stages: pipelineStages } = usePipelineStages();
  const STAGE_OPTIONS = pipelineStages.map((s) => ({ value: s.key, label: s.label }));
  const displayName = convDisplayName(conversation);

  // Subscribe to live assignment cache — updates immediately when useOwnerAssign fires
  const { data: cachedAssign } = useQuery<AssignmentRecord>({
    queryKey: assignmentKey(conversation.leadId ?? '__no_lead__'),
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

  // Derive chatStatus: if we just assigned someone, treat as 'open' even before inbox refetch
  const effectiveChatStatus: WaConversation['chatStatus'] =
    cachedAssign?.assignedTo && conversation.chatStatus === 'unassigned'
      ? 'open'
      : conversation.chatStatus;

  const stageMutation = useMutation({
    mutationFn: (stage: string) => {
      if (conversation.leadId) {
        return apiFetch(`/api/crm/leads/${conversation.leadId}/stage`, {
          method: 'PUT',
          body: JSON.stringify({ stage }),
        });
      }
      return apiFetch('/api/contacts/stage', {
        method: 'PUT',
        body: JSON.stringify({ phone: conversation.phone, stage }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-inbox'] });
      toast.success('Stage updated');
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? (err.body?.error as string | undefined) ?? err.message : undefined;
      toast.error(msg ?? 'Failed to update stage');
    },
  });

  // Notes are lead-scoped only (no unknown-contact notes endpoint exists yet).
  // Shares the ['wa-conv', convKey] cache the main chat panel already owns —
  // so a note posted here shows up immediately, and vice versa, with no
  // extra network cost once both are mounted.
  const convKey = conversation.leadId ?? conversation.phone;
  const { data: convData } = useQuery<{ internalNotes?: InternalNoteItem[] }>({
    queryKey: ['wa-conv', convKey],
    queryFn: () => apiFetch(`/api/crm/leads/${conversation.leadId}`),
    enabled: !!conversation.leadId,
  });
  const notesList = useMemo(() => [...(convData?.internalNotes ?? [])].reverse(), [convData]);

  const [noteText, setNoteText] = useState('');
  const [editingSK, setEditingSK] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  function refreshNotes() {
    qc.invalidateQueries({ queryKey: ['wa-conv', convKey] });
  }

  const addNote = useAddNote(conversation.leadId, () => {
    refreshNotes();
    setNoteText('');
    toast.success('Note saved');
  });
  const editNote = useEditNote(conversation.leadId, () => {
    refreshNotes();
    setEditingSK(null);
    toast.success('Note updated');
  });
  const deleteNote = useDeleteNote(conversation.leadId, () => {
    refreshNotes();
    toast.success('Note deleted');
  });

  function handleAddNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    addNote.mutate(trimmed);
  }
  function startEdit(note: InternalNoteItem) {
    setEditingSK(note.SK);
    setEditText(note.content);
  }
  function saveEdit(note: InternalNoteItem) {
    const trimmed = editText.trim();
    if (!trimmed) return;
    editNote.mutate({ timestamp: note.timestamp, content: trimmed });
  }

  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Contact Info</p>
        {/* Close button — only on smaller screens; on xl the panel is always pinned */}
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="xl:hidden flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Identity */}
        <div className="flex flex-col items-center gap-2 text-center">
          {conversation.leadId ? (
            <Link href={`/contacts/${conversation.leadId}`} title="Open Customer360">
              <Avatar name={displayName} size={48} className="cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-1 transition" />
            </Link>
          ) : (
            <Avatar name={displayName} size={48} />
          )}
          <div>
            {conversation.leadId ? (
              <Link
                href={`/contacts/${conversation.leadId}`}
                className="font-semibold text-neutral-900 hover:text-primary-600 dark:text-neutral-100 dark:hover:text-primary-400 transition-colors"
              >
                {displayName}
              </Link>
            ) : (
              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{displayName}</p>
            )}
            <p className="text-xs text-neutral-500">{conversation.phone}</p>
          </div>
        </div>

        {/* Stage */}
        {conversation.stage !== undefined && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Stage</p>
            <Select
              options={STAGE_OPTIONS}
              value={conversation.stage ?? ''}
              onChange={(e) => stageMutation.mutate(e.target.value)}
              aria-label="Contact stage"
              disabled={stageMutation.isPending}
            />
          </div>
        )}

        {/* Tags — available for all contacts (leads and unknown) */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Tags</p>
          <ContactTags
            tagIds={conversation.tags ?? []}
            leadId={conversation.leadId ?? undefined}
            phone={conversation.phone}
            onMutated={() => qc.invalidateQueries({ queryKey: ['wa-inbox'] })}
          />
        </div>

        {/* Assigned to — editable for leads and (via create-CRM-lead) for unknown contacts */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Assigned to</p>
          {conversation.leadId ? (
            <OwnerSelect
              contactId={conversation.leadId}
              isLead
              currentOwnerName={conversation.assignedToName}
              currentOwnerId={conversation.assignedTo}
              canEdit={canEditOwner}
              onSuccess={() => { qc.invalidateQueries({ queryKey: ['wa-inbox'] }); onTabSwitch?.('open'); }}
            />
          ) : canEditOwner ? (
            <UnknownContactAssignPicker
              conversation={conversation}
              onConvUpdate={onConvUpdate}
              onInboxRefresh={() => qc.invalidateQueries({ queryKey: ['wa-inbox'] })}
              onTabSwitch={onTabSwitch}
            />
          ) : (
            <p className="text-sm text-neutral-500">
              {conversation.assignedToName ?? 'Unassigned'}
            </p>
          )}
        </div>

        {/* Chat status — reads effectiveChatStatus so badge updates immediately after assignment */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Status</p>
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            effectiveChatStatus === 'open'       ? 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300' :
            effectiveChatStatus === 'resolved'   ? 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' :
                                                   'bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-300',
          )}>
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              effectiveChatStatus === 'open'       ? 'bg-success-500' :
              effectiveChatStatus === 'resolved'   ? 'bg-neutral-400' : 'bg-warning-500',
            )} />
            {effectiveChatStatus === 'open' ? 'Open' : effectiveChatStatus === 'resolved' ? 'Resolved' : 'Unassigned'}
          </span>
        </div>

        {/* WhatsApp opt-in indicator */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">WhatsApp</p>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
            <span className="text-xs text-neutral-600 dark:text-neutral-400">Opted in</span>
          </div>
        </div>

        {/* Internal notes */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Internal Notes</p>
          {conversation.leadId ? (
            <>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note visible only to your team…"
                rows={3}
                disabled={addNote.isPending}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddNote(); }}
                aria-label="Internal note"
                className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600/20 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder:text-neutral-600"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[10px] text-neutral-400">Cmd/Ctrl + Enter to post</p>
                <button
                  type="button"
                  onClick={handleAddNote}
                  disabled={addNote.isPending || !noteText.trim()}
                  className="rounded-md bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
                >
                  {addNote.isPending ? 'Posting…' : 'Post Note'}
                </button>
              </div>

              {notesList.length > 0 && (
                <ul className="mt-2.5 space-y-1.5">
                  {notesList.map((note) => {
                    const canModify = canModifyNote(note, user);
                    const isEditing = editingSK === note.SK;
                    return (
                      <li
                        key={note.SK}
                        className="group rounded-lg border border-neutral-100 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900/40"
                      >
                        {isEditing ? (
                          <>
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={2}
                              autoFocus
                              aria-label="Edit note"
                              className="w-full resize-none rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                            />
                            <div className="mt-1 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingSK(null)}
                                className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveEdit(note)}
                                disabled={editNote.isPending || !editText.trim()}
                                className="text-[10px] font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50"
                              >
                                {editNote.isPending ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">{note.content}</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] text-neutral-400">
                                {note.authorName ?? 'Agent'} · {formatRelativeTime(note.timestamp)}
                                {note.editedAt ? ' (edited)' : ''}
                              </p>
                              {canModify && (
                                <div className="flex shrink-0 gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => startEdit(note)}
                                    className="text-[10px] text-neutral-400 hover:text-primary-600"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteNote.mutate(note.timestamp)}
                                    disabled={deleteNote.isPending}
                                    className="text-[10px] text-neutral-400 hover:text-error-600"
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : (
            <p className="text-xs text-neutral-400">Notes require this contact to be a CRM lead first.</p>
          )}
        </div>

        {/* Open Customer360 */}
        {conversation.leadId && (
          <Link
            href={`/contacts/${conversation.leadId}`}
            className="block w-full rounded-lg border border-neutral-200 py-2 text-center text-xs font-medium text-primary-600 hover:bg-primary-50 dark:border-neutral-700 dark:hover:bg-primary-900/10"
          >
            Open Customer 360 →
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Broadcast section ─────────────────────────────────────────────────────────

interface WaTemplate { id: string; name: string; templateName: string; variables: string[]; bodyPreview: string; }
interface CrmStage { key: string; label: string; color: string; }
interface BroadcastRecord {
  id: string; templateName: string; sent: number; failed: number; totalMatched: number;
  deliveredCount?: number; readCount?: number;
  createdByName?: string; createdAt: string; filter: Record<string, unknown>;
}
interface BroadcastResult { sent: number; failed: number; total: number; errors: { phone: string; error: string }[]; }

function BroadcastSection() {
  const qc = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [varValues, setVarValues] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const { data: tmplData } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ templates: WaTemplate[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
  });
  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ stages: CrmStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });
  const { data: historyData } = useQuery({
    queryKey: ['wa-broadcasts'],
    queryFn: () => apiFetch<{ broadcasts: BroadcastRecord[] }>('/api/whatsapp/broadcasts'),
    staleTime: 30_000,
  });

  const broadcastMut = useMutation({
    mutationFn: () => apiFetch<BroadcastResult>('/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        templateId: selectedTemplate,
        variableValues: varValues,
        filter: {
          stages: filterStages.length ? filterStages : undefined,
          tags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        },
      }),
    }),
    onSuccess: (data) => { setResult(data); setConfirmed(false); qc.invalidateQueries({ queryKey: ['wa-broadcasts'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const templates = tmplData?.templates ?? [];
  const stages = pipelineData?.stages ?? [];
  const broadcasts = historyData?.broadcasts ?? [];
  const tmpl = templates.find((t) => t.id === selectedTemplate);

  function toggleStage(key: string) {
    setFilterStages((prev) => prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]);
  }

  return (
    <div className="space-y-5 p-4">
      {result && (
        <div className={cn('rounded-xl border p-4', result.failed === 0 ? 'border-success-200 bg-success-50 dark:border-success-900/30 dark:bg-success-900/10' : 'border-warning-200 bg-warning-50 dark:border-warning-900/30 dark:bg-warning-900/10')}>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-bold text-neutral-900 dark:text-white">Broadcast Complete</p>
              <p className="text-xs text-neutral-500">{result.sent} sent · {result.failed} failed · {result.total} matched</p>
            </div>
            <button onClick={() => setResult(null)} className="text-neutral-400 hover:text-neutral-600">×</button>
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500">Show {result.errors.length} errors</summary>
              <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-white p-2 text-xs dark:bg-neutral-800">
                {result.errors.map((e, i) => <p key={i} className="text-error-500">{e.phone}: {e.error}</p>)}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Config */}
        <div className="space-y-4 lg:col-span-2">
          {/* Template picker */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">1. Choose Template</p>
            {templates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 p-4 text-center dark:border-neutral-700">
                <p className="text-sm text-neutral-400">No templates configured yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <label key={t.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors', selectedTemplate === t.id ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20' : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700')}>
                    <input type="radio" name="template" value={t.id} checked={selectedTemplate === t.id}
                      onChange={() => { setSelectedTemplate(t.id); setVarValues(Array(t.variables.length).fill('')); }}
                      className="mt-0.5 accent-primary-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white">{t.name}</p>
                      <p className="font-mono text-[10px] text-neutral-400">{t.templateName}</p>
                      {t.bodyPreview && <p className="mt-1 text-xs text-neutral-500">{t.bodyPreview}</p>}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Variables */}
          {tmpl && tmpl.variables.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">2. Variable Values</p>
              <div className="space-y-2">
                {tmpl.variables.map((v, i) => (
                  <div key={i}>
                    <label className="mb-1 block text-xs font-medium text-neutral-500">{`{{${i + 1}}}`} {v}</label>
                    <input value={varValues[i] ?? ''} onChange={(e) => { const n = [...varValues]; n[i] = e.target.value; setVarValues(n); }}
                      placeholder="e.g. {{name}}"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">3. Audience Filter <span className="text-neutral-400 font-normal">(optional)</span></p>
            <div className="space-y-3">
              {stages.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-neutral-500">Pipeline Stages</p>
                  <div className="flex flex-wrap gap-2">
                    {stages.map((s) => (
                      <button key={s.key} onClick={() => toggleStage(s.key)}
                        className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', filterStages.includes(s.key) ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400' : 'border-neutral-200 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700')}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-500">Tags (comma-separated)</p>
                <input value={filterTags} onChange={(e) => setFilterTags(e.target.value)}
                  placeholder="e.g. hot-lead, high-value"
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" />
              </div>
            </div>
          </div>

          {/* Confirm + Send */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">4. Send</p>
            {!selectedTemplate ? (
              <p className="text-xs text-neutral-400">Select a template first</p>
            ) : (
              <div className="space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-primary-600" />
                  <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    I confirm this broadcast is authorised and compliant with WhatsApp messaging policies.
                  </p>
                </label>
                <Button loading={broadcastMut.isPending} disabled={!confirmed} onClick={() => broadcastMut.mutate()}
                  iconLeft={<Send className="h-4 w-4" />}>
                  Send Broadcast
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* History */}
        <div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Broadcast History</p>
            {broadcasts.length === 0 ? (
              <p className="text-xs text-neutral-400">No broadcasts yet</p>
            ) : (
              <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
                {broadcasts.map((b) => (
                  <li key={b.id} className="py-2.5">
                    <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate">{b.templateName}</p>
                    <p className="text-xs text-neutral-400">
                      {b.sent} sent · {b.failed} failed · {b.totalMatched} matched
                    </p>
                    <p className="text-xs text-neutral-300 dark:text-neutral-600">
                      {new Date(b.createdAt).toLocaleDateString('en-IN')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type CommPageMode = 'inbox' | 'broadcast';

function CommunicationsContent() {
  const [mode, setMode] = useState<CommPageMode>('inbox');
  const [activeTab, setActiveTab] = useState<ConvTab>('open');
  const [activeConv, setActiveConv] = useState<WaConversation | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const handleConvUpdate = useCallback((updates: Partial<WaConversation>) => {
    setActiveConv((prev) => prev ? { ...prev, ...updates } : null);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Mode switcher */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
          {([['inbox', 'Inbox'], ['broadcast', 'Broadcast']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)}
              className={cn('rounded-md px-4 py-1.5 text-xs font-medium transition', mode === id ? 'bg-primary-600 text-white' : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'broadcast' ? (
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          <BroadcastSection />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Column 1: Conversation list */}
          <div className={cn(
            'w-[280px] shrink-0',
            activeConv ? 'hidden md:block' : 'w-full md:w-[280px]',
          )}>
            <ConversationList
              activeTab={activeTab}
              onTabChange={setActiveTab}
              activeId={activeConv ? (activeConv.leadId ?? activeConv.phone) : undefined}
              onSelect={(conv) => { setActiveConv(conv); setSnapshotOpen(false); }}
            />
          </div>

          {/* Column 2: Thread */}
          {activeConv ? (
            <div className={cn('flex min-w-0 flex-1 flex-col', snapshotOpen ? 'hidden xl:flex' : 'flex')}>
              <button
                onClick={() => setActiveConv(null)}
                className="flex items-center gap-1 px-3 py-2 text-sm text-primary-600 md:hidden"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Back
              </button>
              <ThreadPane conversation={activeConv} onOpenSnapshot={() => setSnapshotOpen((o) => !o)} />
            </div>
          ) : (
            <div className="hidden flex-1 items-center justify-center bg-neutral-50 dark:bg-neutral-900 md:flex">
              <EmptyState
                icon={MessageSquare}
                title="Select a conversation"
                description="Choose a conversation from the left to start"
              />
            </div>
          )}

          {/* Column 3: Contact panel — always visible on xl+, toggled on smaller screens */}
          {activeConv && (
            <div className={cn('w-[320px] shrink-0', !snapshotOpen && 'hidden xl:block')}>
              <CustomerSnapshotPanel conversation={activeConv} onClose={() => setSnapshotOpen(false)} onConvUpdate={handleConvUpdate} onTabSwitch={setActiveTab} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function InboxPage() {
  return (
    <div className="flex h-full flex-col">
      <Suspense>
        <CommunicationsContent />
      </Suspense>
    </div>
  );
}
