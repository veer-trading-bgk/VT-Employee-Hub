'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageSquare, Users, TrendingUp, PenLine, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { toV3Role, type V3Role } from '@/types/v3';

const BOTTOM_NAV = [
  { href: '/home',           label: 'Home',  icon: <Home className="h-5 w-5" />,          roles: ['owner', 'admin', 'manager', 'sales', 'support'] as V3Role[] },
  { href: '/entry',          label: 'Entry', icon: <PenLine className="h-5 w-5" />,        roles: ['owner', 'admin', 'manager', 'sales', 'support'] as V3Role[] },
  { href: '/communications', label: 'Comms', icon: <MessageSquare className="h-5 w-5" />, roles: ['owner', 'admin', 'manager', 'sales', 'support'] as V3Role[] },
  { href: '/customers',      label: 'Cust.', icon: <Users className="h-5 w-5" />,         roles: ['owner', 'admin', 'manager', 'sales', 'support'] as V3Role[] },
  { href: '/sales',          label: 'Sales', icon: <TrendingUp className="h-5 w-5" />,    roles: ['owner', 'admin', 'manager'] as V3Role[] },
];

export function V3BottomNav({ onMoreClick }: { onMoreClick?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);

  const visible = BOTTOM_NAV.filter((item) => item.roles.includes(v3Role));

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-[200] flex h-14 items-center border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:hidden"
      aria-label="Mobile navigation"
    >
      {visible.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              active
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-200',
            )}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}

      {/* More button — opens mobile nav drawer */}
      <button
        onClick={onMoreClick}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-500"
        aria-label="More navigation options"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
        More
      </button>
    </nav>
  );
}
