import { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { Stage } from '@/types/v3';

export type BadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'stage';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  // Widened from Stage to string — a company's CONFIG#CRM pipeline can have
  // custom stage keys the closed Stage union doesn't cover.
  stage?: string;
  // Explicit color for variant="stage", e.g. a live PipelineStage's `color`.
  // Without it, only the 6 default stage keys get a real color via
  // stageStyleMap below; any other key renders shape-only (no color).
  color?: string;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default:  'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  primary:  'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  success:  'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  warning:  'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  error:    'bg-error-50 text-error-700 dark:bg-error-900/30 dark:text-error-400',
  stage:    '',
};

// Stage-specific styles using CSS custom properties from :root
const stageStyleMap: Record<Stage, string> = {
  new_lead:   'bg-[var(--stage-new-lead-bg)] text-[var(--stage-new-lead-text)]',
  contacted:  'bg-[var(--stage-contacted-bg)] text-[var(--stage-contacted-text)]',
  interested: 'bg-[var(--stage-interested-bg)] text-[var(--stage-interested-text)]',
  kyc_done:   'bg-[var(--stage-kyc-done-bg)] text-[var(--stage-kyc-done-text)]',
  demat_done: 'bg-[var(--stage-demat-done-bg)] text-[var(--stage-demat-done-text)]',
  lost:       'bg-[var(--stage-lost-bg)] text-[var(--stage-lost-text)]',
};

export function Badge({
  variant = 'default',
  stage,
  color,
  dot = false,
  className,
  children,
  style,
  ...props
}: BadgeProps) {
  // color (from a live pipeline stage) takes precedence; stageStyleMap is
  // only a fallback for the 6 default keys when no explicit color is given.
  const stageStyle = variant === 'stage' && stage && !color ? stageStyleMap[stage as Stage] : '';
  const colorStyle = variant === 'stage' && color
    ? { backgroundColor: color + '20', color }
    : undefined;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        variantStyles[variant],
        stageStyle,
        className,
      )}
      style={{ ...colorStyle, ...style }}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" aria-hidden />
      )}
      {children}
    </span>
  );
}
