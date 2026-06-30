'use client';

import { useEffect } from 'react';
import { X, Bell, MessageSquare, UserPlus, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/v3/ui/Avatar';

export interface Notification {
  id: string;
  type: 'message' | 'assignment' | 'followup' | 'mention' | 'system';
  title: string;
  body: string;
  contactName?: string;
  readAt?: string;
  createdAt: string;
  href?: string;
}

const TYPE_ICONS = {
  message:    <MessageSquare className="h-4 w-4 text-primary-600" aria-hidden />,
  assignment: <UserPlus className="h-4 w-4 text-success-600" aria-hidden />,
  followup:   <Clock className="h-4 w-4 text-warning-600" aria-hidden />,
  mention:    <Bell className="h-4 w-4 text-primary-600" aria-hidden />,
  system:     <CheckCircle2 className="h-4 w-4 text-neutral-500" aria-hidden />,
};

interface V3NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  notifications?: Notification[];
  onMarkAllRead?: () => void;
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function V3NotificationPanel({
  open,
  onClose,
  notifications = [],
  onMarkAllRead,
}: V3NotificationPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const unread = notifications.filter((n) => !n.readAt);

  return (
    <>
      {/* Desktop: push content (handled by parent layout) */}
      {/* Overlay for mobile/tablet */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 bg-black/30 lg:hidden transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        style={{ zIndex: 300 }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Notifications"
        aria-modal="true"
        className={cn(
          'fixed inset-y-0 right-0 w-[380px] max-w-full flex flex-col bg-white shadow-xl border-l border-neutral-200',
          'transition-transform duration-200 ease-out',
          'dark:bg-neutral-950 dark:border-neutral-800',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ zIndex: 300 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Notifications
            </h2>
            {unread.length > 0 && (
              <span className="flex h-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[10px] font-semibold text-white">
                {unread.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unread.length > 0 && onMarkAllRead && (
              <button
                onClick={onMarkAllRead}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close notifications"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                <Bell className="h-6 w-6 text-neutral-400" aria-hidden />
              </div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                All caught up
              </p>
              <p className="text-sm text-neutral-500">
                No notifications right now
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={cn(
                  'flex items-start gap-3 border-b border-neutral-100 px-4 py-3 transition-colors hover:bg-neutral-50 dark:border-neutral-800/50 dark:hover:bg-neutral-900',
                  !n.readAt && 'bg-primary-50/40 dark:bg-primary-900/10',
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                  {TYPE_ICONS[n.type]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {n.title}
                    </p>
                    {!n.readAt && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-label="Unread" />
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-600 line-clamp-2 dark:text-neutral-400">
                    {n.body}
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-400">{timeAgo(n.createdAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
