'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, UserPlus, TrendingUp, StickyNote, Clock, Radio, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FABAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  shortcut?: string;
}

export interface FABProps {
  actions?: FABAction[];
}

const DEFAULT_ACTIONS: FABAction[] = [
  {
    label: 'New Contact',
    icon: <UserPlus className="h-4 w-4" aria-hidden />,
    onClick: () => {},
  },
  {
    label: 'New Lead',
    icon: <TrendingUp className="h-4 w-4" aria-hidden />,
    onClick: () => {},
  },
  {
    label: 'Add Note',
    icon: <StickyNote className="h-4 w-4" aria-hidden />,
    onClick: () => {},
  },
  {
    label: 'Add Follow-up',
    icon: <Clock className="h-4 w-4" aria-hidden />,
    onClick: () => {},
  },
  {
    label: 'Start Broadcast',
    icon: <Radio className="h-4 w-4" aria-hidden />,
    onClick: () => {},
  },
];

export function FAB({ actions = DEFAULT_ACTIONS }: FABProps) {
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);

  // `/` keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div
      ref={fabRef}
      className="fixed bottom-6 right-6 z-[400] flex flex-col-reverse items-end gap-2 md:bottom-6 md:right-6"
      style={{ zIndex: 400 }}
    >
      {/* FAB action items */}
      {open && (
        <div className="flex flex-col-reverse gap-2 mb-1" role="menu">
          {actions.map((action, i) => (
            <button
              key={i}
              role="menuitem"
              onClick={() => {
                action.onClick();
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-lg border border-neutral-200',
                'text-sm font-medium text-neutral-700 whitespace-nowrap',
                'hover:bg-primary-50 hover:text-primary-700 hover:border-primary-200',
                'transition-all duration-150',
                'dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-700',
                'animate-in slide-in-from-bottom-2 fade-in',
              )}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {action.icon}
              <span>{action.label}</span>
              {action.shortcut && (
                <kbd className="ml-1 text-xs text-neutral-400 font-mono">{action.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Main FAB button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close quick actions' : 'Quick actions (/)'}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full shadow-xl',
          'transition-all duration-200',
          open
            ? 'bg-neutral-700 text-white rotate-45 hover:bg-neutral-800'
            : 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
          'md:h-14 md:w-14',
        )}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <Plus className="h-6 w-6" aria-hidden />}
      </button>
    </div>
  );
}
