'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Button } from '@/components/v3/ui/Button';
import { aiAdminKeys, fetchGeneralSettings, saveGeneralSettings, type GeneralSettings } from '@/lib/ai-admin/api';

type EditableFields = Omit<GeneralSettings, 'autoAssign'>;

const ROWS: Array<{ key: keyof EditableFields; label: string; description: string }> = [
  { key: 'conversationAgentEnabled', label: 'AI Conversation Agent', description: 'Lets the AI initiate and carry a conversation with new customers on WhatsApp, handing off to a human when appropriate.' },
  { key: 'qualificationEnabled', label: 'AI Qualification', description: 'While the conversation agent runs, extract stated budget/timeline/product interest onto the lead record.' },
  { key: 'leadScoringEnabled', label: 'Lead Scoring', description: 'Recompute this company\'s lead priority score/tier on the regular scoring sweep.' },
  { key: 'summaryEnabled', label: 'AI Summary', description: 'Generate a short handoff summary for the human who picks up an AI conversation.' },
  { key: 'crmAutoTransferEnabled', label: 'CRM Auto Transfer', description: 'Automatically assign and advance the pipeline stage when an AI conversation hands off.' },
];

export function GeneralTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: aiAdminKeys.general(), queryFn: fetchGeneralSettings });
  // Local edits are tracked as a partial diff, never a copy of server state —
  // no effect is needed to "hydrate" this from data once it loads, so there's
  // nothing to cascade-render (react-hooks/set-state-in-effect).
  const [overrides, setOverrides] = useState<Partial<EditableFields>>({});

  const mutation = useMutation({
    mutationFn: saveGeneralSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAdminKeys.general() });
      setOverrides({});
      toast.success('General settings saved');
    },
    onError: () => toast.error('Could not save — try again.'),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const form: EditableFields = {
    conversationAgentEnabled: data.conversationAgentEnabled,
    qualificationEnabled: data.qualificationEnabled,
    summaryEnabled: data.summaryEnabled,
    crmAutoTransferEnabled: data.crmAutoTransferEnabled,
    leadScoringEnabled: data.leadScoringEnabled,
    ...overrides,
  };
  const dirty = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <p className="border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:border-neutral-800">
          Behavior toggles
        </p>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{row.label}</p>
                <p className="max-w-xl text-xs text-neutral-500">{row.description}</p>
              </div>
              <Toggle
                checked={form[row.key]}
                onChange={(e) => setOverrides({ ...overrides, [row.key]: e.target.checked })}
                disabled={mutation.isPending}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">Auto Assignment</p>
          <p className="text-xs text-neutral-500">
            Managed in Admin &gt; Auto Assign, shown here for reference only.
            Currently {data.autoAssign?.enabled ? 'enabled' : 'disabled'}
            {data.autoAssign?.capacity ? ` · capacity ${data.autoAssign.capacity}` : ''}.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate(form)} disabled={!dirty || mutation.isPending}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
