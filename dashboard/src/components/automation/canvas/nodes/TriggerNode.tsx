'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CanvasNode } from '@/lib/automationGraph';

export function TriggerNode({ data, selected }: NodeProps<CanvasNode>) {
  return (
    <div className={cn(
      'w-56 rounded-xl border-2 bg-primary-50 px-4 py-3 shadow-sm dark:bg-primary-900/20',
      selected ? 'border-primary-500' : 'border-primary-300 dark:border-primary-700',
    )}>
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/40">
          <Zap className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">Trigger</p>
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{data.label ?? 'Trigger'}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary-400" />
    </div>
  );
}
