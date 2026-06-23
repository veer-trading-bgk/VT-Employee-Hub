'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';
import { WhatsAppSubNav } from '@/components/layout/WhatsAppSubNav';

interface Template {
  id: string;
  name: string;
  templateName: string;
  language: string;
  category: string;
  bodyPreview: string;
  variables: string[];
  createdAt: string;
}

const CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'en_US', label: 'English (US)' },
  { code: 'hi', label: 'Hindi' }, { code: 'mr', label: 'Marathi' },
  { code: 'gu', label: 'Gujarati' }, { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' }, { code: 'kn', label: 'Kannada' },
];

const CATEGORY_STYLE: Record<string, string> = {
  UTILITY:        'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  MARKETING:      'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  AUTHENTICATION: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const EMPTY: Partial<Template> = { name: '', templateName: '', language: 'en', category: 'UTILITY', bodyPreview: '', variables: [] };

export default function TemplatesPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Template>>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [varInput, setVarInput] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ success: boolean; templates: Template[] }>('/api/whatsapp/templates'),
    staleTime: 30_000,
  });

  const templates = data?.templates ?? [];

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? apiFetch(`/api/whatsapp/templates/${editing}`, { method: 'PUT', body: JSON.stringify(form) })
      : apiFetch('/api/whatsapp/templates', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wa-templates'] }); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/whatsapp/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-templates'] }),
  });

  function resetForm() { setForm(EMPTY); setEditing(null); setVarInput(''); setShowForm(false); }
  function startEdit(t: Template) { setForm({ ...t }); setEditing(t.id); setShowForm(true); }
  function addVar() { const v = varInput.trim(); if (!v) return; setForm((f) => ({ ...f, variables: [...(f.variables ?? []), v] })); setVarInput(''); }
  function removeVar(i: number) { setForm((f) => ({ ...f, variables: (f.variables ?? []).filter((_, idx) => idx !== i) })); }

  return (
    <>
      <Navbar title="WhatsApp Templates" showBack />
      <WhatsAppSubNav />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl p-4 pb-10">

          {/* Info banner */}
          <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/30 dark:bg-blue-900/10">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">About WhatsApp Templates</p>
            <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
              Templates must first be approved by Meta in your WhatsApp Business Manager. The <strong>Template Name</strong> here must exactly match the approved template slug in Meta (lowercase, underscores). Variables use <code className="rounded bg-blue-100 px-1 dark:bg-blue-900">{'{{1}}'}</code>, <code className="rounded bg-blue-100 px-1 dark:bg-blue-900">{'{{2}}'}</code> etc. in Meta but you can label them here for clarity.
            </p>
          </div>

          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Your Templates ({templates.length})</h2>
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              + Add Template
            </button>
          </div>

          {/* Form */}
          {showForm && (
            <div className="mb-5 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900/30 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">{editing ? 'Edit Template' : 'New Template'}</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Display Name</label>
                    <input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. KYC Reminder"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Template Name (Meta slug)</label>
                    <input value={form.templateName ?? ''} onChange={(e) => setForm({ ...form, templateName: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      placeholder="e.g. kyc_reminder"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Language</label>
                    <select value={form.language ?? 'en'} onChange={(e) => setForm({ ...form, language: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Category</label>
                    <select value={form.category ?? 'UTILITY'} onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Body Preview (for reference)</label>
                  <textarea value={form.bodyPreview ?? ''} onChange={(e) => setForm({ ...form, bodyPreview: e.target.value })}
                    placeholder="Hi {{1}}, your KYC is pending. Please complete it at your earliest convenience."
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  <p className="mt-1 text-[11px] text-slate-400">Use {'{{name}}'} or {'{{phone}}'} for dynamic substitution when sending</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Variable Labels (optional — for your reference)</label>
                  <div className="flex gap-2">
                    <input value={varInput} onChange={(e) => setVarInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVar(); } }}
                      placeholder="e.g. Customer Name"
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                    <button onClick={addVar} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">+ Add</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(form.variables ?? []).map((v, i) => (
                      <span key={i} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                        {'{{'}{i + 1}{'}}'}  {v}
                        <button onClick={() => removeVar(i)} className="text-indigo-300 hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                </div>
                {saveMutation.isError && (
                  <p className="text-sm text-red-500">{(saveMutation.error as any)?.message ?? 'Save failed'}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={resetForm} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700">Cancel</button>
                  <button onClick={() => saveMutation.mutate()}
                    disabled={!form.name?.trim() || !form.templateName?.trim() || saveMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    {saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Save Template'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Template list */}
          {isLoading && <p className="py-10 text-center text-sm text-slate-400">Loading templates…</p>}
          {!isLoading && templates.length === 0 && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-14 text-center dark:border-slate-700">
              <span className="mb-3 text-4xl">📝</span>
              <p className="text-sm font-medium text-slate-500">No templates yet</p>
              <p className="mt-1 text-xs text-slate-400">Add your Meta-approved WhatsApp templates here to use in broadcasts and automations</p>
            </div>
          )}
          <div className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{t.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORY_STYLE[t.category] ?? ''}`}>{t.category}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">{t.language}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-400">{t.templateName}</p>
                    {t.bodyPreview && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t.bodyPreview}</p>}
                    {t.variables.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {t.variables.map((v, i) => (
                          <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                            {'{{'}{i + 1}{'}}'} = {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 gap-1.5">
                    <button onClick={() => startEdit(t)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Edit</button>
                    <button onClick={() => { if (confirm(`Delete "${t.name}"?`)) deleteMutation.mutate(t.id); }}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-900/30 dark:hover:bg-red-900/10">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
