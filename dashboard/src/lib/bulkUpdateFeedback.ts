// Pure decision logic for the Contacts page's bulk assign/tag feedback
// (2026-07-10, docs/phase3/TECHNICAL_DEBT.md). Separated from
// contacts/page.tsx's reportBulkOutcome() specifically so it's testable
// without a browser or React — given { results, succeeded, failed } from
// POST /api/contacts/bulk-update, decide what toast to show and which ids
// (if any) should stay selected for an immediate retry.

export interface BulkUpdateResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface BulkUpdateResponse {
  success: boolean;
  results: BulkUpdateResult[];
  succeeded: number;
  failed: number;
}

export interface BulkOutcomeDecision {
  toastType: 'success' | 'error' | 'none';
  message: string;
  // null = leave the current selection alone (nothing was attempted);
  // otherwise the exact set selectedIds should become — [] clears it on
  // full success, or the failed ids on partial/total failure (retry affordance).
  retrySelectedIds: string[] | null;
}

export function decideBulkOutcome(action: string, res: BulkUpdateResponse): BulkOutcomeDecision {
  const { results, succeeded, failed } = res;

  if (results.length === 0) {
    return { toastType: 'none', message: '', retrySelectedIds: null };
  }

  if (failed === 0) {
    return {
      toastType: 'success',
      message: `${action} ${succeeded} contact${succeeded !== 1 ? 's' : ''}`,
      retrySelectedIds: [],
    };
  }

  const failedIds = results.filter((r) => !r.ok).map((r) => r.id);
  const firstReason = results.find((r) => !r.ok)?.error ?? null;

  const message = succeeded === 0
    ? `Failed to ${action.toLowerCase()} ${failed} contact${failed !== 1 ? 's' : ''}${firstReason ? `: ${firstReason}` : ''}`
    : `${action} ${succeeded} contact${succeeded !== 1 ? 's' : ''} — ${failed} failed${firstReason ? `: ${firstReason}` : ''}. Failed contacts stay selected — try again.`;

  return { toastType: 'error', message, retrySelectedIds: failedIds };
}
