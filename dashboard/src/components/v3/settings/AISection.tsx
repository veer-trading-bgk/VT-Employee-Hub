'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';

interface AIConfigResponse {
  masterEnabled: boolean;
  moduleToggles: Record<string, boolean>;
}

// Mirrors src/config/aiConfig.js's registry — only the real useCases that
// exist today. A future useCase needs a label added here alongside its config
// entry, the same way NodePalette.tsx's EXTRA_META needs an entry per node type.
const MODULES: Array<{ useCase: string; label: string; description: string }> = [
  { useCase: 'metrics-insights', label: 'My Metrics Insights', description: 'AI analysis of an employee’s own performance metrics' },
  { useCase: 'team-metrics-insights', label: 'Team Metrics Insights', description: 'AI analysis of team-wide performance, for admins and managers' },
  { useCase: 'inbox-intent-detection', label: 'Inbox Intent Detection', description: 'Classifies each new WhatsApp conversation’s likely intent (interested, complaint, KYC query, etc.)' },
  { useCase: 'template-creation', label: 'AI-Assisted Template Creation', description: 'Drafts a Meta-compliant WhatsApp template from a plain-language description, for an admin to review before submitting' },
  { useCase: 'inbox-template-suggestion', label: 'AI Template Suggestions in Chat', description: 'Suggests a matching approved template while an agent is viewing a conversation in the Inbox — the agent reviews and sends it themselves' },
];

/**
 * Settings > AI — the two-level control from ADR-015 point 13: one master
 * switch (instantly disables every AI feature for this company, checked fresh
 * on every AIService.generate() call, no caching) plus per-useCase module
 * toggles beneath it, relevant only while the master switch is on.
 */
export function AISection() {
  const qc = useQueryClient();

  const { data: cfg, isLoading } = useQuery<AIConfigResponse>({
    queryKey: ['ai-config'],
    queryFn: () => apiFetch<AIConfigResponse>('/api/ai/config'),
  });

  const { data: wallet } = useQuery<{ balancePoints: number }>({
    queryKey: ['ai-wallet'],
    queryFn: () => apiFetch<{ balancePoints: number }>('/api/ai/wallet'),
  });

  const mutation = useMutation({
    mutationFn: (next: AIConfigResponse) =>
      apiFetch<{ success: boolean }>('/api/ai/config', { method: 'PUT', body: JSON.stringify(next) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-config'] }),
    onError: () => toast.error('Could not save AI settings — try again.'),
  });

  function setMaster(masterEnabled: boolean) {
    mutation.mutate({ masterEnabled, moduleToggles: cfg?.moduleToggles ?? {} });
  }

  function setModule(useCase: string, enabled: boolean) {
    mutation.mutate({
      masterEnabled: cfg?.masterEnabled ?? true,
      moduleToggles: { ...(cfg?.moduleToggles ?? {}), [useCase]: enabled },
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const masterOn = cfg?.masterEnabled ?? true;

  return (
    <div className="space-y-6">
      {/* Master switch — the emergency kill switch */}
      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-500/10">
            <Sparkles className="h-4.5 w-4.5 text-primary-600 dark:text-primary-400" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">AI features</p>
            <p className="text-xs text-neutral-500">Master switch — turns every AI feature off instantly when disabled, regardless of the toggles below.</p>
          </div>
        </div>
        <Toggle checked={masterOn} onChange={(e) => setMaster(e.target.checked)} disabled={mutation.isPending} />
      </div>

      {/* Module toggles — only meaningful while the master switch is on */}
      <div className={cn('rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900', !masterOn && 'opacity-50')}>
        <p className="border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
          Individual features
        </p>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {MODULES.map((m) => {
            const enabled = (cfg?.moduleToggles ?? {})[m.useCase] !== false;
            return (
              <div key={m.useCase} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{m.label}</p>
                  <p className="text-xs text-neutral-500">{m.description}</p>
                </div>
                <Toggle
                  checked={enabled}
                  onChange={(e) => setModule(m.useCase, e.target.checked)}
                  disabled={!masterOn || mutation.isPending}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Wallet balance — placeholder display. Nothing debits this yet (AI usage
          is fully covered by the subscription plan today); this exists ahead of
          WhatsApp Calling, which will be the first feature to actually draw it
          down for its per-minute pass-through cost. */}
      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
            <Wallet className="h-4.5 w-4.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">Wallet balance</p>
            <p className="text-xs text-neutral-500">Not charged for AI yet — will also cover WhatsApp Calling minutes once that launches.</p>
          </div>
        </div>
        <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-white">
          {wallet?.balancePoints ?? 0} <span className="text-xs font-normal text-neutral-400">points</span>
        </p>
      </div>
    </div>
  );
}
