'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  FLOW_LIMITS,
  deriveOptionId,
  type CheckboxGroupComponent,
  type DatePickerComponent,
  type DropdownComponent,
  type FlowOption,
  type FooterComponent,
  type OptInComponent,
  type PhotoPickerComponent,
  type RadioButtonsGroupComponent,
  type SelectionFlowComponent,
  type TextAreaComponent,
  type TextBodyComponent,
  type TextCaptionComponent,
  type TextHeadingComponent,
  type TextInputComponent,
  type TextInputType,
  type TextSubheadingComponent,
} from '@/types/flowBuilder';

// One editor export per supported component type (Phase 2a contract). Types
// whose config shapes match share an internal body — TextContentBody for the
// four text components, SelectionFieldBody + OptionsListEditor for the three
// data-source components — so the per-type exports stay thin.

interface EditorProps<T> {
  component: T;
  onChange: (component: T) => void;
  /** True when another form component on the screen has the same field name. */
  duplicateName?: boolean;
}

// ── Shared field primitives ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-neutral-500">{label}</label>
      {children}
    </div>
  );
}

// The ctaLabel "(0/20)" pattern: hard maxLength + always-visible counter.
function LimitedInput({ label, value, max, placeholder, onChange }: {
  label: string;
  value: string;
  max: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={`${label} (${value.length}/${max})`}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        placeholder={placeholder}
        maxLength={max}
        className={inputCls}
      />
    </Field>
  );
}

// Response field name — keys this component's value in the Flow response, so
// it is kept url/JSON-safe (lowercase snake_case) as the user types.
function NameField({ value, duplicate, onChange }: {
  value: string;
  duplicate?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Field name (keys the response)">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, ''))}
        placeholder="field_name"
        className={cn(inputCls, 'font-mono text-xs', duplicate && 'border-error-500 focus:border-error-500 focus:ring-error-500/20')}
      />
      {duplicate ? (
        <p className="text-[11px] text-error-500">
          Another field in this Flow already uses this name — names must be unique across all screens.
        </p>
      ) : (
        <p className="text-[11px] text-neutral-400">Lowercase letters, numbers and underscores.</p>
      )}
    </Field>
  );
}

function RequiredToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500/20 dark:border-neutral-600"
      />
      Required
    </label>
  );
}

function HelperTextField({ value, onChange }: { value?: string; onChange: (value?: string) => void }) {
  return (
    <Field label="Helper text (optional)">
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="Shown under the field"
        className={inputCls}
      />
    </Field>
  );
}

// ── Text content (TextHeading / TextSubheading / TextBody / TextCaption) ─────

type TextContentComponent = TextHeadingComponent | TextSubheadingComponent | TextBodyComponent | TextCaptionComponent;

function TextContentBody<T extends TextContentComponent>({ component, onChange }: EditorProps<T>) {
  return (
    <Field label="Text">
      <textarea
        value={component.text}
        onChange={(e) => onChange({ ...component, text: e.target.value })}
        placeholder="Text shown to the customer"
        rows={3}
        className={cn(inputCls, 'resize-none')}
      />
    </Field>
  );
}

export function TextHeadingEditor(props: EditorProps<TextHeadingComponent>) {
  return <TextContentBody {...props} />;
}

export function TextSubheadingEditor(props: EditorProps<TextSubheadingComponent>) {
  return <TextContentBody {...props} />;
}

export function TextBodyEditor(props: EditorProps<TextBodyComponent>) {
  return <TextContentBody {...props} />;
}

export function TextCaptionEditor(props: EditorProps<TextCaptionComponent>) {
  return <TextContentBody {...props} />;
}

// ── TextInput / TextArea ──────────────────────────────────────────────────────

const INPUT_TYPES: TextInputType[] = ['text', 'number', 'email', 'password', 'passcode', 'phone'];

export function TextInputEditor({ component, onChange, duplicateName }: EditorProps<TextInputComponent>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Label"
        value={component.label}
        max={FLOW_LIMITS.componentLabelMax}
        placeholder="e.g. Full name"
        onChange={(label) => onChange({ ...component, label })}
      />
      <NameField value={component.name} duplicate={duplicateName} onChange={(name) => onChange({ ...component, name })} />
      <Field label="Input type">
        <select
          value={component.inputType}
          onChange={(e) => onChange({ ...component, inputType: e.target.value as TextInputType })}
          className={inputCls}
        >
          {INPUT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
      <HelperTextField value={component.helperText} onChange={(helperText) => onChange({ ...component, helperText })} />
      <RequiredToggle value={component.required} onChange={(required) => onChange({ ...component, required })} />
    </div>
  );
}

