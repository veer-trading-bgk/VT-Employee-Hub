'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, ApiClientError, UserShape, setMemoryToken } from '@/lib/api';
import type { User } from '@/types';

export interface TotpChallenge {
  tempToken: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<TotpChallenge | null>;
  verifyTotp: (challenge: TotpChallenge, totpCode: string) => Promise<void>;
  verifyBackupCode: (tempToken: string, email: string, backupCode: string) => Promise<void>;
  logout: () => Promise<void>;
  // Re-fetches /api/auth/me and updates `user` in place — B3 finding #11.
  // Callers that mutate the current user's own record (profile save, avatar
  // upload) call this afterward so displays reading `user` from context
  // (e.g. V3Sidebar's name/avatar) update immediately, without a reload.
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  // The public marketing page never restores a session, so it's never "loading" it.
  const [loading, setLoading] = useState(() => pathname !== '/marketing');

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    setMemoryToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  // Shared by the mount-time session restore below and by refreshUser()
  // (B3 finding #11) — re-fetches the current user and updates context
  // state. Doesn't touch `loading`; the mount effect owns that separately
  // so a mid-session refreshUser() call never flashes a loading state.
  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me() as UserShape & { token?: string };
      if (me.token) setMemoryToken(me.token);
      setUser(me as User);
    } catch {
      setUser(null);
    }
  }, []);

  // Restore session from cookie on load. The public marketing page
  // (apforce.in rewrites '/' to this route) is static and never needs auth
  // state — skip the call so it never sends a cross-origin request to the
  // backend, which apforce.in is intentionally not in the CORS allowlist for.
  useEffect(() => {
    if (pathname === '/marketing') return;
    (async () => {
      await refreshUser();
      setLoading(false);
    })();
  }, [pathname, refreshUser]);

  // Global handler: apiFetch dispatches this when a 401 survives even after a
  // token refresh attempt — meaning the refresh token is also expired/invalid.
  // Guard prevents multiple concurrent dispatches (e.g. from ping loop) from
  // calling logout() and router.push('/login') more than once.
  useEffect(() => {
    let handled = false;
    const handle = () => {
      if (handled) return;
      handled = true;
      logout();
    };
    window.addEventListener('auth:expired', handle);
    return () => { window.removeEventListener('auth:expired', handle); handled = false; };
  }, [logout]);

  const login = useCallback(async (email: string, password: string): Promise<TotpChallenge | null> => {
    try {
      const res = await api.login(email, password);

      if ('requiresTOTP' in res) {
        return { tempToken: res.tempToken, email };
      }

      if ('token' in res) setMemoryToken(res.token);
      const u = res.user as User;
      setUser(u);
      const dest = u.role === 'superadmin' ? '/platform'
                 : u.role === 'admin' ? '/admin/dashboard'
                 : u.role === 'manager' ? '/manager/dashboard'
                 : '/employee/dashboard';
      router.push(dest);
      return null;
    } catch (err) {
      if (err instanceof ApiClientError) throw new Error(err.message);
      throw new Error('Login failed. Please try again.');
    }
  }, [router]);

  const verifyTotp = useCallback(async (challenge: TotpChallenge, totpCode: string) => {
    try {
      const res = await api.verifyTotp(challenge.tempToken, totpCode);
      setMemoryToken(res.token);
      const u = res.user as User;
      setUser(u);
      const dest = u.role === 'superadmin' ? '/platform'
                 : u.role === 'admin' ? '/admin/dashboard'
                 : u.role === 'manager' ? '/manager/dashboard'
                 : '/employee/dashboard';
      router.push(dest);
    } catch (err) {
      if (err instanceof ApiClientError) throw new Error(err.message);
      throw new Error('Verification failed. Please try again.');
    }
  }, [router]);

  const verifyBackupCode = useCallback(async (tempToken: string, email: string, backupCode: string) => {
    try {
      const res = await api.verifyBackupCode(tempToken, email, backupCode);
      setMemoryToken(res.token);
      const u = res.user as User;
      setUser(u);
      const dest = u.role === 'superadmin' ? '/platform'
                 : u.role === 'admin' ? '/admin/dashboard'
                 : u.role === 'manager' ? '/manager/dashboard'
                 : '/employee/dashboard';
      router.push(dest);
    } catch (err) {
      if (err instanceof ApiClientError) throw new Error(err.message);
      throw new Error('Invalid backup code. Please try again.');
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyTotp, verifyBackupCode, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
