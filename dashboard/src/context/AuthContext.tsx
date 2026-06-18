'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError, UserShape, setMemoryToken } from '@/lib/api';
import type { User } from '@/types';

const SESSION_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS ?? 900000);

export interface TotpChallenge {
  tempToken: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Returns a TotpChallenge if 2FA is required, otherwise navigates to dashboard. */
  login: (email: string, password: string) => Promise<TotpChallenge | null>;
  /** Complete the 2FA step with a 6-digit TOTP code. */
  verifyTotp: (challenge: TotpChallenge, totpCode: string) => Promise<void>;
  /** Complete the 2FA step with an 8-char backup code. */
  verifyBackupCode: (tempToken: string, email: string, backupCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    setMemoryToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(logout, SESSION_TIMEOUT_MS);
  }, [logout]);

  useEffect(() => {
    if (!user) return;
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetIdleTimer));
    resetIdleTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdleTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [user, resetIdleTimer]);

  // Restore session from cookie on load
  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
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

      // Store token in memory so Bearer header works even if cross-origin cookies are blocked
      if ('token' in res) setMemoryToken(res.token);
      const u = res.user as User;
      setUser(u);
      // Redirect to role-specific dashboard
      const dest = u.role === 'admin' ? '/admin/dashboard'
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
      const dest = u.role === 'admin' ? '/admin/dashboard'
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
      const dest = u.role === 'admin' ? '/admin/dashboard'
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
