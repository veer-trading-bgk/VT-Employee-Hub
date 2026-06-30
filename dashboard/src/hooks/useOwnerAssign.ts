'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { Contact } from '@/types/v3';
import {
  assignmentKey,
  broadcastAssignment,
  type AssignmentRecord,
} from '@/lib/assignmentBridge';

// Re-export so consumers only need one import
export type { AssignmentRecord };
export { assignmentKey };

interface ContactsListResponse {
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssignPayload {
  employeeId: string;
  employeeName: string;
}

interface MutationContext {
  prevAssignment?: AssignmentRecord;
  prevContact?: Contact;
}

/**
 * Centralized owner-assignment mutation.
 *
 * On mutate  → optimistically updates THREE layers simultaneously:
 *   1. ['assignment', leadId]  — canonical single-source-of-truth (NEW)
 *   2. ['contact', leadId]     — C360 single-contact view
 *   3. ['contacts', ...]       — Contacts list (all paginated variants)
 *   4. ['sales-contacts']      — Sales CRM flat list
 *
 * On success → broadcasts via BroadcastChannel so every other open tab
 *              updates without any API round-trip.
 *
 * On error   → rolls back ['assignment'] and ['contact']; refetches lists.
 *
 * Adding a new module? Just read ['assignment', leadId] — no changes here.
 */
export function useOwnerAssign(contactId: string) {
  const qc = useQueryClient();

  return useMutation<unknown, Error, AssignPayload, MutationContext>({
    mutationFn: ({ employeeId, employeeName }) =>
      apiFetch(`/api/crm/leads/${contactId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo: employeeId, assignedToName: employeeName }),
      }),

    onMutate: async ({ employeeId, employeeName }) => {
      const newAssignment: AssignmentRecord = {
        assignedTo: employeeId,
        assignedToName: employeeName,
      };

      const patch: Partial<Contact> = {
        assignedTo: employeeId,
        assignedToName: employeeName,
        ownerName: employeeName,
        ownerId: employeeId,
      };

      // Cancel in-flight queries that could overwrite optimistic data
      await Promise.all([
        qc.cancelQueries({ queryKey: assignmentKey(contactId) }),
        qc.cancelQueries({ queryKey: ['contact', contactId] }),
      ]);

      // Snapshot for rollback
      const prevAssignment = qc.getQueryData<AssignmentRecord>(assignmentKey(contactId));
      const prevContact    = qc.getQueryData<Contact>(['contact', contactId]);

      // 1. Assignment cache — the new single source of truth
      //    All components reading ['assignment', contactId] re-render immediately
      qc.setQueryData<AssignmentRecord>(assignmentKey(contactId), newAssignment);

      // 2. C360 single-contact cache — kept for backward compat
      qc.setQueryData<Contact>(['contact', contactId], (old) =>
        old ? { ...old, ...patch } : old,
      );

      // 3. Contacts list — all paginated variants share the ['contacts'] prefix
      qc.setQueriesData<ContactsListResponse>(
        { queryKey: ['contacts'] },
        (old) =>
          old
            ? {
                ...old,
                contacts: old.contacts.map((c) =>
                  c.id === contactId ? { ...c, ...patch } : c,
                ),
              }
            : old,
      );

      // 4. Sales CRM flat contact array
      qc.setQueryData<Contact[]>(['sales-contacts'], (old) =>
        old ? old.map((c) => (c.id === contactId ? { ...c, ...patch } : c)) : old,
      );

      return { prevAssignment, prevContact };
    },

    onSuccess: (_data, { employeeId, employeeName }) => {
      toast.success('Owner updated');
      // Invalidate C360 to pick up any server-side side-effects
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      // Cross-tab broadcast: other open tabs update ['assignment', contactId]
      // in their own QueryClient without any API call
      broadcastAssignment(contactId, {
        assignedTo: employeeId,
        assignedToName: employeeName,
      });
    },

    onError: (_err, _vars, ctx) => {
      // Roll back assignment cache
      if (ctx?.prevAssignment !== undefined) {
        qc.setQueryData(assignmentKey(contactId), ctx.prevAssignment);
      } else {
        // It was never set before — remove the optimistic entry entirely
        qc.removeQueries({ queryKey: assignmentKey(contactId) });
      }
      // Roll back C360 cache
      if (ctx?.prevContact) {
        qc.setQueryData(['contact', contactId], ctx.prevContact);
      }
      // Refetch list caches — simpler and safer than reverting map operations
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['sales-contacts'] });
      toast.error('Failed to update owner — please try again');
    },
  });
}
