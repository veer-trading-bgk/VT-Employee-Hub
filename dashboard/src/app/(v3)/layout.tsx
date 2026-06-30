'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { V3Sidebar } from '@/components/v3/layout/V3Sidebar';
import { V3BottomNav } from '@/components/v3/layout/V3BottomNav';
import { V3NotificationPanel } from '@/components/v3/layout/V3NotificationPanel';
import { CommandPalette } from '@/components/v3/ui/CommandPalette';
import { FAB } from '@/components/v3/ui/FAB';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { cn } from '@/lib/cn';

export default function V3Layout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Lock scroll while mobile nav is open
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  return (
    <ProtectedRoute>
      {/* Skip to content — accessibility */}
      <a href="#main-content" className="skip-nav">
        Skip to content
      </a>

      <div className="flex h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-950">
        {/* ── Desktop sidebar ─────────────────────────────────────────── */}
        <div className="relative hidden md:block">
          <V3Sidebar
            onNotificationsClick={() => setNotifOpen((o) => !o)}
            unreadNotifications={0}
          />
        </div>

        {/* ── Mobile sidebar backdrop ──────────────────────────────────── */}
        <div
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
          className={cn(
            'fixed inset-0 z-40 bg-black/50 md:hidden transition-opacity duration-200',
            mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        />

        {/* ── Mobile sidebar panel ─────────────────────────────────────── */}
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 md:hidden',
            'transform transition-transform duration-300 ease-in-out',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <V3Sidebar
            onNotificationsClick={() => { setNotifOpen((o) => !o); setMobileNavOpen(false); }}
            unreadNotifications={0}
            onMobileClose={() => setMobileNavOpen(false)}
          />
        </div>

        {/* ── Main content ─────────────────────────────────────────────── */}
        <main
          id="main-content"
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-y-auto',
            'pb-14 md:pb-0',          // space for mobile bottom nav
            'transition-all duration-200',
            notifOpen && 'lg:mr-[380px]', // notification panel pushes content on desktop
          )}
          tabIndex={-1}
        >
          {children}
        </main>

        {/* ── Mobile bottom nav ────────────────────────────────────────── */}
        <V3BottomNav onMoreClick={() => setMobileNavOpen(true)} />

        {/* ── Notification panel ───────────────────────────────────────── */}
        <V3NotificationPanel
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          notifications={[]}
          onMarkAllRead={() => {}}
        />

        {/* ── Global overlays (always in DOM) ──────────────────────────── */}
        <CommandPalette />
        <FAB />
      </div>
    </ProtectedRoute>
  );
}
