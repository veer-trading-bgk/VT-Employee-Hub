'use client';

// Instagram Messages tab — a FORK of the WhatsApp Inbox's ConversationList +
// ThreadPane (ADR-022 / Q7 audit), stripped to IG's reality: igsid-keyed,
// text-only, NO WABA window / templates / receipts / CRM. Reuses the
// @/components/v3/ui primitives and the wsClient stack as-is.

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useWsEvent } from '@/hooks/useWsEvent';
import type { WsMessage } from '@/lib/wsClient';
import { Avatar, Badge, EmptyState, ErrorState, SkeletonRow } from '@/components/v3/ui';
import type { IgContact, IgContactsResponse, IgMessagesResponse } from './types';

function safeFormat(v: string | number | null, fmt: string): string {
  if (v == null) return '';
  try { return format(new Date(v), fmt); } catch { return ''; }
}

// ── Contact list (left) ──────────────────────────────────────────────────────
// The list refetches live via the global EVENT_QUERY_MAP (instagram_message →
// ['instagram-contacts']), so no local subscription is needed here.
function ContactList({ activeIgsid, onSelect }: { activeIgsid: string | null; onSelect: (c: IgContact) => void }) {
  const { data, isLoading, isError, refetch } = useQuery<IgContactsResponse>({
    queryKey: ['instagram-contacts'],
    queryFn: () => apiFetch<IgContactsResponse>('/api/instagram/contacts'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const contacts = data?.contacts ?? [];

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Direct messages</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : isError ? (
          <ErrorState title="Couldn't load contacts" onRetry={() => refetch()} />
        ) : contacts.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No conversations yet" description="Instagram DMs will appear here once people message you." />
        ) : (
          contacts.map((c) => {
            const name = c.igUsername ? `@${c.igUsername}` : c.igsid;
            const active = c.igsid === activeIgsid;
            return (
              <button
                key={c.igsid}
                onClick={() => onSelect(c)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition',
                  active ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
                )}
              >
                <Avatar name={name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{name}</span>
                    {c.pendingFollowGate && <Badge variant="warning" dot>Awaiting reply</Badge>}
                  </div>
                  <span className="text-xs text-neutral-400">{safeFormat(c.lastMessageAt, 'MMM d, h:mm a')}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Thread (right) — text-only, read-only ────────────────────────────────────
function Thread({ contact }: { contact: IgContact | null }) {
  const qc = useQueryClient();
  const igsid = contact?.igsid ?? null;

  const { data, isLoading, isError, refetch } = useQuery<IgMessagesResponse>({
    queryKey: ['instagram-conv', igsid],
    queryFn: () => apiFetch<IgMessagesResponse>(`/api/instagram/contacts/${encodeURIComponent(igsid!)}/messages`),
    enabled: !!igsid,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  // The open thread isn't in the global map — refetch it on a matching inbound DM.
  const onIgMessage = useCallback((msg: WsMessage) => {
    if (igsid && msg.igsid === igsid) qc.refetchQueries({ queryKey: ['instagram-conv', igsid] });
  }, [qc, igsid]);
  useWsEvent('instagram_message', onIgMessage);

  if (!contact) {
    return <div className="flex h-full flex-1 items-center justify-center text-sm text-neutral-400">Select a conversation</div>;
  }

  const name = contact.igUsername ? `@${contact.igUsername}` : contact.igsid;
  const messages = data?.messages ?? [];

  // Messages arrive chronological from the API; group by day for separators.
  const groups: { date: string; items: IgMessagesResponse['messages'] }[] = [];
  for (const m of messages) {
    const d = safeFormat(m.timestamp, 'EEEE, d MMMM yyyy');
    const last = groups[groups.length - 1];
    if (last?.date === d) last.items.push(m);
    else groups.push({ date: d, items: [m] });
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Minimal contact card — igUsername only. NO stage/assign/CRM (ADR-020/021). */}
      <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Avatar name={name} size={32} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{name}</div>
          {contact.pendingFollowGate && <span className="text-xs text-amber-600">Follow Gate — awaiting their reply</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 px-4 py-4 dark:bg-neutral-950">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : isError ? (
          <ErrorState title="Couldn't load messages" onRetry={() => refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No messages yet" />
        ) : (
          groups.map((g, gi) => (
            <div key={gi} className="mb-4">
              <div className="mb-3 text-center">
                <span className="rounded-full bg-neutral-200 px-3 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800">{g.date}</span>
              </div>
              {g.items.map((m, i) => {
                const isOut = m.direction === 'outbound';
                return (
                  <div key={m.mid ?? i} className={cn('mb-2 flex', isOut ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
                      isOut ? 'bg-primary-600 text-white' : 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-800 dark:text-neutral-100',
                    )}>
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <div className={cn('mt-1 text-[10px]', isOut ? 'text-white/70' : 'text-neutral-400')}>{safeFormat(m.timestamp, 'h:mm a')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-neutral-200 px-4 py-2.5 text-center text-xs text-neutral-400 dark:border-neutral-800">
        Read-only — replies are sent by your Instagram automations.
      </div>
    </div>
  );
}

export function InstagramMessagesTab() {
  const [active, setActive] = useState<IgContact | null>(null);
  return (
    <div className="flex h-full">
      <ContactList activeIgsid={active?.igsid ?? null} onSelect={setActive} />
      <Thread contact={active} />
    </div>
  );
}
