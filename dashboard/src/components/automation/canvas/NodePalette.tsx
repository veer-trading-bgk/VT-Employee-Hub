'use client';

import { Zap, GitBranch } from 'lucide-react';
import { ACTION_META, type NodeType } from '@/types/automations';
import { ACTION_ICONS } from '../WorkflowBuilder';

const PALETTE_TYPES: NodeType[] = [
  'send_template', 'assign_employee', 'change_stage', 'add_tag', 'create_task', 'wait', 'condition', 'end',
];

const CONDITION_META = { label: 'Condition' };

interface NodePaletteProps {
  onAdd: (type: NodeType) => void;
}

/**
 * Adds an unconnected node near the bottom of the current graph — the user then
 * drags a connection from an existing node's handle to it (React Flow's native
 * connect interaction, wired via WorkflowCanvas's onConnect). Deliberately not a
 * drag-from-palette interaction: click-to-add matches the existing linear
 * builder's (WorkflowBuilder.tsx) "+ " picker, so the two builders feel related.
 */
export function NodePalette({ onAdd }: NodePaletteProps) {
  return (
    <div className="w-48 rounded-xl border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <p className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Add node</p>
      <div className="space-y-0.5">
        {PALETTE_TYPES.map((type) => {
          const Icon = type === 'condition' ? GitBranch : (ACTION_ICONS[type] ?? Zap);
          const label = type === 'condition' ? CONDITION_META.label : (ACTION_META[type]?.label ?? type);
          return (
            <button
              key={type}
              onClick={() => onAdd(type)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
