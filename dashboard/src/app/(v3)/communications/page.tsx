'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import {
  MessageSquare, Search, Send, MoreHorizontal, Phone,
  CheckCheck, Check, Clock, AlertCircle, Plus, X, ChevronLeft,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Select } from '@/components/v3/ui/Select';
import { SkeletonRow, Skeleton } from '@/components/v3/ui/Skeleton';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { format, isToday, isYesterday } from 'date-fns';
import { STAGE_LABELS } from '@/types/v3';
import { wsClient } from '@/lib/wsClient';
import type { WsMessage } from '@/lib/wsClient';
import { toast } from 'sonner';

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
  assignedToName?: string | null;
  stage?: string | null;
  tags?: string[];
}

interface WaMessage {
  SK: string;
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: string;
  type?: string;
  mediaUrl?: string;
  mimeType?: string;
  filename?: string;
  msgStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  sentByName?: string;
}

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

function DeliveryIcon({ status }: { status?: WaMessage['msgStatus'] }) {
  if (status === 'read')      return <CheckCheck className="h-3.5 w-3.5 text-primary-300" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 text-white/60" aria-label="Delivered" />;
  if (status === 'sent')      return <Check className="h-3.5 w-3.5 text-white/60" aria-label="Sent" />;
  if (status === 'failed')    return <AlertCircle className="h-3.5 w-3.5 text-red-300" aria-label="Failed" />;
  return <Clock className="h-3.5 w-3.5 text-white/40" aria-label="Pending" />;
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

  const { data, isLoading } = useQuery<{ conversations: WaConversation[]; counts: Record<string, number> }>({
    queryKey: ['wa-inbox', activeTab],
    queryFn: async () => {
      const res = await apiFetch(`/api/whatsapp/inbox?status=${activeTab}`) as Response;
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: { conversations: [], counts: {} },
  });

  const conversations = data?.conversations ?? [];
  const counts = data?.counts ?? {};

  // Real-time: new WA message → refresh conversation list
  useEffect(() => {
    const handler = () => {
      qc.invalidateQueries({ queryKey: ['wa-inbox', activeTab] });
    };
    wsClient.on('whatsapp_message', handler);
    return () => wsClient.off('whatsapp_message', handler);
  }, [qc, activeTab]);

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
            Communications
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
                    {conv.lastMessagePreview || conv.phone}
                  </p>
                  {hasUnread && (
                    <div className="mt-1">
                      <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-600 px-1 text-[9px] font-bold text-white">
                        {conv.unreadCount}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: WaMessage }) {
  const isOut = message.direction === 'outbound';
  return (
    <div className={cn('mb-1.5 flex', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          isOut
            ? 'bg-primary-600 text-white rounded-br-sm'
            : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700',
        )}
      >
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const convKey = conversation.leadId ?? conversation.phone;
  const displayName = convDisplayName(conversation);

  const { data, isLoading } = useQuery<{ messages: WaMessage[] }>({
    queryKey: ['wa-conv', convKey],
    queryFn: async () => {
      if (conversation.type === 'lead' && conversation.leadId) {
        const res = await apiFetch(`/api/crm/leads/${conversation.leadId}`) as Response;
        return res.json();
      }
      const res = await apiFetch(`/api/whatsapp/inbox/unknown/${conversation.phone}/messages`) as Response;
      return res.json();
    },
    staleTime: 0,
    refetchInterval: 5_000,
  });

  const messages = data?.messages ?? [];

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
    mutationFn: async (text: string) => {
      if (conversation.type === 'lead' && conversation.PK) {
        const res = await apiFetch('/api/whatsapp/send', {
          method: 'POST',
          body: JSON.stringify({ leadPK: conversation.PK, message: text }),
        }) as Response;
        return res.json();
      }
      const res = await apiFetch(`/api/whatsapp/inbox/unknown/${conversation.phone}/send`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      }) as Response;
      return res.json();
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
          <button
            onClick={onOpenSnapshot}
            className="text-sm font-semibold text-neutral-900 hover:text-primary-600 dark:text-neutral-100"
          >
            {displayName}
          </button>
          <p className="text-xs text-neutral-500">{conversation.phone}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" iconLeft={<Phone className="h-4 w-4" />} aria-label="Call contact" />
          <Button variant="ghost" size="sm" iconLeft={<MoreHorizontal className="h-4 w-4" />} aria-label="More options" />
        </div>
      </div>

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
            disabled={!draft.trim()}
            loading={sendMutation.isPending}
            iconLeft={<Send className="h-4 w-4" />}
            aria-label="Send message"
          />
        </div>
        <p className="mt-1.5 text-[10px] text-neutral-400">WhatsApp · Enter to send</p>
      </div>
    </div>
  );
}

// ── Snapshot Panel ────────────────────────────────────────────────────────────

function CustomerSnapshotPanel({
  conversation,
  onClose,
}: {
  conversation: WaConversation;
  onClose: () => void;
}) {
  const STAGE_OPTIONS = Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }));
  const displayName = convDisplayName(conversation);

  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Contact Info</p>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Identity */}
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar name={displayName} size={48} />
          <div>
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">{displayName}</p>
            <p className="text-xs text-neutral-500">{conversation.phone}</p>
          </div>
          {conversation.leadId && (
            <a href={`/customers/${conversation.leadId}`} className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View full profile →
            </a>
          )}
        </div>

        {/* Stage */}
        {conversation.stage !== undefined && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Stage</p>
            <Select
              options={STAGE_OPTIONS}
              value={conversation.stage ?? ''}
              onChange={() => {}}
              aria-label="Contact stage"
            />
          </div>
        )}

        {/* Tags */}
        {(conversation.tags?.length ?? 0) > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Tags</p>
            <div className="flex flex-wrap gap-1">
              {conversation.tags?.map((tag) => (
                <Badge key={tag} variant="default">{tag}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Assigned to */}
        {conversation.assignedToName && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Assigned to</p>
            <p className="text-sm text-neutral-900 dark:text-neutral-100">{conversation.assignedToName}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function CommunicationsContent() {
  const [activeTab, setActiveTab] = useState<ConvTab>('open');
  const [activeConv, setActiveConv] = useState<WaConversation | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  return (
    <div className="flex h-full overflow-hidden">
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

      {/* Column 3: Snapshot */}
      {activeConv && snapshotOpen && (
        <div className="w-[320px] shrink-0">
          <CustomerSnapshotPanel conversation={activeConv} onClose={() => setSnapshotOpen(false)} />
        </div>
      )}
    </div>
  );
}

export default function CommunicationsPage() {
  return (
    <div className="flex h-full flex-col">
      <Suspense>
        <CommunicationsContent />
      </Suspense>
    </div>
  );
}
