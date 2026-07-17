'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { SendFlowConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

interface FlowRecord {
  flowId: string;
  name:   string;
}

export function SendFlowNode({ data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as SendFlowConfig;

  // Shared ['whatsapp-flows'] cache — same key WhatsAppFlowsPanel.tsx,
  // ComposerToolbar.tsx's picker, and SendFlowEditor.tsx's FlowPicker all use,
  // so this is a cache hit (not a new fetch) whenever any of those has
  // already loaded on this page.
  const { data: flowData } = useQuery({
    queryKey: ['whatsapp-flows'],
    queryFn: () => apiFetch<{ flows: FlowRecord[] }>('/api/whatsapp/flows'),
    staleTime: 60_000,
  });
  const flow = flowData?.flows.find((f) => f.flowId === cfg?.flowId);

  return (
    <div className={cn(
      'w-64 rounded-xl border bg-white px-4 py-3 shadow-sm transition-shadow dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md dark:border-primary-600' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Workflow className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Send Flow</p>
          <p className="truncate text-xs text-neutral-500">{flow?.name ?? (cfg?.flowId ? 'Unknown Flow' : 'No Flow selected')}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}
