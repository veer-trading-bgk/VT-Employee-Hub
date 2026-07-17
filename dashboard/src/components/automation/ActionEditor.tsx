'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useEmployeesList } from '@/hooks/useEmployeesList';
import { useTagCatalog } from '@/hooks/useTagCatalog';
import type { WorkflowStep } from '@/types/automations';

// ── Shared styles — also used by WorkflowBuilder.tsx's TriggerEditor ─────────
export const inputCls  = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
export const selectCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

/**
 * Per-action-type config editor for the canvas's node side panel
 * (NodeConfigPanel.tsx's fallback for plain action-type nodes). A graph
 * action node's `config` is byte-identical to a legacy linear step's
 * `config` (same StepConfig union, see types/automations.ts) — this editor
 * predates the single-editor migration (2026-07-10) and was originally
 * shared with the now-removed linear builder too, which is why the config
 * shape still matches so exactly.
 */
export function ActionEditor({ step, onChange }: { step: WorkflowStep; onChange: (c: WorkflowStep['config']) => void }) {
  const cfg = step.config as Record<string, unknown>;

  // Shared data
  const { data: templatesData } = useQuery<{ templates: Array<{ id: string; templateName: string; status: string }> }>({
    queryKey: ['templates'],
    queryFn:  () => apiFetch('/api/whatsapp/templates'),
    staleTime: 5 * 60_000,
    enabled:  step.type === 'send_template',
  });
  // Canonical employees list — the old inline query here read `.employees`
  // off a response shaped `{ success, data: [...] }`, so it was always empty
  // regardless of role; this also silently excluded admin/superadmin like
  // every other duplicate employee-fetch this hook replaces.
  const { employees } = useEmployeesList({ enabled: step.type === 'assign_employee' });
  // GET /api/tags returns { success, tags: Tag[] } (full {id, label, color, ...}
  // objects), not string[] — useTagCatalog() is the canonical, correctly-typed
  // owner of the ['tag-catalog'] query (see docs/phase3/TECHNICAL_DEBT.md: the
  // former inline useQuery<{tags: string[]}> here rendered raw Tag objects as
  // <option> children, throwing "Objects are not valid as a React child").
  const { tags: tagCatalog } = useTagCatalog();
  const { stages: pipelineStages } = usePipelineStages();

  const set = (key: string, value: unknown) => onChange({ ...cfg, [key]: value } as WorkflowStep['config']);

  switch (step.type) {
    case 'send_template': {
      const approved = (templatesData?.templates ?? []).filter((t) => t.status === 'APPROVED');
      return (
        <div className="space-y-3">
          <Field label="Template">
            <select value={String(cfg.templateName ?? '')} onChange={(e) => set('templateName', e.target.value)} className={selectCls}>
              <option value="">Select approved template…</option>
              {approved.map((t) => <option key={t.id} value={t.templateName}>{t.templateName}</option>)}
            </select>
          </Field>
          <Field label="Language">
            <select value={String(cfg.language ?? 'en')} onChange={(e) => set('language', e.target.value)} className={selectCls}>
              <option value="en">English (en)</option>
              <option value="hi">Hindi (hi)</option>
              <option value="kn">Kannada (kn)</option>
              <option value="te">Telugu (te)</option>
              <option value="ta">Tamil (ta)</option>
            </select>
          </Field>
          <Field label="Variables" hint="One per line. Use {{name}} or {{phone}} for dynamic values.">
            <textarea
              rows={3}
              value={((cfg.variables as string[]) ?? []).join('\n')}
              onChange={(e) => set('variables', e.target.value.split('\n').filter(Boolean))}
              placeholder="{{name}}&#10;{{phone}}"
              className={cn(inputCls, 'resize-none')}
            />
          </Field>
        </div>
      );
    }

    case 'assign_employee': {
      return (
        <Field label="Employee">
          <select
            value={String(cfg.employeeId ?? '')}
            onChange={(e) => {
              const emp = employees.find((x) => x.id === e.target.value);
              onChange({ ...cfg, employeeId: e.target.value, employeeName: emp?.name ?? null } as WorkflowStep['config']);
            }}
            className={selectCls}
          >
            <option value="">Select employee…</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </Field>
      );
    }

    case 'change_stage': {
      return (
        <Field label="New Stage">
          <select value={String(cfg.stage ?? '')} onChange={(e) => set('stage', e.target.value)} className={selectCls}>
            <option value="">Select stage…</option>
            {pipelineStages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
      );
    }

    case 'add_tag': {
      return (
        <Field label="Tag">
          {tagCatalog.length > 0 ? (
            <select value={String(cfg.tag ?? '')} onChange={(e) => set('tag', e.target.value)} className={selectCls}>
              <option value="">Select tag…</option>
              {tagCatalog.map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
            </select>
          ) : (
            <input value={String(cfg.tag ?? '')} onChange={(e) => set('tag', e.target.value)} placeholder="Tag name" className={inputCls} />
          )}
        </Field>
      );
    }

    case 'create_task': {
      return (
        <div className="space-y-3">
          <Field label="Days from now">
            <input
              type="number"
              min={1}
              max={365}
              value={String(cfg.daysFromNow ?? 1)}
              onChange={(e) => set('daysFromNow', Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Note (optional)">
            <input
              value={String(cfg.note ?? '')}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Follow up with this contact"
              className={inputCls}
            />
          </Field>
        </div>
      );
    }

    case 'start_ai_conversation': {
      return (
        <Field
          label="Context hint (optional)"
          hint="Seeds the AI's first turn — e.g. a tapped button's category, so it can skip re-asking. Supports {{name}}/{{phone}}/{{trait.*}}. Leave blank for a neutral opener."
        >
          <textarea
            rows={2}
            value={String(cfg.contextHint ?? '')}
            onChange={(e) => set('contextHint', e.target.value)}
            placeholder="Customer is interested in: Demat Account"
            className={cn(inputCls, 'resize-none')}
          />
        </Field>
      );
    }

    case 'wait': {
      return (
        <AmountUnitFields
          amount={Number(cfg.amount ?? 5)}
          unit={String(cfg.unit ?? 'minutes') as 'minutes' | 'hours' | 'days'}
          onChange={(amount, unit) => onChange({ ...cfg, amount, unit } as WorkflowStep['config'])}
        />
      );
    }

    default:
      return null;
  }
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{label}</label>
      {hint && <p className="mb-1.5 text-[11px] text-neutral-400">{hint}</p>}
      {children}
    </div>
  );
}

/**
 * Amount + unit (minutes/hours/days) pair — shared by the `wait` action's config
 * above and the branching canvas's `button_reply` condition timeout config, since
 * both are "how long to wait" inputs with the identical three units.
 */
export function AmountUnitFields({ amount, unit, onChange }: {
  amount: number;
  unit: 'minutes' | 'hours' | 'days';
  onChange: (amount: number, unit: 'minutes' | 'hours' | 'days') => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        value={String(amount)}
        onChange={(e) => onChange(Number(e.target.value), unit)}
        className={cn(inputCls, 'w-20')}
      />
      <select
        value={unit}
        onChange={(e) => onChange(amount, e.target.value as 'minutes' | 'hours' | 'days')}
        className={cn(selectCls, 'flex-1')}
      >
        <option value="minutes">Minutes</option>
        <option value="hours">Hours</option>
        <option value="days">Days</option>
      </select>
    </div>
  );
}
