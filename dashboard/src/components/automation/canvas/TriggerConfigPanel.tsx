'use client';

import { X, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { TriggerEditor } from '../WorkflowBuilder';
import type { WorkflowTrigger } from '@/types/automations';

interface TriggerConfigPanelProps {
  trigger:     WorkflowTrigger;
  onChange:    (t: WorkflowTrigger) => void;
  onClose:     () => void;
  workflowId?: string;
}

/**
 * Right-docked panel for editing a graph workflow's trigger — visually mirrors
 * NodeConfigPanel's chrome, but isn't NodeConfigPanel itself: the trigger lives
 * on workflow.trigger, not nodes[], so it has no NodeType/NodeConfig shape to
 * pass through that component's node-specific props. Reuses TriggerEditor
 * unmodified — the same dropdown + config UI the linear builder uses, so
 * there's exactly one place that knows how to edit a trigger, not two.
 */
export function TriggerConfigPanel({ trigger, onChange, onClose, workflowId }: TriggerConfigPanelProps) {
  return (
    <div
      className={cn(
        // top-16 (not top-3) so this panel never overlaps the canvas's own
        // top-right Save/Auto-arrange Panel — see WorkflowCanvas.tsx.
        'absolute right-3 top-16 bottom-3 z-10 flex w-[380px] flex-col overflow-hidden',
        'rounded-xl border border-neutral-200 bg-white shadow-lg',
        'dark:border-neutral-800 dark:bg-neutral-900',
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
            <Zap className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden />
          </div>
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Trigger</p>
        </div>
        <button
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 sm:h-8 sm:w-8 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <TriggerEditor trigger={trigger} onChange={onChange} workflowId={workflowId} />
      </div>
    </div>
  );
}
