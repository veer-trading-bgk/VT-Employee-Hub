'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useUIStore } from '@/store/uiStore';
import { getInitials } from '@/utils/formatters';
import { ROLE_LABELS, ROLE_COLORS } from '@/utils/permissions';
import type { Role } from '@/types';

/* ── Inline SVG icons — no external dep ─────────────────────────── */
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
  const { notifications, markAllRead, toggleSidebar, toggleMobileSidebar } = useUIStore();
  const router = useRouter();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">

      {/* ── Left: back / hamburger / title ── */}
      <div className="flex items-center gap-0.5">

        {/* Back chevron — secondary pages only */}
        {showBack && (
          <button onClick={() => router.back()} aria-label="Go back" className={btn}>
            <ChevronLeft />
          </button>
        )}

        {/* Mobile hamburger — always present so sidebar is reachable from any page */}
        <button onClick={toggleMobileSidebar} aria-label="Open menu" className={`${btn} md:hidden`}>
          <MenuIcon />
        </button>

        {/* Desktop sidebar collapse — only on primary pages (no back button context) */}
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

      {/* ── Right: bell / user / logout ── */}
      <div className="flex items-center gap-1">

        {/* Notification bell */}
        <button onClick={markAllRead} aria-label="Notifications" className={`relative ${btn}`}>
          <BellIcon />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-slate-900">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {/* User identity pill */}
        {user && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
              {getInitials(user.name)}
            </div>
            <div className="hidden sm:block leading-tight">
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
