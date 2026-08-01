'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { OpenWebJourneyConfig } from '@/types/automations';
import { Field, inputCls, selectCls } from './ActionEditor';

/**
 * Config editor for open_web_journey. Template select mirrors ActionEditor's
 * send_template picker (same ['templates'] query + APPROVED filter) — there is
 * no shared TemplatePicker component to reuse; do not invent a second abstraction.
 */
export function OpenWebJourneyEditor({ config, onChange }: {
  config:   OpenWebJourneyConfig;
  onChange: (c: OpenWebJourneyConfig) => void;
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
        label="Template"
        hint="WhatsApp template that receives the journey URL as its first variable (same approved list as Send Template)."
      >
        <select
          value={config.templateId ?? ''}
          onChange={(e) => onChange({ ...config, templateId: e.target.value })}
          className={selectCls}
        >
          <option value="">Select approved template…</option>
          {approved.map((t) => (
            <option key={t.id} value={t.templateName}>{t.templateName}</option>
          ))}
        </select>
      </Field>

      {/* Task 3 dependency: Journey Definition list/picker does not exist yet —
          free-text journeyDefId until admin defs UI can feed a real select. */}
      <Field
        label="Journey definition ID"
        hint="Paste a journeydef_… id for now. Task 3 will replace this with a definition picker."
      >
        <input
          value={config.journeyDefId ?? ''}
          onChange={(e) => onChange({ ...config, journeyDefId: e.target.value })}
          placeholder="journeydef_…"
          className={inputCls}
        />
      </Field>

      <Field label="Expiry (minutes)" hint="Optional. Defaults to 60 when the node is first added.">
        <input
          type="number"
          min={1}
          value={config.expiryMinutes ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({
              ...config,
              deliveryChannel: 'whatsapp',
              ...(raw === '' ? { expiryMinutes: undefined } : { expiryMinutes: Number(raw) }),
            });
          }}
          placeholder="60"
          className={inputCls}
        />
      </Field>

      <Field
        label="Delivery channel"
        hint="Fixed to WhatsApp — the only channel implemented today; backend does not read this field yet."
      >
        <input
          value="whatsapp"
          disabled
          readOnly
          className={`${inputCls} cursor-not-allowed opacity-70`}
        />
      </Field>
    </div>
  );
}
