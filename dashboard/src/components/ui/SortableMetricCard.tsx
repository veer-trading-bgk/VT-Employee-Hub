'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MetricCard, type MetricCardProps } from './MetricCard';

interface SortableMetricCardProps extends MetricCardProps {
  id: string;
}

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
      <circle cx="2.5" cy="2"  r="1.5" />
      <circle cx="7.5" cy="2"  r="1.5" />
      <circle cx="2.5" cy="7"  r="1.5" />
      <circle cx="7.5" cy="7"  r="1.5" />
      <circle cx="2.5" cy="12" r="1.5" />
      <circle cx="7.5" cy="12" r="1.5" />
    </svg>
  );
}

export function SortableMetricCard({ id, ...cardProps }: SortableMetricCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-0' : undefined}
    >
      {/* Wrapper makes the whole card draggable */}
      <div
        className="relative cursor-grab active:cursor-grabbing select-none touch-none"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${cardProps.metric.label}`}
      >
        {/* Grip badge — top-right corner inside the card */}
        <div className="absolute right-3 top-3 z-20 pointer-events-none
          flex h-6 w-6 items-center justify-center rounded-md
          bg-white/90 shadow-sm text-slate-400
          dark:bg-slate-800/90 dark:text-slate-500">
          <GripIcon />
        </div>

        <MetricCard {...cardProps} />
      </div>
    </div>
  );
}

/** Rendered inside DragOverlay — the ghost card that follows the cursor */
export function DragOverlayCard(props: MetricCardProps) {
  return (
    <div className="rotate-1 scale-[1.04] opacity-95 shadow-2xl rounded-xl ring-2 ring-indigo-400/30">
      <MetricCard {...props} />
    </div>
  );
}
