'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, Suspense } from 'react';
import {
  Home,
  MessageSquare,
  Users,
  TrendingUp,
  BarChart3,
  Zap,
  Settings,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  PenLine,
  CalendarDays,
  Wallet,
  ShieldCheck,
  Briefcase,
  UserCog,
  Target,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { useAuth } from '@/context/AuthContext';
import { toV3Role, V3_ROLE_LABELS, type V3Role } from '@/types/v3';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: V3Role[];
  badge?: number;
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ReactNode;
  roles: V3Role[];
  items: NavItem[];
}

// Flat top-level items (no group)
const FLAT_ITEMS: NavItem[] = [
  { href: '/home',           label: 'My Work',       icon: <Home className="h-5 w-5" />,          roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
  { href: '/inbox',          label: 'Inbox',          icon: <MessageSquare className="h-5 w-5" />, roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
  { href: '/contacts',       label: 'Contacts',       icon: <Users className="h-5 w-5" />,         roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
  { href: '/sales',          label: 'Sales CRM',      icon: <TrendingUp className="h-5 w-5" />,    roles: ['owner', 'admin', 'manager', 'sales'] },
];

// Team group — HR / workforce items
const TEAM_GROUP: NavGroup = {
  id: 'team',
  label: 'Team',
  icon: <Briefcase className="h-5 w-5" />,
  roles: ['owner', 'admin', 'manager', 'sales', 'support'],
  items: [
    { href: '/employees',     label: 'Employees',     icon: <UserCog className="h-5 w-5" />,      roles: ['owner', 'admin'] },
    { href: '/metric-target', label: 'Metric Target', icon: <Target className="h-5 w-5" />,       roles: ['owner', 'admin', 'manager'] },
    { href: '/audit-log',     label: 'Audit Log',     icon: <ScrollText className="h-5 w-5" />,   roles: ['owner', 'admin'] },
    { href: '/entry',         label: 'Daily Entry',   icon: <PenLine className="h-5 w-5" />,      roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
    { href: '/attendance',    label: 'Attendance',    icon: <CalendarDays className="h-5 w-5" />, roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
    { href: '/compensation',  label: 'Compensation',  icon: <Wallet className="h-5 w-5" />,       roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
  ],
};

// Bottom flat items (after Team group)
const BOTTOM_ITEMS: NavItem[] = [
  { href: '/analytics',  label: 'Analytics',  icon: <BarChart3 className="h-5 w-5" />,   roles: ['owner', 'admin', 'manager'] },
  { href: '/automation', label: 'Automation', icon: <Zap className="h-5 w-5" />,         roles: ['owner', 'admin'] },
  { href: '/platform',   label: 'Platform',   icon: <ShieldCheck className="h-5 w-5" />, roles: ['owner'] },
  { href: '/settings',   label: 'Settings',   icon: <Settings className="h-5 w-5" />,    roles: ['owner', 'admin', 'manager', 'sales', 'support'] },
];

const SEPARATOR_BEFORE_BOTTOM = new Set(['/platform', '/settings']);

interface V3SidebarProps {
  onNotificationsClick?: () => void;
  unreadNotifications?: number;
  onMobileClose?: () => void;
}

function V3SidebarInner({
  onNotificationsClick,
  unreadNotifications = 0,
  onMobileClose,
}: V3SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [teamOpen, setTeamOpen] = useState(true);

  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);

  function isActiveItem(item: NavItem): boolean {
    return pathname === item.href || pathname.startsWith(item.href + '/');
  }

  function itemHref(item: NavItem): string {
    return item.href;
  }

  function renderNavItem(item: NavItem) {
    if (!item.roles.includes(v3Role)) return null;
    const active = isActiveItem(item);
    const href = itemHref(item);

    return (
      <Link
        key={href}
        href={href}
        onClick={onMobileClose}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-2',
          active
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
        )}
      >
        <span className={cn('shrink-0', active ? 'text-primary-600 dark:text-primary-400' : '')}>{item.icon}</span>
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && item.badge != null && item.badge > 0 && (
          <Badge variant="primary" className="ml-auto text-[10px] h-5 min-w-[20px] justify-center">
            {item.badge > 99 ? '99+' : item.badge}
          </Badge>
        )}
      </Link>
    );
  }

  // Check if any Team item is visible for this role
  const visibleTeamItems = TEAM_GROUP.items.filter((i) => i.roles.includes(v3Role));
  const showTeam = visibleTeamItems.length > 0;

  // Check if any Team item is active (to auto-open group)
  const teamHasActive = visibleTeamItems.some(isActiveItem);

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-neutral-200 bg-white transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-950',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className={cn('flex items-center border-b border-neutral-200 dark:border-neutral-800', collapsed ? 'justify-center px-3 py-4' : 'gap-2 px-4 py-4')}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white text-sm font-bold">
          A
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-900 dark:text-white">APForce</p>
            <p className="text-[10px] text-neutral-400">v3.0</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3 space-y-0.5" aria-label="Main navigation">

        {/* Top flat items */}
        {FLAT_ITEMS.map((item) => renderNavItem(item))}

        {/* Team group */}
        {showTeam && (
          <div className="pt-1">
            <div className={cn('my-1 border-t border-neutral-200 dark:border-neutral-800')} aria-hidden />

            {/* Group header */}
            <button
              onClick={() => setTeamOpen((o) => !o)}
              title={collapsed ? 'Team' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors',
                collapsed ? 'justify-center px-2' : '',
                teamHasActive
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300',
              )}
              aria-expanded={teamOpen}
            >
              <span className="shrink-0">{TEAM_GROUP.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{TEAM_GROUP.label}</span>
                  {teamOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </>
              )}
            </button>

            {/* Group items */}
            {(teamOpen || collapsed) && (
              <div className={cn('space-y-0.5', !collapsed && 'pl-2')}>
                {visibleTeamItems.map((item) => renderNavItem(item))}
              </div>
            )}
          </div>
        )}

        {/* Bottom flat items */}
        <div className="pt-1">
          <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" aria-hidden />
          {BOTTOM_ITEMS.map((item, i) => {
            if (!item.roles.includes(v3Role)) return null;
            const showSep = SEPARATOR_BEFORE_BOTTOM.has(item.href) && i > 0;
            return (
              <div key={item.href}>
                {showSep && <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" aria-hidden />}
                {renderNavItem(item)}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Bottom: Notifications + User */}
      <div className="border-t border-neutral-200 px-2 py-3 space-y-1 dark:border-neutral-800">
        <button
          onClick={onNotificationsClick}
          title={collapsed ? 'Notifications' : undefined}
          className={cn(
            'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 w-full',
            collapsed && 'justify-center px-2',
          )}
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5 shrink-0" aria-hidden />
          {!collapsed && <span>Notifications</span>}
          {unreadNotifications > 0 && (
            <span
              className={cn(
                'flex h-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[10px] font-semibold text-white',
                collapsed ? 'absolute right-1 top-1 h-2 w-2 p-0' : 'ml-auto',
              )}
              aria-label={`${unreadNotifications} unread notifications`}
            >
              {!collapsed && (unreadNotifications > 99 ? '99+' : unreadNotifications)}
            </span>
          )}
        </button>

        <div className={cn('flex items-center gap-2 rounded-lg px-2 py-2', collapsed ? 'justify-center' : '')}>
          <Avatar name={user?.name ?? '?'} size={32} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {user?.name}
              </p>
              <p className="text-[10px] text-neutral-400">{V3_ROLE_LABELS[v3Role]}</p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={logout}
              className="shrink-0 text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Logout"
              title="Logout"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm hover:bg-neutral-50 hover:text-neutral-700 md:flex dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{ zIndex: 10 }}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </aside>
  );
}

export function V3Sidebar(props: V3SidebarProps) {
  return (
    <Suspense fallback={null}>
      <V3SidebarInner {...props} />
    </Suspense>
  );
}
