'use client';

import type { CreateJourneyRecordConfig } from '@/types/automations';
import { Field } from './ActionEditor';

/**
 * Config editor for create_journey_record. recordSchema is intentionally
 * omitted — typed as unknown for scoped future work; do not add a JSON editor.
 * linkToContact is not in the Task 1 type (backend reserved V1).
 */
export function CreateJourneyRecordEditor({ config, onChange }: {
  config:   CreateJourneyRecordConfig;
  onChange: (c: CreateJourneyRecordConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field
        label="Link to lead"
        hint="When enabled, resolves/creates a lead via CustomerIdentityService (ADR-013) using the journey context phone."
      >
        <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
          <input
            type="checkbox"
            checked={Boolean(config.linkToLead)}
            onChange={(e) => onChange({ ...config, linkToLead: e.target.checked })}
            className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          Call CIS.resolveOrCreate before writing RECORD
        </label>
      </Field>
      <p className="text-[11px] leading-relaxed text-neutral-400">
        Record schema is not configurable in V1 — payload comes from the webhook
        body (journeyRecord / submittedData) at runtime.
      </p>
    </div>
  );
}
