import { apiFetch } from '@/lib/api';

const BASE = '/api/ai-admin';

export const aiAdminKeys = {
  all: ['ai-admin'] as const,
  general: () => [...aiAdminKeys.all, 'general'] as const,
  conversation: () => [...aiAdminKeys.all, 'conversation'] as const,
  compliance: () => [...aiAdminKeys.all, 'compliance'] as const,
  future: () => [...aiAdminKeys.all, 'future'] as const,
};

// ── General ──────────────────────────────────────────────────────────────────

export interface GeneralSettings {
  conversationAgentEnabled: boolean;
  qualificationEnabled: boolean;
  summaryEnabled: boolean;
  crmAutoTransferEnabled: boolean;
  leadScoringEnabled: boolean;
  autoAssign: { enabled: boolean; capacity?: number; overflow?: string };
}

export async function fetchGeneralSettings(): Promise<GeneralSettings> {
  return apiFetch<GeneralSettings>(`${BASE}/general`);
}

export async function saveGeneralSettings(payload: Omit<GeneralSettings, 'autoAssign'>): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/general`, { method: 'PUT', body: JSON.stringify(payload) });
}

// ── Conversation ─────────────────────────────────────────────────────────────

export type Persona = 'professional_rm' | 'friendly_advisor' | 'concise_expert';
export type Tone = 'professional' | 'friendly' | 'formal' | 'casual';
export type ConversationStyle = 'concise' | 'balanced' | 'detailed';

export interface ConversationSettings {
  persona: Persona;
  tone: Tone;
  languageRules: string;
  conversationStyle: ConversationStyle;
  qualificationRules: string;
}

export async function fetchConversationSettings(): Promise<ConversationSettings> {
  return apiFetch<ConversationSettings>(`${BASE}/conversation`);
}

export async function saveConversationSettings(payload: ConversationSettings): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/conversation`, { method: 'PUT', body: JSON.stringify(payload) });
}

// ── Compliance (read-only) ───────────────────────────────────────────────────

export interface ComplianceInfo {
  guardrailCategories: string[];
  escalationCategories: string[];
  safeResponseTemplate: string;
  editable: false;
  note: string;
}

export async function fetchComplianceInfo(): Promise<ComplianceInfo> {
  return apiFetch<ComplianceInfo>(`${BASE}/compliance`);
}

// ── Future AI Settings ───────────────────────────────────────────────────────

export interface FutureSettings {
  customModelSettings: {
    enabled: boolean;
    model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-5' | null;
    temperature: number | null;
  };
  rag: { enabled: boolean; locked: true };
  embedding: { model: string | null; locked: true };
  search: { locked: true };
}

export async function fetchFutureSettings(): Promise<FutureSettings> {
  return apiFetch<FutureSettings>(`${BASE}/future`);
}

export async function saveFutureSettings(payload: Pick<FutureSettings, 'customModelSettings'>): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/future`, { method: 'PUT', body: JSON.stringify(payload) });
}
