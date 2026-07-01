import {
  CheckCircle2,
  Clock,
  XCircle,
  PauseCircle,
  AlertTriangle,
  Ban,
  Scale,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TemplateStatus } from '@/lib/templates/types';
import { STATUS_LABELS } from '@/lib/templates/constants';

const CONFIG: Record<
  TemplateStatus,
  { icon: React.ElementType; bg: string; text: string; dot: string }
> = {
  DRAFT:            { icon: Pencil,       bg: 'bg-neutral-100 dark:bg-neutral-800',    text: 'text-neutral-600 dark:text-neutral-400',   dot: 'bg-neutral-400' },
  PENDING:          { icon: Clock,        bg: 'bg-amber-50 dark:bg-amber-900/20',       text: 'text-amber-700 dark:text-amber-400',        dot: 'bg-amber-500' },
  APPROVED:         { icon: CheckCircle2, bg: 'bg-success-50 dark:bg-success-900/20',  text: 'text-success-700 dark:text-success-400',    dot: 'bg-success-600 animate-pulse' },
  REJECTED:         { icon: XCircle,      bg: 'bg-error-50 dark:bg-error-900/20',       text: 'text-error-700 dark:text-error-400',        dot: 'bg-error-600' },
  PAUSED:           { icon: PauseCircle,  bg: 'bg-orange-50 dark:bg-orange-900/20',    text: 'text-orange-700 dark:text-orange-400',      dot: 'bg-orange-500' },
  DISABLED:         { icon: Ban,          bg: 'bg-neutral-100 dark:bg-neutral-800',    text: 'text-neutral-600 dark:text-neutral-400',   dot: 'bg-neutral-500' },
  FLAGGED:          { icon: AlertTriangle,bg: 'bg-warning-50 dark:bg-warning-900/20',  text: 'text-warning-700 dark:text-warning-400',    dot: 'bg-warning-600' },
  IN_APPEAL:        { icon: Scale,        bg: 'bg-primary-50 dark:bg-primary-900/20',  text: 'text-primary-700 dark:text-primary-400',    dot: 'bg-primary-600' },
  REINSTATED:       { icon: RefreshCw,    bg: 'bg-success-50 dark:bg-success-900/20',  text: 'text-success-700 dark:text-success-400',    dot: 'bg-success-600' },
  PENDING_DELETION: { icon: Trash2,       bg: 'bg-error-50 dark:bg-error-900/20',       text: 'text-error-600 dark:text-error-400',        dot: 'bg-error-500' },
};

interface Props {
  status: TemplateStatus;
  showIcon?: boolean;
  showDot?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}

export function TemplateStatusBadge({
  status,
  showIcon = false,
  showDot = false,
  size = 'sm',
  className,
}: Props) {
  const cfg = CONFIG[status] ?? CONFIG.DRAFT;
  const Icon = cfg.icon;
  const label = STATUS_LABELS[status] ?? status;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        cfg.bg,
        cfg.text,
        className,
      )}
    >
      {showDot && (
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot)} aria-hidden />
      )}
      {showIcon && !showDot && (
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
      )}
      {label}
    </span>
  );
}
