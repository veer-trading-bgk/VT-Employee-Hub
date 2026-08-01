import { apiFetch } from '@/lib/api';
import type {
  CreateJourneyDefinitionResponse,
  JourneyDefinitionFormValues,
  ListJourneyDefinitionsResponse,
  MutateJourneyDefinitionResponse,
} from './types';

const BASE = '/api/journeys/definitions';

export async function fetchJourneyDefinitions() {
  const res = await apiFetch<ListJourneyDefinitionsResponse>(BASE);
  return res.definitions ?? [];
}

/** brandingConfig always null until a later branding task. */
export async function createJourneyDefinition(form: JourneyDefinitionFormValues) {
  return apiFetch<CreateJourneyDefinitionResponse>(BASE, {
    method: 'POST',
    body: JSON.stringify({
      name: form.name.trim(),
      industryPack: form.industryPack.trim() || 'generic',
      screens: form.screens,
      brandingConfig: null,
      linkedWorkflowId: form.linkedWorkflowId,
    }),
    retries: 0,
  });
}

export async function updateJourneyDefinition(id: string, form: JourneyDefinitionFormValues) {
  return apiFetch<MutateJourneyDefinitionResponse>(`${BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: form.name.trim(),
      industryPack: form.industryPack.trim() || 'generic',
      linkedWorkflowId: form.linkedWorkflowId,
      active: form.active,
      screens: form.screens,
      // brandingConfig intentionally omitted — later branding task.
    }),
    retries: 0,
  });
}

/** Soft-delete — backend sets active: false (forms.js precedent). */
export async function deleteJourneyDefinition(id: string) {
  return apiFetch<MutateJourneyDefinitionResponse>(`${BASE}/${id}`, {
    method: 'DELETE',
    retries: 0,
  });
}

export const journeyKeys = {
  all: ['journey-definitions'] as const,
  list: () => [...journeyKeys.all, 'list'] as const,
};
