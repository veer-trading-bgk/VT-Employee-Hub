'use client';

import type { SendInstagramMessageConfig } from '@/types/automations';
import { Field } from './ActionEditor';

/**
 * Config editor for the canvas's 'send_instagram_message' node — v1's one
 * Instagram send capability. Deliberately a single textarea: none of
 * WhatsApp's other message concepts (templates, buttons, lists, media,
 * location, Flows) exist 1:1 on Instagram's API, so there's no equivalent
 * config surface to build here yet (2026-07-18 audit).
 */
export function SendInstagramMessageEditor({ config, onChange }: {
  config:   SendInstagramMessageConfig;
  onChange: (c: SendInstagramMessageConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Message" hint="Plain text only — sent as an Instagram DM reply. Only reachable from a keyword trigger on an Instagram-sourced conversation.">
        <textarea
          value={config.messageText ?? ''}
          onChange={(e) => onChange({ ...config, messageText: e.target.value })}
          rows={4}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          placeholder="Thanks for reaching out! …"
        />
      </Field>
    </div>
  );
}
