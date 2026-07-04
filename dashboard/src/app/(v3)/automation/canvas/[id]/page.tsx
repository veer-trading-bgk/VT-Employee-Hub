'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { WorkflowCanvas } from '@/components/automation/canvas/WorkflowCanvas';
import type { AutomationResponse, GraphNode, GraphEdge } from '@/types/automations';

// Full-bleed canvas route — the one deliberate exception to UI_GUIDELINES.md's
// "use drawers for create/edit" rule (see that file's Drawers & Modals section).
// Pan/zoom/drag-connect needs the full viewport, not a 600px slide-over.
export default function WorkflowCanvasEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<AutomationResponse>({
    queryKey: ['automation', params.id],
    queryFn:  () => apiFetch(`/api/automations/${params.id}`),
  });

  const saveMutation = useMutation({
    mutationFn: (body: { nodes: GraphNode[]; edges: GraphEdge[]; entryNodeId: string | undefined }) =>
      apiFetch(`/api/automations/${params.id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation', params.id] });
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Workflow saved');
    },
    onError: (err: Error) => toast.error(err.message ?? 'Save failed'),
  });

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Minimal header — full page real estate goes to the canvas below */}
      <div className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
        <button
          onClick={() => router.push('/automation')}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Back to Automation"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
          <Zap className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">
            {data?.automation?.name ?? 'Loading…'}
          </p>
          <p className="text-[11px] text-neutral-400">Branching workflow canvas</p>
        </div>
      </div>

      {/* Canvas */}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">Loading workflow…</div>
        ) : error || !data?.automation ? (
          <div className="flex h-full items-center justify-center text-sm text-error-500">Workflow not found.</div>
        ) : (
          <WorkflowCanvas
            key={data.automation.updatedAt}
            workflow={data.automation}
            onSave={async (nodes, edges, entryNodeId) => { await saveMutation.mutateAsync({ nodes, edges, entryNodeId }); }}
          />
        )}
      </div>
    </div>
  );
}
