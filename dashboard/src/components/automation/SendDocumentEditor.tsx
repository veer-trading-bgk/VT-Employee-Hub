'use client';

import type { SendDocumentConfig } from '@/types/automations';
import { Field, inputCls } from './ActionEditor';
import { MediaSourceField } from './MediaSourceField';

/**
 * Config editor for the canvas's 'send_document' node. WhatsAppSendService.sendMedia()
 * already fully supports document + caption as a single Graph API call (confirmed by
 * reading it) — this node is UI/config only, plus one new AutomationEngine action
 * case that calls sendMedia() with mediaType: 'document'.
 */
export function SendDocumentEditor({ config, onChange }: {
  config:   SendDocumentConfig;
  onChange: (c: SendDocumentConfig) => void;
}) {
  const set = <K extends keyof SendDocumentConfig>(key: K, val: SendDocumentConfig[K]) =>
    onChange({ ...config, [key]: val });

  return (
    <div className="space-y-3">
      <Field label="File">
        <MediaSourceField
          value={config}
          onChange={(v) => onChange({ ...config, ...v })}
          accept="application/pdf,application/msword,.docx,.xlsx,.csv,text/plain"
        />
      </Field>

      <Field label="Filename" hint="Shown to the customer in WhatsApp's document preview.">
        <input
          value={config.filename ?? ''}
          onChange={(e) => set('filename', e.target.value)}
          placeholder="brochure.pdf"
          className={inputCls}
        />
      </Field>

      <Field label="Caption (optional)" hint="Supported variables: {{name}}, {{phone}}. Sent together with the file, not as a separate message.">
        <textarea
          value={config.caption ?? ''}
          onChange={(e) => set('caption', e.target.value)}
          rows={2}
          placeholder="Here's the document you asked about, {{name}}"
          className={inputCls}
        />
      </Field>
    </div>
  );
}
