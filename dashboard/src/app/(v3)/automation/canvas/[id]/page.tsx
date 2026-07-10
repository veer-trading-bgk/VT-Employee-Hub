'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Zap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api';
import { WorkflowCanvas } from '@/components/automation/canvas/WorkflowCanvas';
import type { AutomationResponse, GraphNode, GraphEdge, WorkflowTrigger, Workflow } from '@/types/automations';

// Track A4 Batch 2 (2026-07-09, docs/phase3/TECHNICAL_DEBT.md): the canvas
// route had no rename UI at all — the header showed the name as static text
// and saveMutation's PUT body never included it. This is a separate,
// independent mutation (name-only PUT body) rather than folding name into
// WorkflowCanvas's own save flow — the backend's PUT /:id already applies
// partial updates per-field, and threading name state through WorkflowCanvas
// would touch a much larger surface for no benefit.
// `key={automation.id}` on the caller resets this component's local state
// per the React-recommended alternative to a useEffect+setState sync (this
// repo's eslint config flags synchronous setState-in-effect) — a fresh
// mount picks up the just-loaded name once, not on every background refetch.
function WorkflowNameField({ automation, onSave }: { automation: Workflow; onSave: (name: string) => void }) {
  const [name, setName] = useState(automation.name);
  // Escape sets this synchronously (unlike setName, which is batched) so
  // commit() — fired by the blur() call right below it, before React has
  // re-rendered — knows to discard the in-progress edit instead of reading
  // the stale, not-yet-reverted `name` closure and saving it anyway.
  const cancelledRef = useRef(false);

  function commit() {
    if (cancelledRef.current) { cancelledRef.current = false; setName(automation.name); return; }
    const trimmed = name.trim();
    if (!trimmed) { setName(automation.name); return; } // no empty rename — revert silently, matches Delete's no-op-on-invalid pattern
    if (trimmed !== automation.name) onSave(trimmed);
    if (trimmed !== name) setName(trimmed);
  }

  return (
    <input
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancelledRef.current = true; e.currentTarget.blur(); }
      }}
      aria-label="Workflow name"
      className="w-full truncate rounded border border-transparent bg-transparent px-1 -mx-1 text-sm font-semibold text-neutral-900 hover:border-neutral-200 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:text-white dark:hover:border-neutral-700"
    />
  );
}

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
    mutationFn: (body: { nodes: GraphNode[]; edges: GraphEdge[]; entryNodeId: string | undefined; trigger: WorkflowTrigger }) =>
      apiFetch(`/api/automations/${params.id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation', params.id] });
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Workflow saved');
    },
    onError: (err: Error) => toast.error(err.message ?? 'Save failed'),
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => apiFetch(`/api/automations/${params.id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation', params.id] });
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Workflow renamed');
    },
    onError: (err: Error) => toast.error(err.message ?? 'Rename failed'),
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
        <div className="min-w-0 flex-1 max-w-sm">
          {data?.automation ? (
            <WorkflowNameField key={data.automation.id} automation={data.automation} onSave={(name) => renameMutation.mutate(name)} />
          ) : (
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Loading…</p>
          )}
          <p className="text-[11px] text-neutral-400">Branching workflow canvas</p>
        </div>
      </div>

      {/* Canvas */}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin text-primary-500" aria-hidden />
            <p>Loading workflow…</p>
          </div>
        ) : error || !data?.automation ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-error-500">
            {error instanceof ApiClientError && error.status === 404 ? (
              <p>Workflow not found.</p>
            ) : error ? (
              <>
                <p>Couldn&apos;t load this workflow.</p>
                <p className="text-xs text-neutral-400">
                  {error instanceof ApiClientError ? `${error.status}: ${error.message}` : (error as Error).message}
                </p>
                <p className="text-xs text-neutral-400">Check the backend is running and reachable.</p>
              </>
            ) : (
              <p>Workflow not found.</p>
            )}
          </div>
        ) : (
          <WorkflowCanvas
            key={data.automation.updatedAt}
            workflow={data.automation}
            onSave={async (nodes, edges, entryNodeId, trigger) => { await saveMutation.mutateAsync({ nodes, edges, entryNodeId, trigger }); }}
          />
        )}
      </div>
    </div>
  );
}
