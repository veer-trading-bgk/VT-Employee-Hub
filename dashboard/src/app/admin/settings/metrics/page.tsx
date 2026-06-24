'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import { METRICS } from '@/lib/metrics.config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetricDisplay {
  key: string;
  label: string;
  icon: string;
  target: number;
  targetPeriod: 'day' | 'month';
  color: string;
  pointsWeight: number;
  isCurrency: boolean;
  isCustomized: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_MAP = Object.fromEntries(METRICS.map((m) => [m.key, m]));

function targetLabel(m: MetricDisplay) {
  return `${m.target.toLocaleString('en-IN')}${m.isCurrency ? ' ₹' : ''}/${m.targetPeriod === 'day' ? 'day' : 'mo'}`;
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({
  metric,
  onClose,
  onSave,
  onReset,
  isSaving,
  isResetting,
}: {
  metric: MetricDisplay;
  onClose: () => void;
  onSave: (data: Partial<MetricDisplay>) => void;
  onReset: () => void;
  isSaving: boolean;
  isResetting: boolean;
}) {
  const def = DEFAULT_MAP[metric.key];
  const [form, setForm] = useState({
    label:        metric.label,
    icon:         metric.icon,
    target:       String(metric.target),
    targetPeriod: metric.targetPeriod,
    color:        metric.color,
    pointsWeight: String(metric.pointsWeight),
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{form.icon || '📊'}</span>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{form.label || metric.key}</p>
              <p className="text-xs text-slate-400">key: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{metric.key}</code></p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>

        {/* Form */}
        <div className="space-y-3 px-5 py-4">

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Icon</label>
              <input
                value={form.icon}
                onChange={(e) => set('icon', e.target.value)}
                maxLength={8}
                placeholder="📊"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Display name</label>
              <input
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                maxLength={60}
                placeholder="Metric name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Target {metric.isCurrency ? '(₹)' : '(count)'}
              </label>
              <input
                type="number"
                min={1}
                value={form.target}
                onChange={(e) => set('target', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Period</label>
              <select
                value={form.targetPeriod}
                onChange={(e) => set('targetPeriod', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="day">Per day</option>
                <option value="month">Per month</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Chart color</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set('color', e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="text-xs text-slate-400">{form.color}</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Points weight
              </label>
              <input
                type="number"
                min={1}
                value={form.pointsWeight}
                onChange={(e) => set('pointsWeight', e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <p className="mt-0.5 text-[10px] text-slate-400">
                {metric.isCurrency ? `₹${Number(form.pointsWeight).toLocaleString('en-IN')} = 1 pt` : `1 unit = ${form.pointsWeight} pts`}
              </p>
            </div>
          </div>

          {def && (
            <p className="text-[10px] text-slate-400">
              Defaults: {def.icon} {def.label} · {def.target}/{def.targetPeriod === 'day' ? 'day' : 'mo'} · weight {def.pointsWeight}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <button
            onClick={() => onSave({ ...form, target: Number(form.target), pointsWeight: Number(form.pointsWeight) } as any)}
            disabled={isSaving}
            className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
          {metric.isCustomized && (
            <button
              onClick={onReset}
              disabled={isResetting}
              title="Reset to APForce default"
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-500 hover:border-rose-200 hover:text-rose-500 disabled:opacity-50 dark:border-slate-700"
            >
              {isResetting ? '…' : '↺ Reset'}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({ metric, onEdit }: { metric: MetricDisplay; onEdit: () => void }) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      {/* Color bar */}
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl" style={{ backgroundColor: metric.color }} />

      <div className="mb-3 flex items-start justify-between">
        <span className="text-3xl">{metric.icon}</span>
        <div className="flex items-center gap-1.5">
          {metric.isCustomized && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-bold text-indigo-600 ring-1 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:ring-indigo-700">
              CUSTOM
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {metric.key}
          </span>
        </div>
      </div>

      <p className="text-sm font-bold text-slate-900 dark:text-white">{metric.label}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          🎯 {targetLabel(metric)}
        </span>
        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          ⭐ {metric.isCurrency ? `₹${metric.pointsWeight.toLocaleString('en-IN')}=1pt` : `×${metric.pointsWeight}`}
        </span>
      </div>

      <button
        onClick={onEdit}
        className="mt-4 w-full rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
      >
        ✏️ Edit
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MetricSettingsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MetricDisplay | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['metrics-config'],
    queryFn: () => apiFetch<{ success: boolean; config: MetricDisplay[] }>('/api/metrics/config'),
  });

  const saveMutation = useMutation({
    mutationFn: ({ key, payload }: { key: string; payload: object }) =>
      apiFetch(`/api/metrics/config/${key}`, { method: 'PUT', body: JSON.stringify(payload) }),
    onSuccess: () => {
      toast.success('Metric updated');
      queryClient.invalidateQueries({ queryKey: ['metrics-config'] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMutation = useMutation({
    mutationFn: (key: string) =>
      apiFetch(`/api/metrics/config/${key}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Reset to default');
      queryClient.invalidateQueries({ queryKey: ['metrics-config'] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const metrics: MetricDisplay[] = data?.config ?? [];
  const customCount = metrics.filter((m) => m.isCustomized).length;

  return (
    <>
      <Navbar title="Metric Settings" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">

          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Metric Settings</h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Customize metric names, icons, targets and point weights for your team.
                {customCount > 0 && (
                  <span className="ml-2 font-medium text-indigo-600 dark:text-indigo-400">
                    {customCount} customized
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-400">
              ⚠️ <strong>Key</strong> (e.g. <code>kyc</code>) cannot be changed — it&apos;s stored in every employee record.
              <br/>All other fields update immediately across your dashboard.
            </div>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((m) => (
                <MetricCard key={m.key} metric={m} onEdit={() => setEditing(m)} />
              ))}
            </div>
          )}

          {/* Info box */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">How it works</p>
            <div className="grid gap-3 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-3">
              <div className="flex gap-2">
                <span className="text-base">🏷️</span>
                <span><strong className="text-slate-700 dark:text-slate-300">Name & Icon</strong><br/>Shown on cards, leaderboard, and employee daily entry.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-base">🎯</span>
                <span><strong className="text-slate-700 dark:text-slate-300">Target</strong><br/>Used for progress bars and % achievement calculations.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-base">⭐</span>
                <span><strong className="text-slate-700 dark:text-slate-300">Points weight</strong><br/>For counts: <code>value × weight = pts</code>. For ₹ metrics: <code>value ÷ weight = pts</code>.</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {editing && (
        <EditModal
          metric={editing}
          isSaving={saveMutation.isPending}
          isResetting={resetMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveMutation.mutate({ key: editing.key, payload })}
          onReset={() => resetMutation.mutate(editing.key)}
        />
      )}
    </>
  );
}
