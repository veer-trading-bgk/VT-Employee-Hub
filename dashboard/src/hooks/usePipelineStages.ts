'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { STAGE_LABELS, type Stage } from '@/types/v3';

export interface PipelineStage {
  key: string;
  label: string;
  color: string;
  order: number;
}

// Client-side mirror of crm.js's DEFAULT_STAGES — used only while the real
// pipeline is loading or if the fetch fails, same fallback role the backend's
// own DEFAULT_STAGES plays when CONFIG#CRM#<companyId>/PIPELINE is absent.
const FALLBACK_STAGES: PipelineStage[] = (Object.keys(STAGE_LABELS) as Stage[]).map((key, i) => ({
  key,
  label: STAGE_LABELS[key],
  color: '#64748b',
  order: i,
}));

/**
 * Shared CRM pipeline (company-configurable stage list) — single React
 * Query owner for ['pipeline-stages']. Backed by GET /api/crm/pipeline,
 * the same CONFIG#CRM#<companyId>/PIPELINE record crm.js's stage-change
 * and stage-validation routes already treat as the source of truth.
 * Use this everywhere instead of the hardcoded STAGE_LABELS map so the UI
 * can't drift from a company's customized pipeline.
 */
export function usePipelineStages() {
  const { data, isLoading } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });
  const stages = (data?.stages?.length ? data.stages : FALLBACK_STAGES)
    .slice()
    .sort((a, b) => a.order - b.order);
  return { stages, isLoading };
}
