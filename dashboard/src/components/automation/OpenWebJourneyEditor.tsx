'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OpenWebJourneyConfig } from '@/types/automations';
import { Field, inputCls, selectCls } from './ActionEditor';
import { fetchJourneyDefinitions, journeyKeys } from '@/lib/journeys/api';
import { apiFetch } from '@/lib/api';

/**
 * Config editor for open_web_journey. Template select mirrors ActionEditor's
 * send_template picker (same ['templates'] query + APPROVED filter) — there is
 * no shared TemplatePicker component to reuse; do not invent a second abstraction.
 * Journey definition select mirrors JourneyDefinitionDrawer's linkedWorkflowId
 * picker (journeyKeys.list + active filter + orphan option).
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

  // Same ownership as Settings Journey Definitions list — do not invent a second key.
  const { data: definitions = [], isLoading: defsLoading } = useQuery({
    queryKey: journeyKeys.list(),
    queryFn: fetchJourneyDefinitions,
    staleTime: 60_000,
  });

  const definitionOptions = useMemo(() => {
    const options = [
      { value: '', label: defsLoading ? 'Loading definitions…' : 'Select journey definition…' },
      ...definitions
        .filter((d) => d.active !== false)
        .map((d) => ({ value: d.id, label: d.name || d.id })),
    ];
    // Orphan: inactive / missing from active filter — keep selection visible (linkedWorkflowId pattern).
    if (
      config.journeyDefId
      && !options.some((o) => o.value === config.journeyDefId)
    ) {
      const orphan = definitions.find((d) => d.id === config.journeyDefId);
      options.push({
        value: config.journeyDefId,
        label: orphan
          ? `${orphan.name} (inactive)`
          : `${config.journeyDefId} (unavailable)`,
      });
    }
    return options;
  }, [definitions, defsLoading, config.journeyDefId]);

  return (
    <div className="space-y-3">
      <Field
        label="Template"
        hint="Two supported shapes: (1) Body-link (legacy) — body {{1}} receives the full journey URL. (2) CTA button — template Dynamic URL must be …/journey/{{1}}; the path (companyId/instanceId/token) is filled automatically at send time — do not type a button suffix here."
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

      <Field
        label="Journey definition"
        hint="Active definitions from Settings → Journey Definitions. Inactive ones stay selectable if already bound."
      >
        <select
          value={config.journeyDefId ?? ''}
          onChange={(e) => onChange({ ...config, journeyDefId: e.target.value })}
          className={selectCls}
          disabled={defsLoading && !config.journeyDefId}
        >
          {definitionOptions.map((o) => (
            <option key={o.value || '__placeholder__'} value={o.value} disabled={o.value === ''}>
              {o.label}
            </option>
          ))}
        </select>
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
