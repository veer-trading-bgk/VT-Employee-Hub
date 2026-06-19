'use client';

import { ReactNode, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { ProtectedRoute } from './ProtectedRoute';
import { useUIStore } from '@/store/uiStore';
import type { Role } from '@/types';

export function AppShell({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: Role[];
}) {
  const { mobileSidebarOpen, closeMobileSidebar } = useUIStore();
  const pathname = usePathname();

  // Close sidebar on every route change
  useEffect(() => {
    closeMobileSidebar();
  }, [pathname, closeMobileSidebar]);

  // Escape key dismisses sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileSidebar();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeMobileSidebar]);

  // Lock body scroll while mobile sidebar is open
  useEffect(() => {
    document.body.style.overflow = mobileSidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileSidebarOpen]);

  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">

        {/* Desktop sidebar — always visible at md+ */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Mobile — dimmed backdrop */}
        <div
          aria-hidden="true"
          onClick={closeMobileSidebar}
          className={[
            'fixed inset-0 z-40 bg-black/50 md:hidden',
            'transition-opacity duration-300 ease-in-out',
            mobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          ].join(' ')}
        />

        {/* Mobile — sidebar panel slides in from left */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={[
            'fixed inset-y-0 left-0 z-50 w-64 md:hidden',
            'transform transition-transform duration-300 ease-in-out',
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <Sidebar forceMobile />
        </aside>

        {/* Main content — extra bottom padding on mobile for BottomNav clearance */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
        </div>

        {/* Mobile bottom navigation bar */}
        <BottomNav />
      </div>
    </ProtectedRoute>
  );
}
