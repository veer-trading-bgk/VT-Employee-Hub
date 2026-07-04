'use client';

import { ButtonListEditor } from '@/components/shared/ButtonListEditor';
import type { SendButtonsConfig, SendButtonsHeader } from '@/types/automations';
import { Field, inputCls, selectCls } from './ActionEditor';
import { MediaSourceField } from './MediaSourceField';

const HEADER_ACCEPT: Record<Exclude<SendButtonsHeader['type'], undefined>, string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf',
};

/**
 * Config editor for the canvas's 'send_buttons' node — reuses ButtonListEditor.tsx
 * verbatim (the same component WelcomeMessagePanel.tsx uses), since a node here
 * sends the identical message shape a welcome-message config does, just mid-workflow.
 * Deliberately narrower than the welcome-message messageType selector: no 'template'
 * option, since that's what the existing 'send_template' node type already covers.
 */
export function SendButtonsEditor({ config, onChange }: {
  config:   SendButtonsConfig;
  onChange: (c: SendButtonsConfig) => void;
}) {
  const set = <K extends keyof SendButtonsConfig>(key: K, val: SendButtonsConfig[K]) =>
    onChange({ ...config, [key]: val });

  return (
    <div className="space-y-3">
      <Field label="Message type">
        <select
          value={config.messageType}
          onChange={(e) => set('messageType', e.target.value as SendButtonsConfig['messageType'])}
          className={selectCls}
        >
          <option value="reply_buttons">Reply buttons (up to 3)</option>
          <option value="cta_buttons">CTA button (1 URL button)</option>
        </select>
      </Field>

      <Field label="Message text" hint="Supported variables: {{name}}, {{phone}}.">
        <textarea
          value={config.bodyText}
          onChange={(e) => set('bodyText', e.target.value)}
          rows={3}
          placeholder="Shown to the customer above the button(s)"
          className={inputCls}
        />
      </Field>

      {config.messageType === 'reply_buttons' ? (
        <ButtonListEditor
          mode="reply"
          value={config.buttons ?? []}
          onChange={(v) => set('buttons', v)}
        />
      ) : (
        <ButtonListEditor
          mode="cta"
          value={config.ctaButtons ?? []}
          onChange={(v) => set('ctaButtons', v)}
        />
      )}

      <Field label="Header (optional)" hint="An image, video, or document shown above the message text.">
        <select
          value={config.header?.type ?? ''}
          onChange={(e) => {
            const type = e.target.value as SendButtonsHeader['type'] | '';
            set('header', type ? { type } : undefined);
          }}
          className={selectCls}
        >
          <option value="">No header</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="document">Document</option>
        </select>
      </Field>

      {config.header?.type && (
        <MediaSourceField
          value={config.header}
          onChange={(v) => set('header', { type: config.header!.type, ...v })}
          accept={HEADER_ACCEPT[config.header.type]}
        />
      )}
    </div>
  );
}
