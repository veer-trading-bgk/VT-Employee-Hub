'use client';

import type { MetaSignalConfig, MetaSignalEventName } from '@/types/automations';
import { META_SIGNAL_EVENTS } from '@/types/automations';
import { Field, selectCls } from './ActionEditor';

/**
 * Config editor for the canvas's 'meta_signal' node — reports a conversion
 * event to Meta's Conversions API for the lead reaching this node.
 *
 * The event name is a dropdown of Meta's FIXED business-messaging event list
 * (META_SIGNAL_EVENTS), deliberately not free text: the BM Conversions API
 * does not accept custom event names (doc-verified 2026-07-18), so a typed
 * "DematOpened" would be silently unusable at Meta. Per-product identity
 * (Demat vs MF vs Insurance) stays in APForce's tags/workflows — one
 * workflow per conversion tag, each mapped to a standard Meta event here.
 *
 * The value selector's options are the lead's numeric money fields — today
 * exactly one exists (expectedValue, see CustomerIdentityService's lead
 * shape); this stays a select (not free text) so a typo can't silently
 * drop values from every event.
 */
const VALUE_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'No value — event only' },
  { value: 'expectedValue', label: 'Expected Value (₹, from the lead\'s CRM tab)' },
];

export function MetaSignalEditor({ config, onChange }: {
  config:   MetaSignalConfig;
  onChange: (c: MetaSignalConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Meta event" hint="Meta's Conversions API for WhatsApp accepts only these standard events — custom names are not supported.">
        <select
          value={config.metaEventName ?? ''}
          onChange={(e) => onChange({ ...config, metaEventName: e.target.value as MetaSignalEventName | '' })}
          className={selectCls}
        >
          <option value="">Select event…</option>
          {META_SIGNAL_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
        </select>
      </Field>
      <Field label="Conversion value (optional)" hint="Attach the lead's amount as the event's value in INR. Leads without the amount set send cleanly without a value. Note: Meta requires a value for Purchase events.">
        <select
          value={config.valueField ?? ''}
          onChange={(e) => onChange({ ...config, valueField: e.target.value || undefined })}
          className={selectCls}
        >
          {VALUE_FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <p className="text-[11px] leading-relaxed text-neutral-400">
        Reports at most once per lead per event, and only for leads that arrived
        via a Click-to-WhatsApp ad — organic leads are skipped silently.
      </p>
    </div>
  );
}
