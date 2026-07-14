'use client';

import { X, Trash2, GitBranch, MousePointerClick, FileText, MessageSquare, ListChecks, MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ACTION_META, isConditionConfig, type ActionType, type NodeType } from '@/types/automations';
import type { NodeConfig, ConditionNodeConfig, SendButtonsConfig, SendDocumentConfig, SendMessageConfig, SendListConfig, SendLocationConfig, StepConfig } from '@/types/automations';
import { ActionEditor } from '../ActionEditor';
import { ConditionEditor } from '../ConditionEditor';
import { SendButtonsEditor } from '../SendButtonsEditor';
import { SendDocumentEditor } from '../SendDocumentEditor';
import { SendMessageEditor } from '../SendMessageEditor';
import { SendListEditor } from '../SendListEditor';
import { SendLocationEditor } from '../SendLocationEditor';
import { ACTION_ICONS } from '../WorkflowBuilder';

interface NodeConfigPanelProps {
  nodeId:           string;
  nodeType:         NodeType;
  config:           NodeConfig;
  onChange:         (config: NodeConfig) => void;
  onClose:          () => void;
  onDelete:         () => void;
}

const EXTRA_TITLES: Partial<Record<NodeType, { label: string; icon: typeof GitBranch }>> = {
  condition:     { label: 'Condition',     icon: GitBranch },
  send_buttons:  { label: 'Send Buttons',  icon: MousePointerClick },
  send_document: { label: 'Send Document', icon: FileText },
  send_message:  { label: 'Plain Message', icon: MessageSquare },
  send_list:     { label: 'Message + List', icon: ListChecks },
  send_location: { label: 'Send Location', icon: MapPin },
};

/**
 * Right-docked config panel — visually borrows Drawer.tsx's header/footer styling
 * but is deliberately NOT a Drawer: no backdrop, no focus trap, no body-scroll-lock.
 * The canvas behind it must stay interactive (pan/zoom/click other nodes) while a
 * node's config is open, which a modal Drawer would block.
 */
export function NodeConfigPanel({ nodeId, nodeType, config, onChange, onClose, onDelete }: NodeConfigPanelProps) {
  const extra = EXTRA_TITLES[nodeType];
  const Icon  = extra?.icon ?? ACTION_ICONS[nodeType as ActionType] ?? undefined;
  const title = extra?.label ?? ACTION_META[nodeType as ActionType]?.label ?? nodeType;

  return (
    <div
      className={cn(
        // top-16 (not top-3) so this panel never overlaps the canvas's own
        // top-right Save/Auto-arrange Panel — see WorkflowCanvas.tsx.
        'absolute right-3 top-16 bottom-3 z-10 flex w-[380px] flex-col overflow-hidden',
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
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onDelete}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-400 hover:bg-error-50 hover:text-error-600 sm:h-8 sm:w-8 dark:hover:bg-error-900/20"
            aria-label="Delete node"
            title="Delete node"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 sm:h-8 sm:w-8 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {nodeType === 'condition' ? (
          <ConditionEditor
            config={isConditionConfig(config) ? config : { mode: 'field_match', branches: [] }}
            onChange={(c: ConditionNodeConfig) => onChange(c)}
          />
        ) : nodeType === 'send_buttons' ? (
          <SendButtonsEditor
            config={config as SendButtonsConfig}
            onChange={(c) => onChange(c)}
          />
        ) : nodeType === 'send_document' ? (
          <SendDocumentEditor
            config={config as SendDocumentConfig}
            onChange={(c) => onChange(c)}
          />
        ) : nodeType === 'send_message' ? (
          <SendMessageEditor
            config={config as SendMessageConfig}
            onChange={(c) => onChange(c)}
          />
        ) : nodeType === 'send_list' ? (
          <SendListEditor
            config={config as SendListConfig}
            onChange={(c) => onChange(c)}
          />
        ) : nodeType === 'send_location' ? (
          <SendLocationEditor
            config={config as SendLocationConfig}
            onChange={(c) => onChange(c)}
          />
        ) : (
          <ActionEditor
            step={{ id: nodeId, type: nodeType as ActionType, config: config as StepConfig }}
            onChange={(c) => onChange(c as NodeConfig)}
          />
        )}
      </div>
    </div>
  );
}
