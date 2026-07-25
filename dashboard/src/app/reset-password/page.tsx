'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiClientError } from '@/lib/api';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side checks mirror the backend's actual rule (auth.js's
    // resetPasswordSchema, same as scripts/recover-admin.js) for immediate
    // feedback — the backend re-validates regardless, so this is UX only.
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Password must be at least 8 characters and include an uppercase letter and a number.');
      return;
    }
    if (!token) {
      setError('This reset link is missing its token. Please request a new one.');
      return;
    }

    setSubmitting(true);
    try {
      await api.confirmPasswordReset(token, newPassword);
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center">
        <div className="mb-4 text-5xl">⚠️</div>
        <h2 className="text-base font-semibold text-white">Invalid reset link</h2>
        <p className="mt-2 text-sm text-slate-400">
          This link is missing its reset token. Please request a new password reset.
        </p>
        <Link
          href="/forgot-password"
          className="mt-5 block w-full rounded-lg bg-indigo-600 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Request New Link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mb-4 text-5xl">✅</div>
        <h2 className="text-base font-semibold text-white">Password reset</h2>
        <p className="mt-2 text-sm text-slate-400">Redirecting you to login…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">New password</label>
        <input
          type="password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="8+ characters, 1 uppercase, 1 number"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Confirm password</label>
        <input
          type="password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your new password"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>
      <button
        type="submit"
        disabled={submitting || !newPassword || !confirmPassword}
        className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Resetting…
          </span>
        ) : (
          'Reset Password'
        )}
      </button>
      <p className="text-center text-sm text-slate-500">
        Remembered it?{' '}
        <Link href="/login" className="text-indigo-400 hover:text-indigo-300 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-purple-600/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-3xl shadow-lg shadow-indigo-900/50">
            🔐
          </div>
          <h1 className="text-2xl font-bold text-white">Set a New Password</h1>
          <p className="mt-1 text-sm text-slate-400">Choose a strong password for your account</p>
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl">
          <Suspense>
            <ResetPasswordContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
