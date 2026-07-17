'use client';

import Link from 'next/link';
import type { SendFlowConfig } from '@/types/automations';
import { Field } from './ActionEditor';
import { FlowPicker } from '@/components/shared/ButtonListEditor';

/**
 * Config editor for the canvas's 'send_flow' node — a dropdown-based reference
 * to a registered CONFIG#FLOW# Flow (see SendLocationEditor.tsx's identical
 * "config-time reference" shape for BranchSelect). Tapping the sent message
 * opens the Flow form directly, so there's no button config here at all —
 * unlike SendButtonsEditor/SendListEditor.
 */
export function SendFlowEditor({ config, onChange }: {
  config:   SendFlowConfig;
  onChange: (c: SendFlowConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Flow" hint="The registered WhatsApp Flow to send.">
        <FlowPicker value={config.flowId ?? ''} onChange={(flowId) => onChange({ ...config, flowId })} />
      </Field>
      <Link
        href="/settings?tab=whatsapp"
        target="_blank"
        className="inline-block text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        Manage Flows in Settings →
      </Link>
    </div>
  );
}
