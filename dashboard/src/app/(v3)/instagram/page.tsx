'use client';

import { useState } from 'react';
import { MessageSquare, Image as ImageIcon, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { InstagramMessagesTab } from '@/components/instagram/MessagesTab';
import { InstagramCommentsTab } from '@/components/instagram/CommentsTab';
import { InstagramSettingsPanel } from '@/components/instagram/InstagramSettingsPanel';

type IgTab = 'messages' | 'comments' | 'settings';

const TABS: { id: IgTab; label: string; icon: LucideIcon }[] = [
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'comments', label: 'Comments', icon: ImageIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function InstagramPageInner() {
  const [tab, setTab] = useState<IgTab>('messages');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab switcher — segmented control (same pattern as the Inbox mode switcher) */}
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition',
                tab === id
                  ? 'bg-primary-600 text-white'
                  : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'messages' && <InstagramMessagesTab />}
        {tab === 'comments' && <InstagramCommentsTab />}
        {tab === 'settings' && <InstagramSettingsPanel />}
      </div>
    </div>
  );
}

export default function InstagramPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <InstagramPageInner />
    </ProtectedRoute>
  );
}
