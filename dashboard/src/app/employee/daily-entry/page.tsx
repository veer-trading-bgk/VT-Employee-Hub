'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { MetricCard } from '@/components/ui/MetricCard';
import { apiFetch } from '@/lib/api';
import { METRICS, dailyTarget } from '@/lib/metrics.config';
import type { MyMetricsResponse, VerificationStatus } from '@/types';

const TODAY     = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 864e5).toISOString().split('T')[0];

// Visual grouping — drives section headers only, no logic change
const GROUPS = [
  { label: 'Core Metrics',    keys: ['kyc', 'demat', 'mf', 'insurance', 'algo', 'coaching'] },
  { label: 'Matrix Products', keys: ['pms', 'pro_insight', 'ltpp'] },
];

export default function DailyEntryPage() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  // correction: null = not correcting; string = correction input value for that key
  const [correcting, setCorrecting] = useState<Record<string, string | null>>({});

  const enterCorrection = (key: string, currentValue: number) =>
    setCorrecting((prev) => ({ ...prev, [key]: String(currentValue) }));
  const cancelCorrection = (key: string) =>
    setCorrecting((prev) => ({ ...prev, [key]: null }));

  const { data, isLoading } = useQuery({
    queryKey: ['my-metrics-entry'],
    queryFn: () => apiFetch<MyMetricsResponse>('/api/metrics/my?days=2'),
    staleTime: 60_000,
  });

  const todayData     = data?.data?.[TODAY]       ?? {};
  const yesterdayData = data?.data?.[YESTERDAY]  ?? {};
  const apiTargets    = data?.targets             ?? {};
  const todayStatus   = data?.statuses?.[TODAY]   ?? {};

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const toSave = METRICS.filter((m) => parseInt(values[m.key] ?? '0') > 0);
      if (toSave.length === 0) throw new Error('Enter at least one value');
      await Promise.all(
        toSave.map((m) =>
          apiFetch('/api/metrics/add', {
            method: 'POST',
            body: JSON.stringify({
              metric_type: m.key,
              value: parseInt(values[m.key]),
              date: TODAY,
            }),
          })
        )
      );
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['my-metrics-entry'] });
      const previous = qc.getQueryData<MyMetricsResponse>(['my-metrics-entry']);
      qc.setQueryData<MyMetricsResponse>(['my-metrics-entry'], (old) => {
        if (!old) return old;
        const today = { ...(old.data[TODAY] ?? {}) };
        METRICS.forEach((m) => {
          const v = parseInt(values[m.key] ?? '0');
          if (v > 0) today[m.key] = (today[m.key] ?? 0) + v;
        });
        return { ...old, data: { ...old.data, [TODAY]: today } };
      });
      return { previous };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['my-metrics-entry'], ctx.previous);
      toast.error(err.message);
    },
    onSuccess: () => {
      toast.success('Metrics saved!');
      setValues({});
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-metrics-entry'] });
      qc.invalidateQueries({ queryKey: ['my-metrics-30'] });
    },
  });

  const { mutate: correct, isPending: isCorrecting } = useMutation({
    mutationFn: ({ key, newValue }: { key: string; newValue: number }) =>
      apiFetch('/api/metrics/set', {
        method: 'PUT',
        body: JSON.stringify({ metric_type: key, value: newValue }),
      }),
    onMutate: async ({ key, newValue }) => {
      await qc.cancelQueries({ queryKey: ['my-metrics-entry'] });
      const previous = qc.getQueryData<MyMetricsResponse>(['my-metrics-entry']);
      qc.setQueryData<MyMetricsResponse>(['my-metrics-entry'], (old) => {
        if (!old) return old;
        const today = { ...(old.data[TODAY] ?? {}), [key]: newValue };
        return { ...old, data: { ...old.data, [TODAY]: today } };
      });
      return { previous };
    },
    onError: (err: Error, { key }, ctx) => {
      if (ctx?.previous) qc.setQueryData(['my-metrics-entry'], ctx.previous);
      toast.error(err.message);
      setCorrecting((prev) => ({ ...prev, [key]: null }));
    },
    onSuccess: (_res, { key }) => {
      toast.success('Value corrected!');
      setCorrecting((prev) => ({ ...prev, [key]: null }));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['my-metrics-entry'] });
      qc.invalidateQueries({ queryKey: ['my-metrics-30'] });
    },
  });

  const hasAnyValue = METRICS.some((m) => parseInt(values[m.key] ?? '0') > 0);

  return (
    <>
      <Navbar title="Daily Entry" showBack />
      <div className="p-4 pb-24 md:p-8 md:pb-8 max-w-3xl">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Today's Entry
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{TODAY}</p>
        </div>

        {isLoading ? (
          <Loading />
        ) : (
          <div className="space-y-6">
            {GROUPS.map((group) => {
              const groupMetrics = METRICS.filter((m) => group.keys.includes(m.key));
              return (
                <section key={group.label}>
                  {/* Section header */}
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    {group.label}
                  </h2>

                  {/* Compact grid — 3 cols desktop, 2 cols mobile */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {groupMetrics.map((m) => {
                      const logged    = todayData[m.key]     ?? 0;
                      const yest      = yesterdayData[m.key] ?? 0;
                      // Prefer API-returned target (reflects backend config);
                      // fall back to frontend config for new metrics
                      const target    = (apiTargets[m.key] as number) ?? dailyTarget(m);
                      const progress  = target > 0 ? Math.min(Math.round((logged / target) * 100), 999) : 0;

                      const inCorrection = correcting[m.key] !== undefined && correcting[m.key] !== null;
                      return (
                        <MetricCard
                          key={m.key}
                          metric={m}
                          value={logged}
                          target={target}
                          progress={progress}
                          yesterday={yest}
                          verificationStatus={todayStatus[m.key] as VerificationStatus | undefined}
                          // Add mode
                          inputValue={inCorrection ? undefined : (values[m.key] ?? '')}
                          onInputChange={inCorrection ? undefined : (v) => setValues((prev) => ({ ...prev, [m.key]: v }))}
                          onFixClick={inCorrection ? undefined : () => enterCorrection(m.key, logged)}
                          // Correction mode
                          correctionValue={inCorrection ? (correcting[m.key] ?? '') : undefined}
                          onCorrectionChange={inCorrection ? (v) => setCorrecting((prev) => ({ ...prev, [m.key]: v })) : undefined}
                          onCorrectionSave={inCorrection ? () => {
                            const v = parseFloat(correcting[m.key] ?? '');
                            if (isNaN(v) || v < 0) { toast.error('Enter a valid number'); return; }
                            correct({ key: m.key, newValue: v });
                          } : undefined}
                          onCorrectionCancel={inCorrection ? () => cancelCorrection(m.key) : undefined}
                          disabled={isPending || isCorrecting}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {/* Save button — sticky on mobile */}
            <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2 pt-3 md:static md:bottom-auto md:px-0 md:pb-0 md:pt-0">
              <div className="md:hidden absolute inset-0 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-slate-950 dark:via-slate-950/90 pointer-events-none -z-10" />
              <button
                onClick={() => save()}
                disabled={isPending || !hasAnyValue}
                className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white shadow-lg
                  hover:bg-indigo-700 active:scale-[0.98] transition-all
                  disabled:cursor-not-allowed disabled:opacity-40
                  md:rounded-lg md:shadow-none"
              >
                {isPending ? '⏳ Saving…' : '✅ Save Today\'s Metrics'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
