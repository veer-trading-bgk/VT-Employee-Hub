'use client';

import { cn } from '@/lib/cn';
import type { ConditionNodeConfig, ConditionMode, ConditionField, ConditionOperator } from '@/types/automations';
import { Field, inputCls, selectCls, AmountUnitFields } from './ActionEditor';
import { BranchListEditor } from './BranchListEditor';

const FIELD_OPTIONS: Array<{ value: ConditionField; label: string }> = [
  { value: 'stage',      label: 'Stage' },
  { value: 'from_stage', label: 'From Stage' },
  { value: 'to_stage',   label: 'To Stage' },
  { value: 'source',     label: 'Source' },
  { value: 'tags',       label: 'Tags' },
  { value: 'assignedTo', label: 'Assigned To' },
];

const OPERATOR_OPTIONS: Array<{ value: ConditionOperator; label: string }> = [
  { value: 'equals',       label: 'is' },
  { value: 'not_equals',   label: 'is not' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'exists',       label: 'exists' },
  { value: 'not_exists',   label: 'not exists' },
];

const MODE_META: Record<ConditionMode, { label: string; description: string }> = {
  field_match:  { label: 'CRM field match',   description: 'Branch on the lead\'s current stage, tags, source, or assignment — re-checked live when this node runs.' },
  boolean:      { label: 'Yes / No',          description: 'A single true/false check on one field.' },
  button_reply: { label: 'WhatsApp button reply', description: 'Pause and branch on which reply button the contact taps (or a timeout).' },
};

/**
 * Config editor for the graph canvas's `condition` node type — the one genuinely
 * new node kind added in Phase 1 (every other node type reuses ActionEditor).
 */
export function ConditionEditor({ config, onChange }: {
  config:   ConditionNodeConfig;
  onChange: (c: ConditionNodeConfig) => void;
}) {
  const set = <K extends keyof ConditionNodeConfig>(key: K, val: ConditionNodeConfig[K]) =>
    onChange({ ...config, [key]: val });

  const branches = config.branches ?? [];

  return (
    <div className="space-y-3">
      <Field label="Condition type">
        <select
          value={config.mode}
          onChange={(e) => onChange({ mode: e.target.value as ConditionMode })}
          className={selectCls}
        >
          {(Object.keys(MODE_META) as ConditionMode[]).map((m) => (
            <option key={m} value={m}>{MODE_META[m].label}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-neutral-400">{MODE_META[config.mode].description}</p>
      </Field>

      {(config.mode === 'field_match' || config.mode === 'boolean') && (
        <div className="flex items-center gap-2">
          <select
            value={config.field ?? 'stage'}
            onChange={(e) => set('field', e.target.value as ConditionField)}
            className={cn(selectCls, 'flex-1')}
          >
            {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select
            value={config.operator ?? 'equals'}
            onChange={(e) => set('operator', e.target.value as ConditionOperator)}
            className={cn(selectCls, 'w-32')}
          >
            {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {config.mode === 'boolean' && !['exists', 'not_exists'].includes(config.operator ?? 'equals') && (
        <Field label="Value">
          <input
            value={config.value ?? ''}
            onChange={(e) => set('value', e.target.value)}
            placeholder="Comparison value"
            className={inputCls}
          />
        </Field>
      )}
      {config.mode === 'boolean' && (
        <p className="text-[11px] text-neutral-400">Outcomes: <span className="font-medium">Yes</span> / <span className="font-medium">No</span> — fixed, not editable.</p>
      )}

      {config.mode === 'field_match' && (
        <Field label="Branches" hint="First matching branch wins. Re-checked against the lead's current state, not the state when the workflow started.">
          <BranchListEditor mode="field_match" value={branches} onChange={(v) => set('branches', v)} />
        </Field>
      )}

      {config.mode === 'button_reply' && (
        <>
          <Field
            label="Buttons"
            hint="Type the button id manually — must match what an earlier step actually sends."
          >
            <BranchListEditor
              mode="button_reply"
              value={branches}
              onChange={(v) => set('branches', v)}
              maxBranches={3}
            />
          </Field>
          <Field label="Timeout (optional)" hint="If no reply arrives in time, the fallback branch below fires instead.">
            <AmountUnitFields
              amount={config.timeoutAmount ?? 2}
              unit={config.timeoutUnit ?? 'hours'}
              onChange={(amount, unit) => onChange({ ...config, timeoutAmount: amount, timeoutUnit: unit })}
            />
          </Field>
        </>
      )}

      {(config.mode === 'field_match' || config.mode === 'button_reply') && branches.length > 0 && (
        <Field label="Fallback branch" hint="Followed when nothing matches (field_match) or on timeout (button reply).">
          <select
            value={config.fallbackKey ?? ''}
            onChange={(e) => set('fallbackKey', e.target.value || undefined)}
            className={selectCls}
          >
            <option value="">None — end here</option>
            {branches.map((b) => <option key={b.key} value={b.key}>{b.label || b.key}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}
