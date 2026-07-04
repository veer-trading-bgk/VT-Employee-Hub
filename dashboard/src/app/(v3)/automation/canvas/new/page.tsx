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
      .then((res) => router.replace(`/automation/canvas/${res.automation.id}`))
      .catch(() => router.replace('/automation'));
  }, [router]);

  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
      Creating new workflow…
    </div>
  );
}
