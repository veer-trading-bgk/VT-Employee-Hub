'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { CompleteJourneyConfig } from '@/types/automations';
import { Field, inputCls, selectCls } from './ActionEditor';

/**
 * Config editor for complete_journey. Optional confirmation template uses the
 * same approved-template select pattern as ActionEditor send_template /
 * OpenWebJourneyEditor (no shared TemplatePicker component exists).
 * confirmationVariableFields is an ordered free-text list of Journey field IDs
 * → WhatsApp {{1}}, {{2}}, … (V1 — no journeyDef-aware picker yet).
 */
export function CompleteJourneyEditor({ config, onChange }: {
  config:   CompleteJourneyConfig;
  onChange: (c: CompleteJourneyConfig) => void;
}) {
  const { data: templatesData } = useQuery<{ templates: Array<{ id: string; templateName: string; status: string }> }>({
    queryKey: ['templates'],
    queryFn:  () => apiFetch('/api/whatsapp/templates'),
    staleTime: 5 * 60_000,
  });
  const approved = (templatesData?.templates ?? []).filter((t) => t.status === 'APPROVED');
  const fields = config.confirmationVariableFields ?? [];

  function setFields(next: string[]) {
    if (next.length === 0) {
      const { confirmationVariableFields: _drop, ...rest } = config;
      onChange(rest);
      return;
    }
    onChange({ ...config, confirmationVariableFields: next });
  }

  return (
    <div className="space-y-3">
      <Field
        label="Confirmation template (optional)"
        hint="Best-effort WhatsApp notify after status → completed. Leave blank to skip."
      >
        <select
          value={config.confirmationTemplateId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              const {
                confirmationTemplateId: _t,
                confirmationLanguage: _l,
                confirmationVariableFields: _f,
                ...rest
              } = config;
              onChange(rest);
              return;
            }
            onChange({ ...config, confirmationTemplateId: v });
          }}
          className={selectCls}
        >
          <option value="">None</option>
          {approved.map((t) => (
            <option key={t.id} value={t.templateName}>{t.templateName}</option>
          ))}
        </select>
      </Field>

      {config.confirmationTemplateId && (
        <>
          <Field label="Language">
            <select
              value={config.confirmationLanguage ?? 'en'}
              onChange={(e) => onChange({ ...config, confirmationLanguage: e.target.value })}
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
            hint="Ordered Journey field IDs → {{1}}, {{2}}, …. Must match screen field ids exactly."
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
