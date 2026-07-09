import { apiFetch } from '@/lib/api';
import type { TestResult } from '@/lib/ai-admin/api';

const BASE = '/api/knowledge';

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  list: () => [...knowledgeKeys.all, 'list'] as const,
  versions: (entryId: string) => [...knowledgeKeys.all, 'versions', entryId] as const,
};

// Structured Knowledge Center (Phase 2A, PR 3) — bounded Q&A entries,
// keyword-matched into the live prompt. question/triggers/answer are
// draft/active-split and gated behind the same PromptTestService gate PR 2
// uses; category is display/filter metadata only, updates immediately.

export interface KnowledgeEntry {
  entryId: string;
  draftQuestion: string;
  draftTriggers: string[];
  draftAnswer: string;
  activeQuestion: string | null;
  activeTriggers: string[];
  activeAnswer: string | null;
  activeVersion: number;
  activePublishedAt: string | null;
  category: string | null;
  archived: boolean;
  lastTestResult: TestResult | null;
  createdAt: string;
}

export interface KnowledgeEntryVersion {
  version: number;
  question: string;
  triggers: string[];
  answer: string;
  category: string | null;
  publishedAt: string;
  publishedBy: string;
  testResult: TestResult;
  restoredFrom: number | null;
}

export interface KnowledgeEntryDraftPayload {
  question: string;
  triggers: string[];
  answer: string;
  category?: string;
}

export async function fetchKnowledgeEntries(): Promise<{ entries: KnowledgeEntry[] }> {
  return apiFetch(`${BASE}/`);
}

export async function createKnowledgeEntry(payload: KnowledgeEntryDraftPayload): Promise<KnowledgeEntry> {
  return apiFetch(`${BASE}/`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function saveKnowledgeEntryDraft({ entryId, ...payload }: KnowledgeEntryDraftPayload & { entryId: string }): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/${entryId}/draft`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function testKnowledgeEntry(entryId: string): Promise<TestResult> {
  return apiFetch(`${BASE}/${entryId}/test`, { method: 'POST', body: JSON.stringify({}) });
}

export async function publishKnowledgeEntry(entryId: string): Promise<{ success: boolean; version: number; testResult: TestResult }> {
  return apiFetch(`${BASE}/${entryId}/publish`, { method: 'POST', body: JSON.stringify({}) });
}

export async function fetchKnowledgeEntryVersions(entryId: string): Promise<{ versions: KnowledgeEntryVersion[] }> {
  return apiFetch(`${BASE}/${entryId}/versions`);
}

export async function restoreKnowledgeEntryVersion({ entryId, version }: { entryId: string; version: number }): Promise<{ success: boolean; version: number; restoredFrom: number; testResult: TestResult }> {
  return apiFetch(`${BASE}/${entryId}/versions/${version}/restore`, { method: 'POST', body: JSON.stringify({}) });
}

export async function archiveKnowledgeEntry(entryId: string): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/${entryId}/archive`, { method: 'PUT', body: JSON.stringify({}) });
}

export async function unarchiveKnowledgeEntry(entryId: string): Promise<{ success: boolean }> {
  return apiFetch(`${BASE}/${entryId}/unarchive`, { method: 'PUT', body: JSON.stringify({}) });
}
