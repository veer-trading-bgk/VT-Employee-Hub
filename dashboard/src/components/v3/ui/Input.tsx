'use client';

import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  phonePrefix?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      hint,
      error,
      iconLeft,
      iconRight,
      phonePrefix = false,
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

        <div className="relative flex items-center">
          {phonePrefix && (
            <div className="absolute left-3 flex items-center pointer-events-none">
              <span className="text-sm text-neutral-500 select-none">+91</span>
              <span className="ml-2 h-4 w-px bg-neutral-300" aria-hidden />
            </div>
          )}
          {!phonePrefix && iconLeft && (
            <div className="absolute left-3 flex items-center pointer-events-none text-neutral-400">
              {iconLeft}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={hasError}
            aria-describedby={
              error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
            }
            className={cn(
              'w-full rounded-lg border bg-white px-3 py-2 text-sm text-neutral-900',
              'placeholder:text-neutral-400',
              'transition-colors duration-100',
              'focus:outline-none focus:ring-2 focus:ring-primary-600 focus:ring-offset-0 focus:border-primary-600',
              'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-neutral-50',
              'dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600',
              hasError
                ? 'border-error-500 focus:ring-error-500 focus:border-error-500'
                : 'border-neutral-200 dark:border-neutral-700',
              phonePrefix ? 'pl-16' : iconLeft ? 'pl-9' : '',
              iconRight ? 'pr-9' : '',
              className,
            )}
            {...props}
          />
          {iconRight && (
            <div className="absolute right-3 flex items-center pointer-events-none text-neutral-400">
              {iconRight}
            </div>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="text-xs text-error-600" role="alert">
            {error}
          </p>
        )}
        {!error && hint && (
          <p id={`${inputId}-hint`} className="text-xs text-neutral-500">
            {hint}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

// Textarea variant
export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, className, id, required, ...props }, ref) => {
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
        <textarea
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={hasError}
          rows={3}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2 text-sm text-neutral-900 resize-none',
            'placeholder:text-neutral-400',
            'transition-colors duration-100',
            'focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-primary-600',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-neutral-50',
            'dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600',
            hasError
              ? 'border-error-500 focus:ring-error-500 focus:border-error-500'
              : 'border-neutral-200 dark:border-neutral-700',
            className,
          )}
          {...props}
        />
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

Textarea.displayName = 'Textarea';
