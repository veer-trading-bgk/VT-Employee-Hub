'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CompleteJourneyConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

export function CompleteJourneyNode({ data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as CompleteJourneyConfig;
  const summary = cfg?.confirmationTemplateId
    ? `Confirm: ${cfg.confirmationTemplateId}`
    : 'Mark completed';

  return (
    <div className={cn(
      'w-64 rounded-xl border bg-white px-4 py-3 shadow-sm transition-shadow dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md dark:border-primary-600' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success-100 dark:bg-success-500/20">
          <CheckCircle2 className="h-3.5 w-3.5 text-success-600 dark:text-success-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Complete Journey</p>
          <p className="truncate text-xs text-neutral-500">{summary}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}
