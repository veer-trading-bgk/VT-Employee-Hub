'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

// Centralised mutations for Customer 360.
// Skeleton created in Commit 1 — mutations are activated as tabs are wired in subsequent commits.
export function useContactMutations(leadId: string) {
  const qc = useQueryClient();

  function invalidateContact() {
    qc.invalidateQueries({ queryKey: ['contact', leadId] });
  }

  const changeStage = useMutation({
    mutationFn: (stage: string) =>
      apiFetch(`/api/crm/leads/${leadId}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ stage }),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to update stage'),
  });

  const reassign = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string | null }) =>
      apiFetch(`/api/crm/leads/${leadId}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assignedTo: id, assignedToName: name }),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to reassign contact'),
  });

  const addTag = useMutation({
    mutationFn: (tagId: string) =>
      apiFetch('/api/tags/contacts', {
        method: 'PUT',
        body: JSON.stringify({ leadId, add: [tagId], remove: [] }),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to add tag'),
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) =>
      apiFetch('/api/tags/contacts', {
        method: 'PUT',
        body: JSON.stringify({ leadId, add: [], remove: [tagId] }),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to remove tag'),
  });

  const addNote = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/api/crm/leads/${leadId}/note`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to save note'),
  });

  const createTask = useMutation({
    mutationFn: (data: { date: string; note: string; assignedTo?: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/followup`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateContact();
      qc.invalidateQueries({ queryKey: ['followups', leadId] });
    },
    onError: () => toast.error('Failed to create task'),
  });

  const completeTask = useMutation({
    mutationFn: ({ followupId, outcome }: { followupId: string; outcome: string }) =>
      apiFetch(`/api/crm/leads/${leadId}/followup/${followupId}`, {
        method: 'PUT',
        body: JSON.stringify({ done: true, outcome }),
      }),
    onSuccess: () => {
      invalidateContact();
      qc.invalidateQueries({ queryKey: ['followups', leadId] });
    },
    onError: () => toast.error('Failed to complete task'),
  });

  const updateField = useMutation({
    mutationFn: (data: Partial<{ name: string; email: string; notes: string }>) =>
      apiFetch(`/api/crm/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to update contact'),
  });

  const updateCrm = useMutation({
    mutationFn: (data: Partial<{
      source: string;
      productInterest: string[];
      closureDeadline: string | null;
      notes: string;
      expectedValue: number | null;
      probability: number | null;
    }>) =>
      apiFetch(`/api/crm/leads/${leadId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: invalidateContact,
    onError: () => toast.error('Failed to update CRM data'),
  });

  return {
    changeStage,
    reassign,
    addTag,
    removeTag,
    addNote,
    createTask,
    completeTask,
    updateField,
    updateCrm,
  };
}
