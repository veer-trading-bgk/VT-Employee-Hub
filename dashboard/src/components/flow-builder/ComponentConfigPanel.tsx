'use client';

import { Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isFormComponent, type FlowComponent, type FlowScreen } from '@/types/flowBuilder';
import { COMPONENT_META } from './componentMeta';
import {
  CheckboxGroupEditor,
  DatePickerEditor,
  DropdownEditor,
  FooterEditor,
  OptInEditor,
  PhotoPickerEditor,
  RadioButtonsGroupEditor,
  TextAreaEditor,
  TextBodyEditor,
  TextCaptionEditor,
  TextHeadingEditor,
  TextInputEditor,
  TextSubheadingEditor,
} from './componentEditors';

interface ComponentConfigPanelProps {
  component: FlowComponent;
  /** Owning screen — used for cross-component checks (duplicate field names). */
  screen: FlowScreen;
  /** Field names owned by OTHER screens — duplicates across screens break
   * cross-screen data passing, so they get the same inline warning. */
  externalFieldNames?: ReadonlySet<string>;
  onChange: (component: FlowComponent) => void;
  onClose: () => void;
  onDelete: () => void;
}

/**
 * Right-docked config panel for the selected stack component — NodeConfigPanel's
 * select-item→side-panel architecture (header with icon/title/delete/close,
 * scrollable per-type editor body), rebuilt against the Flow component model.
 * Not a Drawer for the same reason NodeConfigPanel isn't: the stack must stay
 * clickable while a component's config is open.
 */
export function ComponentConfigPanel({ component, screen, externalFieldNames, onChange, onClose, onDelete }: ComponentConfigPanelProps) {
  const { label: title, icon: Icon } = COMPONENT_META[component.type];
  const subtitle = isFormComponent(component) ? component.name : component.type;
  const duplicateName =
    isFormComponent(component) &&
    (screen.components.some((c) => c.id !== component.id && isFormComponent(c) && c.name === component.name) ||
      (externalFieldNames?.has(component.name) ?? false));

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg',
        'dark:border-neutral-800 dark:bg-neutral-900',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
            <Icon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{title}</p>
            <p className="truncate text-[11px] text-neutral-400">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onDelete}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-400 hover:bg-error-50 hover:text-error-600 sm:h-8 sm:w-8 dark:hover:bg-error-900/20"
            aria-label="Delete component"
            title="Delete component"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 sm:h-8 sm:w-8 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Body — per-type editor */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {component.type === 'TextHeading' ? (
          <TextHeadingEditor component={component} onChange={onChange} />
        ) : component.type === 'TextSubheading' ? (
          <TextSubheadingEditor component={component} onChange={onChange} />
        ) : component.type === 'TextBody' ? (
          <TextBodyEditor component={component} onChange={onChange} />
        ) : component.type === 'TextCaption' ? (
          <TextCaptionEditor component={component} onChange={onChange} />
        ) : component.type === 'TextInput' ? (
          <TextInputEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'TextArea' ? (
          <TextAreaEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'Dropdown' ? (
          <DropdownEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'RadioButtonsGroup' ? (
          <RadioButtonsGroupEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'CheckboxGroup' ? (
          <CheckboxGroupEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'OptIn' ? (
          <OptInEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'DatePicker' ? (
          <DatePickerEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : component.type === 'PhotoPicker' ? (
          <PhotoPickerEditor component={component} onChange={onChange} duplicateName={duplicateName} />
        ) : (
          <FooterEditor component={component} onChange={onChange} />
        )}
      </div>
    </div>
  );
}
