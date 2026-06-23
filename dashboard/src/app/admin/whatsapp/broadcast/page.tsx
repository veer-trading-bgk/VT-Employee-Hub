'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import { WhatsAppSubNav } from '@/components/layout/WhatsAppSubNav';

interface Template { id: string; name: string; templateName: string; variables: string[]; bodyPreview: string; }
interface Stage { key: string; label: string; color: string; }
interface BroadcastRecord {
  id: string; templateName: string; sent: number; failed: number; totalMatched: number;
  createdByName?: string; createdAt: string; filter: Record<string, any>;
}
interface BroadcastResult { sent: number; failed: number; total: number; errors: { phone: string; error: string }[]; }

export default function BroadcastPage() {
  const qc = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [varValues, setVarValues] = useState<string[]>([]);
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { data: tmplData } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ templates: Template[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
  });
  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ stages: Stage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['wa-broadcasts'],
    queryFn: () => apiFetch<{ broadcasts: BroadcastRecord[] }>('/api/whatsapp/broadcasts'),
    staleTime: 30_000,
  });

  const templates = tmplData?.templates ?? [];
  const stages = pipelineData?.stages ?? [];
  const broadcasts = historyData?.broadcasts ?? [];
  const tmpl = templates.find((t) => t.id === selectedTemplate);

  const broadcastMutation = useMutation({
    mutationFn: () => apiFetch<BroadcastResult>('/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        templateId: selectedTemplate,
        variableValues: varValues,
        filter: {
          stages: filterStages.length ? filterStages : undefined,
          tags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
          source: filterSource || undefined,
        },
      }),
    }),
    onSuccess: (data) => { setResult(data); setConfirmed(false); refetchHistory(); },
  });

  function toggleStage(key: string) {
    setFilterStages((prev) => prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]);
  }

  const hasTemplate = !!selectedTemplate;
  const readyToSend = hasTemplate && confirmed;

  return (
    <>
      <Navbar title="Bulk Broadcast" showBack />
      <WhatsAppSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl p-4 pb-10">

          {/* Result card */}
          {result && (
            <div className={`mb-5 rounded-2xl border p-5 ${result.failed === 0 ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-900/10' : 'border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-900/10'}`}>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{result.failed === 0 ? '🎉' : '⚠'}</span>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Broadcast Complete</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {result.sent} sent · {result.failed} failed · {result.total} matched
                  </p>
                </div>
                <button onClick={() => setResult(null)} className="ml-auto text-slate-400 hover:text-slate-600">×</button>
              </div>
              {result.errors.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-slate-500">Show {result.errors.length} errors</summary>
                  <div className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-white p-2 text-xs dark:bg-slate-800">
                    {result.errors.map((e, i) => <p key={i} className="text-red-500">{e.phone}: {e.error}</p>)}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Left: config */}
            <div className="space-y-4 lg:col-span-2">
              {/* Template picker */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">1. Choose Template</h3>
                  <Link href="/admin/whatsapp/templates" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">Manage →</Link>
                </div>
                {templates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
                    <p className="text-sm text-slate-400">No templates yet.</p>
                    <Link href="/admin/whatsapp/templates" className="mt-1 block text-xs text-indigo-600 hover:underline">Add your first template →</Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {templates.map((t) => (
                      <label key={t.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${selectedTemplate === t.id ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-900/20' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
                        <input type="radio" name="template" value={t.id} checked={selectedTemplate === t.id}
                          onChange={() => { setSelectedTemplate(t.id); setVarValues(Array(t.variables.length).fill('')); }}
                          className="mt-0.5 accent-indigo-600" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{t.name}</p>
                          <p className="font-mono text-[10px] text-slate-400">{t.templateName}</p>
                          {t.bodyPreview && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.bodyPreview}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Variables */}
              {tmpl && tmpl.variables.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">2. Variable Values</h3>
                  <p className="mb-3 text-xs text-slate-400">Use <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{'{{name}}'}</code> or <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{'{{phone}}'}</code> to personalise, or enter a fixed value.</p>
                  <div className="space-y-2">
                    {tmpl.variables.map((v, i) => (
                      <div key={i}>
                        <label className="mb-1 block text-xs font-medium text-slate-500">{'{{'}{i + 1}{'}}'}  {v}</label>
                        <input value={varValues[i] ?? ''} onChange={(e) => { const n = [...varValues]; n[i] = e.target.value; setVarValues(n); }}
                          placeholder={`e.g. {{name}}`}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filters */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">{tmpl && tmpl.variables.length > 0 ? '3' : '2'}. Filter Audience</h3>
                <p className="mb-3 text-xs text-slate-400">Leave all blank to send to all leads (use with caution).</p>

                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-500">Pipeline Stages</p>
                    <div className="flex flex-wrap gap-2">
                      {stages.map((s) => (
                        <button key={s.key} onClick={() => toggleStage(s.key)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterStages.includes(s.key) ? 'border-transparent text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}
                          style={filterStages.includes(s.key) ? { backgroundColor: s.color, borderColor: s.color } : {}}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Tags (comma-separated)</label>
                      <input value={filterTags} onChange={(e) => setFilterTags(e.target.value)}
                        placeholder="e.g. hot-lead, follow-up"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Source</label>
                      <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                        <option value="">All sources</option>
                        <option value="manual">Manual</option>
                        <option value="import">CSV Import</option>
                        <option value="web_form">Web Form</option>
                        <option value="meta_lead_ads">Meta Lead Ads</option>
                        <option value="whatsapp">WhatsApp</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Confirmation + send */}
              {hasTemplate && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/30 dark:bg-amber-900/10">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-amber-600" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      I confirm I have permission to contact these leads via WhatsApp and the template is approved by Meta.
                    </p>
                  </label>
                </div>
              )}

              {broadcastMutation.isError && (
                <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20">
                  {(broadcastMutation.error as any)?.message ?? 'Broadcast failed'}
                </p>
              )}

              <button onClick={() => broadcastMutation.mutate()}
                disabled={!readyToSend || broadcastMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                {broadcastMutation.isPending ? (
                  <><span className="animate-spin">⟳</span> Sending…</>
                ) : (
                  <><span>📢</span> Send Broadcast</>
                )}
              </button>
            </div>

            {/* Right: history */}
            <div>
              <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Recent Broadcasts</h3>
              <div className="space-y-3">
                {broadcasts.length === 0 && <p className="text-sm text-slate-400">No broadcasts yet.</p>}
                {broadcasts.slice(0, 10).map((b) => (
                  <div key={b.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{b.templateName}</p>
                    <p className="mt-0.5 text-xs text-slate-400">by {b.createdByName ?? 'Admin'} · {new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                    <div className="mt-2 flex gap-3 text-xs">
                      <span className="font-semibold text-emerald-600">{b.sent} sent</span>
                      {b.failed > 0 && <span className="font-semibold text-red-500">{b.failed} failed</span>}
                      <span className="text-slate-400">{b.totalMatched} matched</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
