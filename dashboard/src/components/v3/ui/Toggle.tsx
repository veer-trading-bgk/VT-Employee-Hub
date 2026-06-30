'use client';

import { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type ToggleSize = 'sm' | 'md';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  size?: ToggleSize;
}

export function Toggle({ label, size = 'md' as ToggleSize, className, id, ...props }: ToggleProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex cursor-pointer items-center gap-3',
        props.disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <div className="relative">
        <input
          type="checkbox"
          role="switch"
          id={inputId}
          className="peer sr-only"
          {...props}
        />
        {/* Track */}
        <div
          className={cn(
            'rounded-full bg-neutral-200 transition-colors duration-200',
            'peer-checked:bg-primary-600',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-primary-600 peer-focus-visible:ring-offset-2',
            'dark:bg-neutral-700',
            size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
          )}
        />
        {/* Thumb */}
        <div
          className={cn(
            'absolute top-0.5 left-0.5 rounded-full bg-white shadow-sm transition-transform duration-200',
            'peer-checked:translate-x-full',
            size === 'sm' ? 'h-3 w-3' : 'h-4 w-4',
          )}
          aria-hidden
        />
      </div>
      {label && (
        <span className="text-sm font-medium text-neutral-700 select-none dark:text-neutral-200">
          {label}
        </span>
      )}
    </label>
  );
}
