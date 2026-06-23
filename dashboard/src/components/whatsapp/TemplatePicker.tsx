'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

interface Template {
  id: string;
  name: string;
  templateName: string;
  language: string;
  category: string;
  bodyPreview: string;
  variables: string[];
}

interface Props {
  leadId: string;
  phone: string;
  onSent: () => void;
  onCancel: () => void;
}

const CATEGORY_COLOR: Record<string, string> = {
  UTILITY:        'bg-blue-50 text-blue-700',
  MARKETING:      'bg-purple-50 text-purple-700',
  AUTHENTICATION: 'bg-amber-50 text-amber-700',
};

export function TemplatePicker({ leadId, phone, onSent, onCancel }: Props) {
  const [selected, setSelected] = useState<Template | null>(null);
  const [varValues, setVarValues] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => apiFetch<{ success: boolean; templates: Template[] }>('/api/whatsapp/templates'),
    staleTime: 60_000,
  });

  const templates = data?.templates ?? [];

  function pickTemplate(t: Template) {
    setSelected(t);
    setVarValues(Array(t.variables.length).fill(''));
  }

  const sendMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/whatsapp/send-template', {
        method: 'POST',
        body: JSON.stringify({
          leadId,
          templateId: selected!.id,
          variableValues: varValues,
        }),
      }),
    onSuccess: onSent,
  });

  const previewBody = selected?.bodyPreview
    ? selected.bodyPreview.replace(/\{\{(\d+)\}\}/g, (_, n) => varValues[parseInt(n) - 1] || `{{${n}}}`)
    : '';

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/30 dark:bg-amber-900/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">24h window expired</p>
          <p className="text-xs text-amber-600 dark:text-amber-400">Send a pre-approved WhatsApp template to re-open the conversation.</p>
        </div>
        <button onClick={onCancel} className="ml-2 text-amber-400 hover:text-amber-600">✕</button>
      </div>

      {isLoading && <p className="text-center text-xs text-slate-400">Loading templates…</p>}

      {!isLoading && templates.length === 0 && (
        <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
          No templates configured. <a href="/admin/whatsapp/templates" className="text-indigo-500 underline">Add one →</a>
        </p>
      )}

      {/* Template list */}
      {!selected && templates.length > 0 && (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => pickTemplate(t)}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-800 dark:text-white">{t.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${CATEGORY_COLOR[t.category] ?? ''}`}>{t.category}</span>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800">{t.language}</span>
                </div>
                {t.bodyPreview && (
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">{t.bodyPreview}</p>
                )}
              </div>
              <span className="mt-0.5 flex-shrink-0 text-xs text-indigo-500">Select →</span>
            </button>
          ))}
        </div>
      )}

      {/* Variable fill + preview */}
      {selected && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(null)} className="text-xs text-amber-600 hover:underline">← Back</button>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{selected.name}</span>
          </div>

          {selected.variables.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium text-slate-500">Fill in variables:</p>
              {selected.variables.map((label, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-10 flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-mono text-slate-500 dark:bg-slate-800">
                    {`{{${i + 1}}}`}
                  </span>
                  <input
                    placeholder={label}
                    value={varValues[i] ?? ''}
                    onChange={(e) => {
                      const next = [...varValues];
                      next[i] = e.target.value;
                      setVarValues(next);
                    }}
                    className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              ))}
            </div>
          )}

          {previewBody && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Preview</p>
              <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{previewBody}</p>
            </div>
          )}

          {sendMutation.isError && (
            <p className="text-xs text-red-500">{(sendMutation.error as Error).message ?? 'Send failed'}</p>
          )}

          <button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
            {sendMutation.isPending ? 'Sending…' : `Send to ${phone}`}
          </button>
        </div>
      )}
    </div>
  );
}
