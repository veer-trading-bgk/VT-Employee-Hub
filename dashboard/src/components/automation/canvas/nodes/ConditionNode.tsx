'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ConditionNodeConfig } from '@/types/automations';
import { getConditionQuestion, getConditionBranches, type CanvasNode } from '@/lib/automationGraph';

export function ConditionNode({ data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as ConditionNodeConfig;
  const question = getConditionQuestion(cfg);
  const branches = getConditionBranches(cfg);

  return (
    <div className={cn(
      'w-64 rounded-xl border-l-4 border-t border-r border-b bg-white px-4 py-3 shadow-sm dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md' : 'border-neutral-200 border-l-primary-400 dark:border-neutral-800 dark:border-l-primary-500',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
          <GitBranch className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{question}</p>
          <p className="text-xs text-neutral-500">
            {branches.length} branch{branches.length !== 1 ? 'es' : ''}
          </p>
        </div>
      </div>

      {/* Branch labels — glanceable on the node face; the edges themselves also carry labels */}
      <div className="mt-2.5 flex justify-between gap-1 px-1">
        {branches.map((b) => (
          <span
            key={b.key}
            className="truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
          >
            {b.label}
          </span>
        ))}
      </div>

      {branches.map((b, i) => (
        <Handle
          key={b.key}
          type="source"
          position={Position.Bottom}
          id={b.key}
          style={{ left: `${((i + 1) / (branches.length + 1)) * 100}%` }}
          className="!bg-primary-400"
        />
      ))}
    </div>
  );
}
