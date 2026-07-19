'use client';

import type { WaitInstagramReplyConfig } from '@/types/automations';
import { Field, AmountUnitFields } from './ActionEditor';

/**
 * Config editor for the canvas's 'wait_instagram_reply' node — the Follow
 * Gate's pause point (ADR-021 R5). Only a timeout duration to configure;
 * the reply/timeout branching itself is wired on the canvas via this node's
 * own two handles (WaitInstagramReplyNode.tsx), same opt-in-branch pattern
 * as send_buttons' reply timeout.
 */
export function WaitInstagramReplyEditor({ config, onChange }: {
  config:   WaitInstagramReplyConfig;
  onChange: (c: WaitInstagramReplyConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field
        label="Timeout (optional)"
        hint="Keys the wait on the IGSID captured by the preceding Send Instagram Reply node — place this node directly after one. Connect this node's own handles below to branch on whether the customer replied. Leave unset for an effectively unbounded wait."
      >
        <AmountUnitFields
          amount={config.timeoutAmount ?? 24}
          unit={config.timeoutUnit ?? 'hours'}
          onChange={(amount, unit) => onChange({ ...config, timeoutAmount: amount, timeoutUnit: unit })}
        />
      </Field>
    </div>
  );
}
