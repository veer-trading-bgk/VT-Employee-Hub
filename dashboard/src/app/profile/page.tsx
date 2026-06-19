'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { ROLE_LABELS, ROLE_COLORS } from '@/utils/permissions';
import type { Role } from '@/types';

interface MeResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  totpEnabled: boolean;
  panNumber?: string;
  aadhaarNumber?: string;
  homeAddress?: string;
  createdAt?: string;
}

function maskPAN(pan: string) {
  // ABCDE1234F → ABCDE****F
  return pan.slice(0, 5) + '****' + pan.slice(-1);
}

function maskAadhaar(aad: string) {
  // 123456789012 → •••• •••• 9012
  return '•••• •••• ' + aad.slice(-4);
}

function ProfileRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between py-3">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-sm font-medium text-right ${mono ? 'font-mono tracking-wider' : ''} text-slate-900 dark:text-white`}>
        {value}
      </dd>
    </div>
  );
}

const NOT_PROVIDED = (
  <span className="text-xs text-slate-400 dark:text-slate-500">Not provided — contact admin</span>
);

export default function ProfilePage() {
  const { user: jwtUser } = useAuth();
  const role = (jwtUser?.role ?? 'telecaller') as Role;

  const { data: user, isLoading } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => apiFetch<MeResponse>('/api/auth/me'),
    staleTime: 60_000,
  });

  return (
    <AppShell>
      <Navbar title="My Profile" showBack />
      <div className="space-y-6 p-4 md:p-8 max-w-lg">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Profile</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Your account information</p>
        </div>

        {/* ── Avatar card ── */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-2xl font-bold text-white">
              {jwtUser?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="text-xl font-semibold text-slate-900 dark:text-white">{jwtUser?.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{jwtUser?.email}</p>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLORS[role]}`}>
                {ROLE_LABELS[role]}
              </span>
            </div>
          </div>
        </div>

        {/* ── Account details ── */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Account Details</h2>
          <dl className="divide-y divide-slate-100 dark:divide-slate-800">
            <ProfileRow label="Full Name" value={jwtUser?.name ?? '—'} />
            <ProfileRow label="Email" value={jwtUser?.email ?? '—'} />
            <div className="flex justify-between py-3">
              <dt className="text-sm text-slate-500 dark:text-slate-400">Role</dt>
              <dd>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLORS[role]}`}>
                  {ROLE_LABELS[role]}
                </span>
              </dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-sm text-slate-500 dark:text-slate-400">2FA</dt>
              <dd>
                {isLoading ? (
                  <span className="text-xs text-slate-400">—</span>
                ) : user?.totpEnabled ? (
                  <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-800">
                    Enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">
                    Not set up
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* ── Identification (sensitive) ── */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Identification</h2>
          <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Stored securely · visible only to you and admins</p>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            </div>
          ) : (
            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              <ProfileRow
                label="PAN Number"
                mono
                value={user?.panNumber ? maskPAN(user.panNumber) : NOT_PROVIDED}
              />
              <ProfileRow
                label="Aadhaar Number"
                mono
                value={user?.aadhaarNumber ? maskAadhaar(user.aadhaarNumber) : NOT_PROVIDED}
              />
              <div className="py-3">
                <dt className="mb-1 text-sm text-slate-500 dark:text-slate-400">Home Address</dt>
                <dd className="text-sm font-medium text-slate-900 dark:text-white whitespace-pre-wrap">
                  {user?.homeAddress ?? NOT_PROVIDED}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>
    </AppShell>
  );
}
