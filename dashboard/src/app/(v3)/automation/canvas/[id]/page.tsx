'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Zap, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api';
import { WorkflowCanvas } from '@/components/automation/canvas/WorkflowCanvas';
import type { AutomationResponse, GraphNode, GraphEdge, WorkflowTrigger, Workflow } from '@/types/automations';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

// Default name a freshly-created workflow carries until renamed — must match
// canvas/new/page.tsx's STARTER_BODY.name exactly (checked as part of the
// auto-focus decision below, not just the ?new=1 query param, so a workflow
// someone already renamed within the same just-created page load doesn't
// get its cursor stolen back).
const DEFAULT_WORKFLOW_NAME = 'New workflow';

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
//
// 2026-07-10 regression-investigation follow-up (docs/phase3/TECHNICAL_DEBT.md):
// this field always worked — confirmed live via Playwright against the real
// component — but had zero visible affordance at rest (fully transparent
// border, identical typography to the static <p> it replaced), so it read
// as inert text. A pencil icon is the fix, not a persistent border: a border
// alone is ambiguous (could read as a disabled/read-only box), while a
// pencil is a near-universally recognized "this is editable" signal and
// needs no hover/focus to be understood. Kept always visible, not
// hover-gated — a hover-only icon would just move the discoverability
// problem instead of fixing it.
function WorkflowNameField({ automation, onSave, autoFocus }: { automation: Workflow; onSave: (name: string) => void; autoFocus?: boolean }) {
  const [name, setName] = useState(automation.name);
  // Escape sets this synchronously (unlike setName, which is batched) so
  // commit() — fired by the blur() call right below it, before React has
  // re-rendered — knows to discard the in-progress edit instead of reading
  // the stale, not-yet-reverted `name` closure and saving it anyway.
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Imperative focus+select via ref in an effect, not the native `autoFocus`
  // JSX prop (which would fire unconditionally on every mount regardless of
  // the `autoFocus` param and trips jsx-a11y/no-autofocus) — this only runs
  // when the caller has actually decided auto-focus is warranted. Fires
  // once per mount (the caller's key={automation.id} guarantees a fresh
  // mount per workflow, so this can't re-steal focus on a background
  // refetch of the SAME workflow). select() (not just focus()) so the
  // first keystroke replaces "New workflow" outright instead of appending.
  useEffect(() => {
    if (autoFocus) { inputRef.current?.focus(); inputRef.current?.select(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see comment above
  }, []);

  function commit() {
    if (cancelledRef.current) { cancelledRef.current = false; setName(automation.name); return; }
    const trimmed = name.trim();
    if (!trimmed) { setName(automation.name); return; } // no empty rename — revert silently, matches Delete's no-op-on-invalid pattern
    if (trimmed !== automation.name) onSave(trimmed);
    if (trimmed !== name) setName(trimmed);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
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
      <Pencil className="h-3 w-3 shrink-0 text-neutral-300 dark:text-neutral-600" aria-hidden />
    </div>
  );
}

// Full-bleed canvas route — the one deliberate exception to UI_GUIDELINES.md's
// "use drawers for create/edit" rule (see that file's Drawers & Modals section).
// Pan/zoom/drag-connect needs the full viewport, not a 600px slide-over.
function WorkflowCanvasEditPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  // Captured once via lazy useState init, NOT re-derived from searchParams
  // every render — router.replace() below strips ?new=1 from the URL almost
  // immediately (well before the automation query resolves), and re-reading
  // searchParams.get('new') after that strip would silently go back to
  // false right as WorkflowNameField needs it, losing the auto-focus. This
  // is what distinguishes "just created" (redirected here from canvas/new
  // with ?new=1) from "opened later from WorkflowList" (navigates here with
  // no query param at all, so this is false and stays false) — a query
  // param, not a createdAt-within-N-seconds time check, because it's exact
  // and immune to network latency/clock skew instead of an approximation.
  const [isJustCreated] = useState(() => searchParams.get('new') === '1');

  const { data, isLoading, error } = useQuery<AutomationResponse>({
    queryKey: ['automation', params.id],
    queryFn:  () => apiFetch(`/api/automations/${params.id}`),
  });

  // One-time URL cleanup so a later page refresh (F5) while still on this
  // workflow doesn't re-trigger auto-focus mid-edit and steal the cursor.
  useEffect(() => {
    if (isJustCreated) router.replace(`/automation/canvas/${params.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only, isJustCreated is stable for the component's lifetime
  }, []);

  // Only auto-focus when BOTH signals agree: redirected straight from
  // creation (isJustCreated) AND the name is still the untouched default —
  // the second check means a workflow someone already renamed within the
  // same just-created page load (e.g. typed a name, then the page
  // re-rendered for an unrelated reason) doesn't get its cursor stolen back.
  const shouldAutoFocusName = isJustCreated && data?.automation?.name === DEFAULT_WORKFLOW_NAME;

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
            <WorkflowNameField key={data.automation.id} automation={data.automation} onSave={(name) => renameMutation.mutate(name)} autoFocus={shouldAutoFocusName} />
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

export default function WorkflowCanvasEditPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <WorkflowCanvasEditPageInner />
    </ProtectedRoute>
  );
}
