'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS, dailyTarget, formatMetricValue } from '@/lib/metrics.config';

interface TeamMember {
  id: string;
  name: string;
  email: string;
}

interface AddForMemberResponse {
  success: boolean;
  data: { metric_type: string; value: number; total: number; date: string };
}

const TODAY = new Date().toISOString().split('T')[0];

const GROUPS = [
  { label: 'Core Metrics',    keys: ['kyc', 'demat', 'mf', 'insurance', 'algo', 'coaching'] },
  { label: 'Matrix Products', keys: ['pms', 'pro_insight', 'ltpp'] },
];

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ' +
  'dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export default function TLAddEntryPage() {
  const qc = useQueryClient();
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [entryDate, setEntryDate] = useState(TODAY);
  const [values, setValues] = useState<Record<string, string>>({});

  // Fetch TL's assigned team
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['tl-my-team'],
    queryFn: () => apiFetch<{ success: boolean; data: TeamMember[] }>('/api/metrics/my-team'),
    staleTime: 5 * 60 * 1000,
  });

  const teamMembers = teamData?.data ?? [];
  const hasAnyValue = METRICS.some((m) => parseInt(values[m.key] ?? '0') > 0);

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async () => {
      if (!selectedMember) throw new Error('Select a team member first');
      const toSave = METRICS.filter((m) => parseInt(values[m.key] ?? '0') > 0);
      if (toSave.length === 0) throw new Error('Enter at least one value');

      await Promise.all(
        toSave.map((m) =>
          apiFetch<AddForMemberResponse>('/api/metrics/add-for-member', {
            method: 'POST',
            body: JSON.stringify({
              targetUserId: selectedMember.id,
              metric_type: m.key,
              value: parseInt(values[m.key]),
              date: entryDate,
            }),
          })
        )
      );
    },
    onSuccess: () => {
      toast.success(`Metrics saved for ${selectedMember?.name}`);
      setValues({});
      qc.invalidateQueries({ queryKey: ['team-lead-team-summary'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Navbar title="Add Entry for Team" showBack />
      <div className="p-4 pb-28 md:p-8 md:pb-8 max-w-3xl">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Add Entry for Team Member</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Log metrics on behalf of someone in your team
          </p>
        </div>

        {teamLoading ? (
          <Loading />
        ) : teamMembers.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900/50 dark:bg-amber-950/20">
            <p className="text-2xl mb-2">👥</p>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">No team members assigned yet</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Ask an admin to assign performers to you in the Employee Directory.
            </p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Step 1 — Select team member */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Step 1 — Select Team Member
              </p>

              {/* Member grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {teamMembers.map((m) => {
                  const active = selectedMember?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedMember(m);
                        setValues({});
                      }}
                      className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all ${
                        active
                          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30'
                          : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-indigo-800 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${active ? 'bg-indigo-600' : 'bg-slate-400 dark:bg-slate-600'}`}>
                        {m.name?.[0]?.toUpperCase() ?? '?'}
                      </span>
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-semibold ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-white'}`}>
                          {m.name}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">{m.email.split('@')[0]}</p>
                      </div>
                      {active && <span className="ml-auto shrink-0 text-indigo-500">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2 — Date + Metrics (shown only after selecting member) */}
            {selectedMember && (
              <>
                {/* Date selector */}
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex-1">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                      Step 2 — Select Date
                    </p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      Logging for: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{selectedMember.name}</span>
                    </p>
                  </div>
                  <input
                    type="date"
                    value={entryDate}
                    max={TODAY}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                {/* Step 3 — Metric values */}
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Step 3 — Enter Metrics
                  </p>

                  <div className="space-y-4">
                    {GROUPS.map((group) => {
                      const groupMetrics = METRICS.filter((m) => group.keys.includes(m.key));
                      return (
                        <section key={group.label}>
                          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                            {group.label}
                          </h2>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {groupMetrics.map((m) => {
                              const raw = parseInt(values[m.key] ?? '0');
                              const val = isNaN(raw) ? 0 : raw;
                              const target = dailyTarget(m);
                              const progress = target > 0 ? Math.min(Math.round((val / target) * 100), 100) : 0;
                              const hasVal = val > 0;
                              return (
                                <div
                                  key={m.key}
                                  className={`rounded-xl border bg-white p-4 transition-all dark:bg-slate-900 ${
                                    hasVal
                                      ? 'border-indigo-200 shadow-sm dark:border-indigo-800'
                                      : 'border-slate-200 dark:border-slate-800'
                                  }`}
                                >
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-lg leading-none">{m.icon}</span>
                                    <span className={`text-[10px] font-bold tabular-nums ${hasVal ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
                                      {progress}%
                                    </span>
                                  </div>
                                  <p className="mb-2 text-[11px] font-semibold leading-tight text-slate-500 dark:text-slate-400">
                                    {m.label}
                                  </p>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    placeholder="0"
                                    value={values[m.key] ?? ''}
                                    onChange={(e) =>
                                      setValues((prev) => ({ ...prev, [m.key]: e.target.value }))
                                    }
                                    disabled={isPending}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm font-medium text-slate-900 placeholder-slate-300 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-600 dark:focus:border-indigo-500 dark:focus:bg-slate-900"
                                  />
                                  <p className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <span
                                      className="block h-full rounded-full bg-indigo-500 transition-all duration-300"
                                      style={{ width: `${progress}%` }}
                                    />
                                  </p>
                                  <p className="mt-1 text-[10px] text-slate-400">
                                    target:{' '}
                                    {target < 1 ? target.toFixed(1) : formatMetricValue(m, Math.round(target))}/day
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Save button — sticky on mobile */}
            {selectedMember && (
              <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2 pt-3 md:static md:bottom-auto md:px-0 md:pb-0 md:pt-0">
                <div className="md:hidden absolute inset-0 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-slate-950 dark:via-slate-950/90 pointer-events-none -z-10" />
                <button
                  onClick={() => submit()}
                  disabled={isPending || !hasAnyValue}
                  className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-40 md:rounded-lg md:shadow-none"
                >
                  {isPending
                    ? '⏳ Saving…'
                    : `✅ Save Entry for ${selectedMember.name}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
