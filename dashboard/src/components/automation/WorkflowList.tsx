'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Trash2, Play, Pause, Zap, GitBranch, Copy } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonTable } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { cn } from '@/lib/cn';
import { format } from 'date-fns';
import {
  type AutomationsResponse, type Workflow,
  WORKFLOW_STATUS_META, getTriggerLabel, getWorkflowStatus, isGraphWorkflow,
} from '@/types/automations';

export function WorkflowList() {
  const [search, setSearch] = useState('');
  const { user } = useAuth();
  const isAdmin = ['owner', 'admin'].includes(toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]));
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery<AutomationsResponse>({
    queryKey: ['automations'],
    queryFn:  () => apiFetch('/api/automations'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/automations/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations']      });
      qc.invalidateQueries({ queryKey: ['automation-stats'] });
    },
    onError: (err: Error) => toast.error(err.message ?? 'Status update failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations']      });
      qc.invalidateQueries({ queryKey: ['automation-stats'] });
      toast.success('Workflow deleted');
    },
    onError: (err: Error) => toast.error(err.message ?? 'Delete failed'),
  });

  // "Save as Template" (Item 5) — personal save-and-reuse duplicate, always
  // created as a draft so duplicating an active workflow can never result in
  // two active workflows firing on the same trigger.
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/automations/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Workflow duplicated as a draft');
    },
    onError: (err: Error) => toast.error(err.message ?? 'Duplicate failed'),
  });

  const workflows = (data?.automations ?? []).filter((w) =>
    !search || w.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Single-editor migration (2026-07-10, docs/phase3/TECHNICAL_DEBT.md): the
  // canvas is now the only editor — create always starts a fresh graph
  // workflow, edit always opens the canvas. There is no more Simple/Advanced
  // choice and no workflow shape this could route to besides graph.
  function openCreate() { router.push('/automation/canvas/new'); }
  function openEdit(w: Workflow) { router.push(`/automation/canvas/${w.id}`); }

  return (
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="search"
              placeholder="Search workflows…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          {isAdmin && (
            <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Create Workflow
            </Button>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <SkeletonTable rows={4} />
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={Zap}
            title={search ? 'No workflows match your search' : 'No workflows yet'}
            description={!search ? 'Create a workflow to automate lead follow-ups, stage changes, and WhatsApp messages.' : undefined}
            action={!search && isAdmin ? { label: 'Create Workflow', onClick: openCreate } : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Workflow</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Trigger</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-neutral-500">Steps</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-neutral-500">Runs</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-neutral-500">Last Run</th>
                  <th className="w-20 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {workflows.map((w) => (
                  <WorkflowRow
                    key={w.id}
                    workflow={w}
                    isAdmin={isAdmin}
                    onEdit={openEdit}
                    onToggle={(wf) => {
                      const cur = getWorkflowStatus(wf);
                      statusMutation.mutate({ id: wf.id, status: cur === 'active' ? 'paused' : 'active' });
                    }}
                    onDelete={(wf) => {
                      if (window.confirm('Delete this workflow permanently?')) deleteMutation.mutate(wf.id);
                    }}
                    onDuplicate={(wf) => duplicateMutation.mutate(wf.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
  );
}

function WorkflowRow({
  workflow: w, isAdmin, onEdit, onToggle, onDelete, onDuplicate,
}: {
  workflow:    Workflow;
  isAdmin:     boolean;
  onEdit:      (w: Workflow) => void;
  onToggle:    (w: Workflow) => void;
  onDelete:    (w: Workflow) => void;
  onDuplicate: (w: Workflow) => void;
}) {
  const status = getWorkflowStatus(w);
  const meta   = WORKFLOW_STATUS_META[status];
  const isGraph = isGraphWorkflow(w);
  const stepCount = isGraph
    ? (w.nodes ?? []).filter((n) => n.type !== 'end').length
    : (w.steps ?? []).filter((s) => s.type !== 'end').length;
  const canToggle = isAdmin && ['active', 'paused', 'draft'].includes(status);

  return (
    <tr
      className="cursor-pointer bg-white hover:bg-neutral-50/70 dark:bg-neutral-950 dark:hover:bg-neutral-900/70"
      onClick={() => onEdit(w)}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <p className="max-w-[200px] truncate font-medium text-neutral-900 dark:text-white">{w.name}</p>
          {isGraph && (
            <span
              title="Branching workflow — opens in the canvas"
              className="flex shrink-0 items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-600 dark:bg-primary-900/20 dark:text-primary-400"
            >
              <GitBranch className="h-2.5 w-2.5" aria-hidden /> Branching
            </span>
          )}
        </div>
        {w.description && (
          <p className="max-w-[200px] truncate text-xs text-neutral-400">{w.description}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </td>
      <td className="px-4 py-3 text-xs text-neutral-500">{getTriggerLabel(w)}</td>
      <td className="px-4 py-3 text-right text-sm text-neutral-600 dark:text-neutral-400">
        {stepCount}
      </td>
      <td className="px-4 py-3 text-right text-sm text-neutral-600 dark:text-neutral-400">
        {(w.runCount ?? 0).toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right text-xs text-neutral-400">
        {w.lastRunAt ? format(new Date(w.lastRunAt), 'd MMM, h:mm a') : '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canToggle && (
            <button
              onClick={() => onToggle(w)}
              title={status === 'active' ? 'Pause' : 'Activate'}
              className={cn(
                'rounded p-1 transition-colors',
                status === 'active'
                  ? 'text-neutral-400 hover:bg-warning-50 hover:text-warning-600 dark:hover:bg-warning-900/20'
                  : 'text-neutral-400 hover:bg-success-50 hover:text-success-600 dark:hover:bg-success-900/20',
              )}
            >
              {status === 'active' ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onDuplicate(w)}
              title="Save as Template (duplicate as a new draft)"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-900/20"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onDelete(w)}
              disabled={status === 'active'}
              title={status === 'active' ? 'Pause this workflow before deleting it' : 'Delete'}
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-error-50 hover:text-error-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400 dark:hover:bg-error-900/20"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
