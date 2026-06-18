'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/context/AuthContext';
import { ROLE_LABELS, ROLE_COLORS } from '@/utils/permissions';
import type { Role } from '@/types';

export default function ProfilePage() {
  const { user } = useAuth();
  const role = (user?.role ?? 'telecaller') as Role;

  return (
    <>
      <Navbar title="My Profile" />
      <div className="space-y-6 p-4 md:p-8 max-w-lg">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Profile</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your account information</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-2xl font-bold text-white">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="text-xl font-semibold text-slate-900 dark:text-white">{user?.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLORS[role]}`}>
                {ROLE_LABELS[role]}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Account Details</h2>
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <div className="flex justify-between py-3">
              <dt className="text-sm text-slate-500 dark:text-slate-400">Full Name</dt>
              <dd className="text-sm font-medium text-slate-900 dark:text-white">{user?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-sm text-slate-500 dark:text-slate-400">Email</dt>
              <dd className="text-sm font-medium text-slate-900 dark:text-white">{user?.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-sm text-slate-500 dark:text-slate-400">Role</dt>
              <dd>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLORS[role]}`}>
                  {ROLE_LABELS[role]}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </>
  );
}
