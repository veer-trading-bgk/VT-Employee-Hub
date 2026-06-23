'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/whatsapp',            label: 'Inbox',     icon: '💬' },
  { href: '/admin/whatsapp/templates',  label: 'Templates', icon: '📝' },
  { href: '/admin/whatsapp/broadcast',  label: 'Broadcast', icon: '📢' },
  { href: '/admin/whatsapp/settings',   label: 'Settings',  icon: '⚙️' },
];

export function WhatsAppSubNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center overflow-x-auto border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 flex-shrink-0">
      {TABS.map((tab) => {
        const active = tab.href === '/admin/whatsapp'
          ? pathname === '/admin/whatsapp'
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              active
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <span className="text-sm">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
