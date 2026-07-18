'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { apiFetch, ApiClientError } from '@/lib/api';
import { invalidateContactCaches } from '@/lib/contactCache';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { Badge } from '@/components/v3/ui/Badge';
import { toast } from 'sonner';

export interface StageSelectProps {
  /** The lead ID used for the stage-change API call (must be a lead, not an unknown contact). */
  contactId: string;
  /** Whether this contact is a CRM lead that supports stage editing. */
  isLead: boolean;
  currentStage: string;
  compact?: boolean;
  className?: string;
  /** Called after a successful stage change (useful for invalidating module-specific caches). */
  onSuccess?: () => void;
}

/**
 * Stage-edit control — click-to-open native <select>, same interaction shape
 * as OwnerSelect.tsx: click opens the dropdown, pick a value, it closes and
 * shows the new stage. Deliberately reuses OwnerSelect's underlying
 * mechanic — a plain native <select>, not a custom-built popover — rather
 * than rebuilding dropdown positioning/click-outside handling from scratch;
 * the browser already owns both for a native element.
 *
 * Unlike OwnerSelect, there is no separate frontend role gate here. Stage
 * editing is "always interactive" for any authenticated viewer — same
 * precedent as Customer 360's CrmTab.tsx stage <select> (see its own
 * "Stage (always interactive) + Assign (admin/manager/superadmin only)"
 * comment). PUT /api/crm/leads/:id/stage enforces the real rule
 * server-side (Stage 1 of the 360° audit fix plan: restricted roles —
 * telecaller/agent/intern — limited to their own assigned leads); a 403
 * from that check surfaces here as a toast rather than a frontend pre-check.
 *
 * Optimistic display mirrors CrmTab.tsx's own pendingStage pattern (a local
 * state field shown immediately on selection, cleared onSettled) rather
 * than a cache-level optimistic write — invalidateContactCaches()'s
 * standard three-family sweep is what reconciles the real value afterward.
 */
export function StageSelect({
  contactId,
  isLead,
  currentStage,
  compact = false,
  className,
  onSuccess,
}: StageSelectProps) {
  const [editing, setEditing] = useState(false);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const qc = useQueryClient();
  const { stages } = usePipelineStages();

  const displayStage = pendingStage ?? currentStage;
  const stageObj = stages.find((s) => s.key === displayStage);

  const mutation = useMutation({
    mutationFn: (stage: string) =>
      apiFetch(`/api/crm/leads/${contactId}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () => {
      invalidateContactCaches(qc, contactId);
      toast.success('Stage updated');
      onSuccess?.();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? (err.body?.error as string | undefined) : undefined;
      toast.error(
        msg === 'Forbidden'
          ? "You can't change the stage of a lead that isn't assigned to you"
          : (msg ?? 'Failed to update stage'),
      );
    },
    onSettled: () => setPendingStage(null),
  });

  // Auto-focus + open the native select when entering edit mode — same
  // technique OwnerSelect.tsx uses.
  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
      try { selectRef.current.showPicker?.(); } catch { /* ignore */ }
    }
  }, [editing]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const stage = e.target.value;
    setEditing(false);
    if (!stage || stage === currentStage) return;
    setPendingStage(stage);
    mutation.mutate(stage);
  }

  // ── Read-only (unknown/phone-only contact — no leadId to write through,
  //    same distinction OwnerSelect's own !isLead branch makes) ───────────
  if (!isLead) {
    return (
      <Badge variant="stage" stage={displayStage} color={stageObj?.color} className={className}>
        {stageObj?.label ?? displayStage}
      </Badge>
    );
  }

  // ── Pending (mutation in-flight) ──────────────────────────────────────────
  if (mutation.isPending) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" aria-hidden />
        <span className={cn('text-sm text-neutral-500', compact && 'text-xs')}>Saving…</span>
      </div>
    );
  }

  // ── Editing (dropdown open) ───────────────────────────────────────────────
  if (editing) {
    return (
      <div className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
        <select
          ref={selectRef}
          defaultValue={displayStage}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
          aria-label="Lead stage"
          className={cn(
            'w-full appearance-none rounded-md border border-primary-400 bg-white py-1 pl-2 pr-7',
            'focus:outline-none focus:ring-2 focus:ring-primary-500',
            'dark:bg-neutral-900 dark:border-primary-600 dark:text-neutral-100',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
          aria-hidden
        />
      </div>
    );
  }

  // ── Default: clickable badge ────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={cn('group inline-flex items-center gap-1', className)}
      title="Click to change stage"
      aria-label={`Current stage: ${stageObj?.label ?? displayStage}. Click to change.`}
    >
      <Badge variant="stage" stage={displayStage} color={stageObj?.color}>
        {stageObj?.label ?? displayStage}
      </Badge>
      <ChevronDown className="h-3 w-3 text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
    </button>
  );
}
