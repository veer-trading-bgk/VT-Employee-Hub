'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';

type TargetPeriod = 'day' | 'month';

interface TargetEntry {
  target: number;
  targetPeriod: TargetPeriod;
  pointsWeight?: number;
}

interface TargetsResponse {
  success: boolean;
  data: Record<string, TargetEntry>;
  isCustom: boolean;
}

export default function AdminTargetsPage() {
  const qc = useQueryClient();
  const { metrics } = useMetricsConfig();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 1000 * 60 * 5,
  });

  const [form, setForm] = useState<Record<string, TargetEntry>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.data) {
      const merged: Record<string, TargetEntry> = {};
      metrics.forEach((m) => {
        const stored = data.data[m.key];
        merged[m.key] = {
          target: stored?.target ?? m.target,
          targetPeriod: (stored?.targetPeriod ?? m.targetPeriod) as TargetPeriod,
          pointsWeight: stored?.pointsWeight ?? m.pointsWeight,
        };
      });
      setForm(merged);
      setDirty(false);
    }
  }, [data?.data]);

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/targets', {
        method: 'PUT',
        body: JSON.stringify({ targets: form }),
      }),
    onSuccess: () => {
      toast.success('✅ Targets saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['admin-targets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: rebuildPoints, isPending: isRebuilding } = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; employeesUpdated: number }>('/api/admin/points-rebuild', { method: 'POST' }),
    onSuccess: (res) => toast.success(`Points rebuilt for ${res.employeesUpdated} employees`),
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: reset, isPending: isResetting } = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Targets reset to defaults');
      qc.invalidateQueries({ queryKey: ['admin-targets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateField = (key: string, field: 'target' | 'targetPeriod' | 'pointsWeight', value: string | number) => {
    setForm((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: field === 'targetPeriod' ? value : Number(value) },
    }));
    setDirty(true);
  };

  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ' +
    'dark:border-slate-700 dark:bg-slate-800 dark:text-white';

  return (
    <>
      <Navbar title="Metric Targets" showBack />
      <div className="space-y-6 p-4 md:p-8 max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Metric Targets</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Set daily or monthly targets for each metric. Changes apply to all employees.
            </p>
            {data?.isCustom && (
              <span className="mt-1.5 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                Custom targets active
              </span>
            )}
          </div>
          {data?.isCustom && (
            <button
              onClick={() => {
                if (confirm('Reset all targets to system defaults?')) reset();
              }}
              disabled={isResetting}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/20"
            >
              {isResetting ? '⏳ Resetting…' : '↺ Reset to Defaults'}
            </button>
          )}
        </div>

        {isLoading ? (
          <Loading />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {metrics.map((m) => {
              const entry = form[m.key];
              if (!entry) return null; // Should never happen after merge, but keeps TS happy
              return (
                <div key={m.key} className="flex flex-wrap items-center gap-4 p-4">
                  <div className="flex w-48 items-center gap-2 flex-shrink-0">
                    <span className="text-xl">{m.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{m.label}</p>
                      <p className="text-xs text-slate-400">{m.unit === 'currency' ? '₹ amount' : 'count'}</p>
                    </div>
                  </div>

                  <div className="flex flex-1 items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Target ({entry.targetPeriod === 'day' ? 'per day' : 'per month'})
                      </label>
                      <input
                        type="number"
                        min="0"
                        step={m.unit === 'currency' ? '1000' : '1'}
                        value={entry.target}
                        onChange={(e) => updateField(m.key, 'target', e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="w-36">
                      <label className="block text-xs font-medium text-slate-500 mb-1">Period</label>
                      <select
                        value={entry.targetPeriod}
                        onChange={(e) => updateField(m.key, 'targetPeriod', e.target.value)}
                        className={inputCls}
                      >
                        <option value="day">Daily</option>
                        <option value="month">Monthly</option>
                      </select>
                    </div>
                    <div className="w-32">
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Points Wt
                      </label>
                      <input
                        type="number"
                        min="1"
                        step={m.unit === 'currency' ? '1000' : '1'}
                        value={entry.pointsWeight ?? m.pointsWeight}
                        onChange={(e) => updateField(m.key, 'pointsWeight', e.target.value)}
                        className={inputCls}
                      />
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {m.unit === 'currency'
                          ? `÷${(entry.pointsWeight ?? m.pointsWeight).toLocaleString('en-IN')} = 1 pt`
                          : `×${entry.pointsWeight ?? m.pointsWeight} pts each`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => save()}
              disabled={isSaving || !dirty}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSaving ? '⏳ Saving…' : '💾 Save Targets'}
            </button>
            {dirty && (
              <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
            )}
            <div className="ml-auto">
              <button
                onClick={() => {
                  if (confirm('Recalculate ALL employee points from raw metric data using current point weights?\n\nThis overwrites the Achievements leaderboard totals.')) {
                    rebuildPoints();
                  }
                }}
                disabled={isRebuilding}
                className="rounded-lg border border-violet-200 px-4 py-2 text-sm font-medium text-violet-600 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950/20"
              >
                {isRebuilding ? '⏳ Rebuilding…' : '🔄 Rebuild Points'}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">How targets work</p>
          <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
            <li>• Daily targets are shown directly on employee cards.</li>
            <li>• Monthly targets are divided by 30 to derive the daily figure shown to employees.</li>
            <li>• <strong>Points Wt</strong>: count metrics earn <code>value × weight</code> pts; currency metrics earn <code>value ÷ weight</code> pts.</li>
            <li>• Leaderboard and progress bars update immediately after saving.</li>
            <li>• Use Reset to Defaults to go back to the original system targets.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
