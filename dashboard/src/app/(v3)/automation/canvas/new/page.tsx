'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { AutomationResponse } from '@/types/automations';

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

export default function WorkflowCanvasNewPage() {
  const router = useRouter();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    apiFetch<AutomationResponse>('/api/automations', {
      method: 'POST',
      body: JSON.stringify(STARTER_BODY),
    })
      .then((res) => router.replace(`/automation/canvas/${res.automation.id}?new=1`))
      .catch(() => router.replace('/automation'));
  }, [router]);

  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
      Creating new workflow…
    </div>
  );
}
