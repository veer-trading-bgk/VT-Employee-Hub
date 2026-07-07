'use client';

import { useState, useEffect } from 'react';
import { Target, RotateCcw, Zap, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

type TargetPeriod = 'day' | 'month';
interface TargetEntry { target: number; targetPeriod: TargetPeriod; pointsWeight?: number; }
interface TargetsResponse { success: boolean; data: Record<string, TargetEntry>; isCustom: boolean; }

const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm transition focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

function MetricTargetPageInner() {
  const qc = useQueryClient();
  const { metrics } = useMetricsConfig();
  const [form, setForm] = useState<Record<string, TargetEntry>>({});
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 5 * 60_000,
  });

  // Only re-run when server data changes — metrics is excluded because
  // useMetricsConfig returns a new array reference on every render (.map()),
  // including metrics in deps would cause an infinite setForm → re-render loop.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.data]);

  const saveMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'PUT', body: JSON.stringify({ targets: form }) }),
    onSuccess: () => {
      toast.success('Targets saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['admin-targets'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Targets reset to defaults');
      setConfirmReset(false);
      qc.invalidateQueries({ queryKey: ['admin-targets'] });
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmReset(false); },
  });

  const rebuildMut = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; employeesUpdated: number }>('/api/admin/points-rebuild', { method: 'POST' }),
    onSuccess: (res) => {
      toast.success(`Points rebuilt for ${res.employeesUpdated} employees`);
      setConfirmRebuild(false);
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmRebuild(false); },
  });

  function updateField(key: string, field: keyof TargetEntry, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [field]: field === 'targetPeriod' ? value : Number(value) } }));
    setDirty(true);
  }

  const formReady = Object.keys(form).length > 0;

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
        {data?.isCustom && (
          <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">
            Custom targets active
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">

          {/* Error state */}
          {isError && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-error-200 bg-error-50 py-10 text-center dark:border-error-800/40 dark:bg-error-900/20">
              <p className="text-sm font-semibold text-error-700 dark:text-error-300">Failed to load targets</p>
              <Button size="sm" variant="secondary" onClick={() => refetch()}>Retry</Button>
            </div>
          )}

          {/* Metrics list */}
          {!isError && (
            <>
              {isLoading ? (
                <div className="space-y-2">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
              ) : (
                <Card noPadding>
                  <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {metrics.map((m) => {
                      const entry = form[m.key];
                      if (!entry) return null;
                      return (
                        <li key={m.key} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors">
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
                                value={entry.target}
                                onChange={(e) => updateField(m.key, 'target', e.target.value)}
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

              {/* Action bar */}
              {formReady && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900">
                  {/* Save */}
                  <Button
                    iconLeft={<Save className="h-4 w-4" />}
                    loading={saveMut.isPending}
                    onClick={() => saveMut.mutate()}
                    variant={dirty ? 'primary' : 'secondary'}
                  >
                    {dirty ? 'Save Targets' : 'Saved'}
                  </Button>
                  {dirty && (
                    <span className="text-xs font-medium text-warning-600 dark:text-warning-400">
                      ● Unsaved changes
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    {/* Rebuild Points — inline confirm */}
                    {confirmRebuild ? (
                      <div className="flex items-center gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 dark:border-warning-700/50 dark:bg-warning-900/20">
                        <span className="text-xs text-warning-700 dark:text-warning-300">Recalculate all employee points?</span>
                        <button onClick={() => rebuildMut.mutate()}
                          disabled={rebuildMut.isPending}
                          className="text-xs font-semibold text-warning-700 hover:underline disabled:opacity-50 dark:text-warning-300">
                          {rebuildMut.isPending ? 'Rebuilding…' : 'Yes, rebuild'}
                        </button>
                        <button onClick={() => setConfirmRebuild(false)}
                          className="text-xs text-neutral-400 hover:text-neutral-600">Cancel</button>
                      </div>
                    ) : (
                      <Button size="sm" variant="secondary"
                        iconLeft={<Zap className="h-3.5 w-3.5" />}
                        onClick={() => setConfirmRebuild(true)}>
                        Rebuild Points
                      </Button>
                    )}

                    {/* Reset to Defaults — only when custom targets active */}
                    {data?.isCustom && (
                      confirmReset ? (
                        <div className="flex items-center gap-2 rounded-lg border border-error-300 bg-error-50 px-3 py-2 dark:border-error-700/50 dark:bg-error-900/20">
                          <span className="text-xs text-error-700 dark:text-error-300">Reset to system defaults?</span>
                          <button onClick={() => resetMut.mutate()}
                            disabled={resetMut.isPending}
                            className="text-xs font-semibold text-error-700 hover:underline disabled:opacity-50 dark:text-error-300">
                            {resetMut.isPending ? 'Resetting…' : 'Yes, reset'}
                          </button>
                          <button onClick={() => setConfirmReset(false)}
                            className="text-xs text-neutral-400 hover:text-neutral-600">Cancel</button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost"
                          iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                          onClick={() => setConfirmReset(true)}>
                          Reset to Defaults
                        </Button>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Empty state — metrics not loaded */}
              {!isLoading && !formReady && (
                <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-200 py-10 text-center dark:border-neutral-700">
                  <p className="text-sm text-neutral-400">No metric configuration found</p>
                  <Button size="sm" variant="secondary" onClick={() => refetch()}>Reload</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Admin/manager — nav already hides this (V3Sidebar's roles: ['owner','admin','manager']),
// but that was nav-hiding only, not real route enforcement (Phase 2A audit,
// 2026-07-06). See docs/bible/19_DECISION_LOG.md's Era 24 entry.
export default function MetricTargetPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'manager']}>
      <MetricTargetPageInner />
    </ProtectedRoute>
  );
}
