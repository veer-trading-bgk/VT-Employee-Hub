'use client';

import type { SendListConfig } from '@/types/automations';
import { Field, inputCls, AmountUnitFields } from './ActionEditor';
import { ListRowEditor } from './ListRowEditor';

/**
 * Config editor for the canvas's 'send_list' node (Item 1b) — Meta's
 * WhatsApp Interactive List message, via WhatsAppSendService.sendInteractive().
 */
export function SendListEditor({ config, onChange }: {
  config:   SendListConfig;
  onChange: (c: SendListConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Message text" hint="Supported variables: {{name}}, {{phone}}.">
        <textarea
          value={config.bodyText ?? ''}
          onChange={(e) => onChange({ ...config, bodyText: e.target.value })}
          rows={3}
          placeholder="Shown to the customer above the list button"
          className={inputCls}
        />
      </Field>

      <Field label="List button text" hint="Opens the list of options — Meta limit 20 characters.">
        <input
          value={config.buttonText ?? ''}
          onChange={(e) => onChange({ ...config, buttonText: e.target.value })}
          maxLength={20}
          placeholder="View Options"
          className={inputCls}
        />
      </Field>

      <Field label="Options">
        <ListRowEditor value={config.rows ?? []} onChange={(rows) => onChange({ ...config, rows })} />
      </Field>

      <Field
        label="Reply timeout (optional)"
        hint="Connect this node's own row handles on the canvas to branch on which option is picked. If no reply arrives in time, the 'No reply' handle fires instead. Leave unset for an effectively unbounded wait."
      >
        <AmountUnitFields
          amount={config.replyTimeoutAmount ?? 2}
          unit={config.replyTimeoutUnit ?? 'hours'}
          onChange={(amount, unit) => onChange({ ...config, replyTimeoutAmount: amount, replyTimeoutUnit: unit })}
        />
      </Field>
    </div>
  );
}
