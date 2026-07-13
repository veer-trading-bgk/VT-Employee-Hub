'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:   'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm disabled:bg-primary-200',
  secondary: 'bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50 active:bg-neutral-100 shadow-sm disabled:text-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-700 dark:hover:bg-neutral-700',
  ghost:     'text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 disabled:text-neutral-300 dark:text-neutral-200 dark:hover:bg-neutral-800',
  danger:    'bg-error-600 text-white hover:bg-error-700 active:bg-error-800 shadow-sm disabled:bg-error-200',
  link:      'text-primary-600 hover:text-primary-700 underline-offset-2 hover:underline disabled:text-neutral-300 p-0',
};

// M2-A: sm(32px)/md(36px) sat under the 44px touch-target floor (M1 audit).
// Mobile-first: unprefixed h-11 (44px) is the base/floor; sm:h-8/sm:h-9
// (Tailwind sm = 640px) override back down to the existing desktop density
// from 640px up. lg was already 44px everywhere — unchanged. Height only —
// padding/text/gap intentionally untouched.
const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-11 px-3 text-sm gap-1.5 sm:h-8',
  md: 'h-11 px-4 text-sm gap-2 sm:h-9',
  lg: 'h-11 px-5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      iconLeft,
      iconRight,
      className,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
          'focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:outline-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-60',
          variantStyles[variant],
          variant !== 'link' && sizeStyles[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
        ) : iconLeft ? (
          <span className="shrink-0">{iconLeft}</span>
        ) : null}
        {children}
        {!loading && iconRight && <span className="shrink-0">{iconRight}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';
