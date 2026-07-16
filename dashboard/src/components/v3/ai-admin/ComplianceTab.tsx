'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Button } from '@/components/v3/ui/Button';
import { aiAdminKeys, fetchComplianceInfo } from '@/lib/ai-admin/api';

/**
 * Read-only by design for Phase 2A / PR 1 — see docs/bible/19_DECISION_LOG.md.
 * Editing guardrail/escalation/safe-response config arrives in PR 2, gated
 * behind a compliance-test-before-publish check that doesn't exist yet.
 */
export function ComplianceTab() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: aiAdminKeys.compliance(), queryFn: fetchComplianceInfo });

  if (isError) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-error-600 dark:text-error-400">Failed to load compliance info</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-900/40 dark:bg-primary-900/10">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
        <p className="text-sm text-primary-900 dark:text-primary-200">{data.note}</p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <p className="border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
          Compliance rules the AI always enforces
        </p>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.guardrailCategories.map((c) => (
            <li key={c} className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200">{c}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <p className="border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
          When the AI hands off to a human
        </p>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.escalationCategories.map((c) => (
            <li key={c} className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200">{c}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold text-neutral-900 dark:text-white">Safe response template</p>
        <p className="mt-1 text-xs text-neutral-500">Sent automatically when a guardrail trips or the customer asks for a human.</p>
        <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          {data.safeResponseTemplate}
        </p>
      </div>
    </div>
  );
}
