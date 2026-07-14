'use client';

import { memo, useMemo, useState, useDeferredValue } from 'react';
import { useCustomer360 } from '@/contexts/Customer360Context';
import type { TimelineItem, Followup, ContactDetail } from '@/lib/contacts/types';

// ── Unified timeline event type ───────────────────────────────────────────────

type EventType =
  | 'message_in' | 'message_out'
  | 'attachment_in' | 'attachment_out'
  | 'note'
  | 'followup_open' | 'followup_done'
  | 'stage_change' | 'assignment' | 'status_change'
  | 'tag_add' | 'tag_remove' | 'contact_update'
  | 'contact_created'
  // Extension points — no data yet, renders if events are injected in the future
  | 'ai' | 'workflow' | 'campaign' | 'broadcast' | 'marketplace';

type FilterId = 'all' | 'messages' | 'crm' | 'notes' | 'tasks' | 'system';

interface TimelineEvent {
  id: string;
  type: EventType;
  timestamp: string;
  title: string;
  description?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

// ── Filter definitions ────────────────────────────────────────────────────────

const MSG_TYPES: EventType[] = ['message_in', 'message_out', 'attachment_in', 'attachment_out'];
const CRM_TYPES: EventType[] = ['followup_open', 'followup_done', 'stage_change', 'assignment', 'contact_created'];
const SYS_TYPES: EventType[] = ['assignment', 'status_change', 'contact_update', 'contact_created'];

const FILTER_DEFS: { id: FilterId; label: string; test: (t: EventType) => boolean }[] = [
  { id: 'all',      label: 'All',      test: () => true },
  { id: 'messages', label: 'Messages', test: (t) => MSG_TYPES.includes(t) },
  { id: 'crm',      label: 'CRM',      test: (t) => CRM_TYPES.includes(t) },
  { id: 'notes',    label: 'Notes',    test: (t) => t === 'note' },
  { id: 'tasks',    label: 'Tasks',    test: (t) => t === 'followup_open' || t === 'followup_done' },
  { id: 'system',   label: 'System',   test: (t) => SYS_TYPES.includes(t) },
];

// ── Event visual config ───────────────────────────────────────────────────────

interface EventCfg { icon: string; bg: string; title: string; }

const EVENT_CFG: Record<EventType, EventCfg> = {
  message_in:     { icon: '📩', bg: 'bg-sky-50 dark:bg-sky-900/20',        title: 'Message received'    },
  message_out:    { icon: '📤', bg: 'bg-indigo-50 dark:bg-indigo-900/20',  title: 'Message sent'        },
  attachment_in:  { icon: '📎', bg: 'bg-sky-50 dark:bg-sky-900/20',        title: 'File received'       },
  attachment_out: { icon: '📤', bg: 'bg-indigo-50 dark:bg-indigo-900/20',  title: 'File sent'           },
  note:           { icon: '🔒', bg: 'bg-amber-50 dark:bg-amber-900/20',    title: 'Internal note'       },
  followup_open:  { icon: '📅', bg: 'bg-orange-50 dark:bg-orange-900/20',  title: 'Follow-up scheduled' },
  followup_done:  { icon: '✅', bg: 'bg-emerald-50 dark:bg-emerald-900/20',title: 'Follow-up completed' },
  stage_change:   { icon: '🔄', bg: 'bg-indigo-50 dark:bg-indigo-900/20',  title: 'Stage updated'       },
  assignment:     { icon: '👤', bg: 'bg-violet-50 dark:bg-violet-900/20',  title: 'Reassigned'          },
  status_change:  { icon: '⚡', bg: 'bg-slate-50 dark:bg-slate-800',       title: 'Status changed'      },
  tag_add:        { icon: '🏷️', bg: 'bg-emerald-50 dark:bg-emerald-900/20',title: 'Tag added'           },
  tag_remove:     { icon: '🏷️', bg: 'bg-slate-50 dark:bg-slate-800',       title: 'Tag removed'         },
  contact_update: { icon: '✏️', bg: 'bg-slate-50 dark:bg-slate-800',       title: 'Contact updated'     },
  contact_created:{ icon: '✨', bg: 'bg-indigo-50 dark:bg-indigo-900/20',  title: 'Contact created'     },
  // Extension points
  ai:          { icon: '🤖', bg: 'bg-purple-50 dark:bg-purple-900/20',  title: 'AI event'         },
  workflow:    { icon: '⚙️', bg: 'bg-slate-50 dark:bg-slate-800',        title: 'Workflow event'   },
  campaign:    { icon: '📢', bg: 'bg-green-50 dark:bg-green-900/20',     title: 'Campaign event'   },
  broadcast:   { icon: '📡', bg: 'bg-blue-50 dark:bg-blue-900/20',       title: 'Broadcast event'  },
  marketplace: { icon: '🛍️', bg: 'bg-pink-50 dark:bg-pink-900/20',      title: 'Marketplace event'},
};

// ── Source labels ─────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', form: 'Form',
  api: 'API', import: 'Import', manual: 'Manual Entry',
  referral: 'Referral', webinar: 'Webinar', social: 'Social Media',
  walk_in: 'Walk-in', whatsapp_ai: 'WhatsApp AI',
};

