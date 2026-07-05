import { Badge, type BadgeVariant } from '@/components/v3/ui/Badge';

// Single shared display for LeadScoringScheduler's priorityTier — used by
// CrmTab.tsx (Contact 360) and the Sales CRM list/Kanban views (sales/page.tsx).
// Reuses the shared Badge component's own color variants rather than a second,
// slightly-different hardcoded palette — previously CrmTab.tsx's derivePriority()
// hand-rolled its own red/amber/slate classes for the same Hot/Warm/Cold concept.

export type PriorityTier = 'hot' | 'warm' | 'cold';

const TIER_LABEL: Record<PriorityTier, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
};

const TIER_VARIANT: Record<PriorityTier, BadgeVariant> = {
  hot: 'error',
  warm: 'warning',
  cold: 'default',
};

export interface PriorityBadgeProps {
  tier: PriorityTier | null | undefined;
  score?: number | null;
  className?: string;
}

export function PriorityBadge({ tier, score, className }: PriorityBadgeProps) {
  if (!tier) {
    return (
      <span className="text-xs text-neutral-300 dark:text-neutral-700" title="Not yet scored — recomputed on a ~60 minute cycle">
        —
      </span>
    );
  }

  return (
    <Badge
      variant={TIER_VARIANT[tier]}
      dot
      className={className}
      title={typeof score === 'number' ? `Priority score: ${score}/100` : undefined}
    >
      {TIER_LABEL[tier]}
    </Badge>
  );
}
