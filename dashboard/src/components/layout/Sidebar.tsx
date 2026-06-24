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
  activeOn?: string[];
  group: string;
}

const EMPLOYEE_ROLES: Role[] = ['telecaller', 'agent', 'intern'];

const ALL_NAV: NavItem[] = [
  // ── Superadmin / Platform ──────────────────────────────────────────────────
  { href: '/platform',              label: 'Control Center', icon: '🛰️',  roles: ['superadmin'], group: 'platform'     },
  { href: '/platform/companies',    label: 'Companies',      icon: '🏢',  roles: ['superadmin'], group: 'platform'     },
  { href: '/platform/billing',      label: 'Revenue',        icon: '💰',  roles: ['superadmin'], group: 'platform'     },
  { href: '/platform/health',       label: 'System Health',  icon: '📡',  roles: ['superadmin'], group: 'platform'     },
  // Superadmin workspace — APForce's own CRM + WhatsApp (apforce_internal company)
  { href: '/admin/crm',             label: 'CRM',            icon: '🤝',  roles: ['superadmin'], group: 'workspace'    },
  { href: '/admin/whatsapp',        label: 'WhatsApp',       icon: '💬',  roles: ['superadmin'], group: 'workspace'    },
  { href: '/platform/analytics',    label: 'Analytics',      icon: '📈',  roles: ['superadmin'], group: 'workspace'    },
  // ── Admin ──────────────────────────────────────────────────────────────────
  { href: '/admin/dashboard',    label: 'Dashboard',      icon: '🔑', roles: ['admin'],   group: 'overview'     },
  { href: '/admin/crm',          label: 'CRM',            icon: '🤝', roles: ['admin'],   group: 'sales'        },
  { href: '/admin/whatsapp',     label: 'WhatsApp',       icon: '💬', roles: ['admin'],   group: 'sales'        },
  { href: '/admin/targets',      label: 'Targets',        icon: '🎯', roles: ['admin'],   group: 'performance'  },
  { href: '/admin/analytics',    label: 'Analytics',      icon: '📈', roles: ['admin'],   group: 'performance'  },
  { href: '/admin/bulk-entry',   label: 'Bulk Entry',     icon: '📋', roles: ['admin'],   group: 'performance'  },
  { href: '/admin/verification', label: 'Verify Metrics', icon: '✅', roles: ['admin'],   group: 'performance'  },
  { href: '/admin/employees',    label: 'Team',           icon: '👥', roles: ['admin'],   group: 'team',
    activeOn: ['/admin/employees', '/admin/attendance', '/admin/compensation'] },
  { href: '/admin/audit',        label: 'Audit Logs',     icon: '🔍', roles: ['admin'],   group: 'system'       },
  { href: '/admin/billing',      label: 'Billing & Plan', icon: '💳', roles: ['admin'],   group: 'system'       },
  // ── Manager ────────────────────────────────────────────────────────────────
  { href: '/manager/dashboard',      label: 'Team Overview',  icon: '👔', roles: ['manager'],   group: 'overview'    },
  { href: '/manager/verify-metrics', label: 'Verify Metrics', icon: '✅', roles: ['manager'],   group: 'operations'  },
  { href: '/manager/attendance',     label: 'Attendance',     icon: '📅', roles: ['manager'],   group: 'operations'  },
  // ── Team Lead ──────────────────────────────────────────────────────────────
  { href: '/team-lead/dashboard',      label: 'Team Overview',  icon: '👥', roles: ['team_lead'], group: 'overview'   },
  { href: '/team-lead/verify-metrics', label: 'Verify Metrics', icon: '✅', roles: ['team_lead'], group: 'operations' },
  // ── Employee ───────────────────────────────────────────────────────────────
  { href: '/employee/dashboard',   label: 'My Dashboard', icon: '📊', roles: EMPLOYEE_ROLES, group: 'my-work'     },
  { href: '/employee/daily-entry', label: 'Daily Entry',  icon: '✏️', roles: EMPLOYEE_ROLES, group: 'my-work'     },
  { href: '/employee/crm',         label: 'My Leads',     icon: '🤝', roles: EMPLOYEE_ROLES, group: 'my-work'     },
  { href: '/employee/achievements', label: 'Achievements', icon: '🏅', roles: EMPLOYEE_ROLES, group: 'my-progress' },
  { href: '/employee/compensation', label: 'My Pay',       icon: '💰', roles: EMPLOYEE_ROLES, group: 'my-progress' },
  { href: '/employee/attendance',   label: 'Attendance',   icon: '📅', roles: EMPLOYEE_ROLES, group: 'my-progress' },
  // ── Shared ─────────────────────────────────────────────────────────────────
  // Leaderboard is telecaller-only — superadmin has no employees to rank
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆', roles: ['admin', 'manager', 'team_lead', 'agent', 'telecaller', 'intern'], group: 'general' },
  { href: '/profile',     label: 'Profile',     icon: '👤', group: 'general' },
  { href: '/settings',    label: 'Settings',    icon: '⚙️', group: 'general' },
];

