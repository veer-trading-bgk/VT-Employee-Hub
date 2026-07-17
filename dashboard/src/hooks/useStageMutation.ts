'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api';
import type { Contact, Stage } from '@/types/v3';

// Extracted from sales/page.tsx's KanbanBoard (desktop drag-and-drop) so the
// mobile stage-picker (M2-C) shares the exact same mutation, optimistic
// update, and error/toast behavior instead of a second independent copy.
export function useStageMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ contact, stageKey }: { contact: Contact; stageKey: string }) => {
      if (contact.type === 'lead' || (contact.leadId ?? null) !== null) {
        const leadId = contact.leadId ?? contact.id;
        return apiFetch(`/api/crm/leads/${leadId}/stage`, { method: 'PUT', body: JSON.stringify({ stage: stageKey }) });
      }
      return apiFetch('/api/contacts/stage', { method: 'PUT', body: JSON.stringify({ phone: contact.phone, stage: stageKey }) });
    },
    onMutate: async ({ contact, stageKey }) => {
      await qc.cancelQueries({ queryKey: ['sales-contacts'] });
      const previous = qc.getQueryData<Contact[]>(['sales-contacts']);
      // Stamp stageChangedAt optimistically too, matching what the backend
      // will actually persist (crm.js / ContactBulkOpsService.updateStage /
      // AutomationEngine all stamp it on every stage write) — otherwise the
      // Sales Kanban board's "Recently moved" sort wouldn't reorder the
      // dragged card to the top of its new column until the onSettled
      // refetch completes, defeating the point of an optimistic update.
      const now = new Date().toISOString();
      qc.setQueryData<Contact[]>(['sales-contacts'], (old = []) =>
        old.map((c) => (c.id === contact.id ? { ...c, stage: stageKey as Stage, stageChangedAt: now } : c)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(['sales-contacts'], context.previous);
      const is429 = error instanceof ApiClientError && error.status === 429;
      toast.error(is429 ? 'Too many stage changes — wait a moment and try again' : 'Failed to update stage');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sales-contacts'] }),
  });
}
