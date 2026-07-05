'use client';

import { useState, type KeyboardEvent } from 'react';

// Click-to-edit name — shared by Contact 360's header, the Inbox conversation
// header, and the Contacts list, so renaming a contact anywhere in the app
// uses the same interaction: click the name, edit inline, commit on
// blur/Enter, Escape cancels, an empty value is discarded rather than saved.
// Extracted from ProfileTab.tsx's original name-only inline edit.

const DEFAULT_INPUT_CLS =
  'w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm font-medium ' +
  'text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 ' +
  'dark:border-indigo-600 dark:bg-slate-800 dark:text-slate-100';

export interface EditableNameProps {
  value: string;
  onSave: (newValue: string) => void;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
}

export function EditableName({
  value,
  onSave,
  className,
  inputClassName,
  ariaLabel = 'Edit name',
}: EditableNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  function startEdit() {
    setEditValue(value);
    setIsEditing(true);
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setIsEditing(false);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') cancelEdit();
  }

  if (isEditing) {
    return (
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        className={inputClassName ?? DEFAULT_INPUT_CLS}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <button type="button" onClick={startEdit} className={className} title="Click to edit">
      {value}
    </button>
  );
}
