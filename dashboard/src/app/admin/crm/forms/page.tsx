'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';

interface Stage { key: string; label: string; color: string; }
interface Employee { id: string; name: string; role: string; }
interface LeadForm {
  id: string; name: string; fields: string[];
  defaultStage?: string; defaultAssignedTo?: string; defaultAssignedToName?: string;
  source: string; redirectUrl?: string; thankYouMessage: string;
  active: boolean; submissionCount: number; createdAt: string;
  meta_page_id?: string;
}

const ALL_FIELDS = [
  { key: 'name',            label: 'Full Name',       required: true },
  { key: 'phone',           label: 'Phone Number',    required: true },
  { key: 'email',           label: 'Email Address',   required: false },
  { key: 'productInterest', label: 'Product Interest', required: false },
  { key: 'notes',           label: 'Message / Notes', required: false },
];

const EMPTY_FORM: Partial<LeadForm> = {
  name: '', fields: ['name', 'phone', 'email'],
  source: 'web_form', thankYouMessage: 'Thank you! Our team will contact you shortly.',
  active: true,
};

export default function LeadFormsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<LeadForm>>(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['lead-forms'],
    queryFn: () => apiFetch<{ forms: LeadForm[] }>('/api/forms'),
    staleTime: 30_000,
  });
  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ stages: Stage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ data: Employee[] }>('/api/admin/employees').catch(() => ({ data: [] })),
    staleTime: 10 * 60_000,
  });

  const forms = data?.forms ?? [];
  const stages = pipelineData?.stages ?? [];
  const employees = (empData?.data ?? []).filter((e) => ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role));

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? apiFetch(`/api/forms/${editing}`, { method: 'PUT', body: JSON.stringify(form) })
      : apiFetch('/api/forms', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lead-forms'] }); resetForm(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/forms/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-forms'] }),
  });

  function resetForm() { setForm(EMPTY_FORM); setEditing(null); setShowForm(false); }
  function startEdit(f: LeadForm) { setForm({ ...f }); setEditing(f.id); setShowForm(true); }

  function toggleField(key: string) {
    const req = ALL_FIELDS.find((f) => f.key === key)?.required;
    if (req) return;
    setForm((f) => ({
      ...f,
      fields: (f.fields ?? []).includes(key)
        ? (f.fields ?? []).filter((x) => x !== key)
        : [...(f.fields ?? []), key],
    }));
  }

  function copyLink(id: string) {
    const url = `${window.location.origin}/form/${id}`;
    navigator.clipboard.writeText(url).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); });
  }

  function copyEmbed(id: string) {
    const url = `${window.location.origin}/form/${id}`;
    const code = `<iframe src="${url}" width="100%" height="520" style="border:none;border-radius:12px;" title="Lead Form"></iframe>`;
    navigator.clipboard.writeText(code);
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <>
      <Navbar title="Lead Capture Forms" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl p-4 pb-10">

          {/* Meta Ads webhook info */}
          <div className="mb-5 rounded-2xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-900/30 dark:bg-purple-900/10">
            <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">Meta Lead Ads Webhook</p>
            <p className="mt-1 text-xs text-purple-700 dark:text-purple-400">
              To receive leads from Meta Lead Ad forms: in Meta Business Manager → App → Webhooks → subscribe the <strong>leadgen</strong> field.
              Set webhook URL to <code className="rounded bg-purple-100 px-1 dark:bg-purple-900">{baseUrl}/api/forms/meta-leads/webhook</code> and Verify Token = <code className="rounded bg-purple-100 px-1 dark:bg-purple-900">META_LEAD_WEBHOOK_TOKEN</code> env var.
              Also set <code className="rounded bg-purple-100 px-1 dark:bg-purple-900">meta_page_id</code> on a form to route Meta leads to that form's default stage/assignee.
            </p>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Your Forms ({forms.length})</h2>
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              + New Form
            </button>
          </div>

          {/* Form builder */}
          {showForm && (
            <div className="mb-5 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900/30 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">{editing ? 'Edit Form' : 'New Lead Capture Form'}</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Form Name</label>
                    <input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Homepage Lead Form"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Lead Source Tag</label>
                    <select value={form.source ?? 'web_form'} onChange={(e) => setForm({ ...form, source: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      <option value="web_form">Web Form</option>
                      <option value="referral">Referral</option>
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                      <option value="website">Website</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium text-slate-500">Fields to Show</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_FIELDS.map((f) => {
                      const active = (form.fields ?? []).includes(f.key);
                      return (
                        <button key={f.key} type="button" onClick={() => toggleField(f.key)}
                          disabled={f.required}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700'} ${f.required ? 'opacity-60 cursor-not-allowed' : ''}`}>
                          {f.label}{f.required ? ' *' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Default Pipeline Stage</label>
                    <select value={form.defaultStage ?? ''} onChange={(e) => setForm({ ...form, defaultStage: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      <option value="">First stage (default)</option>
                      {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Auto-assign to</label>
                    <select value={form.defaultAssignedTo ?? ''} onChange={(e) => {
                        const emp = employees.find((x) => x.id === e.target.value);
                        setForm({ ...form, defaultAssignedTo: e.target.value, defaultAssignedToName: emp?.name });
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      <option value="">Unassigned</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Thank You Message</label>
                  <input value={form.thankYouMessage ?? ''} onChange={(e) => setForm({ ...form, thankYouMessage: e.target.value })}
                    placeholder="Thank you! Our team will contact you shortly."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Redirect URL (optional)</label>
                  <input value={form.redirectUrl ?? ''} onChange={(e) => setForm({ ...form, redirectUrl: e.target.value })}
                    placeholder="https://yoursite.com/thank-you"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>

                <div className="flex gap-2">
                  <button onClick={resetForm} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700">Cancel</button>
                  <button onClick={() => saveMutation.mutate()}
                    disabled={!form.name?.trim() || saveMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    {saveMutation.isPending ? 'Saving…' : editing ? 'Update Form' : 'Create Form'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Forms list */}
          {forms.length === 0 && !showForm && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-14 text-center dark:border-slate-700">
              <span className="mb-3 text-4xl">📋</span>
              <p className="text-sm font-medium text-slate-500">No lead capture forms yet</p>
              <p className="mt-1 text-xs text-slate-400">Create a form to embed on your website or share as a link</p>
            </div>
          )}
          <div className="space-y-4">
            {forms.map((f) => {
              const formUrl = `${baseUrl}/form/${f.id}`;
              const stage = stages.find((s) => s.key === f.defaultStage);
              return (
                <div key={f.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{f.name}</p>
                        {!f.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">Inactive</span>}
                        {stage && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: stage.color }}>{stage.label}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {f.submissionCount} submission{f.submissionCount !== 1 ? 's' : ''} ·
                        Fields: {f.fields.join(', ')}
                      </p>
                      <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{formUrl}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-1.5">
                      <button onClick={() => copyLink(f.id)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${copiedId === f.id ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                        {copiedId === f.id ? '✓ Copied' : 'Copy Link'}
                      </button>
                      <button onClick={() => copyEmbed(f.id)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        {'</>'} Embed
                      </button>
                      <button onClick={() => startEdit(f)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Edit</button>
                      <button onClick={() => { if (confirm(`Delete "${f.name}"?`)) deleteMutation.mutate(f.id); }}
                        className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-900/30">Del</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
