'use client';

import {
  MessageCircle, UserPlus, GitMerge, Tag, CheckSquare, Timer, Square,
  Zap, Hash, Webhook, Copy, RefreshCw, X, Plus, FileText, Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { API_URL, apiFetch } from '@/lib/api';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useEmployeesList } from '@/hooks/useEmployeesList';
import { useTagCatalog } from '@/hooks/useTagCatalog';
import {
  type WorkflowTrigger, type WorkflowStep, type ActionType,
  type TriggerType, type KeywordMatchMode, type KeywordTriggerConfig,
  type WorkflowCondition,
  TRIGGER_META,
} from '@/types/automations';
import { inputCls, selectCls } from './ActionEditor';

// Single-editor migration (2026-07-10, docs/phase3/TECHNICAL_DEBT.md): the
// linear step-sequence builder (WorkflowBuilder component, StepCard,
// Connector, stepSummary) was removed along with WorkflowCreateDrawer.tsx,
// its only caller — the canvas is now the only editor. This file survives
// with a narrower scope because ACTION_ICONS, TriggerEditor, and
// defaultConfig are genuinely shared with the branching canvas
// (NodeConfigPanel.tsx, NodePalette.tsx, WorkflowCanvas.tsx, TriggerConfigPanel.tsx
// all import from here) — confirmed via a repo-wide grep before removing
// anything, same discipline as the ContactHeader deletion.

// ── Icons per action/trigger — also used by the branching canvas's node components ──
export const ACTION_ICONS: Record<string, React.ElementType> = {
  send_template:                MessageCircle,
  assign_employee:              UserPlus,
  change_stage:                 GitMerge,
  add_tag:                      Tag,
  create_task:                  CheckSquare,
  start_ai_conversation:        Bot,
  wait:                         Timer,
  end:                          Square,
  whatsapp_conversation_started:MessageCircle,
  lead_created:                 UserPlus,
  stage_changed:                GitMerge,
  stage_change:                 GitMerge,
  tag_added:                    Tag,
  campaign_completed:           Zap,
  keyword_message:              Hash,
  inbound_webhook:              Webhook,
  form_submitted:               FileText,
};

