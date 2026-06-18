import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  rememberMe: boolean;
  setUser: (user: User | null) => void;
  setRememberMe: (v: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      rememberMe: false,
      setUser: (user) => set({ user }),
      setRememberMe: (rememberMe) => set({ rememberMe }),
      clear: () => set({ user: null }),
    }),
    { name: 'vt-auth' }
  )
);
