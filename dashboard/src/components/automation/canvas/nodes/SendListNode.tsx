'use client';

import { Handle, Position, useEdges, type NodeProps } from '@xyflow/react';
import { ListChecks, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { SendListConfig } from '@/types/automations';
import { getReplyOptions, type CanvasNode } from '@/lib/automationGraph';

// Reserved sourceHandle id for "no reply arrived in time" — matches
// AutomationEngine.js's TIMEOUT_HANDLE_ID constant exactly.
const TIMEOUT_HANDLE_ID = '__timeout__';

export function SendListNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const cfg = data.config as SendListConfig;
  const rowCount = cfg?.rows?.length ?? 0;
  const summary = cfg?.bodyText || 'No message text yet';

  // Unlike SendButtonsConfig, every list row is reply-capable — no mode gate needed.
  const options = getReplyOptions('send_list', cfg);
  const hasReplyHandles = options.length > 0;
  const replySlots = hasReplyHandles ? [...options, { key: TIMEOUT_HANDLE_ID, label: 'No reply' }] : [];

  const edges = useEdges();
  const connectedHandles = new Set(edges.filter((e) => e.source === id).map((e) => e.sourceHandle));

  return (
    <div className={cn(
      'w-64 rounded-xl border bg-white px-4 py-3 shadow-sm transition-shadow dark:bg-neutral-900',
      selected ? 'border-primary-400 shadow-md dark:border-primary-600' : 'border-neutral-200 dark:border-neutral-800',
    )}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <ListChecks className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">Message + List</p>
          <p className="truncate text-xs text-neutral-500">{summary}</p>
        </div>
      </div>
      <p className="mt-1.5 pl-9 text-[11px] text-neutral-400">{rowCount} option{rowCount === 1 ? '' : 's'}</p>

      {/* Per-row + timeout handles — opt-in branching, same unconnected-handle
          warning ConditionNode uses. A node with no edge on any of these behaves
          exactly as it always has: one default edge, no pause. */}
      {hasReplyHandles && (
        <div className="mt-2.5 flex flex-wrap justify-center gap-1 px-1">
          {replySlots.map((opt) => {
            const isConnected = connectedHandles.has(opt.key);
            return (
              <span
                key={opt.key}
                title={isConnected ? undefined : 'No outgoing edge — this reply/timeout leads nowhere'}
                className={cn(
                  'flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium',
                  isConnected
                    ? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                    : 'bg-warning-100 text-warning-700 ring-1 ring-warning-400 dark:bg-warning-500/20 dark:text-warning-400',
                )}
              >
                {!isConnected && <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                {opt.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Default handle — no id, unchanged from before this feature shipped, so every
          edge saved by a workflow that predates per-row handles keeps rendering
          exactly where it always has. Only nudged aside (not removed) once reply
          handles are also present, to make room for them. */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-neutral-400"
        style={hasReplyHandles ? { left: '6%' } : undefined}
      />
      {replySlots.map((opt, i) => (
        <Handle
          key={opt.key}
          type="source"
          position={Position.Bottom}
          id={opt.key}
          style={{ left: `${((i + 1) / (replySlots.length + 1)) * 100}%` }}
          className={cn(opt.key === TIMEOUT_HANDLE_ID ? '!bg-neutral-400' : '!bg-primary-400')}
        />
      ))}
    </div>
  );
}
