'use client';

import { useState } from 'react';
import {
  MessageCircle, UserPlus, GitMerge, Tag, CheckSquare, Timer, Square,
  Zap, ChevronDown, Plus, Trash2, ChevronUp, Edit2, X, Hash,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import {
  type WorkflowTrigger, type WorkflowStep, type ActionType,
  type TriggerType, type KeywordMatchMode, type KeywordTriggerConfig,
  TRIGGER_META, ACTION_META, PHASE1_ACTIONS,
} from '@/types/automations';
import { ActionEditor, inputCls, selectCls } from './ActionEditor';

// ── Icons per action/trigger — also used by the branching canvas's node components ──
export const ACTION_ICONS: Record<string, React.ElementType> = {
  send_template:                MessageCircle,
  assign_employee:              UserPlus,
  change_stage:                 GitMerge,
  add_tag:                      Tag,
  create_task:                  CheckSquare,
  wait:                         Timer,
  end:                          Square,
  whatsapp_conversation_started:MessageCircle,
  lead_created:                 UserPlus,
  stage_changed:                GitMerge,
  stage_change:                 GitMerge,
  tag_added:                    Tag,
  campaign_completed:           Zap,
  keyword_message:              Hash,
};

const newId = () => `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// ── Types ────────────────────────────────────────────────────────────────────
interface WorkflowBuilderProps {
  trigger:         WorkflowTrigger;
  steps:           WorkflowStep[];
  onTriggerChange: (t: WorkflowTrigger) => void;
  onStepsChange:   (s: WorkflowStep[]) => void;
}

// ── Main builder ─────────────────────────────────────────────────────────────
export function WorkflowBuilder({ trigger, steps, onTriggerChange, onStepsChange }: WorkflowBuilderProps) {
  const [editingTrigger,  setEditingTrigger]  = useState(false);
  const [editingStepId,   setEditingStepId]   = useState<string | null>(null);
  const [addingStep,      setAddingStep]       = useState(false);
  const { stages: pipelineStages } = usePipelineStages();

  // Non-'end' steps for rendering; 'end' is always shown last
  const actionSteps = steps.filter((s) => s.type !== 'end');
  const hasEnd      = steps.some((s) => s.type === 'end');

  function addStep(type: ActionType) {
    if (type === 'end') return; // end is always at bottom, not manually addable
    const newStep: WorkflowStep = { id: newId(), type, config: defaultConfig(type) };
    const endStep = steps.find((s) => s.type === 'end');
    const withoutEnd = steps.filter((s) => s.type !== 'end');
    onStepsChange([...withoutEnd, newStep, ...(endStep ? [endStep] : [])]);
    setEditingStepId(newStep.id);
    setAddingStep(false);
  }

  function updateStep(id: string, config: WorkflowStep['config']) {
    onStepsChange(steps.map((s) => s.id === id ? { ...s, config } : s));
  }

  function removeStep(id: string) {
    onStepsChange(steps.filter((s) => s.id !== id));
    if (editingStepId === id) setEditingStepId(null);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...steps];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onStepsChange(next);
  }

  function moveDown(idx: number) {
    const endIdx = steps.findIndex((s) => s.type === 'end');
    const limit  = endIdx >= 0 ? endIdx - 1 : steps.length - 1;
    if (idx >= limit) return;
    const next = [...steps];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onStepsChange(next);
  }

  return (
    <div className="flex flex-col items-center gap-0">
      {/* ── Trigger ──────────────────────────────────────────── */}
      <StepCard
        label="Trigger"
        sublabel={TRIGGER_META[trigger.type]?.label ?? trigger.type}
        icon={ACTION_ICONS[trigger.type] ?? Zap}
        accent="primary"
        isOpen={editingTrigger}
        onToggleEdit={() => setEditingTrigger((v) => !v)}
        isDeletable={false}
        isMovable={false}
      >
        {editingTrigger && (
          <TriggerEditor trigger={trigger} onChange={onTriggerChange} />
        )}
      </StepCard>

      {/* ── Action steps ─────────────────────────────────────── */}
      {actionSteps.map((step, idx) => {
        const Icon = ACTION_ICONS[step.type] ?? Zap;
        const meta = ACTION_META[step.type];
        return (
          <div key={step.id} className="flex w-full flex-col items-center">
            <Connector />
            <StepCard
              label={meta?.label ?? step.type}
              sublabel={stepSummary(step, pipelineStages)}
              icon={Icon}
              accent="neutral"
              isOpen={editingStepId === step.id}
              onToggleEdit={() => setEditingStepId(editingStepId === step.id ? null : step.id)}
              isDeletable
              isMovable
              canMoveUp={idx > 0}
              canMoveDown={idx < actionSteps.length - 1}
              onDelete={() => removeStep(step.id)}
              onMoveUp={() => moveUp(idx)}
              onMoveDown={() => moveDown(idx)}
            >
              {editingStepId === step.id && (
                <ActionEditor
                  step={step}
                  onChange={(config) => updateStep(step.id, config)}
                />
              )}
            </StepCard>
          </div>
        );
      })}

      {/* ── Add step button ───────────────────────────────────── */}
      <Connector />
      {addingStep ? (
        <div className="w-full max-w-sm rounded-xl border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-800 dark:bg-primary-900/10">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">Select action</p>
            <button onClick={() => setAddingStep(false)} className="rounded p-0.5 text-neutral-400 hover:text-neutral-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {PHASE1_ACTIONS.filter((t) => t !== 'end').map((type) => {
              const Icon = ACTION_ICONS[type] ?? Zap;
              return (
                <button
                  key={type}
                  onClick={() => addStep(type)}
                  className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs font-medium text-neutral-700 hover:border-primary-300 hover:bg-primary-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" aria-hidden />
                  {ACTION_META[type]?.label ?? type}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingStep(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 text-neutral-400 hover:border-primary-400 hover:text-primary-500 dark:border-neutral-700 dark:hover:border-primary-600"
          aria-label="Add step"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      )}

      {/* ── End ──────────────────────────────────────────────── */}
      {hasEnd && (
        <>
          <Connector />
          <StepCard
            label="End"
            sublabel="Workflow complete"
            icon={Square}
            accent="neutral"
            isDeletable={false}
            isMovable={false}
            isOpen={false}
            onToggleEdit={() => {}}
          />
        </>
      )}
    </div>
  );
}

// ── StepCard ─────────────────────────────────────────────────────────────────
interface StepCardProps {
  label:       string;
  sublabel?:   string;
  icon:        React.ElementType;
  accent:      'primary' | 'neutral';
  isOpen:      boolean;
  onToggleEdit:() => void;
  isDeletable: boolean;
  isMovable:   boolean;
  canMoveUp?:  boolean;
  canMoveDown?:boolean;
  onDelete?:   () => void;
  onMoveUp?:   () => void;
  onMoveDown?: () => void;
  children?:   React.ReactNode;
}

function StepCard({
  label, sublabel, icon: Icon, accent, isOpen, onToggleEdit,
  isDeletable, isMovable, canMoveUp, canMoveDown, onDelete, onMoveUp, onMoveDown, children,
}: StepCardProps) {
  return (
    <div className={cn(
      'w-full max-w-sm rounded-xl border transition-shadow',
      accent === 'primary'
        ? 'border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/20'
        : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900',
      isOpen && 'shadow-md',
    )}>
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          accent === 'primary'
            ? 'bg-primary-100 dark:bg-primary-900/40'
            : 'bg-neutral-100 dark:bg-neutral-800',
        )}>
          <Icon className={cn(
            'h-4 w-4',
            accent === 'primary' ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-500 dark:text-neutral-400',
          )} aria-hidden />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">{label}</p>
          {sublabel && <p className="truncate text-xs text-neutral-500">{sublabel}</p>}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {isMovable && (
            <>
              <button
                onClick={onMoveUp}
                disabled={!canMoveUp}
                className="rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-neutral-800"
                aria-label="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onMoveDown}
                disabled={!canMoveDown}
                className="rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-neutral-800"
                aria-label="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {isDeletable && (
            <button
              onClick={onDelete}
              className="rounded p-1 text-neutral-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-900/20"
              aria-label="Delete step"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onToggleEdit}
            className={cn(
              'rounded p-1 transition-colors',
              isOpen
                ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800',
            )}
            aria-label={isOpen ? 'Close editor' : 'Edit step'}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {isOpen && children && (
        <div className="border-t border-neutral-200 px-4 pb-4 pt-3 dark:border-neutral-800">
          {children}
        </div>
      )}
    </div>
  );
}

function Connector() {
  return (
    <div className="flex h-6 w-px flex-col items-center">
      <div className="h-full w-px bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ── Trigger editor ────────────────────────────────────────────────────────────
// Exported so the branching canvas's TriggerConfigPanel can reuse this exact
// same editor (and dropdown) rather than building a second one — the canvas's
// TriggerNode has no config UI of its own, this is the only trigger editor.
export function TriggerEditor({ trigger, onChange }: { trigger: WorkflowTrigger; onChange: (t: WorkflowTrigger) => void }) {
  const TRIGGER_OPTIONS: TriggerType[] = [
    'whatsapp_conversation_started', 'lead_created', 'stage_changed', 'tag_added', 'keyword_message',
  ];

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
              {!['exists', 'not_exists'].includes(c.operator) && (
                <input
                  value={c.value ?? ''}
                  onChange={(e) => updateCondition(i, { value: e.target.value })}
                  placeholder="value"
                  className={cn(inputCls, 'flex-1')}
                />
              )}
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

// ── Helpers ───────────────────────────────────────────────────────────────────
// Exported — the branching canvas's node palette (Phase 2) reuses this for the
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

function stepSummary(step: WorkflowStep, stages: PipelineStage[]): string {
  const cfg = step.config as Record<string, unknown>;
  switch (step.type) {
    case 'send_template':   return String(cfg.templateName ?? '') || 'No template selected';
    case 'assign_employee': return String(cfg.employeeName ?? cfg.employeeId ?? '') || 'No employee selected';
    case 'change_stage': {
      const key = String(cfg.stage ?? '');
      return (stages.find((s) => s.key === key)?.label ?? key) || 'No stage selected';
    }
    case 'add_tag':         return String(cfg.tag ?? '') || 'No tag selected';
    case 'create_task':     return `In ${cfg.daysFromNow ?? 1} day(s)`;
    case 'wait':            return `${cfg.amount ?? 5} ${cfg.unit ?? 'minutes'}`;
    case 'end':             return 'Workflow complete';
    default:                return '';
  }
}