// ── Event conversion ──────────────────────────────────────────────────────────

function fromTimelineItem(item: TimelineItem): TimelineEvent {
  const hasMedia = !!(item.mediaId || item.s3Key);
  if (item._kind === 'note') {
    return {
      id: item.SK,
      type: 'note',
      timestamp: item.timestamp,
      title: EVENT_CFG.note.title,
      description: item.content,
      actor: item.sentByName ?? item.authorName,
    };
  }
  const isIn = item.direction === 'inbound';
  const type: EventType = hasMedia
    ? (isIn ? 'attachment_in' : 'attachment_out')
    : (isIn ? 'message_in' : 'message_out');
  return {
    id: item.SK,
    type,
    timestamp: item.timestamp,
    title: EVENT_CFG[type].title,
    description: hasMedia
      ? (item.filename ?? item.mimeType ?? 'Media attachment')
      : item.content,
    actor: isIn ? undefined : (item.sentByName ?? item.authorName ?? 'Agent'),
    metadata: item.msgStatus ? { msgStatus: item.msgStatus } : undefined,
  };
}

function fromFollowup(fu: Followup): TimelineEvent {
  const type: EventType = fu.done ? 'followup_done' : 'followup_open';
  return {
    id: `fu-${fu.date}-${fu.leadId}`,
    type,
    timestamp: `${fu.date}T00:00:00.000Z`,
    title: EVENT_CFG[type].title,
    description: fu.note,
  };
}

