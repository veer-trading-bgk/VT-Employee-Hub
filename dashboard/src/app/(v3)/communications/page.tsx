'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  MessageSquare,
  Search,
  Filter,
  Send,
  Paperclip,
  Smile,
  MoreHorizontal,
  Phone,
  ChevronRight,
  CheckCheck,
  Check,
  Clock,
  AlertCircle,
  Plus,
  X,
  ChevronLeft,
  User,
  Tag,
  StickyNote,
  TrendingUp,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { SkeletonRow, Skeleton } from '@/components/v3/ui/Skeleton';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { format, isToday, isYesterday } from 'date-fns';
import type { Conversation, Message, Contact, Stage } from '@/types/v3';
import { STAGE_LABELS } from '@/types/v3';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type ConvTab = 'open' | 'resolved' | 'pending' | 'unassigned';

// ── Helpers ───────────────────────────────────────────────────────────────────

function msgDate(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMM');
}

function msgTime(iso: string) {
  return format(new Date(iso), 'h:mm a');
}

function DeliveryIcon({ status }: { status: Message['status'] }) {
  if (status === 'read')      return <CheckCheck className="h-3.5 w-3.5 text-primary-500" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 text-neutral-400" aria-label="Delivered" />;
  if (status === 'sent')      return <Check className="h-3.5 w-3.5 text-neutral-400" aria-label="Sent" />;
  if (status === 'failed')    return <AlertCircle className="h-3.5 w-3.5 text-error-500" aria-label="Failed" />;
  return <Clock className="h-3.5 w-3.5 text-neutral-300" aria-label="Pending" />;
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
  onSelect: (conv: Conversation) => void;
}) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<Conversation[]>({
    queryKey: ['conversations', activeTab],
    queryFn: async () => {
      const res = await apiFetch(`/api/contacts?chatStatus=${activeTab}`) as Response;
      const json = await res.json() as { contacts: Contact[] };
      // Map contacts to conversation list format
      return (json.contacts ?? []).map((c): Conversation => ({
        id: c.id,
        contactId: c.id,
        contactName: c.name,
        contactPhone: c.phone,
        status: c.chatStatus,
        assignedToId: c.ownerId,
        assignedToName: c.ownerName,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: '',
        unreadCount: 0,
        createdAt: c.createdAt,
      }));
    },
    staleTime: 30_000,
    placeholderData: [],
  });

  const tabs: { id: ConvTab; label: string }[] = [
    { id: 'open',        label: 'Open'        },
    { id: 'resolved',    label: 'Resolved'    },
    { id: 'pending',     label: 'Pending'     },
    { id: 'unassigned',  label: 'Unassigned'  },
  ];

  const filtered = (data ?? []).filter((c) =>
    !search || c.contactName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
      {/* Header */}
      <div className="border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Communications
          </h1>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={<Plus className="h-4 w-4" />}
            aria-label="New conversation"
          >
            New
          </Button>
        </div>
        {/* Search */}
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
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              aria-selected={conv.id === activeId}
              className={cn(
                'flex w-full items-start gap-2.5 border-b border-neutral-100 px-3 py-3 text-left transition-colors last:border-0 dark:border-neutral-800/50',
                conv.id === activeId
                  ? 'bg-primary-50 dark:bg-primary-900/20'
                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/30',
              )}
            >
              <Avatar name={conv.contactName} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {conv.contactName}
                  </p>
                  {conv.lastMessageAt && (
                    <span className="shrink-0 text-[10px] text-neutral-400">
                      {msgDate(conv.lastMessageAt)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {conv.lastMessagePreview || conv.contactPhone}
                </p>
                {conv.unreadCount > 0 && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary-600 px-1 text-[9px] font-bold text-white">
                      {conv.unreadCount}
                    </span>
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Thread Pane ───────────────────────────────────────────────────────────────

function ThreadPane({
  conversation,
  onOpenSnapshot,
}: {
  conversation: Conversation;
  onOpenSnapshot: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [], isLoading } = useQuery<Message[]>({
    queryKey: ['messages', conversation.contactId],
    queryFn: async () => {
      const res = await apiFetch(`/api/contacts/${conversation.contactId}/messages`) as Response;
      const json = await res.json() as { messages: Message[] };
      return json.messages ?? [];
    },
    staleTime: 15_000,
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiFetch(`/api/contacts/${conversation.contactId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ type: 'text', content: text }),
      }) as Response;
      return res.json();
    },
    onMutate: async (text) => {
      // Optimistic update
      const optimistic: Message = {
        id: `opt-${Date.now()}`,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        direction: 'outbound',
        type: 'text',
        content: text,
        status: 'sent',
        sentAt: new Date().toISOString(),
        sentById: user?.id,
      };
      qc.setQueryData<Message[]>(['messages', conversation.contactId], (old = []) => [
        ...old,
        optimistic,
      ]);
      return { optimistic };
    },
    onError: (_, __, ctx) => {
      // Rollback optimistic message
      qc.setQueryData<Message[]>(['messages', conversation.contactId], (old = []) =>
        old.filter((m) => m.id !== ctx?.optimistic.id),
      );
      toast.error('Failed to send message. Try again.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversation.contactId] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
  const grouped: { date: string; messages: Message[] }[] = [];
  for (const msg of messages) {
    const d = format(new Date(msg.sentAt), 'EEEE, d MMMM yyyy');
    const last = grouped[grouped.length - 1];
    if (last?.date === d) last.messages.push(msg);
    else grouped.push({ date: d, messages: [msg] });
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-900">
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <Avatar name={conversation.contactName} size={32} />
        <div className="min-w-0 flex-1">
          <button
            onClick={onOpenSnapshot}
            className="text-sm font-semibold text-neutral-900 hover:text-primary-600 dark:text-neutral-100"
          >
            {conversation.contactName}
          </button>
          <p className="text-xs text-neutral-500">{conversation.contactPhone}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" iconLeft={<Phone className="h-4 w-4" />} aria-label="Call contact" />
          <Button variant="ghost" size="sm" iconLeft={<MoreHorizontal className="h-4 w-4" />} aria-label="More options" />
        </div>
      </div>

      {/* Message area */}
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                <Skeleton className={cn('h-10 rounded-2xl', i % 2 === 0 ? 'w-48' : 'w-56')} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description="Start the conversation"
          />
        ) : (
          grouped.map(({ date, messages: dayMsgs }) => (
            <div key={date}>
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
                <span className="text-[10px] text-neutral-400">{date}</span>
                <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
              </div>
              {dayMsgs.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
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
            style={{ minHeight: 40, overflow: 'auto' }}
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
        <p className="mt-1.5 text-[10px] text-neutral-400">
          WhatsApp · Reply within 24h window
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === 'outbound';
  return (
    <div className={cn('mb-1 flex', isOut ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-3 py-2 text-sm',
          isOut
            ? 'bg-primary-600 text-white rounded-br-sm'
            : 'bg-white text-neutral-900 border border-neutral-200 rounded-bl-sm dark:bg-neutral-800 dark:text-neutral-100 dark:border-neutral-700',
        )}
      >
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        <div className={cn('mt-1 flex items-center gap-1', isOut ? 'justify-end' : 'justify-start')}>
          <span className={cn('text-[9px]', isOut ? 'text-white/70' : 'text-neutral-400')}>
            {msgTime(message.sentAt)}
          </span>
          {isOut && <DeliveryIcon status={message.status} />}
        </div>
      </div>
    </div>
  );
}

// ── Customer Snapshot Panel ───────────────────────────────────────────────────

function CustomerSnapshotPanel({
  contactId,
  onClose,
}: {
  contactId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const { data: contact } = useQuery<Contact>({
    queryKey: ['contact', contactId],
    queryFn: async () => {
      const res = await apiFetch(`/api/contacts/${contactId}`) as Response;
      const json = await res.json() as { contact: Contact };
      return json.contact;
    },
    staleTime: 30_000,
  });

  const STAGE_OPTIONS = Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }));

  const stageUpdate = useMutation({
    mutationFn: async (stage: Stage) => {
      const res = await apiFetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      }) as Response;
      return res.json();
    },
    onMutate: async (stage) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: ['contact', contactId] });
      qc.setQueryData<Contact>(['contact', contactId], (old) =>
        old ? { ...old, stage } : old,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      toast.success('Stage updated');
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      toast.error('Failed to update stage');
    },
  });

  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Contact Info
        </p>
        <button
          onClick={onClose}
          aria-label="Close snapshot"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!contact ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-12 rounded-full mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="flex flex-col items-center gap-2 text-center">
              <Avatar name={contact.name} size={48} />
              <div>
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">{contact.name}</p>
                <p className="text-xs text-neutral-500">{contact.phone}</p>
              </div>
              <a
                href={`/customers/${contact.id}`}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                View full profile →
              </a>
            </div>

            {/* Stage */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Stage
              </p>
              <Select
                options={STAGE_OPTIONS}
                value={contact.stage}
                onChange={(e) => stageUpdate.mutate(e.target.value as Stage)}
                aria-label="Contact stage"
              />
            </div>

            {/* Tags */}
            {contact.tags.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge key={tag} variant="default">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function CommunicationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ConvTab>('open');
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  // If URL has ?contactId=xxx, pre-select that conversation
  useEffect(() => {
    const contactId = searchParams.get('contactId');
    if (contactId && !activeConv) {
      // We'll load the conversation when data arrives
    }
  }, [searchParams, activeConv]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Column 1: Conversation list (280px) ────────────────────── */}
      <div
        className={cn(
          'w-[280px] shrink-0',
          // On mobile: full width when no conversation selected
          activeConv ? 'hidden md:block' : 'w-full md:w-[280px]',
        )}
      >
        <ConversationList
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeId={activeConv?.id}
          onSelect={(conv) => {
            setActiveConv(conv);
            setSnapshotOpen(false);
          }}
        />
      </div>

      {/* ── Column 2: Thread (fluid) ────────────────────────────────── */}
      {activeConv ? (
        <div className={cn('flex min-w-0 flex-1 flex-col', snapshotOpen ? 'hidden xl:flex' : 'flex')}>
          {/* Mobile back button */}
          <button
            onClick={() => setActiveConv(null)}
            className="flex items-center gap-1 px-3 py-2 text-sm text-primary-600 md:hidden"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
          <ThreadPane
            conversation={activeConv}
            onOpenSnapshot={() => setSnapshotOpen((o) => !o)}
          />
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

      {/* ── Column 3: Snapshot panel (320px) ───────────────────────── */}
      {activeConv && snapshotOpen && (
        <div className="w-[320px] shrink-0">
          <CustomerSnapshotPanel
            contactId={activeConv.contactId}
            onClose={() => setSnapshotOpen(false)}
          />
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
