'use client';

import { useParams } from 'next/navigation';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { FlowBuilderWorkspace } from '@/components/flow-builder/FlowBuilderWorkspace';

// Full-bleed builder route — same deliberate exception to UI_GUIDELINES.md's
// "use drawers for create/edit" rule as automation/canvas/[id] (see that
// file's Drawers & Modals section): the screen editor's stack + docked config
// panel needs the full viewport, not a 600px slide-over.
export default function FlowBuilderEditPage() {
  const params = useParams<{ flowId: string }>();
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <FlowBuilderWorkspace flowId={params.flowId} />
    </ProtectedRoute>
  );
}
