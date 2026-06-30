'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { List, LayoutGrid, Plus, GripVertical, MoreHorizontal, ArrowRight } from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { Avatar } from '@/components/v3/ui/Avatar';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonCard } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { Contact, Stage } from '@/types/v3';
import { STAGE_LABELS } from '@/types/v3';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ── Stage order (column order in Kanban) ─────────────────────────────────────

const STAGE_ORDER: Stage[] = [
  'new_lead',
  'contacted',
  'interested',
  'kyc_done',
  'demat_done',
  'lost',
];

const STAGE_COLORS: Record<Stage, string> = {
  new_lead:   'border-t-neutral-400',
  contacted:  'border-t-primary-500',
  interested: 'border-t-warning-500',
  kyc_done:   'border-t-violet-500',
  demat_done: 'border-t-success-500',
  lost:       'border-t-error-500',
};

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({
  contact,
  isDragging = false,
}: {
  contact: Contact;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging: dragActive } = useDraggable({
    id: contact.id,
    data: { contact },
  });

  const style = transform
    ? { transform: `translate(${transform.x}px,${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-lg border border-neutral-200 bg-white p-3 shadow-sm',
        'dark:border-neutral-800 dark:bg-neutral-900',
        dragActive ? 'opacity-40' : 'opacity-100',
      )}
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="absolute right-2 top-2 hidden h-6 w-6 cursor-grab items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 group-hover:flex dark:hover:bg-neutral-800"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>

      {/* Contact info */}
      <Link href={`/customers/${contact.id}`} className="block" tabIndex={-1}>
        <div className="flex items-start gap-2.5">
          <Avatar name={contact.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:text-primary-600">
              {contact.name}
            </p>
            <p className="text-xs text-neutral-500">{contact.phone}</p>
          </div>
        </div>
      </Link>

      {/* Footer */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {contact.ownerName ? (
          <Avatar name={contact.ownerName} size={20} title={contact.ownerName} />
        ) : (
          <span className="text-xs text-neutral-400">Unassigned</span>
        )}
        {contact.tags.slice(0, 1).map((tag) => (
          <Badge key={tag} variant="default" className="text-[10px]">{tag}</Badge>
        ))}
      </div>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  contacts,
}: {
  stage: Stage;
  contacts: Contact[];
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });

  return (
    <div className="flex w-[240px] shrink-0 flex-col" ref={setNodeRef}>
      {/* Column header */}
      <div
        className={cn(
          'rounded-t-lg border border-b-0 border-neutral-200 bg-white px-3 py-2.5 border-t-2',
          STAGE_COLORS[stage],
          'dark:border-neutral-800 dark:bg-neutral-950',
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {STAGE_LABELS[stage]}
            </span>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-100 px-1.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {contacts.length}
            </span>
          </div>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            aria-label={`Add contact to ${STAGE_LABELS[stage]}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Cards drop zone */}
      <div
        className={cn(
          'flex-1 rounded-b-lg border border-neutral-200 bg-neutral-50 p-2 space-y-2 min-h-[120px] transition-colors',
          isOver && 'bg-primary-50 border-primary-200 dark:bg-primary-900/10',
          'dark:border-neutral-800 dark:bg-neutral-900/50',
        )}
      >
        {contacts.map((c) => (
          <KanbanCard key={c.id} contact={c} />
        ))}
        {contacts.length === 0 && (
          <div className={cn(
            'flex h-16 items-center justify-center rounded-lg border-2 border-dashed text-xs text-neutral-400 transition-colors',
            isOver ? 'border-primary-300 text-primary-500' : 'border-neutral-200 dark:border-neutral-800',
          )}>
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Kanban Board ──────────────────────────────────────────────────────────────

function KanbanBoard({ contacts }: { contacts: Contact[] }) {
  const qc = useQueryClient();
  const [activeContact, setActiveContact] = useState<Contact | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const stageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => {
      const res = await apiFetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      }) as Response;
      return res.json();
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['sales-contacts'] });
      toast.error('Failed to update stage');
    },
  });

  function handleDragStart(event: DragStartEvent) {
    const contact = event.active.data.current?.contact as Contact;
    setActiveContact(contact ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveContact(null);
    const { active, over } = event;
    if (!over) return;

    const contact = active.data.current?.contact as Contact;
    const newStage = over.id as Stage;

    if (contact && newStage !== contact.stage) {
      // Optimistic update
      qc.setQueryData<Contact[]>(['sales-contacts'], (old = []) =>
        old.map((c) => (c.id === contact.id ? { ...c, stage: newStage } : c)),
      );
      stageMutation.mutate({ id: contact.id, stage: newStage });
    }
  }

  const grouped = STAGE_ORDER.reduce<Record<Stage, Contact[]>>(
    (acc, s) => ({ ...acc, [s]: contacts.filter((c) => c.stage === s) }),
    {} as Record<Stage, Contact[]>,
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 p-4 overflow-x-auto min-h-0 flex-1">
        {STAGE_ORDER.map((stage) => (
          <KanbanColumn key={stage} stage={stage} contacts={grouped[stage] ?? []} />
        ))}
      </div>
      <DragOverlay>
        {activeContact && <KanbanCard contact={activeContact} isDragging />}
      </DragOverlay>
    </DndContext>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const router = useRouter();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['sales-contacts'],
    queryFn: async () => {
      const res = await apiFetch('/api/contacts?pageSize=500') as Response;
      const json = await res.json() as { contacts: Contact[] };
      return json.contacts ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Sales</h1>
          <p className="text-sm text-neutral-500">
            {contacts.length} contacts across {STAGE_ORDER.length} stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales/followups">
            <Button variant="secondary" size="sm" iconRight={<ArrowRight className="h-4 w-4" />}>
              Follow-ups
            </Button>
          </Link>
          {/* View toggle */}
          <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
            <button
              onClick={() => setView('kanban')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                view === 'kanban'
                  ? 'bg-primary-600 text-white'
                  : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400',
              )}
              aria-pressed={view === 'kanban'}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              Kanban
            </button>
            <button
              onClick={() => setView('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                view === 'list'
                  ? 'bg-primary-600 text-white'
                  : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400',
              )}
              aria-pressed={view === 'list'}
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              List
            </button>
          </div>
          <Button size="sm" iconLeft={<Plus className="h-4 w-4" />}>
            Add Lead
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex gap-3 p-4 overflow-x-auto">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="w-[240px] shrink-0 space-y-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No leads yet"
          description="Add your first lead to start tracking the pipeline"
          action={{ label: 'Add Lead', onClick: () => {} }}
          className="flex-1"
        />
      ) : (
        <KanbanBoard contacts={contacts} />
      )}
    </div>
  );
}
