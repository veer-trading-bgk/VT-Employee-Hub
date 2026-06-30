'use client';

import { forwardRef, SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      hint,
      error,
      placeholder,
      options,
      className,
      id,
      required,
      ...props
    },
    ref,
  ) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const hasError = Boolean(error);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-neutral-700 dark:text-neutral-200"
          >
            {label}
            {required && <span className="ml-0.5 text-error-600" aria-hidden>*</span>}
          </label>
        )}

        <div className="relative">
          <select
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={hasError}
            className={cn(
              'w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-sm text-neutral-900',
              'transition-colors duration-100',
              'focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-primary-600',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-neutral-50',
              'dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700',
              hasError
                ? 'border-error-500 focus:ring-error-500 focus:border-error-500'
                : 'border-neutral-200 dark:border-neutral-700',
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 pointer-events-none"
            aria-hidden
          />
        </div>

        {error && (
          <p className="text-xs text-error-600" role="alert">
            {error}
          </p>
        )}
        {!error && hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
    );
  },
);

Select.displayName = 'Select';
