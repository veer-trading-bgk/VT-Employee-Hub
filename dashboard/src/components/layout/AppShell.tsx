'use client';

import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { ProtectedRoute } from './ProtectedRoute';
import { useUIStore } from '@/store/uiStore';
import type { Role } from '@/types';

export function AppShell({
  children,
  allowedRoles
}: {
  children: ReactNode;
  allowedRoles?: Role[];
}) {
  const { mobileSidebarOpen, closeMobileSidebar } = useUIStore();

  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
        {/* Desktop sidebar — always visible at md+ */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay — controlled by uiStore.mobileSidebarOpen */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="w-64">
              <Sidebar forceMobile />
            </div>
            <div className="flex-1 bg-black/50" onClick={closeMobileSidebar} />
          </div>
        )}

        {/* Main content — Navbar (sticky) + page content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
