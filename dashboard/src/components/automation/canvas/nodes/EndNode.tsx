'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CanvasNode } from '@/lib/automationGraph';

export function EndNode({ selected }: NodeProps<CanvasNode>) {
  return (
    <div className={cn(
      'w-40 rounded-xl border bg-neutral-50 px-3 py-2.5 shadow-sm dark:bg-neutral-900',
      selected ? 'border-neutral-400 shadow-md' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2">
        <Square className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
        <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">End</p>
      </div>
    </div>
  );
}
