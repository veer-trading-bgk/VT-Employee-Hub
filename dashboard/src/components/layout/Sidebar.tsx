'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useUIStore } from '@/store/uiStore';
import { ROLE_LABELS, ROLE_COLORS, getHomePath } from '@/utils/permissions';
import { getInitials } from '@/utils/formatters';
import type { Role } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles?: Role[];
}

const EMPLOYEE_ROLES: Role[] = ['telecaller', 'agent', 'intern'];

const ALL_NAV: NavItem[] = [
  // ── Admin-only ─────────────────────────────────
  { href: '/admin/dashboard',    label: 'Admin Overview', icon: '🔑',  roles: ['admin'] },
  { href: '/admin/employees',    label: 'Employees',      icon: '👥',  roles: ['admin'] },
  { href: '/admin/bulk-entry',   label: 'Bulk Entry',     icon: '📋',  roles: ['admin'] },
  { href: '/admin/analytics',    label: 'Analytics',      icon: '📈',  roles: ['admin'] },
  { href: '/admin/verification', label: 'Verify Metrics', icon: '✅',  roles: ['admin'] },
  { href: '/admin/audit',        label: 'Audit Logs',     icon: '🔍',  roles: ['admin'] },
  { href: '/admin/compensation', label: 'Payroll',         icon: '💰',  roles: ['admin'] },
  { href: '/admin/crm',          label: 'CRM',             icon: '🤝',  roles: ['admin'] },
  { href: '/admin/attendance',   label: 'Attendance',     icon: '📅',  roles: ['admin'] },
  { href: '/admin/targets',      label: 'Targets',        icon: '🎯',  roles: ['admin'] },
  { href: '/admin/billing',      label: 'Billing & Plan', icon: '💳',  roles: ['admin'] },
  // ── Manager (admin can see too) ─────────────────
  { href: '/manager/dashboard',      label: 'Team Overview',  icon: '👔', roles: ['admin', 'manager'] },
  { href: '/manager/verify-metrics', label: 'Verify Metrics', icon: '✅', roles: ['admin', 'manager'] },
  { href: '/manager/attendance',     label: 'Attendance',     icon: '📅', roles: ['manager'] },
  // ── Team Lead ──────────────────────────────────
  { href: '/team-lead/dashboard',      label: 'Team Overview',  icon: '👥', roles: ['team_lead'] },
  { href: '/team-lead/verify-metrics', label: 'Verify Metrics', icon: '✅', roles: ['team_lead'] },
  // ── Employee ───────────────────────────────────
  { href: '/employee/dashboard',    label: 'My Dashboard', icon: '📊', roles: EMPLOYEE_ROLES },
  { href: '/employee/daily-entry',  label: 'Daily Entry',  icon: '✏️', roles: EMPLOYEE_ROLES },
  { href: '/employee/achievements',  label: 'Achievements', icon: '🏅', roles: EMPLOYEE_ROLES },
  { href: '/employee/compensation',  label: 'My Pay',       icon: '💰', roles: EMPLOYEE_ROLES },
  { href: '/employee/crm',           label: 'My Leads',     icon: '🤝', roles: EMPLOYEE_ROLES },
  { href: '/employee/attendance',    label: 'Attendance',   icon: '📅', roles: EMPLOYEE_ROLES },
  // ── Shared ─────────────────────────────────────
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { href: '/profile',     label: 'Profile',     icon: '👤' },
  { href: '/settings',    label: 'Settings',    icon: '⚙️' },
];

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="mb-1 mt-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {label}
    </p>
  );
}

function NavItemLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span className="text-base">{item.icon}</span>
      {item.label}
    </Link>
  );
}

export function Sidebar({ forceMobile = false }: { forceMobile?: boolean }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { sidebarOpen, closeMobileSidebar } = useUIStore();

  const userRole = (user?.role ?? 'telecaller') as Role;

  if (!sidebarOpen && !forceMobile) return null;

  const visible = ALL_NAV.filter(i => !i.roles || i.roles.includes(userRole));

  const adminItems    = visible.filter(i => i.roles?.includes('admin') && !i.roles?.includes('manager'));
  const managerItems  = visible.filter(i => i.roles?.includes('manager'));
  const teamLeadItems = visible.filter(i => i.roles?.includes('team_lead'));
  const employeeItems = visible.filter(i => EMPLOYEE_ROLES.some(r => i.roles?.includes(r)));
  const generalItems  = visible.filter(i => !i.roles);

  return (
    <aside className="flex h-screen w-full flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:w-60">
      {/* Logo */}
      <Link
        href={getHomePath(userRole)}
        onClick={closeMobileSidebar}
        className="mb-6 flex items-center gap-2 px-2"
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-xl">💼</div>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">Viir Employee Hub</p>
          <p className="text-[10px] text-slate-400">v2.0 Pro</p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto">
        {userRole === 'admin' && adminItems.length > 0 && (
          <>
            <SectionLabel label="Admin" />
            {adminItems.map(item => (
              <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileSidebar} />
            ))}
          </>
        )}

        {(userRole === 'admin' || userRole === 'manager') && managerItems.length > 0 && (
          <>
            <SectionLabel label="Manager" />
            {managerItems.map(item => (
              <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileSidebar} />
            ))}
          </>
        )}

        {userRole === 'team_lead' && teamLeadItems.length > 0 && (
          <>
            <SectionLabel label="Team Lead" />
            {teamLeadItems.map(item => (
              <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileSidebar} />
            ))}
          </>
        )}

        {EMPLOYEE_ROLES.includes(userRole) && employeeItems.length > 0 && (
          <>
            <SectionLabel label="Employee" />
            {employeeItems.map(item => (
              <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileSidebar} />
            ))}
          </>
        )}

        {generalItems.length > 0 && (
          <>
            <SectionLabel label="General" />
            {generalItems.map(item => (
              <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={closeMobileSidebar} />
            ))}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="flex items-center justify-between px-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              {user?.name ? getInitials(user.name) : '?'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{user?.name}</p>
              <span className={`inline-block rounded-full px-1.5 text-[10px] font-semibold ${ROLE_COLORS[userRole]}`}>
                {ROLE_LABELS[userRole]}
              </span>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <button
          onClick={logout}
          className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-rose-100 hover:text-rose-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-rose-950 dark:hover:text-rose-300"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
