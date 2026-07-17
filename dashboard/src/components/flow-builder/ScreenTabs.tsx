'use client';

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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { createScreen, type FlowScreen } from '@/types/flowBuilder';

interface ScreenTabsProps {
  screens: FlowScreen[];
  activeId: string;
  onSelect: (id: string) => void;
  onChange: (screens: FlowScreen[]) => void;
}

/**
 * Horizontal screen-tab strip: select, add, delete, and drag-to-reorder —
 * the component stack's @dnd-kit/sortable pattern applied to screens.
 * Sortable identity is the screen's Meta id; while the user is mid-edit two
 * screens can transiently share an id (validateFlow flags it as an error) —
 * rendering recovers as soon as the ids diverge again, nothing is lost.
 */
export function ScreenTabs({ screens, activeId, onSelect, onChange }: ScreenTabsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = screens.findIndex((s) => s.id === active.id);
    const newIndex = screens.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(screens, oldIndex, newIndex));
  }

  function handleAdd() {
    const screen = createScreen(screens);
    onChange([...screens, screen]);
    onSelect(screen.id);
  }

  function handleDelete(screen: FlowScreen) {
    if (screens.length === 1) return;
    if (!confirm(`Delete screen "${screen.title || screen.id}" and its ${screen.components.length} component(s)?`)) return;
    const remaining = screens.filter((s) => s !== screen);
    onChange(remaining);
    if (screen.id === activeId) onSelect(remaining[Math.max(0, screens.indexOf(screen) - 1)].id);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Stable id — same SSR-hydration reasoning as FlowScreenEditor's DndContext. */}
      <DndContext id="flow-screen-tabs-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={screens.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          {screens.map((screen) => (
            <SortableScreenTab
              key={screen.id}
              screen={screen}
              active={screen.id === activeId}
              deletable={screens.length > 1}
              onSelect={() => onSelect(screen.id)}
              onDelete={() => handleDelete(screen)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={handleAdd}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add screen
      </button>
    </div>
  );
}

function SortableScreenTab({ screen, active, deletable, onSelect, onDelete }: {
  screen: FlowScreen;
  active: boolean;
  deletable: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: screen.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-0.5 rounded-lg border pl-1 pr-1.5 py-1',
        active
          ? 'border-primary-500 bg-primary-600 text-white'
          : 'border-neutral-200 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
        isDragging && 'relative z-10 opacity-70 shadow-lg',
      )}
      data-testid={`flow-screen-tab-${screen.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className={cn('shrink-0 cursor-grab touch-none rounded p-0.5 active:cursor-grabbing', active ? 'text-primary-200' : 'text-neutral-400')}
        aria-label={`Reorder screen ${screen.title || screen.id}`}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button type="button" onClick={onSelect} className="flex items-center gap-1.5 px-1 text-xs font-medium">
        {screen.title || screen.id}
        {screen.terminal && (
          <span
            className={cn('rounded px-1 text-[9px] font-semibold uppercase', active ? 'bg-white/20' : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400')}
            title="Terminal screen — its Footer completes the Flow"
          >
            end
          </span>
        )}
      </button>
      {deletable && (
        <button
          type="button"
          onClick={onDelete}
          className={cn('shrink-0 rounded p-0.5', active ? 'text-primary-200 hover:bg-white/10 hover:text-white' : 'text-neutral-400 hover:bg-neutral-300/50 hover:text-error-500 dark:hover:bg-neutral-600')}
          aria-label={`Delete screen ${screen.title || screen.id}`}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
