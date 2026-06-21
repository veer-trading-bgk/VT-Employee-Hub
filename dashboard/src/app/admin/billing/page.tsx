'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { useAuth } from '@/context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrialStatus {
  hasTrial: boolean;
  plan: string;
  planStatus: string;
  trialEndsAt?: string;
  daysLeft?: number | null;
  isExpired?: boolean;
  companyName?: string;
}

// ── Plan comparison ────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: 'Starter',
    price: 2499,
    description: 'For small AP offices (up to 10 members)',
    features: ['Up to 10 team members', 'All 9 metrics', 'Daily entry + verification', 'Leaderboard', 'Email support'],
  },
  {
    name: 'Growth',
    price: 4999,
    description: 'For growing offices (up to 30 members)',
    features: ['Up to 30 team members', 'Everything in Starter', 'Advanced analytics', 'Bulk entry tools', 'Priority support'],
    highlight: true,
  },
  {
    name: 'Pro',
    price: 7999,
    description: 'For large AP networks',
    features: ['Unlimited team members', 'Everything in Growth', 'Custom branding', 'API access', 'Dedicated support'],
  },
];

// ── Trial countdown ring ───────────────────────────────────────────────────────

function TrialRing({ daysLeft }: { daysLeft: number }) {
  const total = 14;
  const pct = Math.max(0, Math.min(daysLeft / total, 1));
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  const color = daysLeft > 7 ? '#6366f1' : daysLeft > 3 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative flex items-center justify-center w-28 h-28 mx-auto">
      <svg width="112" height="112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle
          cx="56" cy="56" r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-black text-white" style={{ color }}>{daysLeft}</span>
        <span className="text-[10px] font-bold text-slate-400">days left</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { user } = useAuth();

  const { data: trial, isLoading } = useQuery<TrialStatus>({
    queryKey: ['trial-status'],
    queryFn: () => apiFetch('/api/companies/trial'),
    enabled: !!user?.companyId,
    staleTime: 60_000 * 5,
  });

  const isOnTrial = trial?.hasTrial ?? true;
  const daysLeft  = trial?.daysLeft ?? 14;
  const isExpired = trial?.isExpired ?? false;

  return (
    <>
      <Navbar title="Billing & Plan" showBack />
      <div className="p-4 pb-24 md:p-8 md:pb-8 max-w-3xl">

        {/* Trial banner */}
        {isLoading ? <Loading /> : (
          <div className={`rounded-2xl p-6 mb-8 ${
            isExpired
              ? 'bg-rose-950/50 border border-rose-800'
              : 'bg-indigo-950/50 border border-indigo-800'
          }`}>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {isOnTrial && !isExpired && <TrialRing daysLeft={daysLeft ?? 14} />}
              {isExpired && <div className="text-5xl">⚠️</div>}

              <div className="flex-1 text-center sm:text-left">
                {isExpired ? (
                  <>
                    <h2 className="text-lg font-black text-rose-300">Trial Expired</h2>
                    <p className="text-sm text-rose-400 mt-1">
                      Your 14-day trial has ended. Upgrade to keep using APForce.
                    </p>
                  </>
                ) : isOnTrial ? (
                  <>
                    <h2 className="text-lg font-black text-white">Free Trial Active</h2>
                    <p className="text-sm text-slate-300 mt-1">
                      {daysLeft === 0
                        ? 'Your trial expires today!'
                        : `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining in your free trial.`}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Expires: {trial?.trialEndsAt ? new Date(trial.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-black text-emerald-300">Active Subscription</h2>
                    <p className="text-sm text-slate-300 mt-1">Plan: {trial?.plan}</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Plans */}
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Choose a Plan</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl border p-5 flex flex-col transition-all
                ${plan.highlight
                  ? 'border-indigo-500 bg-indigo-950/40 shadow-lg shadow-indigo-900/20'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-indigo-600 px-3 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider shadow">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h3 className={`font-black text-base ${plan.highlight ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                  {plan.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
              </div>

              <div className="mb-4">
                <span className={`text-3xl font-black tabular-nums ${plan.highlight ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                  ₹{plan.price.toLocaleString('en-IN')}
                </span>
                <span className="text-sm text-slate-400"> / month</span>
              </div>

              <ul className="space-y-2 flex-1 mb-5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-400">
                    <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              <button
                className={`w-full rounded-xl py-2.5 text-sm font-bold transition-all active:scale-[0.98]
                  ${plan.highlight
                    ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-900/30'
                    : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-600'
                  }`}
                onClick={() => alert('Razorpay integration coming soon! Contact support to upgrade.')}
              >
                {isOnTrial ? 'Upgrade Now' : 'Switch Plan'}
              </button>
            </div>
          ))}
        </div>

        {/* Coming soon notice */}
        <div className="mt-6 rounded-xl border border-amber-200/30 bg-amber-500/5 p-4 text-center">
          <p className="text-xs text-amber-400/80">
            💳 Online payments coming soon. To upgrade now, contact us at{' '}
            <a href="mailto:support@apforce.in" className="underline hover:text-amber-300">support@apforce.in</a>
          </p>
        </div>

        {/* Company info */}
        {user?.companyId && (
          <div className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Account Details</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Company ID</span>
                <span className="font-mono text-xs text-slate-400">{user.companyId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Admin Email</span>
                <span className="text-slate-300">{user.email}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
