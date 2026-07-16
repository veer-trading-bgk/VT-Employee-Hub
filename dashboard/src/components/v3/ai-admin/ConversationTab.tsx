'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Select } from '@/components/v3/ui/Select';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Button } from '@/components/v3/ui/Button';
import {
  aiAdminKeys, fetchConversationSettings, saveConversationSettings, type ConversationSettings,
} from '@/lib/ai-admin/api';

const PERSONA_OPTIONS = [
  { value: 'professional_rm', label: 'Professional relationship manager (default)' },
  { value: 'friendly_advisor', label: 'Friendly advisor — warmer, more casual' },
  { value: 'concise_expert', label: 'Concise expert — terser, matter-of-fact' },
];
const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional (default)' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Casual' },
];
const STYLE_OPTIONS = [
  { value: 'concise', label: 'Concise — 1 line default (default)' },
  { value: 'balanced', label: 'Balanced — up to 3 lines when helpful' },
  { value: 'detailed', label: 'Detailed — more room, still WhatsApp-appropriate' },
];

export function ConversationTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: aiAdminKeys.conversation(), queryFn: fetchConversationSettings });
  // Local edits are a partial diff on top of server data, not a copy of it —
  // no effect needed to re-hydrate on load (react-hooks/set-state-in-effect).
  const [overrides, setOverrides] = useState<Partial<ConversationSettings>>({});

  const mutation = useMutation({
    mutationFn: saveConversationSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiAdminKeys.conversation() });
      setOverrides({});
      toast.success('Conversation settings saved');
    },
    onError: () => toast.error('Could not save — try again.'),
  });

  if (isError) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-error-600 dark:text-error-400">Failed to load conversation settings</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const form: ConversationSettings = { ...data, ...overrides };
  const dirty = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="mb-4 text-xs text-neutral-500">
          These settings adjust how the AI conversation agent talks — they never override the hard compliance rules
          (see the Compliance tab). Leaving everything at its default matches today&apos;s behavior exactly.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Persona"
            options={PERSONA_OPTIONS}
            value={form.persona}
            onChange={(e) => setOverrides({ ...overrides, persona: e.target.value as ConversationSettings['persona'] })}
            disabled={mutation.isPending}
          />
          <Select
            label="Tone"
            options={TONE_OPTIONS}
            value={form.tone}
            onChange={(e) => setOverrides({ ...overrides, tone: e.target.value as ConversationSettings['tone'] })}
            disabled={mutation.isPending}
          />
          <Select
            label="Conversation style"
            options={STYLE_OPTIONS}
            value={form.conversationStyle}
            onChange={(e) => setOverrides({ ...overrides, conversationStyle: e.target.value as ConversationSettings['conversationStyle'] })}
            disabled={mutation.isPending}
            className="sm:col-span-2"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200" htmlFor="languageRules">Language rules</label>
          <textarea
            id="languageRules"
            rows={2}
            maxLength={300}
            value={form.languageRules}
            onChange={(e) => setOverrides({ ...overrides, languageRules: e.target.value })}
            disabled={mutation.isPending}
            placeholder="e.g. Always reply in Hinglish, never pure Hindi script."
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <p className="text-xs text-neutral-500">{form.languageRules.length}/300</p>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-neutral-700 dark:text-neutral-200" htmlFor="qualificationRules">Additional qualification guidance</label>
          <textarea
            id="qualificationRules"
            rows={3}
            maxLength={500}
            value={form.qualificationRules}
            onChange={(e) => setOverrides({ ...overrides, qualificationRules: e.target.value })}
            disabled={mutation.isPending}
            placeholder="e.g. Do not mark a lead qualified without an explicit budget figure."
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <p className="text-xs text-neutral-500">{form.qualificationRules.length}/500</p>
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