export function TextAreaEditor({ component, onChange, duplicateName }: EditorProps<TextAreaComponent>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Label"
        value={component.label}
        max={FLOW_LIMITS.componentLabelMax}
        placeholder="e.g. Your message"
        onChange={(label) => onChange({ ...component, label })}
      />
      <NameField value={component.name} duplicate={duplicateName} onChange={(name) => onChange({ ...component, name })} />
      <HelperTextField value={component.helperText} onChange={(helperText) => onChange({ ...component, helperText })} />
      <RequiredToggle value={component.required} onChange={(required) => onChange({ ...component, required })} />
    </div>
  );
}

// ── Selection components (Dropdown / RadioButtonsGroup / CheckboxGroup) ──────

/**
 * Shared editor for the data-source array of every selection component —
 * one list UI, not three (ButtonListEditor's list+per-item idiom).
 */
export function OptionsListEditor({ options, onChange }: {
  options: FlowOption[];
  onChange: (options: FlowOption[]) => void;
}) {
  function updateOption(idx: number, patch: Partial<FlowOption>) {
    onChange(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function removeOption(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }

  return (
    <Field label="Options">
      <div className="space-y-1.5">
        {options.map((option, idx) => (
          <OptionRow
            // Index, not option.id — id now mutates as the admin types a
            // title (auto-derive below), and keying by a mutating value
            // would remount this row's <input> every keystroke, dropping
            // focus after the first character. This list has no reordering
            // (append/remove-at-index only), so an index key is safe here.
            key={idx}
            index={idx}
            option={option}
            otherIds={options.filter((_, i) => i !== idx).map((o) => o.id)}
            onChange={(patch) => updateOption(idx, patch)}
            onRemove={() => removeOption(idx)}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange([...options, { id: deriveOptionId('', options.map((o) => o.id)), title: '' }])}
          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          <Plus className="h-3.5 w-3.5" /> Add option
        </button>
        {options.length === 0 && (
          <p className="text-[11px] text-warning-500">Meta requires at least one option before publish.</p>
        )}
      </div>
    </Field>
  );
}

function OptionRow({ option, index, otherIds, onChange, onRemove }: {
  option: FlowOption;
  index: number;
  /** Every OTHER option's current id in this same data-source list — the
   * collision set both the auto-derive-on-type and "was this hand-edited"
   * checks below need. */
  otherIds: string[];
  onChange: (patch: Partial<FlowOption>) => void;
  onRemove: () => void;
}) {
  const [editingId, setEditingId] = useState(false);

  function handleTitleChange(rawTitle: string) {
    const newTitle = rawTitle.slice(0, FLOW_LIMITS.optionTitleMax);
    // Same "stateless — id tracks title until touched" logic as the Screen ID
    // field (FlowScreenEditor.tsx): an untouched id always equals what
    // deriveOptionId would produce for the option's OLD title, so a manual
    // edit (via "Edit ID" below) is detected without extra state — the
    // moment the id stops matching that derivation, every later title edit
    // leaves it alone too.
    const idWasAuto = option.id === deriveOptionId(option.title, otherIds);
    onChange({ title: newTitle, ...(idWasAuto ? { id: deriveOptionId(newTitle, otherIds) } : {}) });
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700" data-testid={`option-row-${index}`}>
      <div className="flex items-center gap-2 p-1.5">
        <input
          value={option.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={`Option ${index + 1}`}
          maxLength={FLOW_LIMITS.optionTitleMax}
          className={cn(inputCls, 'flex-1')}
          data-testid={`option-title-input-${index}`}
        />
        <span className="shrink-0 text-[10px] text-neutral-400">
          {option.title.length}/{FLOW_LIMITS.optionTitleMax}
        </span>
        <button
          type="button"
          onClick={() => setEditingId((v) => !v)}
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          aria-label={editingId ? 'Hide option ID' : 'Edit option ID'}
          title="Edit ID"
        >
          {editingId ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-neutral-300 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-900/20"
          aria-label={`Remove option ${index + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {editingId && (
        <div className="space-y-1 border-t border-neutral-100 p-1.5 dark:border-neutral-800">
          <label className="block text-[10px] font-medium text-neutral-500">
            Option ID (this is what a completed response actually stores)
          </label>
          <input
            value={option.id}
            onChange={(e) => onChange({ id: e.target.value.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '') })}
            placeholder="option_id"
            className={cn(inputCls, 'font-mono text-xs')}
            data-testid={`option-id-input-${index}`}
          />
        </div>
      )}
    </div>
  );
}

function SelectionFieldBody<T extends SelectionFlowComponent>({ component, onChange, duplicateName }: EditorProps<T>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Label"
        value={component.label}
        max={FLOW_LIMITS.componentLabelMax}
        placeholder="e.g. Product interest"
        onChange={(label) => onChange({ ...component, label })}
      />
      <NameField value={component.name} duplicate={duplicateName} onChange={(name) => onChange({ ...component, name })} />
      <OptionsListEditor options={component.dataSource} onChange={(dataSource) => onChange({ ...component, dataSource })} />
      <RequiredToggle value={component.required} onChange={(required) => onChange({ ...component, required })} />
    </div>
  );
}

export function DropdownEditor(props: EditorProps<DropdownComponent>) {
  return <SelectionFieldBody {...props} />;
}

export function RadioButtonsGroupEditor(props: EditorProps<RadioButtonsGroupComponent>) {
  return <SelectionFieldBody {...props} />;
}

export function CheckboxGroupEditor(props: EditorProps<CheckboxGroupComponent>) {
  return <SelectionFieldBody {...props} />;
}

// ── OptIn / DatePicker / PhotoPicker ─────────────────────────────────────────

export function OptInEditor({ component, onChange, duplicateName }: EditorProps<OptInComponent>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Label"
        value={component.label}
        max={FLOW_LIMITS.componentLabelMax}
        placeholder="e.g. I agree to updates"
        onChange={(label) => onChange({ ...component, label })}
      />
      <NameField value={component.name} duplicate={duplicateName} onChange={(name) => onChange({ ...component, name })} />
      <RequiredToggle value={component.required} onChange={(required) => onChange({ ...component, required })} />
    </div>
  );
}

export function DatePickerEditor({ component, onChange, duplicateName }: EditorProps<DatePickerComponent>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Label"
        value={component.label}
        max={FLOW_LIMITS.componentLabelMax}
        placeholder="e.g. Preferred date"
        onChange={(label) => onChange({ ...component, label })}
      />
      <NameField value={component.name} duplicate={duplicateName} onChange={(name) => onChange({ ...component, name })} />
      <HelperTextField value={component.helperText} onChange={(helperText) => onChange({ ...component, helperText })} />
      <RequiredToggle value={component.required} onChange={(required) => onChange({ ...component, required })} />
    </div>
  );
}

export function PhotoPickerEditor({ component, onChange, duplicateName }: EditorProps<PhotoPickerComponent>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Label"
        value={component.label}
        max={FLOW_LIMITS.componentLabelMax}
        placeholder="e.g. Upload documents"
        onChange={(label) => onChange({ ...component, label })}
      />
      <NameField value={component.name} duplicate={duplicateName} onChange={(name) => onChange({ ...component, name })} />
      <Field label="Description (optional)">
        <input
          value={component.description ?? ''}
          onChange={(e) => onChange({ ...component, description: e.target.value || undefined })}
          placeholder="Shown under the label"
          className={inputCls}
        />
      </Field>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

export function FooterEditor({ component, onChange }: EditorProps<FooterComponent>) {
  return (
    <div className="space-y-3">
      <LimitedInput
        label="Button label"
        value={component.label}
        max={FLOW_LIMITS.footerLabelMax}
        placeholder="e.g. Continue"
        onChange={(label) => onChange({ ...component, label })}
      />
      <p className="text-[11px] text-neutral-400">
        The button&apos;s action is wired automatically: it completes the Flow on a terminal (or last) screen and
        navigates to the next screen otherwise.
      </p>
    </div>
  );
}

// ── Shared styles — same tokens as ButtonListEditor ──────────────────────────
const inputCls =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
