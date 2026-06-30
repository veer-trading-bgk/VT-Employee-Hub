import { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type CardVariant = 'default' | 'elevated' | 'outlined' | 'ghost' | 'interactive';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  noPadding?: boolean;
}

const variantStyles: Record<CardVariant, string> = {
  default:     'bg-white border border-neutral-200 shadow-sm dark:bg-neutral-900 dark:border-neutral-800',
  elevated:    'bg-white border border-neutral-100 shadow-md dark:bg-neutral-900 dark:border-neutral-800',
  outlined:    'bg-transparent border border-neutral-200 dark:border-neutral-700',
  ghost:       'bg-neutral-50 dark:bg-neutral-900/50',
  interactive: 'bg-white border border-neutral-200 shadow-sm hover:border-primary-300 hover:shadow-md transition-all cursor-pointer dark:bg-neutral-900 dark:border-neutral-800 dark:hover:border-primary-600',
};

export function Card({ variant = 'default', noPadding = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl',
        variantStyles[variant],
        !noPadding && 'p-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-semibold text-neutral-900 dark:text-neutral-100', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-3', className)} {...props}>
      {children}
    </div>
  );
}
