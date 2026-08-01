'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { CancelJourneyConfig } from '@/types/automations';
import { Field, selectCls } from './ActionEditor';

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
              const { notifyTemplateId: _drop, ...rest } = config;
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
    </div>
  );
}
