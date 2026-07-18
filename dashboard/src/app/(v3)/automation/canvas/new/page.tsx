'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { AutomationResponse } from '@/types/automations';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { useMinViewportWidth } from '@/hooks/useMinViewportWidth';
import { CanvasMobileGate } from '@/components/automation/canvas/CanvasMobileGate';

// "New" is a create-then-redirect page, not a standalone editor: it POSTs a minimal
// starter draft (trigger → end, no branches yet) and immediately navigates to the
// real edit route, /automation/canvas/[id] — which is where Save/load actually live.
// This mirrors how Notion/Docs-style "new document" flows work, and avoids a second,
// parallel "unsaved canvas" code path alongside the real one.
//
// 2026-07-10 (docs/phase3/TECHNICAL_DEBT.md): this page never asked for a
// name — STARTER_BODY.name is a hardcoded default with no UI to override it
// before the POST fires. Rather than build a separate name-entry step here,
// the redirect target's own rename field (canvas/[id]/page.tsx's
// WorkflowNameField, added in Batch 2) now auto-focuses when it detects
// this exact "just created, still untitled" case via the ?new=1 query
// param below — reusing the existing rename mechanism instead of a second
// one.
const STARTER_BODY = {
  name: 'New workflow',
  trigger: { type: 'lead_created', conditions: [] },
  status: 'draft',
  nodes: [{ id: 'n-end', type: 'end', config: {} }],
  edges: [],
  entryNodeId: 'n-end',
};

// Campaigns page's "Create Drip Campaign" on-ramp (?template=drip) — same
// create-then-redirect flow as the blank starter above, just pre-loaded with
// a real send_template/wait sequence instead of an empty end-only graph, so
// the admin lands ready to customize timing and pick templates rather than
// staring at an empty canvas. No new backend/engine concept: this POSTs to
// the exact same /api/automations endpoint, producing an exact same
// CONFIG#AUTO# workflow, editable/deletable/listable in Automation →
// Workflows exactly like any other afterward — source is a provenance
// marker only (WorkflowList.tsx's "Drip Campaign" chip), never read by
// AutomationEngine.js and never gates execution.
//
// tag_added (not lead_created) is the default trigger deliberately: a drip
// CAMPAIGN targets a chosen segment (tag a batch of contacts, the sequence
// fires for that segment), unlike a blanket "every new lead" welcome
// sequence, which lead_created already suits better as the OTHER starter's
// default above.
//
// No `position` on any node — same as the blank starter's own n-end node —
// the canvas auto-arranges via dagre on first open when positions are
// absent (automationGraph.ts's needsAutoLayout()/layoutNodes()), which is
// what "positioned readably" actually means here: nothing to hand-compute.
//
// Node/template/wait timing config is deliberately empty — the admin fills
// in real templates and delays after landing in the editor; this skeleton's
// only job is to remove the "blank canvas" cold-start, not to guess content.
const DRIP_STARTER_BODY = {
  name: 'New drip campaign',
  trigger: { type: 'tag_added', conditions: [] },
  status: 'draft',
  nodes: [
    { id: 'n1', type: 'wait',          config: { amount: 1, unit: 'hours' } },
    { id: 'n2', type: 'send_template', config: { templateName: '', language: 'en', variables: [] } },
    { id: 'n3', type: 'wait',          config: { amount: 1, unit: 'days' } },
    { id: 'n4', type: 'send_template', config: { templateName: '', language: 'en', variables: [] } },
    { id: 'n5', type: 'end',           config: {} },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4' },
    { id: 'e4', source: 'n4', target: 'n5' },
  ],
  entryNodeId: 'n1',
  source: 'drip_campaign_template',
};

function WorkflowCanvasNewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDrip = searchParams.get('template') === 'drip';
  const firedRef = useRef(false);
  // M2-D: below md, don't fire the create-POST at all — a mobile visitor
  // would otherwise create a real "New workflow" draft purely to be
  // redirected straight into the same mobile gate on canvas/[id].
  const isDesktop = useMinViewportWidth(768);

  useEffect(() => {
    if (!isDesktop) return;
    if (firedRef.current) return;
    firedRef.current = true;
    apiFetch<AutomationResponse>('/api/automations', {
      method: 'POST',
      body: JSON.stringify(isDrip ? DRIP_STARTER_BODY : STARTER_BODY),
    })
      .then((res) => router.replace(`/automation/canvas/${res.automation.id}?new=1`))
      .catch(() => router.replace('/automation'));
  }, [router, isDesktop, isDrip]);

  if (!isDesktop) return <CanvasMobileGate />;

  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
      {isDrip ? 'Creating drip campaign…' : 'Creating new workflow…'}
    </div>
  );
}

export default function WorkflowCanvasNewPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <Suspense>
        <WorkflowCanvasNewPageInner />
      </Suspense>
    </ProtectedRoute>
  );
}
