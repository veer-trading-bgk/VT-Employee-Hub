'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Clock, Check, Calendar, ChevronRight, Plus, Filter } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonRow } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { Followup } from '@/types/v3';
import { toast } from 'sonner';
import { format, isToday, isTomorrow, isPast, addDays } from 'date-fns';

type FollowupFilter = 'all' | 'today' | 'overdue' | 'upcoming';

function followupDate(iso: string) {
  const d = new Date(iso);
  if (isPast(d) && !isToday(d)) return { label: 'Overdue', class: 'text-error-600' };
  if (isToday(d)) return { label: 'Today', class: 'text-warning-600' };
  if (isTomorrow(d)) return { label: 'Tomorrow', class: 'text-neutral-600' };
  return { label: format(d, 'EEE, d MMM'), class: 'text-neutral-500' };
}

export default function FollowupsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FollowupFilter>('all');

  const { data: followups = [], isLoading } = useQuery<Followup[]>({
    queryKey: ['followups', filter],
    queryFn: async () => {
      const data = await apiFetch<{ followups: Followup[] }>(`/api/followups?filter=${filter}`);
      return data.followups ?? [];
    },
    staleTime: 30_000,
    placeholderData: [],
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/followups/${id}/complete`, { method: 'POST' });
    },
    onMutate: async (id) => {
      // Optimistic: remove from list
      qc.setQueryData<Followup[]>(['followups', filter], (old = []) =>
        old.filter((f) => f.id !== id),
      );
    },
    onSuccess: () => {
      toast.success('Follow-up marked complete');
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['followups', filter] });
      toast.error('Failed to complete follow-up');
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      const newDue = addDays(new Date(), days).toISOString();
      return apiFetch(`/api/followups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueAt: newDue }),
      });
    },
    onSuccess: () => {
      toast.success('Rescheduled +1 day');
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: () => toast.error('Failed to reschedule'),
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
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Follow-ups
          </h1>
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
              filter === 'overdue'
                ? "You're all caught up — no overdue items"
                : filter === 'today'
                ? 'Nothing scheduled for today'
                : 'No follow-ups match this filter'
            }
            action={{ label: 'Add follow-up', onClick: () => {} }}
            className="flex-1"
          />
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800" role="list">
            {followups.map((f) => {
              const dateInfo = followupDate(f.dueAt);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 bg-white px-6 py-3 hover:bg-neutral-50 dark:bg-neutral-950 dark:hover:bg-neutral-900"
                >
                  {/* Time */}
                  <div className="w-28 shrink-0">
                    <p className={cn('text-xs font-medium', dateInfo.class)}>
                      {dateInfo.label}
                    </p>
                    <p className="text-xs text-neutral-400">
                      {format(new Date(f.dueAt), 'h:mm a')}
                    </p>
                  </div>

                  {/* Contact */}
                  <Avatar name={f.contactName ?? '?'} size={32} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/customers/${f.contactId}?tab=followups`}
                      className="text-sm font-medium text-neutral-900 hover:text-primary-600 dark:text-neutral-100"
                    >
                      {f.contactName}
                    </Link>
                    <p className="text-xs text-neutral-500 capitalize">{f.type}</p>
                  </div>

                  {/* Note (truncated) */}
                  {f.notes && (
                    <p className="hidden max-w-[200px] truncate text-xs text-neutral-400 lg:block">
                      {f.notes}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => snoozeMutation.mutate({ id: f.id, days: 1 })}
                      loading={snoozeMutation.isPending && snoozeMutation.variables?.id === f.id}
                      className="text-xs"
                    >
                      +1 Day
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconLeft={<Check className="h-4 w-4" />}
                      onClick={() => completeMutation.mutate(f.id)}
                      loading={completeMutation.isPending && completeMutation.variables === f.id}
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
