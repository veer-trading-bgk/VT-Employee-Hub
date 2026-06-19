'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export function SessionWarning() {
  const { sessionWarning, extendSession, logout } = useAuth();
  const [countdown, setCountdown] = useState(60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionWarning) {
      setCountdown(60);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    setCountdown(60);
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [sessionWarning]);

  if (!sessionWarning) return null;

  const pct = (countdown / 60) * 100;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-400"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        </div>

        <h2
          id="session-warning-title"
          className="mb-1.5 text-center text-base font-bold text-white"
        >
          Session Expiring Soon
        </h2>
        <p className="mb-5 text-center text-sm text-slate-400">
          You&apos;ll be logged out in{' '}
          <span className="font-bold text-amber-400">{countdown}s</span>{' '}
          due to inactivity.
        </p>

        <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-amber-500 transition-all duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={extendSession}
            className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            Stay Logged In
          </button>
          <button
            onClick={logout}
            className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-400 transition hover:border-slate-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
