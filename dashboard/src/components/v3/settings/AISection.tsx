'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Button } from '@/components/v3/ui/Button';
import { cn } from '@/lib/cn';

interface AIConfigResponse {
  masterEnabled: boolean;
  moduleToggles: Record<string, boolean>;
}

// Mirrors src/config/aiConfig.js's registry — only the real useCases that
// exist today. A future useCase needs a label added here alongside its config
// entry, the same way NodePalette.tsx's EXTRA_META needs an entry per node type.
const MODULES: Array<{ useCase: string; label: string; description: string }> = [
  // 2026-07-08 (Era 33, 19_DECISION_LOG.md): AI deliberately disconnected —
  // this toggle still saves, but no longer does anything (the useCase entry
  // was removed from aiConfig.js's AI_CONFIG). Kept visible rather than
  // removed; description says so plainly rather than silently going inert.
  { useCase: 'metrics-insights', label: 'My Metrics Insights', description: 'Currently unavailable — AI disconnected from this feature.' },
  { useCase: 'team-metrics-insights', label: 'Team Metrics Insights', description: 'Currently unavailable — AI disconnected from this feature.' },
  { useCase: 'inbox-intent-detection', label: 'Inbox Intent Detection', description: 'Classifies each new WhatsApp conversation’s likely intent (interested, complaint, KYC query, etc.)' },
  { useCase: 'template-creation', label: 'AI-Assisted Template Creation', description: 'Drafts a Meta-compliant WhatsApp template from a plain-language description, for an admin to review before submitting' },
  { useCase: 'inbox-template-suggestion', label: 'AI Auto-Reply in Chat', description: 'When an agent clicks "Send AI reply," the AI picks an approved template and sends it to the customer immediately — there is no review step before it reaches them. Enabling this means unreviewed AI-generated messages will go out under this company’s WhatsApp identity.' },
  { useCase: 'conversational-sales-agent', label: 'AI Conversation Agent', description: 'Lets APForce’s AI respond to new customer enquiries on WhatsApp on your company’s behalf, following the same compliance rules as your team (no guaranteed-return claims, no buy/sell/hold advice). The conversation is automatically handed off to a member of your team when appropriate. This must also be turned on in AI Administration → General to take effect — both settings need to be enabled.' },
  { useCase: 'conversation-handoff-summary', label: 'AI Conversation Handoff Summary', description: 'Internal only — generates the 3-5 sentence summary an admin sees when an AI conversation (above) hands off to them. Never sent to the customer.' },
  { useCase: 'conversation-tag-summary', label: 'AI Conversation Tagging & Summary', description: 'Applies tags marked "AI may assign" in Tag Manager and saves a short internal summary as a note on the contact, clearly marked as AI-generated. Internal only — never sent to the customer. Distinct from the handoff summary above.' },
];

/**
 * Settings > AI — the two-level control from ADR-015 point 13: one master
 * switch (instantly disables every AI feature for this company, checked fresh
 * on every AIService.generate() call, no caching) plus per-useCase module
 * toggles beneath it, relevant only while the master switch is on.
 */
export function AISection() {
  const qc = useQueryClient();

  const { data: cfg, isLoading, isError, refetch } = useQuery<AIConfigResponse>({
    queryKey: ['ai-config'],
    queryFn: () => apiFetch<AIConfigResponse>('/api/ai/config'),
  });

  const { data: wallet, isError: isWalletError, refetch: refetchWallet } = useQuery<{ balancePoints: number }>({
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

  // Never render "AI features: ON" when the real state is unknown (B3 audit
  // finding #6) — a company that deliberately turned AI off should never see
  // it displayed as on just because this fetch happened to fail.
  if (isError) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="py-4 text-center">
          <p className="text-sm text-error-600 dark:text-error-400">Failed to load AI settings</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  // Fail-safe default: unknown must not render as enabled. This only
  // matters for the residual case where the query succeeds but `cfg` itself
  // is unexpectedly empty — a genuine failure is caught by isError above and
  // never reaches this line.
  const masterOn = cfg?.masterEnabled ?? false;

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
        {isWalletError ? (
          <div className="text-right">
            <p className="text-sm text-error-600 dark:text-error-400">Failed to load</p>
            <Button size="sm" variant="secondary" className="mt-1" onClick={() => refetchWallet()}>Retry</Button>
          </div>
        ) : (
          <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-white">
            {wallet?.balancePoints ?? 0} <span className="text-xs font-normal text-neutral-400">points</span>
          </p>
        )}
      </div>
    </div>
  );
}
