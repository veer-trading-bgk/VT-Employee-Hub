'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Ban } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CancelJourneyConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

export function CancelJourneyNode({ data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as CancelJourneyConfig;
  const summary = cfg?.reasonSource ? `Reason: ${cfg.reasonSource}` : 'Mark cancelled';

  return (
    <div className={cn(
      'w-64 rounded-xl border bg-white px-4 py-3 shadow-sm transition-shadow dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md dark:border-primary-600' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-error-100 dark:bg-error-500/20">
          <Ban className="h-3.5 w-3.5 text-error-600 dark:text-error-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Cancel Journey</p>
          <p className="truncate text-xs text-neutral-500">{summary}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}
