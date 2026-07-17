'use client';

import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { FlowBuilderCreateForm } from '@/components/flow-builder/FlowBuilderWorkspace';

// Full-bleed builder route — same deliberate exception to UI_GUIDELINES.md's
// "use drawers for create/edit" rule as automation/canvas (see that file's
// Drawers & Modals section): a multi-screen editor with a docked config panel
// needs the full viewport, not a 600px slide-over. Create-then-redirect like
// canvas/new, except Meta's create call needs real input first (name + send
// copy), so this page is a form rather than an on-mount POST.
export default function FlowBuilderNewPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <FlowBuilderCreateForm />
    </ProtectedRoute>
  );
}
