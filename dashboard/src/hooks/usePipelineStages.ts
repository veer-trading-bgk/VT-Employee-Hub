'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface PipelineStage {
  key: string;
  label: string;
  color: string;
  order: number;
}

// Exact client-side mirror of src/services/PipelineService.js's DEFAULT_STAGES —
// used only while the real pipeline is loading or if the fetch fails, same
// fallback role the backend's own DEFAULT_STAGES plays when
// CONFIG#CRM#<companyId>/PIPELINE is absent. Keep colors in sync with that
// file — some consumers (e.g. the sales pipeline board) render stage.color.
const FALLBACK_STAGES: PipelineStage[] = [
  { key: 'new_lead',   label: 'New Lead',   color: '#94a3b8', order: 0 },
  { key: 'contacted',  label: 'Contacted',  color: '#3b82f6', order: 1 },
  { key: 'interested', label: 'Interested', color: '#f59e0b', order: 2 },
  { key: 'kyc_done',   label: 'KYC Done',   color: '#8b5cf6', order: 3 },
  { key: 'demat_done', label: 'Demat Done', color: '#22c55e', order: 4 },
  { key: 'lost',       label: 'Lost',       color: '#ef4444', order: 5 },
];

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
  // Stable reference across renders where `data` hasn't changed — several
  // consumers key their own useMemo/useEffect off this array.
  const stages = useMemo(
    () => (data?.stages?.length ? data.stages : FALLBACK_STAGES).slice().sort((a, b) => a.order - b.order),
    [data],
  );
  return { stages, isLoading };
}
