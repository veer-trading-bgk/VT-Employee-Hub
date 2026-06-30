'use client';

import { forwardRef, InputHTMLAttributes, useEffect, useRef, useImperativeHandle } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, indeterminate = false, className, id, ...props }, ref) => {
    const innerRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => innerRef.current!);

    useEffect(() => {
      if (innerRef.current) {
        innerRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <label
        htmlFor={inputId}
        className={cn(
          'inline-flex cursor-pointer items-center gap-2',
          props.disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
      >
        <span className="relative flex items-center justify-center">
          <input
            ref={innerRef}
            type="checkbox"
            id={inputId}
            className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-neutral-300 bg-white transition-colors checked:border-primary-600 checked:bg-primary-600 focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900"
            {...props}
          />
          {indeterminate ? (
            <Minus
              className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-indeterminate:opacity-100"
              aria-hidden
            />
          ) : (
            <Check
              className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100"
              aria-hidden
            />
          )}
        </span>
        {label && (
          <span className="text-sm text-neutral-700 select-none dark:text-neutral-200">
            {label}
          </span>
        )}
      </label>
    );
  },
);

Checkbox.displayName = 'Checkbox';
