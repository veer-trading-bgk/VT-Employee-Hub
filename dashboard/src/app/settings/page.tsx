'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const [refreshInterval, setRefreshInterval] = useState(
    Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS ?? 30000) / 1000
  );

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>

      <div className="max-w-lg space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="font-medium text-slate-900 dark:text-white">Theme</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Switch between light and dark mode</p>
          </div>
          <button
            onClick={toggleTheme}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="font-medium text-slate-900 dark:text-white">Auto-refresh interval</p>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            How often dashboard widgets poll for new data (current session)
          </p>
          <input
            type="range"
            min={10}
            max={120}
            step={10}
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="w-full"
          />
          <p className="mt-1 text-sm font-medium text-indigo-600 dark:text-indigo-400">{refreshInterval}s</p>
          <p className="mt-1 text-xs text-slate-400">
            Default is set via NEXT_PUBLIC_REFRESH_INTERVAL_MS. This slider is illustrative for the current view.
          </p>
        </div>

        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950">
          <p className="font-medium text-rose-700 dark:text-rose-300">Session</p>
          <p className="mb-3 text-sm text-rose-600/80 dark:text-rose-400/80">
            You&apos;ll be auto-logged out after 15 minutes of inactivity.
          </p>
          <button
            onClick={logout}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            Log out now
          </button>
        </div>
      </div>
    </AppShell>
  );
}
