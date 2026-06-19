'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useUIStore } from '@/store/uiStore';
import { getInitials } from '@/utils/formatters';
import { ROLE_LABELS, ROLE_COLORS } from '@/utils/permissions';
import type { Role } from '@/types';

/* ── Icons ───────────────────────────────────────────────────────── */
function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────── */
function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TYPE_COLORS = {
  info: 'text-blue-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-rose-500',
} as const;

/* ── Shared icon-button class ─────────────────────────────────────── */
const btn =
  'flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors ' +
  'hover:bg-slate-100 hover:text-slate-700 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ' +
  'dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/* ── Props ────────────────────────────────────────────────────────── */
interface NavbarProps {
  title?: string;
  showBack?: boolean;
}

export function Navbar({ title, showBack }: NavbarProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notifications, markAllRead, clearNotifications, toggleSidebar, toggleMobileSidebar } = useUIStore();
  const router = useRouter();
  const unread = notifications.filter((n) => !n.read).length;

  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [notifOpen]);

  const handleBellClick = () => {
    setNotifOpen((o) => !o);
    if (unread > 0) markAllRead();
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">

      {/* ── Left ── */}
      <div className="flex items-center gap-0.5">
        {showBack && (
          <button onClick={() => router.back()} aria-label="Go back" className={btn}>
            <ChevronLeft />
          </button>
        )}

        <button onClick={toggleMobileSidebar} aria-label="Open menu" className={`${btn} md:hidden`}>
          <MenuIcon />
        </button>

        {!showBack && (
          <button onClick={toggleSidebar} aria-label="Toggle sidebar" className={`hidden md:flex ${btn}`}>
            <MenuIcon />
          </button>
        )}

        {title && (
          <span className="ml-1.5 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </span>
        )}
      </div>

      {/* ── Right ── */}
      <div className="flex items-center gap-1">

        {/* Dark / light toggle */}
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className={btn}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        {/* Notification bell + panel */}
        <div ref={notifRef} className="relative">
          <button
            onClick={handleBellClick}
            aria-label="Notifications"
            aria-expanded={notifOpen}
            className={`relative ${btn}`}
          >
            <BellIcon />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-slate-900">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-11 z-50 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</span>
                {notifications.length > 0 && (
                  <button
                    onClick={() => { clearNotifications(); setNotifOpen(false); }}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                    <span className="text-2xl" aria-hidden="true">🔔</span>
                    <p className="text-sm text-slate-500 dark:text-slate-400">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex gap-3 border-b border-slate-50 px-4 py-3 last:border-0 dark:border-slate-800/50 ${
                        !n.read ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''
                      }`}
                    >
                      <span className={`mt-0.5 text-base ${TYPE_COLORS[n.type]}`} aria-hidden="true">
                        {n.type === 'success' ? '✓' : n.type === 'error' ? '✕' : n.type === 'warning' ? '⚠' : 'ℹ'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800 dark:text-slate-200">{n.message}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{relativeTime(n.createdAt)}</p>
                      </div>
                      {!n.read && (
                        <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User identity pill */}
        {user && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
              {getInitials(user.name)}
            </div>
            <div className="hidden leading-tight sm:block">
              <p className="text-xs font-medium text-slate-900 dark:text-white">{user.name}</p>
              <p className={`text-[10px] font-semibold ${ROLE_COLORS[user.role as Role]}`}>
                {ROLE_LABELS[user.role as Role] ?? user.role}
              </p>
            </div>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-400 dark:hover:bg-rose-950/60"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
