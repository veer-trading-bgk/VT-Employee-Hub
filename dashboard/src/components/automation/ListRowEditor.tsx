'use client';

import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ListRow } from '@/types/automations';
import { inputCls } from './ActionEditor';

// Same add/remove-row interaction pattern as BranchListEditor.tsx (itself
// modeled on ButtonListEditor.tsx's ReplyButtonList) — not the same
// component, since a list row's shape (id/title/description) has nothing to
// do with either of those. Deliberately single-section, max 10 rows total —
// Meta's own platform limit for a WhatsApp Interactive List message.
const MAX_ROWS = 10;
const newRowId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

interface ListRowEditorProps {
  value:    ListRow[];
  onChange: (v: ListRow[]) => void;
}

export function ListRowEditor({ value, onChange }: ListRowEditorProps) {
  function addRow() {
    if (value.length >= MAX_ROWS) return;
    onChange([...value, { id: newRowId(), title: '', description: '' }]);
  }
  function updateRow(idx: number, patch: Partial<ListRow>) {
    onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  const atCap = value.length >= MAX_ROWS;

  return (
    <div className="space-y-2">
      {value.map((row, idx) => (
        <div key={row.id} className="space-y-1.5 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center gap-2">
            <input
              value={row.title}
              onChange={(e) => updateRow(idx, { title: e.target.value })}
              placeholder="Option title"
              maxLength={24}
              className={cn(inputCls, 'flex-1')}
            />
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="shrink-0 rounded p-1 text-neutral-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-900/20"
              aria-label="Remove option"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            value={row.description ?? ''}
            onChange={(e) => updateRow(idx, { description: e.target.value })}
            placeholder="Description (optional)"
            maxLength={72}
            className={inputCls}
          />
        </div>
      ))}

      {!atCap ? (
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <Plus className="h-3.5 w-3.5" /> Add option ({value.length}/{MAX_ROWS})
        </button>
      ) : (
        <p className="text-[11px] text-neutral-400">Maximum {MAX_ROWS} options (Meta list-message limit)</p>
      )}
    </div>
  );
}
