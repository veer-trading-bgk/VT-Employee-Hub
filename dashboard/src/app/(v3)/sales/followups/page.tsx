'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Clock, Check, Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Button } from '@/components/v3/ui/Button';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonRow } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { Followup } from '@/types/v3';
import { toast } from 'sonner';
import { format, isToday, isTomorrow, isPast, addDays } from 'date-fns';

type FollowupFilter = 'all' | 'today' | 'overdue' | 'upcoming';

// Raw shape returned by GET /api/crm/followups
interface BackendFollowup {
  leadId: string;
  leadName?: string;
  leadPhone?: string;
  date: string;   // YYYY-MM-DD
  note?: string;
  assignedTo?: string;
  done?: boolean;
  doneAt?: string;
  createdAt: string;
}

// Extended Followup with the two keys needed for the done endpoint
type RichFollowup = Followup & { _date: string; _leadId: string };

function normalize(raw: BackendFollowup): RichFollowup {
  return {
    id: `${raw.date}|${raw.leadId}`,
    _date: raw.date,
    _leadId: raw.leadId,
    contactId: raw.leadId,
    contactName: raw.leadName ?? undefined,
    type: 'call',
    notes: raw.note ?? undefined,
    dueAt: raw.date,
    completedAt: raw.doneAt ?? undefined,
    assignedToId: raw.assignedTo ?? undefined,
    assignedToName: undefined,
    createdAt: raw.createdAt,
  };
}

function followupDate(dueAt: string) {
  // Append T00:00:00 so new Date parses as local midnight, not UTC midnight
  const d = new Date(`${dueAt}T00:00:00`);
  if (isPast(d) && !isToday(d)) return { label: 'Overdue', cls: 'text-error-600' };
  if (isToday(d))               return { label: 'Today',   cls: 'text-warning-600' };
  if (isTomorrow(d))            return { label: 'Tomorrow', cls: 'text-neutral-600' };
  return { label: format(d, 'EEE, d MMM'), cls: 'text-neutral-500' };
}

export default function FollowupsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FollowupFilter>('all');

  // Fetch broad window (overdue + 90 days) and filter client-side.
  // Backend: GET /api/crm/followups?overdue=true&days=90
  const { data: allFollowups = [], isLoading } = useQuery<RichFollowup[]>({
    queryKey: ['followups'],
    queryFn: async () => {
      const data = await apiFetch<{ followups: BackendFollowup[] }>(
        '/api/crm/followups?overdue=true&days=90',
      );
      return (data.followups ?? []).map(normalize);
    },
    staleTime: 30_000,
    placeholderData: [],
  });

  const today = new Date().toISOString().slice(0, 10);

  const followups = allFollowups.filter((f) => {
    switch (filter) {
      case 'overdue':  return f.dueAt < today;
      case 'today':    return f.dueAt === today;
      case 'upcoming': return f.dueAt > today;
      default:         return true;
    }
  });

  // Mark done: PUT /api/crm/followups/:date/:leadId/done
  const completeMutation = useMutation({
    mutationFn: async (f: RichFollowup) =>
      apiFetch(`/api/crm/followups/${f._date}/${f._leadId}/done`, { method: 'PUT' }),
    onMutate: async (f) => {
      qc.setQueryData<RichFollowup[]>(['followups'], (old = []) =>
        old.filter((x) => x.id !== f.id),
      );
    },
    onSuccess: () => {
      toast.success('Follow-up marked complete');
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['followups'] });
      toast.error('Failed to complete follow-up');
    },
  });

  // Snooze: mark current done, create new for next day
  const snoozeMutation = useMutation({
    mutationFn: async ({ f, days }: { f: RichFollowup; days: number }) => {
      await apiFetch(`/api/crm/followups/${f._date}/${f._leadId}/done`, { method: 'PUT' });
      const nextDay = addDays(new Date(`${f._date}T00:00:00`), days).toISOString().slice(0, 10);
      return apiFetch(`/api/crm/leads/${f._leadId}/followup`, {
        method: 'POST',
        body: JSON.stringify({ date: nextDay, note: f.notes ?? '' }),
      });
    },
    onMutate: async ({ f }) => {
      qc.setQueryData<RichFollowup[]>(['followups'], (old = []) =>
        old.filter((x) => x.id !== f.id),
      );
    },
    onSuccess: () => {
      toast.success('Rescheduled +1 day');
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['followups'] });
      toast.error('Failed to reschedule');
    },
  });

  const FILTERS: { id: FollowupFilter; label: string }[] = [
    { id: 'all',      label: 'All'      },
    { id: 'overdue',  label: 'Overdue'  },
    { id: 'today',    label: 'Today'    },
    { id: 'upcoming', label: 'Upcoming' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Follow-ups</h1>
          <p className="text-sm text-neutral-500">
            {followups.length} follow-up{followups.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button size="sm" iconLeft={<Plus className="h-4 w-4" />}>
          Add Follow-up
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-950">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              filter === f.id
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
          </div>
        ) : followups.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No follow-ups"
            description={
              filter === 'overdue'  ? "You're all caught up — no overdue items" :
              filter === 'today'    ? 'Nothing scheduled for today' :
              filter === 'upcoming' ? 'No upcoming follow-ups' :
              'No follow-ups yet'
            }
            action={{ label: 'Add follow-up', onClick: () => {} }}
            className="flex-1"
          />
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800" role="list">
            {followups.map((f) => {
              const di = followupDate(f.dueAt);
              const isCompletePending = completeMutation.isPending && completeMutation.variables?.id === f.id;
              const isSnoozePending   = snoozeMutation.isPending   && snoozeMutation.variables?.f.id === f.id;
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 bg-white px-6 py-3 hover:bg-neutral-50 dark:bg-neutral-950 dark:hover:bg-neutral-900"
                >
                  {/* Date */}
                  <div className="w-28 shrink-0">
                    <p className={cn('text-xs font-medium', di.cls)}>{di.label}</p>
                    <p className="text-xs text-neutral-400">
                      {format(new Date(`${f.dueAt}T00:00:00`), 'EEE')}
                    </p>
                  </div>

                  {/* Contact */}
                  <Avatar name={f.contactName ?? '?'} size={32} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/customers/${f.contactId}?tab=followups`}
                      className="text-sm font-medium text-neutral-900 hover:text-primary-600 dark:text-neutral-100"
                    >
                      {f.contactName ?? f.contactId}
                    </Link>
                    {f.notes && (
                      <p className="truncate text-xs text-neutral-400">{f.notes}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => snoozeMutation.mutate({ f, days: 1 })}
                      loading={isSnoozePending}
                      className="text-xs"
                    >
                      +1 Day
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconLeft={<Check className="h-4 w-4" />}
                      onClick={() => completeMutation.mutate(f)}
                      loading={isCompletePending}
                      aria-label="Mark as done"
                    >
                      Done
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