const SUPERADMIN_GROUPS = [
  { key: 'platform',  label: 'Platform'         },
  { key: 'workspace', label: 'APForce Workspace' },
];
const ADMIN_GROUPS    = [
  { key: 'overview',    label: 'Overview'     },
  { key: 'sales',       label: 'Sales'        },
  { key: 'performance', label: 'Performance'  },
  { key: 'team',        label: 'Team'         },
  { key: 'system',      label: 'System'       },
];
const MANAGER_GROUPS   = [
  { key: 'overview',   label: 'Overview'    },
  { key: 'operations', label: 'Operations'  },
];
const TEAM_LEAD_GROUPS = [
  { key: 'overview',   label: 'Overview'   },
  { key: 'operations', label: 'Operations' },
];
const EMPLOYEE_GROUPS  = [
  { key: 'my-work',     label: 'My Work'     },
  { key: 'my-progress', label: 'My Progress' },
];

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {label}
    </p>
  );
}

function NavItemLink({ item, pathname, onNavigate }: {
  item: NavItem; pathname: string; onNavigate: () => void;
}) {
  const active =
    pathname === item.href ||
    pathname.startsWith(item.href + '/') ||
    (item.activeOn ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'));
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

function GroupedNav({ items, groups, pathname, onNavigate }: {
  items: NavItem[];
  groups: { key: string; label: string }[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <>
      {groups.map(({ key, label }) => {
        const groupItems = items.filter((i) => i.group === key);
        if (!groupItems.length) return null;
        return (
          <div key={key}>
            <SectionLabel label={label} />
            {groupItems.map((item) => (
              <NavItemLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </div>
        );
      })}
    </>
  );
}

export function Sidebar({ forceMobile = false }: { forceMobile?: boolean }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { sidebarOpen, closeMobileSidebar } = useUIStore();

  const userRole = (user?.role ?? 'telecaller') as Role;

  if (!sidebarOpen && !forceMobile) return null;

  const roleItems = ALL_NAV.filter((i) => !i.roles || i.roles.includes(userRole));
  const ownItems  = roleItems.filter((i) => i.roles);
  const general   = roleItems.filter((i) => !i.roles);

  const groups =
    userRole === 'superadmin' ? SUPERADMIN_GROUPS :
    userRole === 'admin'      ? ADMIN_GROUPS    :
    userRole === 'manager'    ? MANAGER_GROUPS  :
    userRole === 'team_lead'  ? TEAM_LEAD_GROUPS :
    EMPLOYEE_GROUPS;

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
          <p className="text-sm font-bold text-slate-900 dark:text-white">APForce</p>
          <p className="text-[10px] text-slate-400">v2.0 Pro</p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto">
        <GroupedNav
          items={ownItems}
          groups={groups}
          pathname={pathname}
          onNavigate={closeMobileSidebar}
        />
        {general.length > 0 && (
          <>
            <SectionLabel label="General" />
            {general.map((item) => (
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
