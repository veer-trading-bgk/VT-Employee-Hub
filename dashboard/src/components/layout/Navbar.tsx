'use client';

import { useAuth } from '@/context/AuthContext';
import { useUIStore } from '@/store/uiStore';
import { getInitials } from '@/utils/formatters';
import { ROLE_LABELS, ROLE_COLORS } from '@/utils/permissions';
import type { Role } from '@/types';

interface NavbarProps {
  title?: string;
}

export function Navbar({ title }: NavbarProps) {
  const { user, logout } = useAuth();
  const { notifications, markAllRead, toggleSidebar, toggleMobileSidebar } = useUIStore();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger — opens overlay drawer */}
        <button
          onClick={toggleMobileSidebar}
          className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
          aria-label="Open menu"
        >
          ☰
        </button>
        {/* Desktop hamburger — collapses/expands sidebar */}
        <button
          onClick={toggleSidebar}
          className="hidden rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:block"
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        {title && <h1 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h1>}
      </div>

      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <button
          onClick={markAllRead}
          className="relative rounded-md p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Notifications"
        >
          🔔
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* User pill */}
        {user && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              {getInitials(user.name)}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium text-slate-900 dark:text-white">{user.name}</p>
              <p className={`inline-block rounded-full px-1.5 py-0 text-[10px] font-semibold ${ROLE_COLORS[user.role as Role]}`}>
                {ROLE_LABELS[user.role as Role] ?? user.role}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
