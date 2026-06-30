'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { List, LayoutGrid, Plus, GripVertical, ArrowRight, Phone, User } from 'lucide-react';
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
import { Drawer, DrawerFooter } from '@/components/v3/ui/Drawer';
import { Input } from '@/components/v3/ui/Input';
import { Table, type TableColumn, type SortDirection } from '@/components/v3/ui/Table';
import { cn } from '@/lib/cn';
import { apiFetch, ApiClientError } from '@/lib/api';
import type { Contact, Stage } from '@/types/v3';
import { STAGE_LABELS } from '@/types/v3';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function contactName(c: Contact): string {
  return c.displayName ?? c.name ?? c.phone ?? '';
}

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

  const assignee = contact.assignedToName ?? contact.ownerName ?? null;

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
          <Avatar name={contactName(contact)} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:text-primary-600">
              {contactName(contact)}
            </p>
            <p className="text-xs text-neutral-500">{contact.phone}</p>
          </div>
        </div>
      </Link>

      {/* Footer */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {assignee ? (
          <Avatar name={assignee} size={20} title={assignee} />
        ) : (
          <span className="text-xs text-neutral-400">Unassigned</span>
        )}
        {(contact.tags ?? []).slice(0, 1).map((tag) => (
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
    mutationFn: async ({ contact, stage }: { contact: Contact; stage: Stage }) => {
      if (contact.type === 'lead' || (contact.leadId ?? null) !== null) {
        return apiFetch(`/api/crm/leads/${contact.id}/stage`, {
          method: 'PUT',
          body: JSON.stringify({ stage }),
        });
      }
      return apiFetch('/api/contacts/stage', {
        method: 'PUT',
        body: JSON.stringify({ phone: contact.phone, stage }),
      });
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
      qc.setQueryData<Contact[]>(['sales-contacts'], (old = []) =>
        old.map((c) => (c.id === contact.id ? { ...c, stage: newStage } : c)),
      );
      stageMutation.mutate({ contact, stage: newStage });
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

// ── List view columns ─────────────────────────────────────────────────────────

function buildListColumns(): TableColumn<Contact>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (row) => (
        <Link href={`/customers/${row.id}`} className="flex items-center gap-2.5 group">
          <Avatar name={contactName(row)} size={32} />
          <div>
            <p className="font-medium text-neutral-900 group-hover:text-primary-600 dark:text-neutral-100">
              {contactName(row)}
            </p>
            <p className="text-xs text-neutral-500">{row.phone}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      sortable: true,
      width: 'w-36',
      cell: (row) => (
        <Badge variant="stage" stage={row.stage}>
          {STAGE_LABELS[row.stage] ?? row.stage}
        </Badge>
      ),
    },
    {
      key: 'owner',
      header: 'Assigned to',
      width: 'w-40',
      cell: (row) => (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          {row.assignedToName ?? row.ownerName ?? '—'}
        </span>
      ),
    },
    {
      key: 'lastActivity',
      header: 'Last activity',
      width: 'w-32',
      cell: (row) => {
        const ts = row.lastMessageAt ?? row.createdAt;
        return (
          <span className="text-sm text-neutral-500">
            {ts ? format(new Date(ts), 'd MMM yyyy') : '—'}
          </span>
        );
      },
    },
  ];
}

// ── Add Lead drawer ───────────────────────────────────────────────────────────

function AddLeadDrawer({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name,       setName]       = useState('');
  const [phone,      setPhone]      = useState('');
  const [stage,      setStage]      = useState<Stage>('new_lead');
  const [notes,      setNotes]      = useState('');
  const [nameError,  setNameError]  = useState('');
  const [phoneError, setPhoneError] = useState('');

  function reset() {
    setName(''); setPhone(''); setStage('new_lead'); setNotes('');
    setNameError(''); setPhoneError('');
  }

  // Strip non-digits and validate exactly 10 digits (Indian mobile)
  function cleanPhone(raw: string): string {
    return raw.replace(/\D/g, '');
  }

  function validateForm(): boolean {
    let valid = true;
    if (!name.trim()) {
      setNameError('Name is required');
      valid = false;
    } else {
      setNameError('');
    }
    const digits = cleanPhone(phone);
    if (!digits) {
      setPhoneError('Phone is required');
      valid = false;
    } else if (digits.length !== 10) {
      setPhoneError(`Must be 10 digits — you entered ${digits.length}`);
      valid = false;
    } else {
      setPhoneError('');
    }
    return valid;
  }

  const addMutation = useMutation({
    mutationFn: async () =>
      apiFetch('/api/crm/leads', {
        method: 'POST',
        body: JSON.stringify({
          name:  name.trim(),
          phone: cleanPhone(phone),   // send only digits
          stage,
          notes: notes.trim(),
        }),
      }),
    onSuccess: () => {
      toast.success('Lead added successfully');
      reset();
      onSuccess();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setPhoneError('A lead with this phone number already exists');
        } else {
          // Surface the actual backend message (e.g. "Validation failed")
          const detail = (err.body?.details as Array<{ message: string }> | undefined)?.[0]?.message;
          toast.error(detail ?? err.message ?? 'Failed to add lead');
        }
      } else {
        toast.error('Failed to add lead');
      }
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;
    addMutation.mutate();
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Add Lead"
      description="Create a new lead in the pipeline"
      footer={
        <DrawerFooter>
          <Button variant="secondary" size="md" onClick={handleClose} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={addMutation.isPending}
            onClick={handleSubmit}
          >
            Add Lead
          </Button>
        </DrawerFooter>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full name"
          required
          placeholder="e.g. Rahul Sharma"
          value={name}
          onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
          iconLeft={<User className="h-4 w-4" />}
          error={nameError}
          autoFocus
        />
        <Input
          label="Phone number"
          required
          placeholder="9876543210"
          hint="10-digit mobile number (without +91)"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (phoneError) setPhoneError(''); }}
          type="tel"
          phonePrefix
          error={phoneError}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Stage
          </label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Notes <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any initial notes about this lead…"
            className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          />
        </div>
      </form>
    </Drawer>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [showAddLead, setShowAddLead] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const canCreate = ['owner', 'admin', 'manager', 'sales'].includes(v3Role);

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['sales-contacts'],
    queryFn: async () => {
      const data = await apiFetch<{ contacts: Contact[] }>('/api/contacts?pageSize=500');
      return data.contacts ?? [];
    },
    staleTime: 30_000,
  });

  const listColumns = buildListColumns();

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

          {canCreate && (
            <Button
              size="sm"
              iconLeft={<Plus className="h-4 w-4" />}
              onClick={() => setShowAddLead(true)}
            >
              Add Lead
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        view === 'kanban' ? (
          <div className="flex gap-3 p-4 overflow-x-auto">
            {STAGE_ORDER.map((s) => (
              <div key={s} className="w-[240px] shrink-0 space-y-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4">
            <SkeletonCard />
          </div>
        )
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No leads yet"
          description="Add your first lead to start tracking the pipeline"
          action={canCreate ? { label: 'Add Lead', onClick: () => setShowAddLead(true) } : undefined}
          className="flex-1"
        />
      ) : view === 'kanban' ? (
        <KanbanBoard contacts={contacts} />
      ) : (
        <div className="flex-1 overflow-auto">
          <Table
            columns={listColumns}
            data={contacts}
            keyExtractor={(row) => row.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
            onRowClick={(row) => router.push(`/customers/${row.id}`)}
          />
        </div>
      )}

      {/* Add Lead drawer */}
      <AddLeadDrawer
        open={showAddLead}
        onClose={() => setShowAddLead(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['sales-contacts'] })}
      />
    </div>
  );
}
