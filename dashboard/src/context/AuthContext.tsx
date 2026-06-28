'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    setMemoryToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  // Restore session from cookie on load
  useEffect(() => {
    (async () => {
      try {
        const me = await api.me() as UserShape & { token?: string };
        if (me.token) setMemoryToken(me.token);
        setUser(me as User);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
    <AuthContext.Provider value={{ user, loading, login, verifyTotp, verifyBackupCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
