'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { WaitConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

export function WaitNode({ data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as WaitConfig;

  return (
    <div className={cn(
      'w-48 rounded-xl border bg-warning-50 px-4 py-3 shadow-sm dark:bg-warning-900/10',
      selected ? 'border-warning-400 shadow-md' : 'border-warning-200 dark:border-warning-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-warning-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-900/30">
          <Timer className="h-3.5 w-3.5 text-warning-600 dark:text-warning-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">Wait</p>
          <p className="truncate text-xs font-medium text-warning-700 dark:text-warning-400">
            {cfg?.amount ?? 5} {cfg?.unit ?? 'minutes'}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-warning-400" />
    </div>
  );
}
