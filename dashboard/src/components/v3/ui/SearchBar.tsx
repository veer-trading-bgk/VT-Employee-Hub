'use client';

import { useState, useRef, InputHTMLAttributes, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  shortcut?: string;
}

export function SearchBar({
  value = '',
  onChange,
  onClear,
  placeholder = 'Search…',
  shortcut = '/',
  className,
  ...props
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === shortcut &&
        shortcut === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [shortcut]);

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search
        className="absolute left-3 h-4 w-4 text-neutral-400 pointer-events-none"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-8 text-sm',
          'placeholder:text-neutral-400',
          'focus:outline-none focus:ring-2 focus:ring-primary-600 focus:border-primary-600',
          'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
        )}
        {...props}
      />
      {value && (
        <button
          onClick={() => { onChange?.(''); onClear?.(); }}
          aria-label="Clear search"
          className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
