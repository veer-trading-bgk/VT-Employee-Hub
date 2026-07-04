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
      // dark:bg-neutral-900/dark:border-neutral-800 (not warning-800/900 — this design
      // system's warning scale only defines 50/100/500/600/700, see globals.css; a
      // dark:bg-warning-900 class silently fails to generate any CSS, which is exactly
      // how this node's title text went invisible — white text over a background stuck
      // on its light-mode warning-50 fill because the dark override never applied).
      'w-48 rounded-xl border bg-warning-50 px-4 py-3 shadow-sm dark:bg-neutral-900',
      selected ? 'border-warning-400 shadow-md dark:border-warning-600' : 'border-warning-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-warning-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-500/20">
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
