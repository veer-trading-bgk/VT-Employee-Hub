import { TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { QualityScore } from '@/lib/templates/types';
import { QUALITY_LABELS } from '@/lib/templates/constants';

const CONFIG: Record<QualityScore, { icon: React.ElementType; bg: string; text: string }> = {
  UNKNOWN: { icon: HelpCircle,  bg: 'bg-neutral-100 dark:bg-neutral-800',   text: 'text-neutral-500 dark:text-neutral-400' },
  HIGH:    { icon: TrendingUp,  bg: 'bg-success-50 dark:bg-success-900/20', text: 'text-success-700 dark:text-success-400' },
  MEDIUM:  { icon: Minus,       bg: 'bg-warning-50 dark:bg-warning-900/20', text: 'text-warning-700 dark:text-warning-400' },
  LOW:     { icon: TrendingDown,bg: 'bg-error-50 dark:bg-error-900/20',      text: 'text-error-700 dark:text-error-400' },
};

interface Props {
  score: QualityScore;
  size?: 'xs' | 'sm';
  className?: string;
}

export function TemplateQualityBadge({ score, size = 'sm', className }: Props) {
  const cfg = CONFIG[score] ?? CONFIG.UNKNOWN;
  const Icon = cfg.icon;
  const label = QUALITY_LABELS[score] ?? score;

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
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
