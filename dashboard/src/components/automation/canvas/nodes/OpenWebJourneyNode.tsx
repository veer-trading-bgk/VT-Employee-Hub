'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Link2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { OpenWebJourneyConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

export function OpenWebJourneyNode({ data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as OpenWebJourneyConfig;
  const summary = cfg?.journeyDefId
    ? (cfg.templateId ? `${cfg.journeyDefId} · ${cfg.templateId}` : cfg.journeyDefId)
    : 'No journey definition';

  return (
    <div className={cn(
      'w-64 rounded-xl border bg-white px-4 py-3 shadow-sm transition-shadow dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md dark:border-primary-600' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Link2 className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Open Web Journey</p>
          <p className="truncate text-xs text-neutral-500">{summary}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}
