'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ACTION_META, type ActionType } from '@/types/automations';
import { ACTION_ICONS } from '../../WorkflowBuilder';
import { summarizeNodeConfig, type CanvasNode } from '@/lib/automationGraph';

export function ActionNode({ data, selected }: NodeProps<CanvasNode>) {
  const nodeType = data.nodeType as ActionType;
  const meta = ACTION_META[nodeType];
  const Icon = ACTION_ICONS[nodeType] ?? Zap;
  const summary = summarizeNodeConfig(nodeType, data.config);

  return (
    <div className={cn(
      'w-60 rounded-xl border bg-white px-4 py-3 shadow-sm transition-shadow dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md dark:border-primary-600' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Icon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{meta?.label ?? nodeType}</p>
          <p className="truncate text-xs text-neutral-500">{summary}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}
