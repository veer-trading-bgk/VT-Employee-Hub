'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { CrmSubNav } from '@/components/layout/CrmSubNav';
import type { PipelineStage } from '../page';

export default function CrmSettingsPage() {
  const queryClient = useQueryClient();

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data: pipelineData, isLoading: pipelineLoading } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (pipelineData?.stages) {
      setStages([...pipelineData.stages].sort((a, b) => a.order - b.order));
    }
  }, [pipelineData]);

  const savePipelineMutation = useMutation({
    mutationFn: () => apiFetch('/api/crm/pipeline', { method: 'PUT', body: JSON.stringify({ stages }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] }); setDirty(false); },
  });

  const updateStage = (idx: number, patch: Partial<PipelineStage>) => {
    setStages((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    setDirty(true);
  };
  const moveStage = (idx: number, dir: -1 | 1) => {
    const next = [...stages];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setStages(next.map((s, i) => ({ ...s, order: i })));
    setDirty(true);
  };
  const addStage = () => {
    setStages([...stages, { key: `stage_${Date.now()}`, label: 'New Stage', color: '#64748b', order: stages.length }]);
    setDirty(true);
  };
  const removeStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })));
    setDirty(true);
  };

  return (
    <>
      <Navbar title="CRM Settings" showBack />
      <CrmSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-6 p-4 pb-10">

          {/* ── Pipeline stages ── */}
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
                    <input type="color" value={stage.color} onChange={(e) => updateStage(idx, { color: e.target.value })}
                      title="Pick color"
                      className="h-8 w-8 flex-shrink-0 cursor-pointer rounded-lg border-2 border-slate-200 bg-transparent p-0.5 dark:border-slate-600" />

                    <input value={stage.label} onChange={(e) => updateStage(idx, { label: e.target.value })}
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

            {dirty && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm text-amber-700 dark:text-amber-300">Unsaved changes</p>
                <div className="flex gap-2">
                  <button onClick={() => { setStages([...(pipelineData?.stages ?? [])].sort((a, b) => a.order - b.order)); setDirty(false); }}
                    className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Discard</button>
                  <button onClick={() => savePipelineMutation.mutate()} disabled={savePipelineMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {savePipelineMutation.isPending ? 'Saving…' : 'Save Pipeline'}
                  </button>
                </div>
              </div>
            )}
            {savePipelineMutation.isError && (
              <p className="mt-2 text-sm text-red-500">{(savePipelineMutation.error as any)?.message ?? 'Save failed'}</p>
            )}
          </section>

        </div>
      </div>
    </>
  );
}
