'use client';

import { useState } from 'react';
import { X, Zap, Loader2, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/v3/ui/Button';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { WorkflowBuilder } from './WorkflowBuilder';
import type {
  Workflow, WorkflowTrigger, WorkflowStep, WorkflowStatus,
} from '@/types/automations';

const END_STEP: WorkflowStep = { id: 'end-default', type: 'end', config: {} };
const EMPTY_TRIGGER: WorkflowTrigger = { type: 'lead_created', conditions: [] };

interface FormState {
  name:        string;
  description: string;
  trigger:     WorkflowTrigger;
  steps:       WorkflowStep[];
  saved:       boolean;
}

function initForm(workflow: Workflow | null | undefined): FormState {
  if (!workflow) return { name: '', description: '', trigger: EMPTY_TRIGGER, steps: [END_STEP], saved: false };
  const t = typeof workflow.trigger === 'object'
    ? workflow.trigger
    : { type: workflow.trigger as WorkflowTrigger['type'], conditions: [] };
  return {
    name:        workflow.name,
    description: workflow.description ?? '',
    trigger:     t,
    steps:       workflow.steps?.length ? workflow.steps : [END_STEP],
    saved:       false,
  };
}

interface WorkflowCreateDrawerProps {
  open:       boolean;
  onClose:    () => void;
  workflow?:  Workflow | null;
}

// Parent must pass key={workflow?.id ?? 'new'} so React remounts when workflow changes.
export function WorkflowCreateDrawer({ open, onClose, workflow }: WorkflowCreateDrawerProps) {
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(() => initForm(workflow));

  const { name, description, trigger, steps, saved } = form;

  const isEdit = !!workflow;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['automations']      });
    qc.invalidateQueries({ queryKey: ['automation-stats'] });
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: (status: WorkflowStatus) => {
      const body = { name: name.trim(), description: description.trim() || null, trigger, steps, status };
      if (isEdit) return apiFetch(`/api/automations/${workflow!.id}`, { method: 'PUT', body: JSON.stringify(body) });
      return apiFetch('/api/automations', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: (_, status) => {
      invalidate();
      setForm((f) => ({ ...f, saved: true }));
      toast.success(isEdit ? 'Workflow updated' : status === 'active' ? 'Workflow activated' : 'Workflow saved as draft');
      setTimeout(onClose, 600);
    },
    onError: (err: Error) => toast.error(err.message ?? 'Save failed'),
  });

  const canSave = name.trim().length > 0 && trigger.type && steps.length > 0;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[600px] flex-col bg-white shadow-2xl dark:bg-neutral-950"
        role="dialog"
        aria-modal
        aria-label={isEdit ? 'Edit workflow' : 'Create workflow'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
              <Zap className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
                {isEdit ? 'Edit Workflow' : 'New Workflow'}
              </h2>
              <p className="text-xs text-neutral-500">
                {isEdit ? `Editing: ${workflow!.name}` : 'Build a trigger → action automation'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Name + description */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Workflow Name <span className="text-error-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Welcome new leads"
                className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Description <span className="text-neutral-400">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What does this workflow do?"
                className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-neutral-200 dark:border-neutral-800" />

          {/* Builder label */}
          <div>
            <p className="mb-4 text-sm font-semibold text-neutral-900 dark:text-white">Workflow Steps</p>
            <WorkflowBuilder
              trigger={trigger}
              steps={steps}
              onTriggerChange={(t) => set('trigger', t)}
              onStepsChange={(s) => set('steps', s)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className={cn(
          'flex items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4 dark:border-neutral-800',
          saved && 'bg-success-50 dark:bg-success-900/10',
        )}>
          {saved ? (
            <div className="flex items-center gap-2 text-sm font-medium text-success-700 dark:text-success-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved
            </div>
          ) : (
            <p className="text-xs text-neutral-400">
              {steps.filter((s) => s.type !== 'end').length} action{steps.filter((s) => s.type !== 'end').length !== 1 ? 's' : ''} configured
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => saveMutation.mutate('draft')}
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Draft'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => saveMutation.mutate('active')}
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isEdit ? 'Update & Activate' : 'Activate'}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
