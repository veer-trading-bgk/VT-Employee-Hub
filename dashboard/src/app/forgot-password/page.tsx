'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSent(true);
    setSubmitting(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-purple-600/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-3xl shadow-lg shadow-indigo-900/50">
            🔑
          </div>
          <h1 className="text-2xl font-bold text-white">Reset Password</h1>
          <p className="mt-1 text-sm text-slate-400">Enter your email to receive reset instructions</p>
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl">
          {sent ? (
            <div className="text-center">
              <div className="mb-4 text-5xl">📧</div>
              <h2 className="text-base font-semibold text-white">Check your inbox</h2>
              <p className="mt-2 text-sm text-slate-400">
                If an account exists for <strong className="text-slate-200">{email}</strong>, a reset link has been sent.
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Contact your admin if you don&apos;t receive the email within 5 minutes.
              </p>
              <Link
                href="/login"
                className="mt-5 block w-full rounded-lg bg-indigo-600 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@viirtrading.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !email}
                className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Sending…
                  </span>
                ) : (
                  'Send Reset Link'
                )}
              </button>
              <p className="text-center text-sm text-slate-500">
                Remembered it?{' '}
                <Link href="/login" className="text-indigo-400 hover:text-indigo-300 hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
