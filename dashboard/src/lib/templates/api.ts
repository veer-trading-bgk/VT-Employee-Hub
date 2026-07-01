import { apiFetch } from '@/lib/api';
import type {
  WaTemplate,
  ListTemplatesResponse,
  SyncTemplatesResponse,
  SubmitTemplateResponse,
  TemplateFormValues,
} from './types';
import { formToComponents, getBodyPreview, extractVariableCount, buildVariableLabels } from './validation';

const BASE = '/api/whatsapp/templates';

// ── Read ───────────────────────────────────────────────────────────────────────

export async function fetchTemplates(): Promise<WaTemplate[]> {
  const res = await apiFetch<ListTemplatesResponse>(BASE);
  return res.templates ?? [];
}

// ── Create ─────────────────────────────────────────────────────────────────────

export interface CreateTemplatePayload {
  name: string;
  templateName: string;
  language: string;
  category: string;
  bodyPreview: string;
  variables: string[];
  components: object[];
  allowCategoryChange: boolean;
  status?: string;
}

export function buildCreatePayload(form: TemplateFormValues): CreateTemplatePayload {
  const components = formToComponents(form);
  const varCount = extractVariableCount(form.bodyText);
  const variables = form.category === 'AUTHENTICATION'
    ? ['OTP Code']
    : buildVariableLabels(varCount);

  return {
    name: form.name,
    templateName: form.templateName,
    language: form.language,
    category: form.category,
    bodyPreview: getBodyPreview(form.bodyText),
    variables,
    components,
    allowCategoryChange: form.allowCategoryChange,
    status: 'DRAFT',
  };
}

export async function createTemplate(form: TemplateFormValues): Promise<{ success: boolean; template: WaTemplate }> {
  const payload = buildCreatePayload(form);
  return apiFetch(`${BASE}`, {
    method: 'POST',
    body: JSON.stringify(payload),
    retries: 0,
  });
}

// ── Update ─────────────────────────────────────────────────────────────────────

export async function updateTemplate(
  id: string,
  form: TemplateFormValues,
): Promise<{ success: boolean }> {
  const payload = buildCreatePayload(form);
  return apiFetch(`${BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    retries: 0,
  });
}

// ── Delete ─────────────────────────────────────────────────────────────────────

export async function deleteTemplate(id: string): Promise<{ success: boolean; warning?: string }> {
  return apiFetch(`${BASE}/${id}`, {
    method: 'DELETE',
    retries: 0,
  });
}

// ── Submit to Meta ─────────────────────────────────────────────────────────────

export async function submitTemplate(id: string): Promise<SubmitTemplateResponse> {
  return apiFetch(`${BASE}/${id}/submit`, {
    method: 'POST',
    retries: 0,
  });
}

// ── Sync from Meta ─────────────────────────────────────────────────────────────

export async function syncTemplates(): Promise<SyncTemplatesResponse> {
  return apiFetch(`${BASE}/sync`, {
    method: 'POST',
    retries: 0,
  });
}

// ── Status history ─────────────────────────────────────────────────────────────

export async function fetchTemplateHistory(id: string) {
  return apiFetch<{ success: boolean; history: object[] }>(`${BASE}/${id}/history`);
}

// ── Send template (existing endpoint) ─────────────────────────────────────────

export interface SendTemplatePayload {
  leadId?: string;
  leadPK?: string;
  templateId: string;
  variableValues: string[];
  headerVariableValue?: string;
}

export async function sendTemplate(payload: SendTemplatePayload): Promise<{ success: boolean }> {
  return apiFetch('/api/whatsapp/send-template', {
    method: 'POST',
    body: JSON.stringify(payload),
    retries: 0,
  });
}

// ── React Query keys ───────────────────────────────────────────────────────────

export const templateKeys = {
  all: ['wa-templates'] as const,
  list: () => [...templateKeys.all, 'list'] as const,
  detail: (id: string) => [...templateKeys.all, 'detail', id] as const,
  history: (id: string) => [...templateKeys.all, 'history', id] as const,
  analytics: (id: string) => [...templateKeys.all, 'analytics', id] as const,
  sync: () => [...templateKeys.all, 'sync'] as const,
};
