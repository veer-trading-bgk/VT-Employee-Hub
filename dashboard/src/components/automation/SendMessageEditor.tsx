'use client';

import type { SendMessageConfig } from '@/types/automations';
import { Field, inputCls } from './ActionEditor';

/**
 * Config editor for the canvas's 'send_message' node (Item 1a) — freeform
 * text via WhatsAppSendService.sendText(). The 24h-window note is a hint,
 * not a live check: a workflow author can't know in advance exactly when
 * this node will fire relative to the customer's last inbound message — Meta
 * itself is the actual enforcement point, same wording as ConversationTab.tsx's
 * own 24h-window banner.
 */
export function SendMessageEditor({ config, onChange }: {
  config:   SendMessageConfig;
  onChange: (c: SendMessageConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Message text" hint="Supported variables: {{name}}, {{phone}}.">
        <textarea
          value={config.messageText ?? ''}
          onChange={(e) => onChange({ ...config, messageText: e.target.value })}
          rows={4}
          placeholder="Hi {{name}}, just checking in..."
          className={inputCls}
        />
      </Field>
      <p className="rounded-lg bg-warning-50 px-3 py-2 text-[11px] text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
        Only works within WhatsApp&apos;s 24-hour customer service window — the customer must have messaged within the last 24h when this step runs. Outside that window, use a Send Template node instead.
      </p>
    </div>
  );
}
