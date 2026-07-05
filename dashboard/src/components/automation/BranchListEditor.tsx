'use client';

import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ConditionBranch } from '@/types/automations';
import { inputCls } from './ActionEditor';

// Same interaction pattern as ButtonListEditor.tsx's ReplyButtonList (add/remove row
// list, capped count) — not the same component, since a condition branch's shape
// (key/label/value or key/label/buttonId) has nothing to do with ButtonListEditor's
// WhatsApp-message-specific `followUp` config.

const newBranchKey = () => `branch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

interface BranchListEditorProps {
  mode:         'field_match' | 'button_reply';
  value:        ConditionBranch[];
  onChange:     (v: ConditionBranch[]) => void;
  maxBranches?: number; // button_reply: 3 (Meta's reply-button cap); field_match: uncapped
}

export function BranchListEditor({ mode, value, onChange, maxBranches }: BranchListEditorProps) {
  function addBranch() {
    if (maxBranches && value.length >= maxBranches) return;
    onChange([...value, { key: newBranchKey(), label: '', ...(mode === 'field_match' ? { value: '' } : { buttonId: '' }) }]);
  }
  function updateBranch(idx: number, patch: Partial<ConditionBranch>) {
    onChange(value.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }
  function removeBranch(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  const atCap = maxBranches != null && value.length >= maxBranches;

  return (
    <div className="space-y-2">
      {value.map((branch, idx) => (
        <div key={branch.key} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
          <input
            value={branch.label ?? ''}
            onChange={(e) => updateBranch(idx, { label: e.target.value })}
            placeholder={mode === 'button_reply' ? 'Button text' : 'Branch label'}
            maxLength={mode === 'button_reply' ? 20 : undefined}
            className={cn(inputCls, 'w-36 shrink-0')}
          />
          {mode === 'field_match' ? (
            <input
              value={branch.value ?? ''}
              onChange={(e) => updateBranch(idx, { value: e.target.value })}
              placeholder="Comparison value (e.g. won)"
              className={cn(inputCls, 'flex-1')}
            />
          ) : (
            <input
              value={branch.buttonId ?? ''}
              onChange={(e) => updateBranch(idx, { buttonId: e.target.value })}
              placeholder="Button id (must match the id sent earlier in this workflow)"
              className={cn(inputCls, 'flex-1')}
            />
          )}
          <button
            type="button"
            onClick={() => removeBranch(idx)}
            className="shrink-0 rounded p-1 text-neutral-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-900/20"
            aria-label="Remove branch"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {!atCap ? (
        <button
          type="button"
          onClick={addBranch}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <Plus className="h-3.5 w-3.5" /> Add branch{maxBranches ? ` (${value.length}/${maxBranches})` : ''}
        </button>
      ) : (
        <p className="text-[11px] text-neutral-400">Maximum {maxBranches} branches (Meta reply-button limit)</p>
      )}
    </div>
  );
}
