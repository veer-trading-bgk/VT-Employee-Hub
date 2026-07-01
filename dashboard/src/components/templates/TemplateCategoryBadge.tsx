import { cn } from '@/lib/cn';
import type { TemplateCategory } from '@/lib/templates/types';
import { CATEGORY_LABELS } from '@/lib/templates/constants';

const CONFIG: Record<TemplateCategory, { bg: string; text: string }> = {
  MARKETING:      { bg: 'bg-purple-50 dark:bg-purple-900/20',  text: 'text-purple-700 dark:text-purple-400' },
  UTILITY:        { bg: 'bg-primary-50 dark:bg-primary-900/20', text: 'text-primary-700 dark:text-primary-400' },
  AUTHENTICATION: { bg: 'bg-amber-50 dark:bg-amber-900/20',    text: 'text-amber-700 dark:text-amber-400' },
};

interface Props {
  category: TemplateCategory;
  size?: 'xs' | 'sm';
  className?: string;
}

export function TemplateCategoryBadge({ category, size = 'sm', className }: Props) {
  const cfg = CONFIG[category] ?? CONFIG.UTILITY;
  const label = CATEGORY_LABELS[category] ?? category;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        cfg.bg,
        cfg.text,
        className,
      )}
    >
      {label}
    </span>
  );
}
