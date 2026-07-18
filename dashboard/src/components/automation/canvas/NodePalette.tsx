'use client';

import { Zap, GitBranch, MousePointerClick, FileText, MessageSquare, ListChecks, MapPin, Workflow, Radio } from 'lucide-react';
import { ACTION_META, type ActionType, type NodeType } from '@/types/automations';
import { ACTION_ICONS } from '../WorkflowBuilder';

const PALETTE_GROUPS: Array<{ label: string; types: NodeType[] }> = [
  { label: 'Messaging', types: ['send_template', 'send_message', 'send_buttons', 'send_list', 'send_document', 'send_location', 'send_flow'] },
  { label: 'CRM Actions', types: ['assign_employee', 'change_stage', 'add_tag', 'create_task', 'meta_signal'] },
  { label: 'AI', types: ['start_ai_conversation'] },
  { label: 'Logic', types: ['wait', 'condition', 'end'] },
];

// Node types outside ActionType (graph-only — see NodeType's own comment) need
// their own label/icon here, same as 'condition' already does.
const EXTRA_META: Partial<Record<NodeType, { label: string; icon: typeof GitBranch }>> = {
  condition:     { label: 'Condition',     icon: GitBranch },
  send_buttons:  { label: 'Send Buttons',  icon: MousePointerClick },
  send_document: { label: 'Send Document', icon: FileText },
  send_message:  { label: 'Plain Message', icon: MessageSquare },
  send_list:     { label: 'Message + List', icon: ListChecks },
  send_location: { label: 'Send Location', icon: MapPin },
  send_flow:     { label: 'Send Flow',     icon: Workflow },
  meta_signal:   { label: 'Meta Signal',   icon: Radio },
};

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
      <div className="space-y-2.5">
        {PALETTE_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400/70 dark:text-neutral-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.types.map((type) => {
                const extra = EXTRA_META[type];
                const Icon = extra?.icon ?? ACTION_ICONS[type as ActionType] ?? Zap;
                const label = extra?.label ?? ACTION_META[type as ActionType]?.label ?? type;
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
        ))}
      </div>
    </div>
  );
}
