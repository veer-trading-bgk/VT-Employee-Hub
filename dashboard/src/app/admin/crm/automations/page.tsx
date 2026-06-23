'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch } from '@/lib/api';

interface Stage { key: string; label: string; color: string; }
interface Template { id: string; name: string; templateName: string; variables: string[]; }
interface Employee { id: string; name: string; role: string; }

interface Condition { field: string; value: string; }
interface Action {
  type: string;
  templateId?: string; templateName?: string; language?: string; variables?: string[];
  employeeId?: string; employeeName?: string;
  tag?: string; stage?: string;
  daysFromNow?: number; note?: string;
}
interface Automation {
  id: string; name: string; trigger: string;
  conditions: Condition[]; actions: Action[];
  enabled: boolean; runCount?: number; createdAt: string;
}

const TRIGGERS = [
  { value: 'lead_created',  label: 'Lead Created',         icon: '➕' },
  { value: 'stage_change',  label: 'Stage Changed',        icon: '🔄' },
  { value: 'tag_added',     label: 'Tag Added',            icon: '🏷' },
];

const ACTION_TYPES = [
  { value: 'send_template',  label: 'Send WhatsApp Template' },
  { value: 'assign_to',      label: 'Assign to Employee' },
  { value: 'add_tag',        label: 'Add Tag' },
  { value: 'move_stage',     label: 'Move to Stage' },
  { value: 'create_followup', label: 'Create Follow-up' },
];

const CONDITION_FIELDS: Record<string, { label: string; valueType: 'stage' | 'text' }[]> = {
  lead_created: [{ label: 'Source is', valueType: 'text' }],
  stage_change: [
    { label: 'From stage', valueType: 'stage' },
    { label: 'To stage',   valueType: 'stage' },
    { label: 'Has tag',    valueType: 'text'  },
  ],
  tag_added: [{ label: 'Tag is', valueType: 'text' }],
};

const CONDITION_FIELD_MAP: Record<string, string[]> = {
  lead_created: ['source'],
  stage_change: ['from_stage', 'to_stage', 'has_tag'],
  tag_added:    ['has_tag'],
};

const EMPTY_AUTO: Partial<Automation> = { name: '', trigger: 'stage_change', conditions: [], actions: [], enabled: true };

