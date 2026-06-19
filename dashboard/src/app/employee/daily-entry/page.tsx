'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { METRICS } from '@/lib/metrics.config';

interface MyMetricsResponse {
  data: Record<string, Record<string, number>>;
  targets: Record<string, number>;
}

const TODAY = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 864e5).toISOString().split('T')[0];

export default function DailyEntryPage() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['my-metrics-entry'],
    queryFn: () => apiFetch<MyMetricsResponse>('/api/metrics/my?days=2'),
    staleTime: 1000 * 60,
  });

  const todayData = data?.data?.[TODAY] ?? {};
  const yesterdayData = data?.data?.[YESTERDAY] ?? {};
  const targets = data?.targets ?? {};

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const toSave = METRICS.filter((m) => {
        const v = parseInt(values[m.key] ?? '0');
        return v > 0;
      });
      if (toSave.length === 0) throw new Error('Enter at least one metric value');
      await Promise.all(
        toSave.map((m) =>
          apiFetch('/api/metrics/add', {
            method: 'POST',
            body: JSON.stringify({ metric_type: m.key, value: parseInt(values[m.key] ?? '0'), date: TODAY, notes }),
          })
        )
      );
    },
    onSuccess: () => {
      toast.success('Metrics saved for today!');
      setValues({});
      setNotes('');
      qc.invalidateQueries({ queryKey: ['my-metrics-entry'] });
      qc.invalidateQueries({ queryKey: ['my-metrics'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Navbar title="Daily Metrics Entry" showBack />
      <div className="space-y-6 p-4 md:p-8 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Daily Entry</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Log your metrics for today — {TODAY}
          </p>
        </div>

        {/* Yesterday snapshot */}
        {Object.keys(yesterdayData).length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">
              Yesterday's Entries
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {METRICS.slice(0, 4).map((m) => (
                <div key={m.key} className="text-center">
                  <p className="text-xs text-slate-500">{m.icon} {m.label}</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">
                    {yesterdayData[m.key] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Entry form */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
            Enter Today's Numbers
          </h2>
          {isLoading ? (
            <Loading size="sm" />
          ) : (
            <div className="space-y-4">
              {METRICS.map((m) => {
                const target = targets[m.key] ?? 0;
                const existing = todayData[m.key] ?? 0;
                return (
                  <div key={m.key} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{m.icon}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{m.label}</p>
                          <p className="text-xs text-slate-500">Daily target: {target}</p>
                        </div>
                      </div>
                      {existing > 0 && (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          ✅ {existing} logged
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      min="0"
                      placeholder={existing > 0 ? `Add more (${existing} already logged)` : 'Enter value…'}
                      value={values[m.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                );
              })}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes about today's activity…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
          )}

          <button
            onClick={() => save()}
            disabled={isPending || isLoading}
            className="mt-5 w-full rounded-lg bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {isPending ? '⏳ Saving…' : '✅ Save Today\'s Metrics'}
          </button>
        </div>
      </div>
    </>
  );
}
