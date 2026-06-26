'use client';

import { useState, useEffect, useRef } from 'react';
import type { Tag } from './TagBadge';

export type { Tag };

// 12-color palette — add more here as needed
export const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
];

interface TagSelectorProps {
  catalogTags: Tag[];
  selectedIds: string[];
  loading?: boolean;
  onToggle: (tagId: string) => void;
  onCreate: (label: string, color: string) => Promise<void>;
  onClose: () => void;
}

export function TagSelector({
  catalogTags,
  selectedIds,
  loading = false,
  onToggle,
  onCreate,
  onClose,
}: TagSelectorProps) {
  const [search, setSearch] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [showPalette, setShowPalette] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click-outside
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = catalogTags.filter((t) =>
    t.label.toLowerCase().includes(search.trim().toLowerCase())
  );

  const canCreate =
    search.trim().length > 0 &&
    !catalogTags.some((t) => t.label.toLowerCase() === search.trim().toLowerCase());

  async function handleCreate() {
    if (!search.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate(search.trim(), newColor);
      setSearch('');
      setShowPalette(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      ref={ref}
      className="w-56 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search / create input */}
      <div className="border-b border-slate-100 p-2 dark:border-slate-800">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) handleCreate();
          }}
          placeholder="Search or create…"
          className="w-full rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {/* Tag list */}
      <div className="max-h-52 overflow-y-auto p-1">
        {loading && (
          <p className="py-3 text-center text-xs text-slate-400">Loading…</p>
        )}
        {!loading && filtered.length === 0 && !canCreate && (
          <p className="py-3 text-center text-xs text-slate-400">
            {search ? 'No matching tags' : 'No tags yet — type to create one'}
          </p>
        )}
        {!loading && filtered.map((tag) => {
          const checked = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onToggle(tag.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {/* Checkbox */}
              <span
                className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition"
                style={
                  checked
                    ? { backgroundColor: tag.color, borderColor: tag.color }
                    : { borderColor: '#cbd5e1' }
                }
              >
                {checked && (
                  <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {/* Color dot */}
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              {/* Label */}
              <span className="flex-1 font-medium text-slate-700 dark:text-slate-200">{tag.label}</span>
            </button>
          );
        })}
      </div>

      {/* Create new tag */}
      {canCreate && (
        <div className="border-t border-slate-100 p-2 dark:border-slate-800">
          <div className="flex items-center gap-2">
            {/* Color swatch trigger */}
            <button
              type="button"
              onClick={() => setShowPalette((v) => !v)}
              title="Pick color"
              className="h-5 w-5 flex-shrink-0 rounded-full border-2 border-white shadow transition hover:scale-110"
              style={{ backgroundColor: newColor }}
            />
            {/* Create button */}
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 rounded-lg bg-indigo-50 px-2 py-1.5 text-left text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60 dark:bg-indigo-900/30 dark:text-indigo-300"
            >
              {creating ? 'Creating…' : `+ Create "${search.trim()}"`}
            </button>
          </div>

          {/* Color palette */}
          {showPalette && (
            <div className="mt-2 grid grid-cols-6 gap-1.5 px-1">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setNewColor(c); setShowPalette(false); }}
                  className="h-5 w-5 rounded-full transition hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: newColor === c ? `2px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
