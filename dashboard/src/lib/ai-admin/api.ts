import { apiFetch } from '@/lib/api';

const BASE = '/api/ai-admin';

export const aiAdminKeys = {
  all: ['ai-admin'] as const,
  general: () => [...aiAdminKeys.all, 'general'] as const,
  conversation: () => [...aiAdminKeys.all, 'conversation'] as const,
  compliance: () => [...aiAdminKeys.all, 'compliance'] as const,
  future: () => [...aiAdminKeys.all, 'future'] as const,
  promptAddendum: () => [...aiAdminKeys.all, 'prompt-addendum'] as const,
  promptAddendumVersions: () => [...aiAdminKeys.all, 'prompt-addendum', 'versions'] as const,
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

// ── Prompt Management (Phase 2A, PR 2) ───────────────────────────────────────
// Bounded free-text addendum, appended after the permanently code-locked
// hard compliance rules — never a full prompt override. Every path that can
// make it live (publish, restore) re-runs the compliance test gate server-
// side, fresh, every time; a client-shown prior pass is UX only.

export interface TestResultItem {
  input: string;
  passed: boolean;
  reply: string | null;
  reason: string | null;
  knownIssue: string | null;
}
export interface TestResult {
  allPassed: boolean;
  results: TestResultItem[];
  testedAt: string;
}
export interface PromptAddendumState {
  activeText: string;
  activeVersion: number;
  draftText: string;
  lastTestResult: TestResult | null;
}
export interface PromptAddendumVersion {
  version: number;
  text: string;
  publishedAt: string;
  publishedBy: string;
  testResult: TestResult;
  restoredFrom: number | null;
}

export async function fetchPromptAddendum(): Promise<PromptAddendumState> {
  return apiFetch<PromptAddendumState>(`${BASE}/prompt-addendum`);
}

export async function savePromptAddendumDraft(text: string): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/prompt-addendum/draft`, { method: 'PUT', body: JSON.stringify({ text }) });
}

export async function testPromptAddendum(text?: string): Promise<TestResult> {
  return apiFetch<TestResult>(`${BASE}/prompt-addendum/test`, {
    method: 'POST', body: JSON.stringify(text === undefined ? {} : { text }),
  });
}

export async function publishPromptAddendum(): Promise<{ success: boolean; version: number; testResult: TestResult }> {
  return apiFetch(`${BASE}/prompt-addendum/publish`, { method: 'POST', body: JSON.stringify({}) });
}

export async function fetchPromptAddendumVersions(): Promise<{ versions: PromptAddendumVersion[] }> {
  return apiFetch(`${BASE}/prompt-addendum/versions`);
}

export async function restorePromptAddendumVersion(version: number): Promise<{ success: boolean; version: number; restoredFrom: number; testResult: TestResult }> {
  return apiFetch(`${BASE}/prompt-addendum/versions/${version}/restore`, { method: 'POST', body: JSON.stringify({}) });
}
