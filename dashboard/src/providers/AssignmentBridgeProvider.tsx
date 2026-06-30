'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  subscribeToAssignments,
  assignmentKey,
  type AssignmentRecord,
} from '@/lib/assignmentBridge';

/**
 * Bridges cross-tab owner-assignment changes via BroadcastChannel.
 *
 * When useOwnerAssign succeeds in any tab it broadcasts an event.
 * This provider receives the event and writes the new assignment into the
 * local QueryClient — every component in this tab subscribed to
 * ['assignment', leadId] re-renders immediately, with zero API calls.
 *
 * Must be mounted once, inside QueryClientProvider.
 */
export function AssignmentBridgeProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  useEffect(() => {
    return subscribeToAssignments((event) => {
      qc.setQueryData<AssignmentRecord>(assignmentKey(event.leadId), {
        assignedTo: event.assignedTo,
        assignedToName: event.assignedToName,
      });
    });
  }, [qc]);

  return <>{children}</>;
}
