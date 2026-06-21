'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { setMemoryToken } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyStep {
  companyName: string;
  broker: string;
  city: string;
}

interface AccountStep {
  adminName: string;
  adminEmail: string;
  adminMobile: string;
  password: string;
  confirmPassword: string;
}

interface SignupResponse {
  success: boolean;
  token: string;
  user: { id: string; email: string; role: string; name: string; companyId: string };
  company: { companyId: string; companyName: string; plan: string; trialEndsAt: string };
}

// ── Broker options ────────────────────────────────────────────────────────────

const BROKERS = [
  { id: 'Angel One', label: 'Angel One' },
  { id: 'Zerodha',   label: 'Zerodha'   },
  { id: 'Motilal',   label: 'Motilal'   },
  { id: 'IIFL',      label: 'IIFL'      },
  { id: 'Kotak',     label: 'Kotak'     },
  { id: 'Other',     label: 'Other'     },
];

// ── Progress dots ─────────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {[1, 2].map((n) => (
        <div
          key={n}
          className={`h-2 rounded-full transition-all duration-300 ${
            n <= step ? 'w-8 bg-indigo-500' : 'w-2 bg-slate-700'
          }`}
        />
      ))}
    </div>
  );
}

// ── Password strength ─────────────────────────────────────────────────────────

