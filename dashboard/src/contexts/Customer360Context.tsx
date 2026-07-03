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
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import type { ContactDetail, ContactMessage, TimelineItem, ContactDetailResponse, Followup } from '@/lib/contacts/types';

export type { PipelineStage };

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
  followups: Followup[];
  nextFollowup: Followup | null;
  refreshFollowups: () => void;
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
  // A real CRM lead id (LEAD# record) — never a phone number or other
  // synthetic value. Unknown/INBOX# contacts have no lead record and are
  // not representable here: callers must branch before mounting this
  // provider (see app/(v3)/contacts/[contactId]/page.tsx's isUnknown
  // check) rather than pass a fake id in. Every tab this context feeds
  // (CRM, Tasks, Notes, Conversation's resolve/reopen) writes through
  // leadId-keyed endpoints with no unknown-contact equivalent, so a
  // reduced context for unknown contacts belongs at the page level —
  // render nothing from this provider rather than a partially-working one.
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

  // Single shared owner of ['pipeline-stages'] — same hook every other
  // stage-consuming surface in the app uses (contacts list, inbox, sales
  // board, campaigns, automation builder). Replaces this context's former
  // standalone ['crm-pipeline'] fetch of the same GET /api/crm/pipeline.
  const { stages } = usePipelineStages();

  const { data: followupsData } = useQuery({
    queryKey: ['crm-followups', leadId],
    queryFn: () =>
      apiFetch<{ success: boolean; followups: Followup[] }>(
        `/api/crm/followups?days=60&leadId=${leadId}`
      ).catch(() => ({ success: true, followups: [] as Followup[] })),
    staleTime: 30_000,
    enabled: !!leadId,
  });

  const contact = data?.lead ?? null;
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

  const refreshFollowups = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['crm-followups', leadId] });
  }, [qc, leadId]);

  const rawFollowups: Followup[] = followupsData?.followups ?? [];
  const nextFollowup: Followup | null =
    [...rawFollowups].filter((f) => !f.done).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

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
      followups: rawFollowups,
      nextFollowup,
      refreshFollowups,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadId, data, stages, followupsData, isLoading, isError, refresh, refreshFollowups],
  );

  return (
    <Customer360Context.Provider value={value}>
      {children}
    </Customer360Context.Provider>
  );
}
