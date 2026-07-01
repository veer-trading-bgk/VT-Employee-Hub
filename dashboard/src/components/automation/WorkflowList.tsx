'use client';

import { useState } from 'react';
import { Plus, Search, Trash2, Play, Pause, Zap } from 'lucide-react';
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
  WORKFLOW_STATUS_META, getTriggerLabel, getWorkflowStatus,
} from '@/types/automations';
import { WorkflowCreateDrawer } from './WorkflowCreateDrawer';

export function WorkflowList() {
  const [search,        setSearch]        = useState('');
  const [drawerOpen,    setDrawerOpen]    = useState(false);
  const [editWorkflow,  setEditWorkflow]  = useState<Workflow | null>(null);
  const { user } = useAuth();
  const isAdmin = ['owner', 'admin'].includes(toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]));
  const qc = useQueryClient();

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

  const workflows = (data?.automations ?? []).filter((w) =>
    !search || w.name.toLowerCase().includes(search.toLowerCase()),
  );

  function openCreate() { setEditWorkflow(null); setDrawerOpen(true); }
  function openEdit(w: Workflow) { setEditWorkflow(w); setDrawerOpen(true); }

  return (
    <>
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
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <WorkflowCreateDrawer
        key={editWorkflow?.id ?? 'new'}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditWorkflow(null); }}
        workflow={editWorkflow}
      />
    </>
  );
}

function WorkflowRow({
  workflow: w, isAdmin, onEdit, onToggle, onDelete,
}: {
  workflow:  Workflow;
  isAdmin:   boolean;
  onEdit:    (w: Workflow) => void;
  onToggle:  (w: Workflow) => void;
  onDelete:  (w: Workflow) => void;
}) {
  const status = getWorkflowStatus(w);
  const meta   = WORKFLOW_STATUS_META[status];
  const stepCount = (w.steps ?? []).filter((s) => s.type !== 'end').length;
  const canDelete = isAdmin && status !== 'active';
  const canToggle = isAdmin && ['active', 'paused', 'draft'].includes(status);

  return (
    <tr
      className="cursor-pointer bg-white hover:bg-neutral-50/70 dark:bg-neutral-950 dark:hover:bg-neutral-900/70"
      onClick={() => onEdit(w)}
    >
      <td className="px-4 py-3">
        <p className="max-w-[200px] truncate font-medium text-neutral-900 dark:text-white">{w.name}</p>
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
          {canDelete && (
            <button
              onClick={() => onDelete(w)}
              title="Delete"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-900/20"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
