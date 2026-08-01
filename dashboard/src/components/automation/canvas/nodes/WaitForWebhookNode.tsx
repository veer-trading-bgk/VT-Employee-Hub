'use client';

import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { Webhook, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { WaitForWebhookConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

// Matches AutomationEngine.js TIMEOUT_HANDLE_ID — default onTimeout in
// defaultWaitForWebhookConfig() so the timeout edge's sourceHandle lines up.
const TIMEOUT_HANDLE_ID = '__timeout__';

/**
 * Journey Platform pause (wait_for_webhook). Dual handles like
 * WaitInstagramReplyNode: default (no-id) = webhook arrived; onTimeout handle
 * = processAllDueWaits timeout branch.
 */
export function WaitForWebhookNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as WaitForWebhookConfig;
  const timeoutHandle = cfg?.onTimeout || TIMEOUT_HANDLE_ID;
  const timeoutLabel = cfg?.timeoutMinutes
    ? `${cfg.timeoutMinutes} min`
    : 'No timeout set';

  const edges = useEdges();
  const connectedHandles = new Set(edges.filter((e) => e.source === id).map((e) => e.sourceHandle ?? null));
  const slots: Array<{ key: string | null; label: string }> = [
    { key: null, label: 'Webhook' },
    { key: timeoutHandle, label: 'Timeout' },
  ];

  return (
    <div className={cn(
      'w-56 rounded-xl border bg-warning-50 px-4 py-3 shadow-sm dark:bg-neutral-900',
      selected ? 'border-warning-400 shadow-md dark:border-warning-600' : 'border-warning-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-warning-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-500/20">
          <Webhook className="h-3.5 w-3.5 text-warning-600 dark:text-warning-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Wait for Webhook</p>
          <p className="truncate text-xs font-medium text-warning-700 dark:text-warning-400">{timeoutLabel}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap justify-center gap-1 px-1">
        {slots.map((s) => {
          const isConnected = connectedHandles.has(s.key);
          return (
            <span
              key={s.label}
              title={isConnected ? undefined : 'No outgoing edge — this branch leads nowhere'}
              className={cn(
                'flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium',
                isConnected
                  ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                  : 'bg-warning-100 text-warning-700 ring-1 ring-warning-400 dark:bg-warning-500/20 dark:text-warning-400',
              )}
            >
              {!isConnected && <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden />}
              {s.label}
            </span>
          );
        })}
      </div>

      {slots.map((s, i) => (
        <Handle
          key={s.label}
          type="source"
          position={Position.Bottom}
          {...(s.key !== null && { id: s.key })}
          style={{ left: `${((i + 1) / (slots.length + 1)) * 100}%` }}
          className={cn(s.key !== null ? '!bg-neutral-400' : '!bg-warning-400')}
        />
      ))}
    </div>
  );
}
