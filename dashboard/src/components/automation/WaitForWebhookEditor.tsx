'use client';

import type { WaitForWebhookConfig } from '@/types/automations';
import { Field, inputCls } from './ActionEditor';

/**
 * Config editor for wait_for_webhook. Timeout branching is NOT configured here —
 * same as WaitInstagramReplyEditor: the node's dual canvas handles (default =
 * webhook arrived, onTimeout handle = timeout) wire the branches. onTimeout
 * stays in config as the handle id (default `__timeout__` from Task 1) and is
 * never a form field.
 */
export function WaitForWebhookEditor({ config, onChange }: {
  config:   WaitForWebhookConfig;
  onChange: (c: WaitForWebhookConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field
        label="Webhook key (optional)"
        hint="Optional discriminator stored on the AUTO_WAIT# record. Leave blank if one wait per journey instance is enough."
      >
        <input
          value={config.webhookKey ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              const { webhookKey: _drop, ...rest } = config;
              onChange(rest as WaitForWebhookConfig);
              return;
            }
            onChange({ ...config, webhookKey: v });
          }}
          placeholder="e.g. booking"
          className={inputCls}
        />
      </Field>

      <Field
        label="Timeout (minutes)"
        hint="Connect this node's Timeout handle on the canvas to the fallback path (often Cancel Journey). Leave the Webhook handle for resumeOnWebhook."
      >
        <input
          type="number"
          min={1}
          value={String(config.timeoutMinutes ?? 60)}
          onChange={(e) => onChange({ ...config, timeoutMinutes: Number(e.target.value) || 60 })}
          className={inputCls}
        />
      </Field>
    </div>
  );
}
