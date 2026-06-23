'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { CrmSubNav } from '@/components/layout/CrmSubNav';
import type { PipelineStage } from '../page';

// ── Types ──────────────────────────────────────────────────────────────────────
interface AutoAssignConfig {
  enabled: boolean;
  capacity: number;
  overflow: 'assign' | 'unassigned';
  pools: Record<string, string[]>;
  updatedAt?: string;
}

interface PoolEmployee {
  id: string;
  name: string;
  role: string;
  status: string;
  autoAssignEnabled?: boolean;
  autoAssignWeight?: number;
}

const PERFORMER_ROLES = new Set(['telecaller', 'agent', 'intern']);

const SOURCES = [
  { key: 'crm',           label: 'CRM Manual Entry',     icon: '✏️' },
  { key: 'web_form',      label: 'Web Form Submissions',  icon: '📋' },
  { key: 'meta_lead_ads', label: 'Meta Lead Ads',         icon: '📣' },
  { key: 'whatsapp',      label: 'WhatsApp',              icon: '💬' },
];

const DEFAULT_CFG: AutoAssignConfig = { enabled: false, capacity: 5, overflow: 'assign', pools: {} };

// ── Employee row with local weight state ──────────────────────────────────────
function EmpRow({
  emp,
  onToggle,
  onWeight,
  isPending,
}: {
  emp: PoolEmployee;
  onToggle: () => void;
  onWeight: (w: number) => void;
  isPending: boolean;
}) {
  const [weight, setWeight] = useState(emp.autoAssignWeight ?? 1);
  useEffect(() => { setWeight(emp.autoAssignWeight ?? 1); }, [emp.autoAssignWeight]);
  const inPool = emp.autoAssignEnabled !== false;

  return (
    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
      <td className="px-4 py-2.5">
        <span className="font-medium text-slate-800 dark:text-white">{emp.name}</span>
        <span className="ml-1.5 text-xs capitalize text-slate-400">{emp.role.replace('_', ' ')}</span>
      </td>
      <td className="px-4 py-2.5 text-center">
        <button
          onClick={onToggle}
          disabled={isPending}
          aria-label={inPool ? 'Remove from pool' : 'Add to pool'}
          className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
            inPool ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            inPool ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </td>
      <td className="px-4 py-2.5 text-center">
        <input
          type="number" min={1} max={10}
          value={weight}
          disabled={!inPool}
          onChange={e => setWeight(Math.max(1, Math.min(10, Number(e.target.value))))}
          onBlur={() => {
            const w = Math.max(1, Math.min(10, weight));
            if (w !== (emp.autoAssignWeight ?? 1)) onWeight(w);
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-center text-sm outline-none focus:border-indigo-400 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </td>
    </tr>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function CrmSettingsPage() {
  const queryClient = useQueryClient();

  // pipeline
  const [stages, setStages]       = useState<PipelineStage[]>([]);
  const [stageDirty, setStageDirty] = useState(false);

  // auto-assign config
  const [aaConfig, setAaConfig]   = useState<AutoAssignConfig>(DEFAULT_CFG);
  const [aaDirty, setAaDirty]     = useState(false);
  const [openSource, setOpenSource] = useState<string | null>(null);

  // ── Queries ──
  const { data: pipelineData, isLoading: pipelineLoading } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  const { data: aaData, isLoading: aaLoading } = useQuery({
    queryKey: ['crm-auto-assign'],
    queryFn: () => apiFetch<{ success: boolean; data: AutoAssignConfig }>('/api/admin/crm/auto-assign'),
    staleTime: 30_000,
  });

  const { data: empData, isLoading: empLoading } = useQuery({
    queryKey: ['admin-employees-aa'],
    queryFn: () => apiFetch<{ success: boolean; employees: PoolEmployee[] }>('/api/admin/employees'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pipelineData?.stages) {
      setStages([...pipelineData.stages].sort((a, b) => a.order - b.order));
    }
  }, [pipelineData]);

  useEffect(() => {
    if (aaData?.data) {
      setAaConfig({
        ...DEFAULT_CFG,
        ...aaData.data,
        capacity: aaData.data.capacity ?? 5,
        overflow: aaData.data.overflow ?? 'assign',
        pools: aaData.data.pools ?? {},
      });
      setAaDirty(false);
    }
  }, [aaData]);

  const poolEmployees = (empData?.employees ?? []).filter(
    e => PERFORMER_ROLES.has(e.role) && e.status !== 'inactive',
  );

  // ── Mutations ──
  const savePipelineMutation = useMutation({
    mutationFn: () => apiFetch('/api/crm/pipeline', { method: 'PUT', body: JSON.stringify({ stages }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] }); setStageDirty(false); },
  });

  const saveAaMutation = useMutation({
    mutationFn: (cfg: AutoAssignConfig) =>
      apiFetch('/api/admin/crm/auto-assign', { method: 'PUT', body: JSON.stringify(cfg) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-auto-assign'] }); setAaDirty(false); },
  });

  const updateEmpMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: object }) =>
      apiFetch(`/api/admin/employees/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-employees-aa'] }),
  });

  // ── Helpers ──
  const patchAa = useCallback((patch: Partial<AutoAssignConfig>) => {
    setAaConfig(prev => ({ ...prev, ...patch }));
    setAaDirty(true);
  }, []);

  const isInPool = (source: string, empId: string) => {
    const pool = aaConfig.pools[source] ?? [];
    return pool.length === 0 || pool.includes(empId);
  };

  const togglePool = (source: string, empId: string) => {
    const current = aaConfig.pools[source] ?? [];
    const allIds  = poolEmployees.map(e => e.id);
    let next: string[];
    if (current.length === 0) {
      next = allIds.filter(id => id !== empId);
    } else if (current.includes(empId)) {
      next = current.filter(id => id !== empId);
    } else {
      next = [...current, empId];
    }
    if (next.length === allIds.length) next = [];
    patchAa({ pools: { ...aaConfig.pools, [source]: next } });
  };

  const poolLabel = (source: string) => {
    const pool = aaConfig.pools[source] ?? [];
    return pool.length === 0 ? 'All employees' : `${pool.length} selected`;
  };

  // ── Pipeline helpers ──
  const updateStage = (idx: number, patch: Partial<PipelineStage>) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    setStageDirty(true);
  };
  const moveStage = (idx: number, dir: -1 | 1) => {
    const next = [...stages];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setStages(next.map((s, i) => ({ ...s, order: i })));
    setStageDirty(true);
  };
  const addStage = () => {
    setStages([...stages, { key: `stage_${Date.now()}`, label: 'New Stage', color: '#64748b', order: stages.length }]);
    setStageDirty(true);
  };
  const removeStage = (idx: number) => {
    setStages(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })));
    setStageDirty(true);
  };

  const discardAa = () => {
    if (aaData?.data) {
      setAaConfig({ ...DEFAULT_CFG, ...aaData.data, capacity: aaData.data.capacity ?? 5, overflow: aaData.data.overflow ?? 'assign', pools: aaData.data.pools ?? {} });
    } else {
      setAaConfig(DEFAULT_CFG);
    }
    setAaDirty(false);
  };

  return (
    <>
      <Navbar title="CRM Settings" showBack />
      <CrmSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-6 p-4 pb-10">

          {/* ── 1. Auto-Assign Config ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Lead Auto-Assign</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Distribute new leads automatically to the least-loaded active employee.
                </p>
                {aaData?.data?.updatedAt && (
                  <p className="mt-1 text-xs text-slate-400">
                    Last saved {new Date(aaData.data.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>

              {aaLoading ? (
                <div className="h-7 w-14 flex-shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
              ) : (
                <button
                  onClick={() => patchAa({ enabled: !aaConfig.enabled })}
                  aria-label={aaConfig.enabled ? 'Disable auto-assign' : 'Enable auto-assign'}
                  className={`relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                    aaConfig.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
                    aaConfig.enabled ? 'translate-x-8' : 'translate-x-1'
                  }`} />
                </button>
              )}
            </div>

            {/* Status banner */}
            <div className={`mt-4 rounded-xl px-4 py-2.5 text-sm font-medium ${
              aaConfig.enabled
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}>
              {aaConfig.enabled
                ? '🟢 Auto-assign ON — new leads distributed automatically'
                : '⚫ Auto-assign OFF — leads default to creator'}
            </div>

            {/* Capacity */}
            <div className="mt-5 flex items-center gap-4">
              <label className="w-44 flex-shrink-0 text-sm font-medium text-slate-700 dark:text-slate-300">
                Capacity per employee
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={50} value={aaConfig.capacity}
                  onChange={e => patchAa({ capacity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                  className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-sm font-semibold outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <span className="text-sm text-slate-500">max open leads</span>
              </div>
            </div>

            {/* Overflow */}
            <div className="mt-4 flex items-start gap-4">
              <span className="w-44 flex-shrink-0 pt-0.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                When everyone full
              </span>
              <div className="space-y-2.5">
                {[
                  { val: 'assign',     label: 'Assign to least-loaded anyway', sub: 'Soft cap — leads still flow, no one is blocked' },
                  { val: 'unassigned', label: 'Leave lead unassigned',          sub: 'Hard cap — lead stays in queue for manual pickup' },
                ].map(opt => (
                  <label key={opt.val} className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio" name="overflow" value={opt.val}
                      checked={aaConfig.overflow === opt.val}
                      onChange={() => patchAa({ overflow: opt.val as 'assign' | 'unassigned' })}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <span>
                      <span className="text-sm font-medium text-slate-800 dark:text-white">{opt.label}</span>
                      <span className="block text-xs text-slate-400">{opt.sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {aaDirty && (
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={discardAa}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Discard
                </button>
                <button
                  onClick={() => saveAaMutation.mutate(aaConfig)}
                  disabled={saveAaMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {saveAaMutation.isPending ? 'Saving…' : 'Save Config'}
                </button>
              </div>
            )}
            {saveAaMutation.isError && (
              <p className="mt-2 text-sm text-red-500">{(saveAaMutation.error as Error)?.message ?? 'Save failed'}</p>
            )}
          </section>

          {/* ── 2. Source Routing ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Source Routing</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Route leads from each channel to a specific employee subset. Empty = all eligible employees.
            </p>

            {(aaLoading || empLoading) ? <Loading /> : (
              <div className="mt-4 space-y-2">
                {SOURCES.map(src => {
                  const isOpen = openSource === src.key;
                  const pool   = aaConfig.pools[src.key] ?? [];
                  return (
                    <div key={src.key} className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
                      <button
                        onClick={() => setOpenSource(isOpen ? null : src.key)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">{src.icon}</span>
                          <span className="text-sm font-medium text-slate-800 dark:text-white">{src.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            pool.length === 0
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                              : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400'
                          }`}>
                            {poolLabel(src.key)}
                          </span>
                          <span className="text-xs text-slate-400">{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-slate-100 px-4 pb-3 pt-2 dark:border-slate-800">
                          {poolEmployees.length === 0 ? (
                            <p className="py-2 text-xs text-slate-400">No active telecallers / agents / interns found.</p>
                          ) : (
                            <div className="space-y-1.5">
                              <label className="flex cursor-pointer items-center gap-2.5 py-0.5">
                                <input
                                  type="checkbox"
                                  checked={pool.length === 0}
                                  onChange={() => patchAa({ pools: { ...aaConfig.pools, [src.key]: [] } })}
                                  className="accent-indigo-600"
                                />
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">All employees (default)</span>
                              </label>
                              <div className="ml-1 border-l-2 border-slate-100 pl-3 dark:border-slate-800">
                                {poolEmployees.map(emp => (
                                  <label key={emp.id} className="flex cursor-pointer items-center gap-2.5 py-1">
                                    <input
                                      type="checkbox"
                                      checked={isInPool(src.key, emp.id)}
                                      onChange={() => togglePool(src.key, emp.id)}
                                      className="accent-indigo-600"
                                    />
                                    <span className="text-sm text-slate-700 dark:text-slate-300">{emp.name}</span>
                                    <span className="rounded px-1.5 py-0.5 text-xs capitalize bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                      {emp.role.replace('_', ' ')}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {aaDirty && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => saveAaMutation.mutate(aaConfig)}
                  disabled={saveAaMutation.isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {saveAaMutation.isPending ? 'Saving…' : 'Save Routing'}
                </button>
              </div>
            )}
          </section>

          {/* ── 3. Employee Pool ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Employee Pool</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Toggle employees in/out and set their lead weight.
              Weight 2 means they receive leads at 2× the rate of weight 1.
            </p>

            {empLoading ? <Loading /> : (
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                      <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                      <th className="px-4 py-2.5 text-center font-medium">In Pool</th>
                      <th className="px-4 py-2.5 text-center font-medium">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {poolEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-xs text-slate-400">
                          No active telecallers / agents / interns found.
                        </td>
                      </tr>
                    ) : poolEmployees.map(emp => (
                      <EmpRow
                        key={emp.id}
                        emp={emp}
                        isPending={updateEmpMutation.isPending}
                        onToggle={() => updateEmpMutation.mutate({
                          id: emp.id,
                          patch: { autoAssignEnabled: emp.autoAssignEnabled === false },
                        })}
                        onWeight={w => updateEmpMutation.mutate({ id: emp.id, patch: { autoAssignWeight: w } })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── 4. Pipeline Stages ── */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Pipeline Stages</h2>
                <p className="text-sm text-slate-500">Customise stage names and colors. Use ↑↓ to reorder.</p>
              </div>
              <button onClick={addStage}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20">
                + Add Stage
              </button>
            </div>

            {pipelineLoading ? <Loading /> : (
              <div className="space-y-2">
                {stages.map((stage, idx) => (
                  <div key={stage.key} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                    <input type="color" value={stage.color}
                      onChange={e => updateStage(idx, { color: e.target.value })}
                      title="Pick color"
                      className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-lg border-2 border-slate-200 bg-transparent p-0.5 dark:border-slate-600" />
                    <input value={stage.label}
                      onChange={e => updateStage(idx, { label: e.target.value })}
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                    <div className="flex gap-1">
                      <button onClick={() => moveStage(idx, -1)} disabled={idx === 0}
                        className="rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-200 disabled:opacity-20 dark:hover:bg-slate-700">↑</button>
                      <button onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1}
                        className="rounded px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-200 disabled:opacity-20 dark:hover:bg-slate-700">↓</button>
                      <button onClick={() => removeStage(idx)} disabled={stages.length <= 1}
                        className="rounded px-2 py-1.5 text-xs text-red-400 hover:bg-red-50 disabled:opacity-20 dark:hover:bg-red-900/20">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stageDirty && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm text-amber-700 dark:text-amber-300">Unsaved changes</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setStages([...(pipelineData?.stages ?? [])].sort((a, b) => a.order - b.order)); setStageDirty(false); }}
                    className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    Discard
                  </button>
                  <button onClick={() => savePipelineMutation.mutate()} disabled={savePipelineMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {savePipelineMutation.isPending ? 'Saving…' : 'Save Pipeline'}
                  </button>
                </div>
              </div>
            )}
            {savePipelineMutation.isError && (
              <p className="mt-2 text-sm text-red-500">
                {(savePipelineMutation.error as Error)?.message ?? 'Save failed'}
              </p>
            )}
          </section>

        </div>
      </div>
    </>
  );
}
