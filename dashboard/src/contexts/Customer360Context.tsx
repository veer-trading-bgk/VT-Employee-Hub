'use client';

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { ContactDetail, ContactMessage, TimelineItem, ContactDetailResponse } from '@/lib/contacts/types';

export interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

export interface Customer360ContextValue {
  leadId: string;
  contact: ContactDetail | null;
  stages: PipelineStage[];
  stageObj: PipelineStage | undefined;
  messages: ContactMessage[];
  notes: ContactMessage[];
  timeline: TimelineItem[];
  windowExpired: boolean;
  isLoading: boolean;
  isError: boolean;
  refresh: () => void;
}

const Customer360Context = createContext<Customer360ContextValue | null>(null);

export function useCustomer360(): Customer360ContextValue {
  const ctx = useContext(Customer360Context);
  if (!ctx) throw new Error('useCustomer360 must be used within Customer360Provider');
  return ctx;
}

function is24hExpired(lastInboundAt?: string | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() > 24 * 3_600_000;
}

interface Customer360ProviderProps {
  leadId: string;
  children: ReactNode;
}

export function Customer360Provider({ leadId, children }: Customer360ProviderProps) {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['contact', leadId],
    queryFn: () => apiFetch<ContactDetailResponse>(`/api/crm/leads/${leadId}`),
    staleTime: 60_000,
    enabled: !!leadId,
  });

  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () =>
      apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 10 * 60_000,
  });

  const contact = data?.lead ?? null;
  const stages = pipelineData?.stages ?? [];
  const messages = (data?.messages ?? []) as ContactMessage[];
  const notes = (data?.internalNotes ?? []) as ContactMessage[];

  const timeline: TimelineItem[] = useMemo(
    () =>
      [
        ...messages.map((m) => ({ ...m, _kind: 'message' as const })),
        ...notes.map((n) => ({ ...n, _kind: 'note' as const })),
      ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages.length, notes.length, leadId],
  );

  const stageObj = stages.find((s) => s.key === contact?.stage);
  const windowExpired = is24hExpired(contact?.lastInboundAt);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['contact', leadId] });
  }, [qc, leadId]);

  const value = useMemo<Customer360ContextValue>(
    () => ({
      leadId,
      contact,
      stages,
      stageObj,
      messages,
      notes,
      timeline,
      windowExpired,
      isLoading,
      isError,
      refresh,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadId, data, pipelineData, isLoading, isError, refresh],
  );

  return (
    <Customer360Context.Provider value={value}>
      {children}
    </Customer360Context.Provider>
  );
}
