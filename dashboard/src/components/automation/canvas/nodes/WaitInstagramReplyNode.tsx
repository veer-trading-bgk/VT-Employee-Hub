'use client';

import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { Timer, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { WaitInstagramReplyConfig } from '@/types/automations';
import type { CanvasNode } from '@/lib/automationGraph';

// Reserved sourceHandle id for "no reply arrived in time" — matches
// AutomationEngine.js's TIMEOUT_HANDLE_ID constant exactly (same convention
// SendButtonsNode.tsx/SendListNode.tsx already use).
const TIMEOUT_HANDLE_ID = '__timeout__';

/**
 * The Follow Gate's pause point (ADR-021 R5) — visually a Wait node (warning
 * colors, Timer icon) but branches like send_buttons/send_list: a default
 * (no-id) edge for "replied", an optional TIMEOUT_HANDLE_ID edge for "no
 * reply in time". Unlike the plain Wait node (single edge, never branches),
 * this one always shows both handles — there's no config-driven "off" state
 * the way send_buttons' cta_buttons mode has, since a Follow Gate always
 * waits on a reply by definition. Both slots get the unconnected-handle
 * warning (unlike SendButtonsNode, whose default handle predates its
 * per-button feature and stays unconditionally rendered for backward
 * compatibility) — this node type is brand new, so there's no old-workflow
 * shape to stay compatible with, and forgetting to wire the reply path is at
 * least as real an authoring mistake as forgetting the timeout path.
 */
export function WaitInstagramReplyNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as WaitInstagramReplyConfig;
  const timeoutLabel = cfg?.timeoutAmount ? `${cfg.timeoutAmount} ${cfg.timeoutUnit ?? 'hours'}` : 'No timeout set';

  const edges = useEdges();
  // xyflow reports a no-id handle's edges as sourceHandle: null (its
  // Connection type), never undefined — matched exactly here.
  const connectedHandles = new Set(edges.filter((e) => e.source === id).map((e) => e.sourceHandle));
  const slots: Array<{ key: string | null; label: string }> = [
    { key: null, label: 'Replied' },
    { key: TIMEOUT_HANDLE_ID, label: 'No reply' },
  ];

  return (
    <div className={cn(
      'w-56 rounded-xl border bg-warning-50 px-4 py-3 shadow-sm dark:bg-neutral-900',
      selected ? 'border-warning-400 shadow-md dark:border-warning-600' : 'border-warning-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-warning-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-500/20">
          <Timer className="h-3.5 w-3.5 text-warning-600 dark:text-warning-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Wait for Instagram Reply</p>
          <p className="truncate text-xs font-medium text-warning-700 dark:text-warning-400">{timeoutLabel}</p>
        </div>
      </div>

      {/* Both branches are opt-in edges, same unconnected-handle warning as
          SendButtonsNode — wiring only "Replied" (leaving "No reply" dangling)
          is valid and common: the flow just ends on timeout. */}
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
          className={cn(s.key === TIMEOUT_HANDLE_ID ? '!bg-neutral-400' : '!bg-warning-400')}
        />
      ))}
    </div>
  );
}
