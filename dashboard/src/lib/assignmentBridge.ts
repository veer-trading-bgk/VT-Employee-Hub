// Pure BroadcastChannel utilities — no React, no TanStack dependencies.
// Keeps cross-tab assignment sync decoupled from any framework.

/** The assignment state for a single lead. */
export interface AssignmentRecord {
  assignedTo: string | null;
  assignedToName: string | null;
}

/** Payload broadcast when an owner changes in any tab. */
export interface AssignmentChangedEvent {
  type: 'apforce:assignment_changed';
  leadId: string;
  assignedTo: string | null;
  assignedToName: string | null;
}

const CHANNEL_NAME = 'apforce-assignments';

/**
 * Canonical React Query cache key for a lead's assignment state.
 * Export this — never use the raw array literal outside this file.
 */
export const assignmentKey = (leadId: string) => ['assignment', leadId] as const;

/**
 * Broadcast an assignment change to all other open tabs.
 * Fire-and-forget — any error is silently swallowed so it never breaks a mutation.
 */
export function broadcastAssignment(leadId: string, record: AssignmentRecord): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    const event: AssignmentChangedEvent = {
      type: 'apforce:assignment_changed',
      leadId,
      assignedTo: record.assignedTo,
      assignedToName: record.assignedToName,
    };
    ch.postMessage(event);
    ch.close();
  } catch {
    // BroadcastChannel may be unavailable in workers / sandboxed iframes
  }
}

/**
 * Subscribe to assignment changes arriving from other tabs.
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function subscribeToAssignments(
  handler: (event: AssignmentChangedEvent) => void,
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(CHANNEL_NAME);
  ch.onmessage = (e: MessageEvent) => {
    if (e.data?.type === 'apforce:assignment_changed') {
      handler(e.data as AssignmentChangedEvent);
    }
  };
  return () => ch.close();
}
