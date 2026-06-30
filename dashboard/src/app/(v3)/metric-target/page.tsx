'use client';

import { useState, useEffect } from 'react';
import { Target } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { toast } from 'sonner';

type TargetPeriod = 'day' | 'month';
interface TargetEntry { target: number; targetPeriod: TargetPeriod; pointsWeight?: number; }
interface TargetsResponse { success: boolean; data: Record<string, TargetEntry>; isCustom: boolean; }

const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

export default function MetricTargetPage() {
  const qc = useQueryClient();
  const { metrics } = useMetricsConfig();
  const [form, setForm] = useState<Record<string, TargetEntry>>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (data?.data) {
      const merged: Record<string, TargetEntry> = {};
      metrics.forEach((m) => {
        const stored = data.data[m.key];
        merged[m.key] = {
          target:       stored?.target       ?? m.target,
          targetPeriod: (stored?.targetPeriod ?? m.targetPeriod) as TargetPeriod,
          pointsWeight: stored?.pointsWeight  ?? m.pointsWeight,
        };
      });
      setForm(merged);
      setDirty(false);
    }
  }, [data?.data, metrics]);

  const saveMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'PUT', body: JSON.stringify({ targets: form }) }),
    onSuccess: () => { toast.success('Targets saved'); setDirty(false); qc.invalidateQueries({ queryKey: ['admin-targets'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'DELETE' }),
    onSuccess: () => { toast.success('Targets reset to defaults'); qc.invalidateQueries({ queryKey: ['admin-targets'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rebuildMut = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; employeesUpdated: number }>('/api/admin/points-rebuild', { method: 'POST' }),
    onSuccess: (res) => toast.success(`Points rebuilt for ${res.employeesUpdated} employees`),
    onError: (e: Error) => toast.error(e.message),
  });

  function updateField(key: string, field: keyof TargetEntry, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [field]: field === 'targetPeriod' ? value : Number(value) } }));
    setDirty(true);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky page header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
            <Target className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Metric Targets</h1>
            <p className="text-xs text-neutral-500">Set daily or monthly targets · changes apply to all employees</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.isCustom && (
            <Button size="sm" variant="secondary" loading={resetMut.isPending}
              onClick={() => { if (confirm('Reset all targets to system defaults?')) resetMut.mutate(); }}>
              Reset to Defaults
            </Button>
          )}
          {data?.isCustom && (
            <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">
              Custom targets active
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {isLoading ? (
            <div className="space-y-2">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (
            <Card noPadding>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {metrics.map((m) => {
                  const entry = form[m.key];
                  if (!entry) return null;
                  return (
                    <li key={m.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <div className="flex w-44 items-center gap-2.5 shrink-0">
                        <span className="text-xl">{m.icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{m.label}</p>
                          <p className="text-xs text-neutral-400">{m.unit === 'currency' ? '₹ amount' : 'count'}</p>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-wrap items-end gap-3">
                        <div className="flex-1 min-w-24">
                          <label className="mb-1 block text-xs font-medium text-neutral-500">
                            Target ({entry.targetPeriod === 'day' ? 'per day' : 'per month'})
                          </label>
                          <input type="number" min={0} step={m.unit === 'currency' ? 1000 : 1}
                            value={entry.target} onChange={(e) => updateField(m.key, 'target', e.target.value)}
                            className={inputCls} />
                        </div>
                        <div className="w-32">
                          <label className="mb-1 block text-xs font-medium text-neutral-500">Period</label>
                          <select value={entry.targetPeriod}
                            onChange={(e) => updateField(m.key, 'targetPeriod', e.target.value)}
                            className={inputCls}>
                            <option value="day">Daily</option>
                            <option value="month">Monthly</option>
                          </select>
                        </div>
                        <div className="w-28">
                          <label className="mb-1 block text-xs font-medium text-neutral-500">Points Wt</label>
                          <input type="number" min={1} step={m.unit === 'currency' ? 1000 : 1}
                            value={entry.pointsWeight ?? m.pointsWeight}
                            onChange={(e) => updateField(m.key, 'pointsWeight', e.target.value)}
                            className={inputCls} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button loading={saveMut.isPending} disabled={!dirty} onClick={() => saveMut.mutate()}>
              Save Targets
            </Button>
            {dirty && <span className="text-xs text-warning-600">Unsaved changes</span>}
            <div className="ml-auto">
              <Button size="sm" variant="secondary" loading={rebuildMut.isPending}
                onClick={() => {
                  if (confirm('Recalculate ALL employee points from raw metric data?\nThis overwrites the Achievements leaderboard totals.'))
                    rebuildMut.mutate();
                }}>
                Rebuild Points
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
