'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Zap, Plus, Play, Pause, Clock, FileText, ChevronRight, ExternalLink } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Toggle } from '@/components/v3/ui/Toggle';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonCard } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Workflow {
  id: string;
  name: string;
  description?: string;
  trigger: string;
  active: boolean;
  lastRunAt?: string;
  runCount: number;
  createdAt: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  new_contact:       'New contact added',
  stage_changed:     'Stage changed',
  followup_overdue:  'Follow-up overdue',
  no_reply_24h:      'No reply in 24 hours',
  message_received:  'Message received',
};

export default function AutomationPage() {
  const qc = useQueryClient();

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ['workflows'],
    queryFn: async () => {
      const data = await apiFetch<{ workflows: Workflow[] }>('/api/workflows');
      return data.workflows ?? [];
    },
    staleTime: 60_000,
    placeholderData: [],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return apiFetch(`/api/workflows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
    },
    onMutate: async ({ id, active }) => {
      qc.setQueryData<Workflow[]>(['workflows'], (old = []) =>
        old.map((w) => (w.id === id ? { ...w, active } : w)),
      );
    },
    onSuccess: (_, vars) => {
      toast.success(vars.active ? 'Workflow enabled' : 'Workflow paused');
    },
    onError: (_, vars) => {
      qc.setQueryData<Workflow[]>(['workflows'], (old = []) =>
        old.map((w) => (w.id === vars.id ? { ...w, active: !vars.active } : w)),
      );
      toast.error('Failed to update workflow');
    },
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Automation</h1>
          <p className="text-sm text-neutral-500">
            {workflows.filter((w) => w.active).length} active workflows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/automation/logs">
            <Button variant="secondary" size="sm" iconLeft={<FileText className="h-4 w-4" />}>
              Execution logs
            </Button>
          </Link>
          <Button size="sm" iconLeft={<Plus className="h-4 w-4" />}>
            New workflow
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No workflows yet"
            description="Automate follow-ups, stage changes, and WhatsApp messages based on triggers"
            action={{ label: 'Create workflow', onClick: () => {} }}
          />
        ) : (
          <div className="space-y-3">
            {workflows.map((workflow) => (
              <Card
                key={workflow.id}
                variant="default"
                className="group"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                    workflow.active
                      ? 'bg-success-50 text-success-600 dark:bg-success-900/20'
                      : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800',
                  )}>
                    <Zap className="h-5 w-5" aria-hidden />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {workflow.name}
                      </h3>
                      <Toggle
                        checked={workflow.active}
                        onChange={(e) => toggleMutation.mutate({ id: workflow.id, active: e.target.checked })}
                        size="sm"
                        aria-label={workflow.active ? 'Disable workflow' : 'Enable workflow'}
                      />
                    </div>
                    {workflow.description && (
                      <p className="mt-0.5 text-xs text-neutral-500">{workflow.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Badge variant="default" className="text-[10px]">
                        Trigger: {TRIGGER_LABELS[workflow.trigger] ?? workflow.trigger}
                      </Badge>
                      {workflow.lastRunAt && (
                        <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden />
                          Last run {format(new Date(workflow.lastRunAt), 'd MMM, h:mm a')}
                        </span>
                      )}
                      <span className="text-[10px] text-neutral-400">
                        {workflow.runCount} runs
                      </span>
                    </div>
                  </div>

                  {/* Edit link */}
                  <Link
                    href={`/automation/${workflow.id}`}
                    className="hidden shrink-0 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 group-hover:flex"
                    aria-label={`Edit ${workflow.name}`}
                  >
                    Edit <ChevronRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
