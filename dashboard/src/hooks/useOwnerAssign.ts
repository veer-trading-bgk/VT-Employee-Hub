'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';
import type { Contact } from '@/types/v3';

// ContactsResponse shape used by the list pages
interface ContactsListResponse {
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

interface AssignPayload {
  employeeId: string;
  employeeName: string;
}

interface MutationContext {
  prevContact?: Contact;
}

/**
 * Centralised owner-assignment mutation.
 *
 * Endpoint: PUT /api/crm/leads/{leadId}/assign  { assignedTo: employeeId }
 *
 * Optimistically updates three caches simultaneously:
 *   ['contact', contactId]  — Customer360 single-contact view
 *   ['contacts', ...]       — Contacts list page (all paginated variants)
 *   ['sales-contacts']      — Sales CRM kanban / list view
 *
 * On error: rolls back single-contact cache and refetches lists.
 */
export function useOwnerAssign(contactId: string) {
  const qc = useQueryClient();

  return useMutation<unknown, Error, AssignPayload, MutationContext>({
    mutationFn: ({ employeeId }) =>
      apiFetch(`/api/crm/leads/${contactId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo: employeeId }),
      }),

    onMutate: async ({ employeeId, employeeName }) => {
      // Cancel any in-flight fetches for the affected caches so they don't
      // overwrite our optimistic update.
      await qc.cancelQueries({ queryKey: ['contact', contactId] });

      // Snapshot the previous single-contact state for rollback.
      const prevContact = qc.getQueryData<Contact>(['contact', contactId]);

      const patch: Partial<Contact> = {
        assignedTo: employeeId,
        assignedToName: employeeName,
        ownerName: employeeName,     // backward-compat alias
        ownerId: employeeId,         // backward-compat alias
      };

      // 1. Customer360 single-contact cache
      qc.setQueryData<Contact>(['contact', contactId], (old) =>
        old ? { ...old, ...patch } : old,
      );

      // 2. Contacts list cache — all paginated variants share the prefix ['contacts']
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

      // 3. Sales CRM flat contact array
      qc.setQueryData<Contact[]>(['sales-contacts'], (old) =>
        old
          ? old.map((c) => (c.id === contactId ? { ...c, ...patch } : c))
          : old,
      );

      return { prevContact };
    },

    onSuccess: () => {
      toast.success('Owner updated');
      // Refetch the authoritative single-contact record to pick up any
      // server-side side-effects (e.g. audit trail fields).
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
    },

    onError: (_err, _vars, ctx) => {
      // Roll back the single-contact cache to the pre-mutation snapshot.
      if (ctx?.prevContact) {
        qc.setQueryData(['contact', contactId], ctx.prevContact);
      }
      // For list caches refetch is simpler and safer than reverting.
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['sales-contacts'] });
      toast.error('Failed to update owner — please try again');
    },
  });
}
