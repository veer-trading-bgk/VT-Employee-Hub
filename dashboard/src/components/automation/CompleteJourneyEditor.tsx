'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { CompleteJourneyConfig } from '@/types/automations';
import { Field, selectCls } from './ActionEditor';

/**
 * Config editor for complete_journey. Optional confirmation template uses the
 * same approved-template select pattern as ActionEditor send_template /
 * OpenWebJourneyEditor (no shared TemplatePicker component exists).
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
              const { confirmationTemplateId: _drop, ...rest } = config;
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
    </div>
  );
}
