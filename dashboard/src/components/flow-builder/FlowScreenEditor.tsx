'use client';

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  FLOW_LIMITS,
  createComponent,
  isFormComponent,
  isTextContentComponent,
  type FlowComponent,
  type FlowComponentType,
  type FlowScreen,
} from '@/types/flowBuilder';
import { COMPONENT_META } from './componentMeta';
import { ComponentPalette } from './ComponentPalette';
import { ComponentConfigPanel } from './ComponentConfigPanel';

interface FlowScreenEditorProps {
  screen: FlowScreen;
  onChange: (screen: FlowScreen) => void;
}

/**
 * Core Phase 2a surface: one screen's ordered component stack (drag to reorder
 * via @dnd-kit/sortable — first live use of the already-installed package),
 * click-to-select with a right-docked config panel, and a click-to-add palette.
 * Pure controlled component — no fetching, no routing; Phase 2b owns
 * save/publish wiring.
 */
export function FlowScreenEditor({ screen, onChange }: FlowScreenEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = screen.components.find((c) => c.id === selectedId) ?? null;

  // distance: 5 keeps plain clicks (select) from starting a drag on the handle;
  // the keyboard sensor is dnd-kit's documented a11y pairing for sortable lists.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = screen.components.findIndex((c) => c.id === active.id);
    const newIndex = screen.components.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange({ ...screen, components: arrayMove(screen.components, oldIndex, newIndex) });
  }

  function handleAdd(type: FlowComponentType) {
    if (screen.components.length >= FLOW_LIMITS.maxComponentsPerScreen) return;
    const component = createComponent(type, screen.components);
    onChange({ ...screen, components: [...screen.components, component] });
    setSelectedId(component.id);
  }

  function handleComponentChange(updated: FlowComponent) {
    onChange({ ...screen, components: screen.components.map((c) => (c.id === updated.id ? updated : c)) });
  }

  function handleDelete() {
    if (!selected) return;
    onChange({ ...screen, components: screen.components.filter((c) => c.id !== selected.id) });
    setSelectedId(null);
  }

  return (
    <div className="flex items-stretch gap-4">
      {/* Left: screen settings + component stack + palette */}
      <div className="min-w-0 flex-1 space-y-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="block text-[11px] font-medium text-neutral-500">Screen title</label>
              <input
                value={screen.title}
                onChange={(e) => onChange({ ...screen, title: e.target.value })}
                placeholder="Screen title"
                className={inputCls}
              />
            </div>
            <label className="flex shrink-0 items-center gap-2 pb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={screen.terminal}
                onChange={(e) => onChange({ ...screen, terminal: e.target.checked })}
                className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500/20 dark:border-neutral-600"
              />
              Terminal screen
            </label>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            A terminal screen&apos;s Footer completes the Flow; other screens&apos; Footers navigate to the next screen.
          </p>
        </div>

        <div className="space-y-1.5">
          {screen.components.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-300 px-3 py-6 text-center text-xs text-neutral-400 dark:border-neutral-700">
              No components yet — add one below.
            </p>
          )}
          {/* Stable id: dnd-kit otherwise derives its aria live-region ids from a
              global counter, which differs between SSR and hydration (React
              hydration-mismatch error). */}
          <DndContext id="flow-screen-editor-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={screen.components.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {screen.components.map((component) => (
                <SortableComponentRow
                  key={component.id}
                  component={component}
                  selected={component.id === selectedId}
                  onSelect={() => setSelectedId(component.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <ComponentPalette components={screen.components} onAdd={handleAdd} />
      </div>

      {/* Right: config panel for the selected component (NodeConfigPanel-style) */}
      {selected && (
        <div className="w-[360px] shrink-0 self-stretch">
          <ComponentConfigPanel
            component={selected}
            screen={screen}
            onChange={handleComponentChange}
            onClose={() => setSelectedId(null)}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}

// ── Sortable stack row ────────────────────────────────────────────────────────

function componentSummary(component: FlowComponent): string {
  if (isTextContentComponent(component)) return component.text || '(empty)';
  if (component.type === 'Footer') return component.label || '(no label)';
  return component.label || '(no label)';
}

function SortableComponentRow({ component, selected, onSelect }: {
  component: FlowComponent;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: component.id });
  const { label: typeLabel, icon: Icon } = COMPONENT_META[component.type];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 rounded-xl border bg-white p-1.5 dark:bg-neutral-900',
        selected
          ? 'border-primary-500 ring-2 ring-primary-500/20'
          : 'border-neutral-200 dark:border-neutral-800',
        isDragging && 'relative z-10 opacity-70 shadow-lg',
      )}
      data-testid={`flow-component-row-${component.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none rounded p-1.5 text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500 active:cursor-grabbing dark:hover:bg-neutral-800"
        aria-label={`Reorder ${typeLabel}`}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
          <Icon className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{componentSummary(component)}</p>
          <p className="truncate text-[11px] text-neutral-400">
            {typeLabel}
            {isFormComponent(component) && <span className="font-mono"> · {component.name}</span>}
          </p>
        </div>
      </button>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';
