'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/types';

interface NavTab {
  href: string;
  label: string;
  icon: string;
}

const EMPLOYEE_ROLES: Role[] = ['telecaller', 'agent', 'intern'];

function getTabsForRole(role: Role): NavTab[] {
  if (role === 'admin') return [
    { href: '/admin/dashboard',  label: 'Overview',  icon: '🔑' },
    { href: '/admin/employees',  label: 'Team',      icon: '👥' },
    { href: '/admin/analytics',  label: 'Analytics', icon: '📈' },
    { href: '/profile',          label: 'Profile',   icon: '👤' },
  ];
  if (role === 'manager') return [
    { href: '/manager/dashboard',      label: 'Team',    icon: '👔' },
    { href: '/manager/verify-metrics', label: 'Verify',  icon: '✅' },
    { href: '/leaderboard',            label: 'Board',   icon: '🏆' },
    { href: '/profile',                label: 'Profile', icon: '👤' },
  ];
  if (role === 'team_lead') return [
    { href: '/team-lead/dashboard',      label: 'Team',    icon: '👥' },
    { href: '/team-lead/verify-metrics', label: 'Verify',  icon: '✅' },
    { href: '/analytics',                label: 'Stats',   icon: '📊' },
    { href: '/profile',                  label: 'Profile', icon: '👤' },
  ];
  // Employee roles (telecaller, agent, intern)
  return [
    { href: '/employee/dashboard',   label: 'Home',    icon: '📊' },
    { href: '/employee/daily-entry', label: 'Entry',   icon: '✏️' },
    { href: '/leaderboard',          label: 'Board',   icon: '🏆' },
    { href: '/profile',              label: 'Profile', icon: '👤' },
  ];
}

export function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname();
  const role = (user?.role ?? 'telecaller') as Role;
  const tabs = getTabsForRole(role);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden dark:border-slate-800 dark:bg-slate-900/95"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Bottom navigation"
    >
      <div className="flex h-16 items-stretch">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.href !== '/profile' && pathname.startsWith(tab.href + '/'));

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-opacity active:opacity-60"
            >
              {/* Icon pill — highlights when active */}
              <span
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-xl text-base transition-colors duration-150',
                  active
                    ? 'bg-indigo-100 dark:bg-indigo-900/50'
                    : 'bg-transparent',
                ].join(' ')}
              >
                {tab.icon}
              </span>

              {/* Label */}
              <span
                className={[
                  'text-[10px] font-medium leading-tight transition-colors duration-150',
                  active
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-500 dark:text-slate-400',
                ].join(' ')}
              >
                {tab.label}
              </span>

              {/* Top-edge active indicator */}
              {active && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-indigo-600 dark:bg-indigo-400" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
