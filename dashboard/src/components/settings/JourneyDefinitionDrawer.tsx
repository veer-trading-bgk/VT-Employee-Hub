'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { Input } from '@/components/v3/ui/Input';
import { Select } from '@/components/v3/ui/Select';
import { Toggle } from '@/components/v3/ui/Toggle';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import {
  createJourneyDefinition,
  journeyKeys,
  updateJourneyDefinition,
} from '@/lib/journeys/api';
import type { JourneyDefinition, JourneyDefinitionFormValues } from '@/lib/journeys/types';
import type { AutomationsResponse } from '@/types/automations';

const INDUSTRY_SUGGESTIONS = ['generic', 'healthcare', 'bfsi'] as const;

function emptyForm(): JourneyDefinitionFormValues {
  return {
    name: '',
    industryPack: 'generic',
    linkedWorkflowId: null,
    active: true,
  };
}

function formFromDefinition(d: JourneyDefinition): JourneyDefinitionFormValues {
  return {
    name: d.name,
    industryPack: d.industryPack || 'generic',
    linkedWorkflowId: d.linkedWorkflowId ?? null,
    active: d.active !== false,
  };
}

export function JourneyDefinitionDrawer({
  open,
  onClose,
  definition,
}: {
  open: boolean;
  onClose: () => void;
  /** null = create; object = edit */
  definition: JourneyDefinition | null;
}) {
  const qc = useQueryClient();
  const isEdit = definition !== null;
  const [form, setForm] = useState<JourneyDefinitionFormValues>(emptyForm());

  useEffect(() => {
    if (!open) return;
    setForm(definition ? formFromDefinition(definition) : emptyForm());
  }, [open, definition]);

  // Reuse WorkflowList's existing list ownership — same queryKey + endpoint.
  const { data: automationsData } = useQuery<AutomationsResponse>({
    queryKey: ['automations'],
    queryFn: () => apiFetch('/api/automations'),
    staleTime: 60_000,
    enabled: open,
  });

  const workflowOptions = useMemo(() => {
    const options = [
      { value: '', label: 'None' },
      ...(automationsData?.automations ?? [])
        .filter((w) => w.status === 'active')
        .map((w) => ({ value: w.id, label: w.name || w.id })),
    ];
    // If the linked workflow is inactive / missing from the active filter, still
    // show it so an edit doesn't silently clear the binding.
    if (
      form.linkedWorkflowId
      && !options.some((o) => o.value === form.linkedWorkflowId)
    ) {
      const orphan = automationsData?.automations?.find((w) => w.id === form.linkedWorkflowId);
      options.push({
        value: form.linkedWorkflowId,
        label: orphan
          ? `${orphan.name} (${orphan.status})`
          : `${form.linkedWorkflowId} (unavailable)`,
      });
    }
    return options;
  }, [automationsData, form.linkedWorkflowId]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isEdit && definition) {
        return updateJourneyDefinition(definition.id, form);
      }
      return createJourneyDefinition(form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journeyKeys.list() });
      toast.success(isEdit ? 'Journey definition updated' : 'Journey definition created');
      onClose();
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Failed to save journey definition')),
  });

  const canSubmit = form.name.trim().length > 0 && !saveMut.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    saveMut.mutate();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit journey definition' : 'New journey definition'}
      description={
        isEdit
          ? 'Screens and branding are configured in a later step — only basics here.'
          : 'Creates a valid definition with no screens yet. The form builder comes next.'
      }
      width={440}
      footer={(
        <DrawerFooter>
          <Button variant="secondary" size="md" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="journey-def-form"
            loading={saveMut.isPending}
            disabled={!canSubmit}
          >
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </DrawerFooter>
      )}
    >
      <form id="journey-def-form" className="space-y-4" onSubmit={handleSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Clinic intake"
          maxLength={200}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="journey-industry-pack"
            className="text-sm font-medium text-neutral-700 dark:text-neutral-200"
          >
            Industry pack
          </label>
          <input
            id="journey-industry-pack"
            list="journey-industry-suggestions"
            value={form.industryPack}
            onChange={(e) => setForm((f) => ({ ...f, industryPack: e.target.value }))}
            placeholder="generic"
            maxLength={60}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <datalist id="journey-industry-suggestions">
            {INDUSTRY_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p className="text-xs text-neutral-400">Suggestions: generic, healthcare, bfsi — or type your own.</p>
        </div>

        <Select
          label="Linked workflow"
          hint="Active automations only. Used when a journey instance should resume a workflow."
          options={workflowOptions}
          value={form.linkedWorkflowId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setForm((f) => ({ ...f, linkedWorkflowId: v === '' ? null : v }));
          }}
        />

        {isEdit && (
          <Toggle
            label="Active"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
        )}
      </form>
    </Drawer>
  );
}
