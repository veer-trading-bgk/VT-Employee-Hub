'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getHomePath } from '@/utils/permissions';
import type { Role } from '@/types';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    } else {
      router.replace(getHomePath(user.role as Role));
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-500" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  );
}
