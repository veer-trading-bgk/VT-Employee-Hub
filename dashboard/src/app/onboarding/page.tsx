'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { METRICS } from '@/lib/metrics.config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TargetEntry { target: number; targetPeriod: 'day' | 'month' }

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepBar({ step }: { step: number }) {
  const steps = ['Set Targets', 'Invite Team', 'Go Live'];
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center">
          <div className={`h-1 w-full ${i === 0 ? 'rounded-l-full' : i === steps.length - 1 ? 'rounded-r-full' : ''}
            transition-all duration-500 ${i < step ? 'bg-indigo-500' : i === step ? 'bg-indigo-300' : 'bg-slate-800'}`} />
          <span className={`mt-2 text-[10px] font-semibold ${i <= step ? 'text-indigo-400' : 'text-slate-600'}`}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Background ────────────────────────────────────────────────────────────────

function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-40 left-0 h-72 w-72 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-violet-600/15 blur-3xl" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);

  // ── Step 0: Set targets ───────────────────────────────────────────────────────

  const [targets, setTargets] = useState<Record<string, TargetEntry>>(() => {
    const t: Record<string, TargetEntry> = {};
    METRICS.forEach((m) => {
      t[m.key] = { target: m.target, targetPeriod: m.targetPeriod };
    });
    return t;
  });

  const { data: savedTargets } = useQuery({
    queryKey: ['targets'],
    queryFn: () => apiFetch<{ success: boolean; data: Record<string, TargetEntry>; isCustom: boolean }>('/api/admin/targets'),
    enabled: !!user,
  });

  useEffect(() => {
    if (savedTargets?.isCustom && Object.keys(savedTargets.data).length > 0) {
      setTargets(savedTargets.data);
    }
  }, [savedTargets]);

  const { mutate: saveTargets, isPending: savingTargets } = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', {
      method: 'PUT',
      body: JSON.stringify({ targets }),
    }),
    onSuccess: () => { toast.success('Targets saved!'); setStep(1); },
    onError: () => toast.error('Failed to save targets'),
  });

  // ── Step 1: Invite team (skip-capable) ────────────────────────────────────────

  // ── Step 2: Go live ───────────────────────────────────────────────────────────

  // Allow admins to bookmark / PWA install as the final step

  if (step === 2) {
    return (
      <div className="min-h-dvh bg-slate-950 text-white flex items-center justify-center px-4">
        <Background />
        <div className="relative z-10 w-full max-w-sm text-center">
          <div className="text-6xl mb-5">🚀</div>
          <h1 className="text-2xl font-black text-white">You&apos;re live!</h1>
          <p className="mt-2 text-slate-400 text-sm">
            APForce is ready. Add it to your home screen for instant access.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 text-left space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Add to Home Screen</p>
            <div className="space-y-2 text-sm text-slate-300">
              <p><strong className="text-white">Android:</strong> Chrome menu → &quot;Add to Home screen&quot;</p>
              <p><strong className="text-white">iPhone:</strong> Safari → Share → &quot;Add to Home Screen&quot;</p>
            </div>
          </div>

          <button
            onClick={() => router.push('/admin/dashboard')}
            className="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white
              hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-indigo-900/40"
          >
            Go to Dashboard →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-white px-4 py-8">
      <Background />

      <div className="relative z-10 max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="h-8 w-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black shadow-lg shadow-indigo-900/50">
              A
            </div>
            <span className="text-lg font-black tracking-tight text-white">APForce</span>
          </div>
          <h1 className="text-xl font-black text-white">Set up your office</h1>
          <p className="text-sm text-slate-400 mt-1">Takes about 2 minutes</p>
        </div>

        <StepBar step={step} />

        {/* ── Step 0: Targets ── */}
        {step === 0 && (
          <div>
            <h2 className="text-base font-bold text-white mb-1">Daily Targets</h2>
            <p className="text-xs text-slate-400 mb-5">
              Set the daily target for each metric. Your team will be tracked against these numbers.
            </p>

            <div className="space-y-3">
              {METRICS.map((m) => (
                <div
                  key={m.key}
                  className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
                    style={{ backgroundColor: `${m.color}18` }}
                  >
                    {m.icon}
                  </div>
                  <span className="flex-1 text-sm font-medium text-slate-300">{m.label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={targets[m.key]?.target ?? 1}
                      onChange={(e) => setTargets((prev) => ({
                        ...prev,
                        [m.key]: { ...prev[m.key], target: parseFloat(e.target.value) || 0 },
                      }))}
                      className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5
                        text-center text-sm font-bold text-white outline-none focus:border-indigo-500
                        transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <select
                      value={targets[m.key]?.targetPeriod ?? 'day'}
                      onChange={(e) => setTargets((prev) => ({
                        ...prev,
                        [m.key]: { ...prev[m.key], targetPeriod: e.target.value as 'day' | 'month' },
                      }))}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs
                        text-slate-400 outline-none focus:border-indigo-500 transition-colors"
                    >
                      <option value="day">/ day</option>
                      <option value="month">/ month</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-xl border border-slate-700 py-3 text-sm text-slate-400
                  hover:text-slate-200 hover:border-slate-600 transition-all"
              >
                Skip for now
              </button>
              <button
                onClick={() => saveTargets()}
                disabled={savingTargets}
                className="flex-[2] rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white
                  hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-indigo-900/40
                  disabled:opacity-60"
              >
                {savingTargets ? 'Saving…' : 'Save & Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Invite team ── */}
        {step === 1 && (
          <div className="text-center">
            <div className="text-5xl mb-5">👥</div>
            <h2 className="text-base font-bold text-white mb-2">Add Your Team</h2>
            <p className="text-sm text-slate-400 mb-6">
              Add agents, telecallers, and managers from the Employees page. You can do this anytime.
            </p>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 mb-6 text-left space-y-2">
              {[
                { role: 'Agent', desc: 'Can log and view own metrics' },
                { role: 'Telecaller', desc: 'Same as agent, different label' },
                { role: 'Manager', desc: 'Can view team, bulk-enter' },
                { role: 'Team Lead', desc: 'Can enter for assigned team' },
              ].map(({ role, desc }) => (
                <div key={role} className="flex items-start gap-3">
                  <div className="h-5 w-5 shrink-0 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold mt-0.5">
                    ✓
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{role}</p>
                    <p className="text-xs text-slate-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 rounded-xl border border-slate-700 py-3 text-sm text-slate-400
                  hover:text-slate-200 hover:border-slate-600 transition-all"
              >
                Skip
              </button>
              <button
                onClick={() => router.push('/admin/employees')}
                className="flex-[2] rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white
                  hover:bg-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-indigo-900/40"
              >
                Add Employees →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
