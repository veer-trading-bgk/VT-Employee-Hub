'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import { useAuth, TotpChallenge } from '@/context/AuthContext';
import Link from 'next/link';

type Step = 'credentials' | 'totp' | 'backup';

// ── Shared background ────────────────────────────────────────────────────────
function Background() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-purple-600/20 blur-3xl" />
      <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-3xl" />
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { id: 'credentials', label: 'Password' },
    { id: 'totp', label: '2FA Code' },
  ];
  const activeIdx = step === 'backup' ? 1 : steps.findIndex((s) => s.id === step);

  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
            i <= activeIdx ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'
          }`}>
            {i < activeIdx ? '✓' : i + 1}
          </div>
          <span className={`text-xs ${i <= activeIdx ? 'text-slate-300' : 'text-slate-500'}`}>{s.label}</span>
          {i < steps.length - 1 && <div className={`h-px w-6 ${i < activeIdx ? 'bg-indigo-600' : 'bg-slate-700'}`} />}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Credentials ───────────────────────────────────────────────────────
function CredentialsStep({
  onSuccess,
}: {
  onSuccess: (challenge: TotpChallenge | null) => void;
}) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const challenge = await login(email, password);
      onSuccess(challenge);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-300">Email address</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@viirtrading.com"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-300">Password</label>
          <Link href="/forgot-password" className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 pr-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? '🙈' : '👁️'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-3">
          <span className="mt-0.5 text-rose-400">⚠️</span>
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !email || !password}
        className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Signing in…
          </span>
        ) : (
          'Sign in'
        )}
      </button>

    </form>
  );
}

// ── Step 2: TOTP code ─────────────────────────────────────────────────────────
function TotpStep({
  challenge,
  onBackupCode,
  onBack,
}: {
  challenge: TotpChallenge;
  onBackupCode: () => void;
  onBack: () => void;
}) {
  const { verifyTotp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleChange = async (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError(null);
    if (digits.length === 6) {
      await submit(digits);
    }
  };

  const submit = async (digits: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await verifyTotp(challenge, digits);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid code';
      if (msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('locked')) {
        setLockedOut(true);
      }
      setError(msg);
      setCode('');
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600/20 text-2xl">
          🔐
        </div>
        <h2 className="text-base font-semibold text-white">Authenticator code</h2>
        <p className="mt-1 text-sm text-slate-400">Open Google Authenticator or Authy and enter the 6-digit code</p>
      </div>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => handleChange(e.target.value)}
        disabled={submitting || lockedOut}
        placeholder="000000"
        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-4 text-center text-2xl font-mono tracking-[0.2em] text-white placeholder-slate-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 sm:text-3xl sm:tracking-[0.4em]"
        autoComplete="one-time-code"
      />

      {submitting && (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-500" />
          Verifying…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-3">
          <span className="mt-0.5 text-rose-400">⚠️</span>
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      {lockedOut && (
        <p className="text-center text-xs text-slate-500">
          Contact your admin if you need immediate access.
        </p>
      )}

      <div className="flex flex-col items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onBackupCode}
          disabled={lockedOut}
          className="text-sm text-indigo-400 hover:text-indigo-300 hover:underline disabled:opacity-40"
        >
          Use backup code instead?
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-400"
        >
          ← Back to login
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Backup code ───────────────────────────────────────────────────────
function BackupStep({
  tempToken,
  email,
  onBack,
}: {
  tempToken: string;
  email: string;
  onBack: () => void;
}) {
  const { verifyBackupCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyBackupCode(tempToken, email, code.toUpperCase().replace(/\s/g, ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-600/20 text-2xl">
          🔑
        </div>
        <h2 className="text-base font-semibold text-white">Backup code</h2>
        <p className="mt-1 text-sm text-slate-400">Enter one of your 8-character backup codes</p>
      </div>

      <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-3 text-xs text-amber-300">
        ⚠️ Each backup code can only be used once. Request new codes from your admin when running low.
      </div>

      <input
        ref={inputRef}
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        maxLength={8}
        placeholder="ABC12345"
        autoComplete="off"
        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-4 text-center text-2xl font-mono tracking-[0.3em] text-white placeholder-slate-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
      />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-3">
          <span className="mt-0.5 text-rose-400">⚠️</span>
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || code.length !== 8}
        className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Verifying…
          </span>
        ) : (
          'Verify backup code'
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center justify-center text-sm text-slate-400 hover:text-slate-300"
      >
        ← Back to authenticator code
      </button>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const [step, setStep] = useState<Step>('credentials');
  const [challenge, setChallenge] = useState<TotpChallenge | null>(null);

  const handleCredentialsSuccess = (ch: TotpChallenge | null) => {
    if (ch) {
      setChallenge(ch);
      setStep('totp');
    }
    // If ch is null, AuthContext already navigated to /dashboard
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4">
      <Background />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-3xl font-black text-white shadow-lg shadow-indigo-900/50">
            A
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">APForce</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your office</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-xl">
          {step !== 'credentials' && <StepIndicator step={step} />}

          {step === 'credentials' && (
            <CredentialsStep onSuccess={handleCredentialsSuccess} />
          )}

          {step === 'totp' && challenge && (
            <TotpStep
              challenge={challenge}
              onBackupCode={() => setStep('backup')}
              onBack={() => { setStep('credentials'); setChallenge(null); }}
            />
          )}

          {step === 'backup' && challenge && (
            <BackupStep
              tempToken={challenge.tempToken}
              email={challenge.email}
              onBack={() => setStep('totp')}
            />
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          New AP office?{' '}
          <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 font-semibold transition">
            Start free trial →
          </Link>
        </p>
      </div>
    </div>
  );
}