// ── Trigger editor ────────────────────────────────────────────────────────────
// Exported so the branching canvas's TriggerConfigPanel can reuse this exact
// same editor (and dropdown) rather than building a second one — the canvas's
// TriggerNode has no config UI of its own, this is the only trigger editor.
export function TriggerEditor({ trigger, onChange, workflowId }: { trigger: WorkflowTrigger; onChange: (t: WorkflowTrigger) => void; workflowId?: string }) {
  const TRIGGER_OPTIONS: TriggerType[] = [
    'whatsapp_conversation_started', 'lead_created', 'stage_changed', 'tag_added', 'keyword_message', 'inbound_webhook', 'form_submitted',
  ];

  // Only the two heavier picker fetches below are gated behind `enabled`.
  // usePipelineStages()/useTagCatalog() have no `enabled` param in their hook
  // signatures — they're cheap, single-item reads already shared (same query
  // keys) with other parts of this page tree, so gating them would mean
  // widening two hooks used by many other callers just for this. Employees
  // and crm-analytics are heavier (the latter runs two full-table scans), so
  // those two actually fetch only when a condition row needs that field —
  // mirrors ActionEditor.tsx's per-action-type `enabled` gating.
  const hasAssignedToCondition = trigger.conditions.some((c) => c.field === 'assignedTo');
  const hasSourceCondition     = trigger.conditions.some((c) => c.field === 'source');

  const { stages: pipelineStages } = usePipelineStages();
  const { tags: tagCatalog } = useTagCatalog();
  const { employees } = useEmployeesList({ enabled: hasAssignedToCondition });
  // No fixed 'source' enum exists anywhere in the codebase — src/routes/*.js sets it to
  // whatever a given entry point hardcodes ('whatsapp', 'inbound_webhook', 'meta_lead_ads', …)
  // and the two frontend SOURCE_OPTIONS lists (NewContactDrawer.tsx, CrmTab.tsx) are manual-entry
  // conveniences that disagree with each other and don't cover automation-set values — neither is
  // authoritative. Reusing GET /api/crm/crm-analytics's per-company `bySource` breakdown (no new
  // backend route) for the real distinct values actually seen on this company's leads instead.
  const { data: sourceAnalytics } = useQuery<{ bySource?: Array<{ source: string; count: number }> }>({
    queryKey: ['crm-analytics'],
    queryFn:  () => apiFetch('/api/crm/crm-analytics'),
    staleTime: 5 * 60_000,
    enabled:  hasSourceCondition,
  });
  const sourceValues = (sourceAnalytics?.bySource ?? []).map((b) => b.source).filter(Boolean);

  function addCondition() {
    onChange({ ...trigger, conditions: [...trigger.conditions, { field: 'stage', operator: 'equals', value: '' }] });
  }

  function removeCondition(i: number) {
    const next = [...trigger.conditions];
    next.splice(i, 1);
    onChange({ ...trigger, conditions: next });
  }

  function updateCondition(i: number, patch: Partial<WorkflowTrigger['conditions'][0]>) {
    const next = trigger.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c);
    onChange({ ...trigger, conditions: next });
  }

  // Value control per condition field — stores the underlying key/id (comparable
  // to what AutomationEngine.js's _ctxField() actually resolves at evaluation
  // time), displays the human label. 'source' has no backend-enforced enum (see
  // the sourceValues comment above), so it stays a free-text input with a
  // native <datalist> of real, per-company values as suggestions rather than a
  // closed <select> — an admin can still type a source value this company
  // hasn't produced yet, matching the fact that the field itself isn't validated
  // against a fixed list anywhere on the backend either.
  function conditionValueControl(c: WorkflowCondition, i: number) {
    const onValueChange = (value: string) => updateCondition(i, { value });

    if (c.field === 'stage' || c.field === 'from_stage' || c.field === 'to_stage') {
      return (
        <select value={c.value ?? ''} onChange={(e) => onValueChange(e.target.value)} className={cn(selectCls, 'flex-1')}>
          <option value="">Select stage…</option>
          {pipelineStages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      );
    }
    if (c.field === 'assignedTo') {
      return (
        <select value={c.value ?? ''} onChange={(e) => onValueChange(e.target.value)} className={cn(selectCls, 'flex-1')}>
          <option value="">Select employee…</option>
          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
      );
    }
    if (c.field === 'tags') {
      return (
        <select value={c.value ?? ''} onChange={(e) => onValueChange(e.target.value)} className={cn(selectCls, 'flex-1')}>
          <option value="">Select tag…</option>
          {tagCatalog.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      );
    }
    if (c.field === 'source') {
      const listId = `condition-source-options-${i}`;
      return (
        <>
          <input
            list={listId}
            value={c.value ?? ''}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="e.g. whatsapp"
            className={cn(inputCls, 'flex-1')}
          />
          <datalist id={listId}>
            {sourceValues.map((s) => <option key={s} value={s} />)}
          </datalist>
        </>
      );
    }
    return (
      <input value={c.value ?? ''} onChange={(e) => onValueChange(e.target.value)} placeholder="value" className={cn(inputCls, 'flex-1')} />
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Trigger event</label>
        <select
          value={trigger.type}
          onChange={(e) => onChange({ ...trigger, type: e.target.value as TriggerType })}
          className={selectCls}
        >
          {TRIGGER_OPTIONS.map((t) => (
            <option key={t} value={t}>{TRIGGER_META[t]?.label ?? t}</option>
          ))}
        </select>
        {TRIGGER_META[trigger.type] && (
          <p className="mt-1 text-[11px] text-neutral-400">{TRIGGER_META[trigger.type].description}</p>
        )}
      </div>

      {trigger.type === 'keyword_message' && (
        <KeywordConfigFields
          config={trigger.config ?? { matchMode: 'contains', keywords: [''], caseSensitive: false }}
          onChange={(config) => onChange({ ...trigger, config })}
        />
      )}

      {trigger.type === 'inbound_webhook' && (
        <WebhookConfigFields trigger={trigger} onChange={onChange} workflowId={workflowId} />
      )}

      {/* Conditions */}
      {trigger.conditions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Conditions (all must match)</p>
          {trigger.conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={c.field}
                onChange={(e) => updateCondition(i, { field: e.target.value as typeof c.field })}
                className={cn(selectCls, 'flex-1')}
              >
                <option value="stage">Stage</option>
                <option value="from_stage">From Stage</option>
                <option value="to_stage">To Stage</option>
                <option value="source">Source</option>
                <option value="tags">Tags</option>
                <option value="assignedTo">Assigned To</option>
              </select>
              <select
                value={c.operator}
                onChange={(e) => updateCondition(i, { operator: e.target.value as typeof c.operator })}
                className={cn(selectCls, 'w-28')}
              >
                <option value="equals">is</option>
                <option value="not_equals">is not</option>
                <option value="contains">contains</option>
                <option value="not_contains">not contains</option>
                <option value="exists">exists</option>
                <option value="not_exists">not exists</option>
              </select>
              {!['exists', 'not_exists'].includes(c.operator) && conditionValueControl(c, i)}
              <button onClick={() => removeCondition(i)} className="shrink-0 rounded p-1 text-neutral-400 hover:text-error-500">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={addCondition}
        className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        <Plus className="h-3.5 w-3.5" /> Add condition
      </button>
    </div>
  );
}

// ── Keyword trigger config — exact/contains use a single phrase input,
// any_of uses a repeatable keyword list (same add/remove-row pattern as the
// conditions list above, for visual/interaction consistency). Also matches a
// button or list-row tap whose title matches the same rules — no separate
// toggle for that, it's always on for this trigger type.
function KeywordConfigFields({ config, onChange }: { config: KeywordTriggerConfig; onChange: (c: KeywordTriggerConfig) => void }) {
  const keywords = config.keywords.length > 0 ? config.keywords : [''];

  function setMode(matchMode: KeywordMatchMode) {
    // exact/contains use only the first slot; any_of keeps the full list.
    onChange({ ...config, matchMode, keywords: matchMode === 'any_of' ? keywords : [keywords[0] ?? ''] });
  }

  function updateKeyword(i: number, value: string) {
    onChange({ ...config, keywords: keywords.map((k, idx) => (idx === i ? value : k)) });
  }

  function addKeyword() {
    onChange({ ...config, keywords: [...keywords, ''] });
  }

  function removeKeyword(i: number) {
    const next = keywords.filter((_, idx) => idx !== i);
    onChange({ ...config, keywords: next.length > 0 ? next : [''] });
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Match mode</label>
        <select value={config.matchMode} onChange={(e) => setMode(e.target.value as KeywordMatchMode)} className={selectCls}>
          <option value="exact">Exact match</option>
          <option value="contains">Contains</option>
          <option value="any_of">Any of these keywords</option>
        </select>
      </div>

      {config.matchMode === 'any_of' ? (
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Keywords (any one matches)</label>
          {keywords.map((kw, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={kw}
                onChange={(e) => updateKeyword(i, e.target.value)}
                placeholder="e.g. demat"
                className={cn(inputCls, 'flex-1')}
              />
              <button onClick={() => removeKeyword(i)} className="shrink-0 rounded p-1 text-neutral-400 hover:text-error-500">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={addKeyword}
            className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add keyword
          </button>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            {config.matchMode === 'exact' ? 'Exact phrase' : 'Phrase'}
          </label>
          <input
            value={keywords[0] ?? ''}
            onChange={(e) => onChange({ ...config, keywords: [e.target.value] })}
            placeholder={config.matchMode === 'exact' ? 'e.g. yes' : 'e.g. demat'}
            className={inputCls}
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={config.caseSensitive ?? false}
          onChange={(e) => onChange({ ...config, caseSensitive: e.target.checked })}
          className="rounded border-neutral-300"
        />
        Case-sensitive
      </label>

      <p className="text-[11px] text-neutral-400">
        Also matches when a customer taps a button or list option with matching text.
      </p>
    </div>
  );
}

// ── Inbound webhook trigger config — read-only URL (companyId/workflowId are
// baked into the path itself; the token is the actual bearer credential, see
// automations.js's handleInboundWebhook). The URL only exists once the workflow
// has been saved at least once with this trigger type — workflowId is undefined
// for a brand-new, not-yet-saved workflow, and webhookToken is undefined until
// the server has generated and returned one.
function WebhookConfigFields({ trigger, onChange, workflowId }: {
  trigger:     WorkflowTrigger;
  onChange:    (t: WorkflowTrigger) => void;
  workflowId?: string;
}) {
  const { user } = useAuth();
  const webhookUrl = workflowId && trigger.webhookToken
    ? `${API_URL}/api/automations/webhook/${user?.companyId}/${workflowId}/${trigger.webhookToken}`
    : null;

  function copyUrl() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl)
      .then(() => toast.success('Webhook URL copied'))
      .catch(() => toast.error('Could not copy — copy it manually'));
  }

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">Webhook URL</label>
      {webhookUrl ? (
        <>
          <div className="flex items-center gap-2">
            <input readOnly value={webhookUrl} className={cn(inputCls, 'flex-1 truncate font-mono text-[11px]')} />
            <button
              type="button"
              onClick={copyUrl}
              className="shrink-0 rounded-lg border border-neutral-200 p-1.5 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              aria-label="Copy webhook URL"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...trigger, regenerateToken: true })}
            disabled={trigger.regenerateToken}
            className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50 dark:text-primary-400"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {trigger.regenerateToken ? 'Will regenerate on save' : 'Regenerate URL'}
          </button>
          {trigger.regenerateToken && (
            <p className="text-[11px] text-warning-600 dark:text-warning-400">
              Save to apply. The current URL above keeps working until then; afterward, anything still posting to it will get a 404.
            </p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-neutral-400">Save this workflow to generate its webhook URL.</p>
      )}
      <p className="text-[11px] text-neutral-400">
        POST JSON {'{ phone, name?, email? }'} to this URL to run this workflow for that contact.
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Exported — the branching canvas's node palette reuses this for the
// action-type nodes it can add; it only needs its own default for 'condition',
// which has no equivalent in the linear model.
export function defaultConfig(type: ActionType): WorkflowStep['config'] {
  switch (type) {
    case 'send_template':   return { templateName: '', language: 'en', variables: [] };
    case 'assign_employee': return { employeeId: '', employeeName: '' };
    // No default stage key — the live pipeline is company-specific, so forcing
    // an explicit pick from the real list beats guessing a key that might not exist.
    case 'change_stage':    return { stage: '' };
    case 'add_tag':         return { tag: '' };
    case 'create_task':     return { daysFromNow: 1, note: '' };
    case 'wait':            return { amount: 5, unit: 'minutes' };
    default:                return {};
  }
}
