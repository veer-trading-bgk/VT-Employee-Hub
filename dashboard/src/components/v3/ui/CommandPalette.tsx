'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Home, MessageSquare, Users, TrendingUp, BarChart3, Zap, Settings, UserPlus, LogOut, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  shortcut?: string;
  group: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const navigate = useCallback((path: string) => {
    router.push(path);
    setOpen(false);
  }, [router]);

  const ALL_COMMANDS: CommandItem[] = [
    { id: 'home',          label: 'My Work',       icon: <Home className="h-4 w-4" />,          action: () => navigate('/home'),           group: 'Navigate', shortcut: 'G H' },
    { id: 'comms',         label: 'Communications', icon: <MessageSquare className="h-4 w-4" />, action: () => navigate('/communications'), group: 'Navigate', shortcut: 'G C' },
    { id: 'contacts',      label: 'Contacts',      icon: <Users className="h-4 w-4" />,          action: () => navigate('/contacts'),       group: 'Navigate', shortcut: 'G U' },
    { id: 'sales',         label: 'Sales',         icon: <TrendingUp className="h-4 w-4" />,     action: () => navigate('/sales'),          group: 'Navigate', shortcut: 'G S' },
    { id: 'analytics',     label: 'Analytics',     icon: <BarChart3 className="h-4 w-4" />,      action: () => navigate('/analytics'),      group: 'Navigate', shortcut: 'G A' },
    { id: 'automation',    label: 'Automation',    icon: <Zap className="h-4 w-4" />,            action: () => navigate('/automation'),     group: 'Navigate' },
    { id: 'settings',      label: 'Settings',      icon: <Settings className="h-4 w-4" />,       action: () => navigate('/settings'),       group: 'Navigate' },
    { id: 'new-contact',   label: 'New Contact',   icon: <UserPlus className="h-4 w-4" />,       action: () => { setOpen(false); /* open FAB */ }, group: 'Actions' },
    { id: 'toggle-theme',  label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode', icon: theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />, action: () => { toggleTheme(); setOpen(false); }, group: 'Actions' },
    { id: 'logout',        label: 'Logout',        icon: <LogOut className="h-4 w-4" />,         action: () => { setOpen(false); logout(); }, group: 'Account' },
  ];

  const filtered = query.trim()
    ? ALL_COMMANDS.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.description?.toLowerCase().includes(query.toLowerCase()),
      )
    : ALL_COMMANDS;

  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
    (acc[cmd.group] ??= []).push(cmd);
    return acc;
  }, {});

  // Reset active index when filtered list changes
  useEffect(() => setActiveIndex(0), [query]);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      filtered[activeIndex]?.action();
    }
  }

  if (!open) return null;

  let globalIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className="fixed inset-0 bg-black/50"
        style={{ zIndex: 400 }}
      />

      {/* Palette */}
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="fixed left-1/2 top-[15%] w-[600px] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900"
        style={{ zIndex: 401 }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={true}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, contacts, or navigate…"
            className="flex-1 bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100"
          />
          <kbd className="text-[10px] font-medium text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded dark:bg-neutral-800">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="scrollbar-thin max-h-80 overflow-y-auto py-2" role="listbox">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                  {group}
                </p>
                {items.map((cmd) => {
                  const idx = globalIndex++;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      role="option"
                      aria-selected={isActive}
                      onClick={cmd.action}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                          : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800',
                      )}
                    >
                      <span className="shrink-0 text-neutral-400">{cmd.icon}</span>
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="text-[10px] font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded dark:bg-neutral-800">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <span className="text-[10px] text-neutral-400">
            <kbd className="font-mono">↑↓</kbd> to navigate · <kbd className="font-mono">↵</kbd> to select
          </span>
        </div>
      </div>
    </>
  );
}
