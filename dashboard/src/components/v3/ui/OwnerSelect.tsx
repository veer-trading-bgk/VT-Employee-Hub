'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Loader2, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/v3/ui/Avatar';
import { useEmployeesList } from '@/hooks/useEmployeesList';
import { useOwnerAssign } from '@/hooks/useOwnerAssign';

export interface OwnerSelectProps {
  /** The lead ID used for the assign API call (must be a lead, not an unknown contact). */
  contactId: string;
  /** Whether this contact is a CRM lead that supports owner assignment. */
  isLead: boolean;
  currentOwnerName?: string | null;
  currentOwnerId?: string | null;
  /** Whether the current user has permission to reassign. */
  canEdit: boolean;
  /** Compact mode for table cells; full mode for sidebar / overview panels. */
  compact?: boolean;
  className?: string;
}

/**
 * Shared owner-assignment control.
 *
 * Renders read-only when canEdit is false or the contact is not a lead.
 * Renders an inline-edit control when canEdit is true — clicking shows a
 * native select with the employees list, commits on change, and shows an
 * optimistic update immediately.
 *
 * Uses useOwnerAssign (mutation) + useEmployeesList (query) — both are
 * centralised hooks that deduplicate across all modules.
 */
export function OwnerSelect({
  contactId,
  isLead,
  currentOwnerName,
  currentOwnerId,
  canEdit,
  compact = false,
  className,
}: OwnerSelectProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  const { employees, isLoading: loadingEmployees } = useEmployeesList({
    enabled: canEdit && isLead,
  });

  const { mutate: assign, isPending } = useOwnerAssign(contactId);

  // Auto-focus + open the native select when switching to edit mode
  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
      // Trigger the dropdown programmatically on browsers that support it
      try { selectRef.current.showPicker?.(); } catch { /* ignore */ }
    }
  }, [editing]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const employeeId = e.target.value;
    if (!employeeId) { setEditing(false); return; }
    const employee = employees.find((emp) => emp.id === employeeId);
    if (!employee) { setEditing(false); return; }

    assign(
      { employeeId: employee.id, employeeName: employee.name },
      { onSettled: () => setEditing(false) },
    );
  }

  // ── Read-only state (no permission or not a lead) ─────────────────────────
  if (!canEdit || !isLead) {
    const name = currentOwnerName ?? '—';
    if (compact) {
      return (
        <span className={cn('text-sm text-neutral-700 dark:text-neutral-300', className)}>
          {name}
        </span>
      );
    }
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {currentOwnerName ? (
          <Avatar name={currentOwnerName} size={20} />
        ) : (
          <User className="h-4 w-4 text-neutral-400" />
        )}
        <span className="text-sm text-neutral-900 dark:text-neutral-100">{name}</span>
      </div>
    );
  }

  // ── Pending (mutation in-flight) ──────────────────────────────────────────
  if (isPending) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" aria-hidden />
        <span className={cn('text-sm text-neutral-500', compact && 'text-xs')}>
          Saving…
        </span>
      </div>
    );
  }

  // ── Editing (select open) ─────────────────────────────────────────────────
  if (editing) {
    return (
      <div className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
        <select
          ref={selectRef}
          defaultValue={currentOwnerId ?? ''}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
          disabled={loadingEmployees}
          aria-label="Assign owner"
          className={cn(
            'w-full appearance-none rounded-md border border-primary-400 bg-white py-1 pl-2 pr-7 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-primary-500',
            'dark:bg-neutral-900 dark:border-primary-600 dark:text-neutral-100',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          <option value="" disabled>
            {loadingEmployees ? 'Loading…' : 'Select owner'}
          </option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
      </div>
    );
  }

  // ── Default: clickable display ────────────────────────────────────────────
  const displayName = currentOwnerName ?? 'Unassigned';

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className={cn(
          'group flex items-center gap-1 rounded px-1 py-0.5 text-left text-sm',
          'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
          'dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
          'transition-colors',
          className,
        )}
        title="Click to change owner"
        aria-label={`Current owner: ${displayName}. Click to change.`}
      >
        <span>{displayName}</span>
        <ChevronDown className="h-3 w-3 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
      </button>
    );
  }

  // Full mode (C360 overview panel)
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
        'hover:bg-neutral-100 dark:hover:bg-neutral-800',
        'transition-colors',
        className,
      )}
      title="Click to change owner"
      aria-label={`Current owner: ${displayName}. Click to change.`}
    >
      <Avatar name={displayName !== 'Unassigned' ? displayName : '?'} size={20} />
      <span className="flex-1 text-sm text-neutral-900 dark:text-neutral-100">
        {displayName}
      </span>
      <ChevronDown
        className="h-3.5 w-3.5 text-neutral-400 opacity-0 group-hover:opacity-60 transition-opacity"
        aria-hidden
      />
    </button>
  );
}
