'use client';

import Link from 'next/link';
import type { SendLocationConfig } from '@/types/automations';
import { Field } from './ActionEditor';
import { BranchSelect } from './BranchSelect';

/**
 * Config editor for the canvas's 'send_location' node (Item 1c) — a
 * dropdown-based reference to a saved CONFIG#BRANCH# office, resolved to real
 * coordinates at execution time by AutomationEngine.js.
 */
export function SendLocationEditor({ config, onChange }: {
  config:   SendLocationConfig;
  onChange: (c: SendLocationConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Branch" hint="The saved office location to send.">
        <BranchSelect value={config.branchId ?? ''} onChange={(branchId) => onChange({ ...config, branchId })} />
      </Field>
      <Link
        href="/settings?tab=whatsapp"
        target="_blank"
        className="inline-block text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        Manage branches in Settings →
      </Link>
    </div>
  );
}
