'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Select } from '@/components/v3/ui/Select';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Button } from '@/components/v3/ui/Button';
import { aiAdminKeys, fetchFutureSettings, saveFutureSettings, type FutureSettings } from '@/lib/ai-admin/api';

type CustomModelSettings = FutureSettings['customModelSettings'];

// These are OVERRIDE choices, not a mirror of what's live. As of Era 46 the
// platform default is Amazon Nova Lite (see the Select placeholder) — the two
// Claude models remain valid override targets because their code path is kept
// dormant-not-deleted (19_DECISION_LOG.md Era 46), so a company could still be
// pinned back to one. Nova is intentionally NOT a selectable option here: the
// backend save enum (src/utils/validation.js aiAdminFutureSchema) allowlists
// only these two + null, and null already means "use the platform default"
// (= Nova). Adding Nova as a value would 400 on save until that enum widens.
const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
];
const MAX_TEMPERATURE = 0.5;

/**
 * Temperature/model are stored and capped, but NOT wired into any live AI
 * call in this PR — see docs/bible/19_DECISION_LOG.md's Phase 2A entry.
 *
 * RAG/knowledge retrieval is deliberately NOT shown on this tab anymore
 * (B4 audit Finding 6): it shipped live the day after this tab did (Era
 * 27-31, 2026-07-07) and runs automatically on every conversation turn
 * (ConversationalAgentService._fetchKnowledgeContext()) with no admin
 * toggle at all — there's nothing "future" left to preview, and the
 * removed locked rows' copy ("no RAG infrastructure exists yet") had been
 * flatly false since the day after this tab shipped.
 */
export function FutureAiSettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: aiAdminKeys.future(), queryFn: fetchFutureSettings });
  // Partial diff on top of server data, not a copy — no effect needed to
  // re-hydrate on load (react-hooks/set-state-in-effect).
  const [overrides, setOverrides] = useState<Partial<CustomModelSettings>>({});

  const mutation = useMutation({
    mutationFn: (customModelSettings: CustomModelSettings) => saveFutureSettings({ customModelSettings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAdminKeys.future() });
      setOverrides({});
      toast.success('Future AI settings saved');
    },
    onError: () => toast.error('Could not save — try again.'),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  const custom: CustomModelSettings = { ...data.customModelSettings, ...overrides };
  const dirty = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <p className="text-sm text-amber-900 dark:text-amber-200">
          Saved for a future release — does not yet affect live conversations. Temperature is capped at {MAX_TEMPERATURE};
          higher values increase reply unpredictability, which the compliance guardrail system specifically defends against.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">Custom model settings</p>
            <p className="text-xs text-neutral-500">Off by default — uses the platform-managed model/temperature until this is wired in.</p>
          </div>
          <Toggle
            checked={custom.enabled}
            onChange={(e) => setOverrides({ ...overrides, enabled: e.target.checked })}
            disabled={mutation.isPending}
          />
        </div>

        <div className={custom.enabled ? 'mt-4 grid gap-4 sm:grid-cols-2' : 'mt-4 grid gap-4 opacity-50 sm:grid-cols-2'}>
          <Select
            label="Model"
            placeholder="Use platform default (Amazon Nova Lite)"
            options={MODEL_OPTIONS}
            value={custom.model ?? ''}
            onChange={(e) => setOverrides({ ...overrides, model: (e.target.value || null) as CustomModelSettings['model'] })}
            disabled={!custom.enabled || mutation.isPending}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200" htmlFor="temperature">
              Temperature (max {MAX_TEMPERATURE})
            </label>
            <input
              id="temperature"
              type="number"
              min={0}
              max={MAX_TEMPERATURE}
              step={0.05}
              value={custom.temperature ?? ''}
              onChange={(e) => setOverrides({
                ...overrides,
                temperature: e.target.value === '' ? null : Math.min(Number(e.target.value), MAX_TEMPERATURE),
              })}
              disabled={!custom.enabled || mutation.isPending}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate(custom)} disabled={!dirty || mutation.isPending}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
