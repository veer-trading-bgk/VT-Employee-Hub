'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { CancelJourneyConfig } from '@/types/automations';
import { Field, inputCls, selectCls } from './ActionEditor';

const REASON_OPTIONS: Array<{ value: 'timeout' | 'user' | 'manual'; label: string }> = [
  { value: 'manual',  label: 'Manual' },
  { value: 'user',    label: 'User' },
  // Authors wire cancel_journey from wait_for_webhook's Timeout handle and set
  // reasonSource to 'timeout' themselves — keep it selectable (e2e / Task 10 shape).
  { value: 'timeout', label: 'Timeout' },
];

/**
 * Config editor for cancel_journey. All three reasonSource enum values are
 * exposed: a cancel node on the wait_for_webhook timeout edge is a normal
 * authoring pattern, so 'timeout' is not engine-only.
 * notifyVariableFields mirrors CompleteJourneyEditor (ordered free-text field IDs).
 */
export function CancelJourneyEditor({ config, onChange }: {
  config:   CancelJourneyConfig;
  onChange: (c: CancelJourneyConfig) => void;
}) {
  const { data: templatesData } = useQuery<{ templates: Array<{ id: string; templateName: string; status: string }> }>({
    queryKey: ['templates'],
    queryFn:  () => apiFetch('/api/whatsapp/templates'),
    staleTime: 5 * 60_000,
  });
  const approved = (templatesData?.templates ?? []).filter((t) => t.status === 'APPROVED');
  const fields = config.notifyVariableFields ?? [];

  function setFields(next: string[]) {
    if (next.length === 0) {
      const { notifyVariableFields: _drop, ...rest } = config;
      onChange(rest as CancelJourneyConfig);
      return;
    }
    onChange({ ...config, notifyVariableFields: next });
  }

  return (
    <div className="space-y-3">
      <Field label="Cancel reason" hint="Stored as cancelReason on the journey META and published on journey_cancelled.">
        <select
          value={String(config.reasonSource ?? 'manual')}
          onChange={(e) => onChange({ ...config, reasonSource: e.target.value })}
          className={selectCls}
        >
          {REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Notify template (optional)"
        hint="Best-effort WhatsApp notify after status → cancelled. Leave blank to skip."
      >
        <select
          value={config.notifyTemplateId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              const {
                notifyTemplateId: _t,
                notifyLanguage: _l,
                notifyVariableFields: _f,
                ...rest
              } = config;
              onChange(rest as CancelJourneyConfig);
              return;
            }
            onChange({ ...config, notifyTemplateId: v });
          }}
          className={selectCls}
        >
          <option value="">None</option>
          {approved.map((t) => (
            <option key={t.id} value={t.templateName}>{t.templateName}</option>
          ))}
        </select>
      </Field>

      {config.notifyTemplateId && (
        <>
          <Field label="Language">
            <select
              value={config.notifyLanguage ?? 'en'}
              onChange={(e) => onChange({ ...config, notifyLanguage: e.target.value })}
              className={selectCls}
            >
              <option value="en">English (en)</option>
              <option value="hi">Hindi (hi)</option>
              <option value="kn">Kannada (kn)</option>
              <option value="te">Telugu (te)</option>
              <option value="ta">Tamil (ta)</option>
            </select>
          </Field>

          <Field
            label="Template variables"
            hint="Ordered Journey field IDs → {{1}}, {{2}}, …. Usually empty on timeout cancels (no submit)."
          >
            <div className="space-y-2">
              {fields.map((fieldId, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-8 shrink-0 text-xs text-neutral-400">{`{{${i + 1}}}`}</span>
                  <input
                    value={fieldId}
                    onChange={(e) => {
                      const next = [...fields];
                      next[i] = e.target.value;
                      setFields(next);
                    }}
                    placeholder="field_id"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    aria-label={`Move variable ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => {
                      if (i === 0) return;
                      const next = [...fields];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setFields(next);
                    }}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move variable ${i + 1} down`}
                    disabled={i === fields.length - 1}
                    onClick={() => {
                      if (i >= fields.length - 1) return;
                      const next = [...fields];
                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                      setFields(next);
                    }}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove variable ${i + 1}`}
                    onClick={() => setFields(fields.filter((_, j) => j !== i))}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setFields([...fields, ''])}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Add variable slot
              </button>
            </div>
          </Field>
        </>
      )}
    </div>
  );
}