export default function AutomationsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<Automation>>(EMPTY_AUTO);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data } = useQuery({
    queryKey: ['automations'],
    queryFn: () => apiFetch<{ automations: Automation[] }>('/api/automations'),
    staleTime: 30_000,
  });
  const { data: pipelineData } = useQuery({
    queryKey: ['crm-pipeline'],
    queryFn: () => apiFetch<{ stages: Stage[] }>('/api/crm/pipeline'),
    staleTime: 5 * 60_000,
  });
  const { data: tmplData } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ templates: Template[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
  });
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<{ data: Employee[] }>('/api/admin/employees').catch(() => ({ data: [] })),
    staleTime: 10 * 60_000,
  });

  const automations = data?.automations ?? [];
  const stages = pipelineData?.stages ?? [];
  const templates = tmplData?.templates ?? [];
  const employees = (empData?.data ?? []).filter((e) => ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role));

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? apiFetch(`/api/automations/${editing}`, { method: 'PUT', body: JSON.stringify(form) })
      : apiFetch('/api/automations', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['automations'] }); resetForm(); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/api/automations/${id}`, { method: 'PUT', body: JSON.stringify({ ...automations.find((a) => a.id === id), enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });

  function resetForm() { setForm(EMPTY_AUTO); setEditing(null); setShowForm(false); }

  function startEdit(a: Automation) { setForm({ ...a }); setEditing(a.id); setShowForm(true); }

  function addCondition() {
    const fields = CONDITION_FIELD_MAP[form.trigger ?? 'stage_change'] ?? [];
    if (!fields.length) return;
    setForm((f) => ({ ...f, conditions: [...(f.conditions ?? []), { field: fields[0], value: '' }] }));
  }

  function updateCondition(i: number, patch: Partial<Condition>) {
    setForm((f) => ({ ...f, conditions: (f.conditions ?? []).map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  }

  function removeCondition(i: number) {
    setForm((f) => ({ ...f, conditions: (f.conditions ?? []).filter((_, idx) => idx !== i) }));
  }

  function addAction() {
    setForm((f) => ({ ...f, actions: [...(f.actions ?? []), { type: 'send_template' }] }));
  }

  function updateAction(i: number, patch: Partial<Action>) {
    setForm((f) => ({ ...f, actions: (f.actions ?? []).map((a, idx) => idx === i ? { ...a, ...patch } : a) }));
  }

  function removeAction(i: number) {
    setForm((f) => ({ ...f, actions: (f.actions ?? []).filter((_, idx) => idx !== i) }));
  }

  const condFields = CONDITION_FIELD_MAP[form.trigger ?? 'stage_change'] ?? [];

  return (
    <>
      <Navbar title="Automations" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-3xl p-4 pb-10">

          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Workflow Automations</h2>
              <p className="text-xs text-slate-400">Trigger actions automatically when leads change stage, get tagged, or are created</p>
            </div>
            <button onClick={() => { resetForm(); setShowForm(true); }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              + New Rule
            </button>
          </div>

          {/* Form */}
          {showForm && (
            <div className="mb-5 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900/30 dark:bg-slate-900">
              <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">{editing ? 'Edit' : 'New'} Automation Rule</h3>
              <div className="space-y-4">

                {/* Name + trigger */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Rule Name</label>
                    <input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. KYC Done → Send Reminder"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Trigger</label>
                    <select value={form.trigger ?? 'stage_change'}
                      onChange={(e) => setForm({ ...form, trigger: e.target.value, conditions: [] })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                      {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Conditions */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500">Conditions (optional — all must match)</label>
                    {condFields.length > 0 && (
                      <button onClick={addCondition} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">+ Add condition</button>
                    )}
                  </div>
                  {(form.conditions ?? []).length === 0 && (
                    <p className="text-xs text-slate-400 italic">No conditions — rule fires for all {TRIGGERS.find((t) => t.value === form.trigger)?.label ?? 'events'}</p>
                  )}
                  <div className="space-y-2">
                    {(form.conditions ?? []).map((c, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-800/50">
                        <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value, value: '' })}
                          className="rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                          {condFields.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
                        </select>
                        <span className="text-xs text-slate-400">=</span>
                        {(c.field === 'from_stage' || c.field === 'to_stage' || c.field === 'stage') ? (
                          <select value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })}
                            className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                            <option value="">Any stage</option>
                            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        ) : (
                          <input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })}
                            placeholder="value"
                            className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                        )}
                        <button onClick={() => removeCondition(i)} className="text-slate-300 hover:text-red-500">×</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500">Actions (executed in order)</label>
                    <button onClick={addAction} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">+ Add action</button>
                  </div>
                  {(form.actions ?? []).length === 0 && (
                    <p className="text-xs text-slate-400 italic">Add at least one action</p>
                  )}
                  <div className="space-y-2">
                    {(form.actions ?? []).map((action, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">{i + 1}.</span>
                          <select value={action.type} onChange={(e) => updateAction(i, { type: e.target.value })}
                            className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                            {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <button onClick={() => removeAction(i)} className="text-slate-300 hover:text-red-500">×</button>
                        </div>

                        {action.type === 'send_template' && (
                          <div className="mt-2 space-y-1.5">
                            <select value={action.templateId ?? ''} onChange={(e) => {
                                const t = templates.find((x) => x.id === e.target.value);
                                updateAction(i, { templateId: e.target.value, templateName: t?.templateName, variables: Array(t?.variables.length ?? 0).fill('{{name}}') });
                              }}
                              className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                              <option value="">Select template…</option>
                              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            {action.variables && action.variables.length > 0 && action.variables.map((v, vi) => (
                              <input key={vi} value={v} onChange={(e) => { const nv = [...(action.variables ?? [])]; nv[vi] = e.target.value; updateAction(i, { variables: nv }); }}
                                placeholder={`Variable ${vi + 1} value — use {{name}} or {{phone}}`}
                                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                            ))}
                          </div>
                        )}

                        {action.type === 'assign_to' && (
                          <select value={action.employeeId ?? ''} onChange={(e) => {
                              const emp = employees.find((x) => x.id === e.target.value);
                              updateAction(i, { employeeId: e.target.value, employeeName: emp?.name });
                            }}
                            className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                            <option value="">Select employee…</option>
                            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        )}

                        {action.type === 'add_tag' && (
                          <input value={action.tag ?? ''} onChange={(e) => updateAction(i, { tag: e.target.value })}
                            placeholder="Tag to add"
                            className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                        )}

                        {action.type === 'move_stage' && (
                          <select value={action.stage ?? ''} onChange={(e) => updateAction(i, { stage: e.target.value })}
                            className="mt-2 w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                            <option value="">Select stage…</option>
                            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        )}

                        {action.type === 'create_followup' && (
                          <div className="mt-2 flex gap-2">
                            <input type="number" min="1" max="90" value={action.daysFromNow ?? 1}
                              onChange={(e) => updateAction(i, { daysFromNow: Number(e.target.value) })}
                              className="w-20 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                            <span className="self-center text-xs text-slate-400">days from now</span>
                            <input value={action.note ?? ''} onChange={(e) => updateAction(i, { note: e.target.value })}
                              placeholder="Follow-up note"
                              className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {saveMutation.isError && <p className="text-sm text-red-500">{(saveMutation.error as any)?.message ?? 'Save failed'}</p>}
                <div className="flex gap-2">
                  <button onClick={resetForm} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700">Cancel</button>
                  <button onClick={() => saveMutation.mutate()}
                    disabled={!form.name?.trim() || (form.actions?.length ?? 0) === 0 || saveMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
                    {saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Create Rule'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Automation list */}
          {automations.length === 0 && !showForm && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-14 text-center dark:border-slate-700">
              <span className="mb-3 text-4xl">⚡</span>
              <p className="text-sm font-medium text-slate-500">No automation rules yet</p>
              <p className="mt-1 text-xs text-slate-400">Create rules to auto-send templates, assign leads, or create follow-ups</p>
            </div>
          )}
          <div className="space-y-3">
            {automations.map((a) => {
              const trigger = TRIGGERS.find((t) => t.value === a.trigger);
              return (
                <div key={a.id} className={`rounded-2xl border bg-white shadow-sm dark:bg-slate-900 ${a.enabled ? 'border-slate-200 dark:border-slate-800' : 'border-slate-100 opacity-60 dark:border-slate-800/50'}`}>
                  <div className="flex items-center gap-3 p-4">
                    <span className="text-xl">{trigger?.icon ?? '⚡'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{a.name}</p>
                      <p className="text-xs text-slate-400">
                        {trigger?.label}
                        {a.conditions.length > 0 && ` · ${a.conditions.length} condition${a.conditions.length > 1 ? 's' : ''}`}
                        {' · '}{a.actions.length} action{a.actions.length > 1 ? 's' : ''}
                        {a.runCount ? ` · ran ${a.runCount} times` : ''}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button onClick={() => toggleMutation.mutate({ id: a.id, enabled: !a.enabled })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${a.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow ${a.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      <button onClick={() => startEdit(a)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Edit</button>
                      <button onClick={() => { if (confirm(`Delete "${a.name}"?`)) deleteMutation.mutate(a.id); }}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:border-red-900/30">Del</button>
                    </div>
                  </div>
                  {/* Action summary */}
                  <div className="border-t border-slate-50 px-4 py-2 dark:border-slate-800">
                    <div className="flex flex-wrap gap-2">
                      {a.actions.map((act, i) => (
                        <span key={i} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {ACTION_TYPES.find((t) => t.value === act.type)?.label ?? act.type}
                        </span>
                      ))}
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
