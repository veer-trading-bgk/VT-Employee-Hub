'use client';

import { ReactNode, useState } from 'react';
import { Filter, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface FilterChip {
  key: string;
  label: string;
  value: string;
}

export interface FilterBarProps {
  chips?: FilterChip[];
  onRemoveChip?: (key: string) => void;
  onClearAll?: () => void;
  children?: ReactNode;
  savedViews?: { id: string; label: string }[];
  activeView?: string;
  onViewChange?: (id: string) => void;
  onSaveView?: () => void;
  className?: string;
}

export function FilterBar({
  chips = [],
  onRemoveChip,
  onClearAll,
  children,
  savedViews = [],
  activeView,
  onViewChange,
  onSaveView,
  className,
}: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="toolbar" aria-label="Filters">
      {/* Saved views */}
      {savedViews.length > 0 && (
        <div className="flex items-center gap-1">
          {savedViews.map((view) => (
            <button
              key={view.id}
              onClick={() => onViewChange?.(view.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                view.id === activeView
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300',
              )}
            >
              {view.label}
            </button>
          ))}
        </div>
      )}

      {/* Inline filter controls (passed as children) */}
      {children}

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((chip) => (
            <div
              key={chip.key}
              className="flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
            >
              <span className="opacity-70">{chip.label}:</span>
              <span>{chip.value}</span>
              <button
                onClick={() => onRemoveChip?.(chip.key)}
                aria-label={`Remove ${chip.label} filter`}
                className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-primary-200 dark:hover:bg-primary-800"
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            </div>
          ))}
          {chips.length > 1 && onClearAll && (
            <button
              onClick={onClearAll}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-700 underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Save view */}
      {onSaveView && chips.length > 0 && (
        <button
          onClick={onSaveView}
          className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
        >
          Save view
        </button>
      )}
    </div>
  );
}
