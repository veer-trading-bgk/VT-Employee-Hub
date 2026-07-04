'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ACTION_META, isConditionConfig, type ActionType } from '@/types/automations';
import type { NodeConfig, ConditionNodeConfig, StepConfig } from '@/types/automations';
import { ActionEditor } from '../ActionEditor';
import { ConditionEditor } from '../ConditionEditor';
import { ACTION_ICONS } from '../WorkflowBuilder';

interface NodeConfigPanelProps {
  nodeId:   string;
  nodeType: ActionType | 'condition';
  config:   NodeConfig;
  onChange: (config: NodeConfig) => void;
  onClose:  () => void;
}

/**
 * Right-docked config panel — visually borrows Drawer.tsx's header/footer styling
 * but is deliberately NOT a Drawer: no backdrop, no focus trap, no body-scroll-lock.
 * The canvas behind it must stay interactive (pan/zoom/click other nodes) while a
 * node's config is open, which a modal Drawer would block.
 */
export function NodeConfigPanel({ nodeId, nodeType, config, onChange, onClose }: NodeConfigPanelProps) {
  const Icon  = nodeType === 'condition' ? undefined : (ACTION_ICONS[nodeType] ?? undefined);
  const title = nodeType === 'condition' ? 'Condition' : (ACTION_META[nodeType]?.label ?? nodeType);

  return (
    <div
      className={cn(
        'absolute right-3 top-3 bottom-3 z-10 flex w-[380px] flex-col overflow-hidden',
        'rounded-xl border border-neutral-200 bg-white shadow-lg',
        'dark:border-neutral-800 dark:bg-neutral-900',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
              <Icon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{title}</p>
            <p className="truncate text-[11px] text-neutral-400">{nodeId}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {nodeType === 'condition' ? (
          <ConditionEditor
            config={isConditionConfig(config) ? config : { mode: 'field_match', branches: [] }}
            onChange={(c: ConditionNodeConfig) => onChange(c)}
          />
        ) : (
          <ActionEditor
            step={{ id: nodeId, type: nodeType, config: config as StepConfig }}
            onChange={(c) => onChange(c as NodeConfig)}
          />
        )}
      </div>
    </div>
  );
}