function fromContact(contact: ContactDetail): TimelineEvent {
  return {
    id: 'contact-created',
    type: 'contact_created',
    timestamp: contact.createdAt,
    title: EVENT_CFG.contact_created.title,
    description: `via ${SOURCE_LABELS[contact.source] ?? contact.source}`,
    actor: 'System',
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function dayLabel(iso: string): string {
  const key = dayKey(iso);
  const tz = { timeZone: 'Asia/Kolkata' };
  const today = new Date().toLocaleDateString('en-CA', tz);
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', tz);
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', tz);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  if (key === tomorrow) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function fmtRelTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
    });
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

// ── EventCard (memo'd for perf) ───────────────────────────────────────────────

const EventCard = memo(function EventCard({ event }: { event: TimelineEvent }) {
  const cfg = EVENT_CFG[event.type];
  return (
    <article
      className="flex gap-3 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800/60"
      aria-label={event.title}
    >
      {/* Icon */}
      <div
        className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm ${cfg.bg}`}
        aria-hidden="true"
      >
        {cfg.icon}
      </div>
      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug text-slate-800 dark:text-slate-200">
              {event.title}
            </p>
            {event.actor && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                by {event.actor}
              </p>
            )}
          </div>
          <time
            dateTime={event.timestamp}
            className="flex-shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-400 dark:text-slate-500"
            title={new Date(event.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
          >
            {fmtRelTime(event.timestamp)}
          </time>
        </div>
        {event.description && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-slate-600 dark:text-slate-400">
            {event.description}
          </p>
        )}
        {/* Extension slot: future event-type-specific metadata can be rendered here */}
        <div data-slot={`event-ext-${event.type}`} className="hidden" aria-hidden="true" />
      </div>
    </article>
  );
});

// ── DateSeparator ─────────────────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <div
      className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-slate-50/95 px-4 py-1.5 backdrop-blur-sm dark:bg-slate-950/95"
      aria-label={`Events from ${label}`}
    >
      <div className="flex-1 border-t border-slate-200 dark:border-slate-800" aria-hidden="true" />
      <span className="flex-shrink-0 rounded-full bg-white px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700">
        {label}
      </span>
      <div className="flex-1 border-t border-slate-200 dark:border-slate-800" aria-hidden="true" />
    </div>
  );
}

// ── Timeline Panel ────────────────────────────────────────────────────────────

type Row =
  | { kind: 'sep'; label: string; key: string }
  | { kind: 'event'; event: TimelineEvent };

function TimelinePanel() {
  const { contact, timeline, followups } = useCustomer360();

  const [activeFilter, setActiveFilter] = useState<FilterId>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);

  // Convert all data sources into unified events, sorted newest-first
  const allEvents = useMemo<TimelineEvent[]>(() => {
    if (!contact) return [];
    return [
      ...timeline.map(fromTimelineItem),
      ...followups.map(fromFollowup),
      fromContact(contact),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [contact, timeline, followups]);

  // Apply type filter
  const filteredByType = useMemo(() => {
    const fn = FILTER_DEFS.find((f) => f.id === activeFilter)?.test ?? (() => true);
    return allEvents.filter((e) => fn(e.type));
  }, [allEvents, activeFilter]);

  // Apply text search (uses deferred value for UI responsiveness)
  const filteredEvents = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return filteredByType;
    return filteredByType.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.description?.toLowerCase().includes(q) ?? false) ||
        (e.actor?.toLowerCase().includes(q) ?? false)
    );
  }, [filteredByType, deferredSearch]);

  // Build flat Row[] with date separators interspersed
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    let lastDay = '';
    for (const event of filteredEvents) {
      const day = dayKey(event.timestamp);
      if (day !== lastDay) {
        result.push({ kind: 'sep', label: dayLabel(event.timestamp), key: `sep-${day}` });
        lastDay = day;
      }
      result.push({ kind: 'event', event });
    }
    return result;
  }, [filteredEvents]);

  // Count per filter for badges
  const countByFilter = useMemo(() => {
    const out: Partial<Record<FilterId, number>> = {};
    for (const f of FILTER_DEFS) {
      if (f.id !== 'all') out[f.id] = allEvents.filter((e) => f.test(e.type)).length;
    }
    return out;
  }, [allEvents]);

  const isSearching = deferredSearch.trim().length > 0;

  if (!contact) return null;

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">

      {/* ── Controls bar ──────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        {/* Search */}
        <div className="relative mb-3">
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
            aria-hidden="true"
          >
            🔍
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search timeline…"
            aria-label="Search timeline events"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-xs text-slate-400 hover:text-slate-600 sm:h-6 sm:w-6 dark:hover:text-slate-300"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
          role="tablist"
          aria-label="Filter timeline by event type"
        >
          {FILTER_DEFS.map((f) => {
            const count = f.id === 'all' ? allEvents.length : (countByFilter[f.id] ?? 0);
            const active = activeFilter === f.id;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFilter(f.id)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold ${
                      active
                        ? 'bg-white/25 text-white'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Timeline list ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" role="log" aria-live="polite" aria-label="Customer timeline">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <span className="text-4xl" aria-hidden="true">
              {isSearching ? '🔍' : '📭'}
            </span>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {isSearching ? 'No events match your search' : 'No events in this category'}
            </p>
            {isSearching && (
              <button
                onClick={() => setSearch('')}
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="px-4">
            {rows.map((row) =>
              row.kind === 'sep' ? (
                <DateSeparator key={row.key} label={row.label} />
              ) : (
                <EventCard key={row.event.id} event={row.event} />
              )
            )}

            {/* Extension slots for future event type renderers */}
            <div data-slot="timeline-ext-ai"         className="hidden" aria-hidden="true" />
            <div data-slot="timeline-ext-workflow"    className="hidden" aria-hidden="true" />
            <div data-slot="timeline-ext-campaign"    className="hidden" aria-hidden="true" />
            <div data-slot="timeline-ext-broadcast"   className="hidden" aria-hidden="true" />
            <div data-slot="timeline-ext-marketplace" className="hidden" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {filteredEvents.length}{' '}
          event{filteredEvents.length !== 1 ? 's' : ''}
          {activeFilter !== 'all' && (
            <span> · {FILTER_DEFS.find((f) => f.id === activeFilter)?.label}</span>
          )}
          {isSearching && <span> · &ldquo;{deferredSearch}&rdquo;</span>}
          {allEvents.length > 0 && activeFilter === 'all' && !isSearching && (
            <span> · {allEvents.length} total</span>
          )}
        </p>
      </div>

    </div>
  );
}

export const TimelineTab = memo(TimelinePanel);
