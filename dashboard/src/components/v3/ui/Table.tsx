'use client';

import { ReactNode, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Checkbox } from './Checkbox';

export interface TableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  cell: (row: T, index: number) => ReactNode;
}

export type SortDirection = 'asc' | 'desc' | null;

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectChange?: (ids: Set<string>) => void;
  sortKey?: string;
  sortDir?: SortDirection;
  onSort?: (key: string, dir: SortDirection) => void;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  bulkActions?: ReactNode;
  stickyHeader?: boolean;
  className?: string;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDirection }) {
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 text-neutral-400" aria-hidden />;
  return dir === 'asc'
    ? <ChevronUp className="h-3.5 w-3.5 text-primary-600" aria-hidden />
    : <ChevronDown className="h-3.5 w-3.5 text-primary-600" aria-hidden />;
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  selectable = false,
  selectedIds = new Set(),
  onSelectChange,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  emptyState,
  bulkActions,
  stickyHeader = true,
  className,
}: TableProps<T>) {
  const allIds = data.map((row, i) => keyExtractor(row, i));
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && allIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    if (!onSelectChange) return;
    if (allSelected) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(allIds));
    }
  }

  function toggleRow(id: string) {
    if (!onSelectChange) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectChange(next);
  }

  function handleSort(key: string) {
    if (!onSort) return;
    const nextDir: SortDirection =
      sortKey === key
        ? sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc'
        : 'asc';
    onSort(key, nextDir);
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Bulk action bar */}
      {selectable && selectedIds.size > 0 && bulkActions && (
        <div className="flex items-center gap-3 border-b border-primary-100 bg-primary-50 px-4 py-2 dark:border-primary-900/30 dark:bg-primary-900/20">
          <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
            {selectedIds.size} selected
          </span>
          {bulkActions}
        </div>
      )}

      {/* Scroll wrapper */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Data table">
          <thead
            className={cn(
              'border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60',
              stickyHeader && 'sticky top-0 z-10',
            )}
          >
            <tr>
              {selectable && (
                <th className="w-10 px-4 py-3 text-left">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left font-medium text-neutral-500 dark:text-neutral-400',
                    col.sortable && 'cursor-pointer select-none hover:text-neutral-700',
                    col.width,
                  )}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  aria-sort={
                    sortKey === col.key
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : undefined
                  }
                >
                  <div className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <SortIcon active={sortKey === col.key} dir={sortKey === col.key ? sortDir ?? null : null} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="py-16 text-center"
                >
                  {emptyState ?? (
                    <span className="text-sm text-neutral-500">No data available</span>
                  )}
                </td>
              </tr>
            ) : (
              data.map((row, i) => {
                const id = keyExtractor(row, i);
                const isSelected = selectedIds.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-b border-neutral-100 transition-colors dark:border-neutral-800/50',
                      onRowClick && 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/30',
                      isSelected && 'bg-primary-50/50 dark:bg-primary-900/10',
                    )}
                  >
                    {selectable && (
                      <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          aria-label={`Select row ${i + 1}`}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                        {col.cell(row, i)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