function passwordStrength(p: string): { score: number; label: string; color: string } {
  let score = 0;
  if (p.length >= 8) score++;
  if (/[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  const levels = [
    { label: '', color: 'bg-slate-700' },
    { label: 'Weak', color: 'bg-rose-500' },
    { label: 'Fair', color: 'bg-amber-500' },
    { label: 'Good', color: 'bg-indigo-400' },
    { label: 'Strong', color: 'bg-emerald-500' },
  ];
  return { score, ...levels[score] };
}

// ── Input component ───────────────────────────────────────────────────────────

function Field({
  label, type = 'text', value, onChange, placeholder, prefix, error, autoComplete,
}: {
  label: string; type?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; prefix?: string; error?: string; autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-400 mb-1.5">{label}</label>
      <div className={`flex items-center rounded-xl border bg-slate-800/60 transition-colors
        ${error ? 'border-rose-500/60' : 'border-slate-700 focus-within:border-indigo-500'}`}>
        {prefix && (
          <span className="pl-3.5 pr-1 text-sm text-slate-500 select-none">{prefix}</span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="flex-1 min-w-0 bg-transparent px-3.5 py-3 text-sm text-white placeholder-slate-500
            outline-none rounded-xl"
        />
      </div>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  );
}

// ── Background blobs ──────────────────────────────────────────────────────────

function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-indigo-600/25 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [company, setCompany] = useState<CompanyStep>({ companyName: '', broker: '', city: '' });
  const [account, setAccount] = useState<AccountStep>({
    adminName: '', adminEmail: '', adminMobile: '', password: '', confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setC = useCallback((field: keyof CompanyStep) => (v: string) => {
    setCompany((prev) => ({ ...prev, [field]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }, []);

  const setA = useCallback((field: keyof AccountStep) => (v: string) => {
    setAccount((prev) => ({ ...prev, [field]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }, []);

  // ── Step 1 validation ────────────────────────────────────────────────────────

  function validateStep1() {
    const errs: Record<string, string> = {};
    if (company.companyName.trim().length < 2) errs.companyName = 'Enter your office / brand name';
    if (!company.broker) errs.broker = 'Select your broker / franchisor';
    if (company.city.trim().length < 2) errs.city = 'Enter your city';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Step 2 validation ────────────────────────────────────────────────────────

  function validateStep2() {
    const errs: Record<string, string> = {};
    if (account.adminName.trim().length < 2) errs.adminName = 'Enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.adminEmail)) errs.adminEmail = 'Enter a valid email';
    if (account.adminMobile && !/^\d{10}$/.test(account.adminMobile)) errs.adminMobile = 'Must be exactly 10 digits';
    if (account.password.length < 8) errs.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(account.password)) errs.password = 'Must include an uppercase letter';
    else if (!/[0-9]/.test(account.password)) errs.password = 'Must include a number';
    if (account.confirmPassword !== account.password) errs.confirmPassword = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!validateStep2()) return;
    setLoading(true);
    try {
      const res = await apiFetch<SignupResponse>('/api/auth/company-signup', {
        method: 'POST',
        body: JSON.stringify({
          companyName: company.companyName.trim(),
          broker: company.broker,
          city: company.city.trim(),
          adminName: account.adminName.trim(),
          adminEmail: account.adminEmail.trim().toLowerCase(),
          ...(account.adminMobile && { adminMobile: account.adminMobile }),
          password: account.password,
        }),
        retries: 0,
      });
      setMemoryToken(res.token);
      setStep(3);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const pwStrength = passwordStrength(account.password);

  // ── Success screen (step 3) ──────────────────────────────────────────────────

  if (step === 3) {
    return (
      <div className="min-h-dvh bg-slate-950 text-white flex flex-col items-center justify-center px-4">
        <Background />
        <div className="relative z-10 w-full max-w-sm">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-4xl">
              🎉
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">You&apos;re in!</h1>
            <p className="mt-2 text-slate-400 text-sm">
              Welcome to APForce, {account.adminName.split(' ')[0]}.<br />
              Your 14-day free trial has started.
            </p>
            <div className="mt-6 rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-4 text-left space-y-1">
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">What&apos;s next</p>
              {[
                { icon: '🎯', text: 'Set daily targets for your team' },
                { icon: '👥', text: 'Add your team members' },
                { icon: '📱', text: 'Bookmark APForce on your phone' },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2.5 text-sm text-slate-300">
                  <span>{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push('/onboarding')}
              className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white
                hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-indigo-900/40"
            >
              Set Up My Office →
            </button>
            <button
              onClick={() => router.push('/admin/dashboard')}
              className="mt-3 w-full rounded-xl py-2.5 text-sm text-slate-500 hover:text-slate-300 transition"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-white flex flex-col items-center justify-center px-4 py-8">
      <Background />

      <div className="relative z-10 w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-indigo-900/50">
              A
            </div>
            <span className="text-xl font-black tracking-tight text-white">APForce</span>
          </div>
          <p className="mt-2 text-sm text-slate-400">AP & Sub-Broker Performance Platform</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md p-7 shadow-2xl">
          <ProgressDots step={step} />

          {/* ── Step 1: Company / Office info ── */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-black text-white mb-1">Your AP Office</h2>
              <p className="text-xs text-slate-400 mb-6">Tell us about your sub-brokership / AP office</p>

              <div className="space-y-4">
                <Field
                  label="Office / Brand Name"
                  value={company.companyName}
                  onChange={setC('companyName')}
                  placeholder="e.g. Viir Trading"
                  autoComplete="organization"
                  error={errors.companyName}
                />

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-2">Broker / Franchisor</label>
                  <div className="flex flex-wrap gap-2">
                    {BROKERS.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { setC('broker')(b.id); setErrors((p) => { const n = { ...p }; delete n.broker; return n; }); }}
                        className={`rounded-lg px-3.5 py-2 text-sm font-semibold border transition-all ${
                          company.broker === b.id
                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                            : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200 bg-slate-800/50'
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                  {errors.broker && <p className="mt-1.5 text-xs text-rose-400">{errors.broker}</p>}
                </div>

                <Field
                  label="City"
                  value={company.city}
                  onChange={setC('city')}
                  placeholder="e.g. Mumbai"
                  autoComplete="address-level2"
                  error={errors.city}
                />
              </div>

              <button
                onClick={() => validateStep1() && setStep(2)}
                className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white
                  hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-indigo-900/40"
              >
                Continue →
              </button>
            </div>
          )}

          {/* ── Step 2: Admin account ── */}
          {step === 2 && (
            <div>
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mb-4 transition"
              >
                ← Back
              </button>
              <h2 className="text-lg font-black text-white mb-1">Your Account</h2>
              <p className="text-xs text-slate-400 mb-6">You&apos;ll be the admin for <strong className="text-slate-300">{company.companyName}</strong></p>

              <div className="space-y-4">
                <Field
                  label="Full Name"
                  value={account.adminName}
                  onChange={setA('adminName')}
                  placeholder="Your full name"
                  autoComplete="name"
                  error={errors.adminName}
                />
                <Field
                  label="Work Email"
                  type="email"
                  value={account.adminEmail}
                  onChange={setA('adminEmail')}
                  placeholder="you@youroffice.com"
                  autoComplete="email"
                  error={errors.adminEmail}
                />
                <Field
                  label="Mobile Number (optional)"
                  type="tel"
                  value={account.adminMobile}
                  onChange={setA('adminMobile')}
                  prefix="+91"
                  placeholder="10-digit number"
                  autoComplete="tel-national"
                  error={errors.adminMobile}
                />

                {/* Password with strength bar */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
                  <div className={`flex items-center rounded-xl border bg-slate-800/60 transition-colors
                    ${errors.password ? 'border-rose-500/60' : 'border-slate-700 focus-within:border-indigo-500'}`}>
                    <input
                      type="password"
                      value={account.password}
                      onChange={(e) => setA('password')(e.target.value)}
                      placeholder="Min 8 chars, uppercase + number"
                      autoComplete="new-password"
                      className="flex-1 bg-transparent px-3.5 py-3 text-sm text-white placeholder-slate-500 outline-none rounded-xl"
                    />
                  </div>
                  {account.password && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${pwStrength.color}`}
                          style={{ width: `${(pwStrength.score / 4) * 100}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-bold ${pwStrength.score >= 3 ? 'text-emerald-400' : pwStrength.score >= 2 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {pwStrength.label}
                      </span>
                    </div>
                  )}
                  {errors.password && <p className="mt-1 text-xs text-rose-400">{errors.password}</p>}
                </div>

                <Field
                  label="Confirm Password"
                  type="password"
                  value={account.confirmPassword}
                  onChange={setA('confirmPassword')}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  error={errors.confirmPassword}
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white
                  hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-indigo-900/40
                  disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating your account…' : 'Start Free Trial →'}
              </button>
            </div>
          )}

          {/* Trust strip */}
          <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-slate-600">
            <span>🔒 Secure</span>
            <span>•</span>
            <span>✅ 14-day free trial</span>
            <span>•</span>
            <span>❌ No credit card</span>
          </div>
        </div>

        <p className="mt-5 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="text-indigo-400 font-semibold hover:text-indigo-300 transition">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
