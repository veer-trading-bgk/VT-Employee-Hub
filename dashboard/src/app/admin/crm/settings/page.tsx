'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import type { PipelineStage } from '../page';

interface WabaConnection {
  connected: boolean;
  phoneNumber?: string;
  wabaId?: string;
  connectedAt?: string;
}

const PALETTE = [
  '#64748b','#3b82f6','#8b5cf6','#f59e0b','#f97316',
  '#10b981','#ef4444','#ec4899','#06b6d4','#84cc16',
];

export default function CrmSettingsPage() {
  const queryClient = useQueryClient();
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [dirty, setDirty] = useState(false);
  const [wabaStatus, setWabaStatus] = useState<string>('');

  const { data: pipelineData, isLoading: pipelineLoading } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ success: boolean; stages: PipelineStage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });

  const { data: wabaData, isLoading: wabaLoading } = useQuery({
    queryKey: ['waba-connection'],
    queryFn: () => apiFetch<WabaConnection>('/api/whatsapp/connection'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (pipelineData?.stages) {
      setStages([...pipelineData.stages].sort((a, b) => a.order - b.order));
    }
  }, [pipelineData]);

  const savePipelineMutation = useMutation({
    mutationFn: () => apiFetch('/api/crm/pipeline', { method: 'PUT', body: JSON.stringify({ stages }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] });
      setDirty(false);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/connection', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waba-connection'] }),
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
    const newStage: PipelineStage = {
      key: `stage_${Date.now()}`,
      label: 'New Stage',
      color: '#64748b',
      order: stages.length,
    };
    setStages([...stages, newStage]);
    setDirty(true);
  };

  const removeStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })));
    setDirty(true);
  };

  // Meta OAuth popup
  const connectWhatsApp = async () => {
    setWabaStatus('opening…');
    try {
      const { url } = await apiFetch<{ url: string }>('/api/whatsapp/auth/init');
      const popup = window.open(url, 'waba_connect', 'width=620,height=700,left=200,top=100');
      if (!popup) { setWabaStatus('Popup blocked — allow popups for this site'); return; }

      const handler = (e: MessageEvent) => {
        if (e.data?.type === 'waba_connected') {
          setWabaStatus('');
          queryClient.invalidateQueries({ queryKey: ['waba-connection'] });
          window.removeEventListener('message', handler);
        } else if (e.data?.type === 'waba_failed') {
          setWabaStatus(`Failed: ${e.data.message}`);
          window.removeEventListener('message', handler);
        }
      };
      window.addEventListener('message', handler);
    } catch (err) {
      setWabaStatus('Could not start connection. Check META_APP_ID.');
    }
  };

  return (
    <>
      <Navbar title="CRM Settings" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-2xl space-y-6 p-4 pb-10">

          {/* WhatsApp connection */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-white">WhatsApp Business</h2>
            <p className="mb-5 text-sm text-slate-500">Connect your Meta WhatsApp Business Account to send and receive messages from CRM leads.</p>

            {wabaLoading ? (
              <Loading />
            ) : wabaData?.connected ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Connected</p>
                  </div>
                  <p className="mt-0.5 text-sm text-emerald-600 dark:text-emerald-400">{wabaData.phoneNumber}</p>
                  <p className="text-xs text-emerald-500">
                    Connected {wabaData.connectedAt ? new Date(wabaData.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </p>
                </div>
                <button onClick={() => { if (confirm('Disconnect WhatsApp? Messages will stop working.')) disconnectMutation.mutate(); }}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Before connecting, ensure:</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    <li>• Your Meta App is in <strong>Live mode</strong> (not Development)</li>
                    <li>• <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">META_APP_ID</code> and <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">META_APP_SECRET</code> are set on server</li>
                    <li>• <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">BACKEND_URL</code> is set to your live server URL</li>
                  </ul>
                </div>
                {wabaStatus && (
                  <p className={`rounded-lg p-3 text-sm ${wabaStatus.includes('Failed') || wabaStatus.includes('blocked') || wabaStatus.includes('Check') ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20'}`}>
                    {wabaStatus}
                  </p>
                )}
                <button onClick={connectWhatsApp}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1ebe5c] active:scale-95 transition-all">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  Connect with Meta WhatsApp
                </button>
              </div>
            )}
          </section>

          {/* Pipeline stages */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Pipeline Stages</h2>
                <p className="text-sm text-slate-500">Customise your sales pipeline. Drag to reorder using ↑↓ buttons.</p>
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
                    {/* Color swatch + picker */}
                    <div className="relative flex-shrink-0">
                      <div className="h-7 w-7 rounded-lg cursor-pointer" style={{ backgroundColor: stage.color }}
                        onClick={() => { /* toggle palette */ }} />
                      <div className="absolute left-0 top-9 z-10 hidden rounded-xl border border-slate-200 bg-white p-2 shadow-lg group-hover:flex dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex flex-wrap gap-1 w-32">
                          {PALETTE.map((c) => (
                            <button key={c} onClick={() => updateStage(idx, { color: c })}
                              className="h-5 w-5 rounded" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Color picker as native input */}
                    <input type="color" value={stage.color} onChange={(e) => updateStage(idx, { color: e.target.value })}
                      className="h-7 w-7 flex-shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0" />

                    <input value={stage.label} onChange={(e) => updateStage(idx, { label: e.target.value })}
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />

                    <div className="flex gap-1">
                      <button onClick={() => moveStage(idx, -1)} disabled={idx === 0}
                        className="rounded p-1.5 text-xs text-slate-400 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-700">↑</button>
                      <button onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1}
                        className="rounded p-1.5 text-xs text-slate-400 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-700">↓</button>
                      <button onClick={() => removeStage(idx)} disabled={stages.length <= 1}
                        className="rounded p-1.5 text-xs text-red-400 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-900/20">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {dirty && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="text-sm text-amber-700 dark:text-amber-300">You have unsaved changes</p>
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
