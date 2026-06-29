'use client';

import { useRef, useEffect } from 'react';
import { CONTACT_TABS } from '@/lib/contacts/types';
import type { TabId } from '@/lib/contacts/types';

interface ContactTabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function ContactTabNav({ activeTab, onTabChange }: ContactTabNavProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll the active tab button into view when it changes
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  }, [activeTab]);

  return (
    <div
      className="flex overflow-x-auto border-b border-slate-200 bg-white scrollbar-none dark:border-slate-800 dark:bg-slate-900"
      role="tablist"
      aria-label="Contact sections"
    >
      {CONTACT_TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={isActive ? activeRef : undefined}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={[
              'relative flex-shrink-0 px-3 py-3 text-xs font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
              'sm:px-4 sm:text-sm',
              isActive
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
            ].join(' ')}
          >
            <span className="sm:hidden" aria-hidden={!isActive}>
              {tab.mobileLabel}
            </span>
            <span className="hidden sm:inline">
              {tab.label}
            </span>
            {isActive && (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-indigo-600 dark:bg-indigo-400"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
