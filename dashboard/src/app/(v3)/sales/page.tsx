'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  List, LayoutGrid, Plus, GripVertical, ArrowRight,
  User, Search, X, ChevronDown,
} from 'lucide-react';
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
import { format, subDays } from 'date-fns';

// ── Stage config ──────────────────────────────────────────────────────────────

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmployeeItem { id: string; name: string; role: string; }
type DateFilter = '' | '7d' | '30d' | '90d';

interface Filters {
  search: string;
  stage: Stage | '';
  owner: string;
  tags: string[];       // tag IDs
  dateAdded: DateFilter;
}

const EMPTY_FILTERS: Filters = { search: '', stage: '', owner: '', tags: [], dateAdded: '' };

// ── Drag preview card (no useDraggable hook — safe inside DragOverlay) ────────

function KanbanDragPreview({ contact }: { contact: Contact }) {
  const assignee = contact.assignedToName ?? contact.ownerName ?? null;

  return (
    <div className="w-[232px] rounded-lg border border-primary-300 bg-white p-3 dark:border-primary-700 dark:bg-neutral-900">
      <div className="flex items-start gap-2.5">
        <Avatar name={contactName(contact)} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {contactName(contact)}
          </p>
          <p className="text-xs text-neutral-500">{contact.phone}</p>
        </div>
      </div>
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

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({ contact }: { contact: Contact }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
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
        'group relative rounded-lg border border-neutral-200 bg-white shadow-sm',
        'dark:border-neutral-800 dark:bg-neutral-900',
        'transition-[opacity,shadow] duration-150',
        isDragging ? 'opacity-30 shadow-none' : 'opacity-100 hover:shadow-md',
      )}
    >
      {/* Drag grip */}
      <button
        {...listeners}
        {...attributes}
        className="absolute right-2 top-2 z-10 hidden h-6 w-6 cursor-grab items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 group-hover:flex active:cursor-grabbing dark:hover:bg-neutral-800"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>

      {/* Clickable card body */}
      <Link href={`/customers/${contact.id}`} className="block p-3" tabIndex={isDragging ? -1 : 0}>
        <div className="flex items-start gap-2.5">
          <Avatar name={contactName(contact)} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-900 hover:text-primary-600 dark:text-neutral-100">
              {contactName(contact)}
            </p>
            <p className="text-xs text-neutral-500">{contact.phone}</p>
          </div>
        </div>
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
      </Link>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({ stage, contacts }: { stage: Stage; contacts: Contact[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });

  return (
    <div className="flex w-[240px] shrink-0 flex-col" ref={setNodeRef}>
      {/* Header */}
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

      {/* Drop zone */}
      <div
        className={cn(
          'flex-1 rounded-b-lg border border-neutral-200 bg-neutral-50 p-2 space-y-2 min-h-[160px]',
          'transition-colors duration-150',
          isOver
            ? 'bg-primary-50 border-primary-300 dark:bg-primary-900/15 dark:border-primary-700'
            : 'dark:border-neutral-800 dark:bg-neutral-900/50',
        )}
      >
        {contacts.map((c) => (
          <KanbanCard key={c.id} contact={c} />
        ))}
        {contacts.length === 0 && (
          <div
            className={cn(
              'flex h-20 items-center justify-center rounded-lg border-2 border-dashed text-xs transition-colors duration-150',
              isOver
                ? 'border-primary-300 text-primary-500 dark:border-primary-700'
                : 'border-neutral-200 text-neutral-400 dark:border-neutral-800',
            )}
          >
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

  // ── Stage mutation with proper rollback ────────────────────────────────────
  //
  // Bug fix: use `contact.leadId ?? contact.id` for the CRM endpoint.
  // The Contact interface documents `id` as "leadId for leads, 10-digit phone
  // for unknowns", but some API responses return contacts where `type` is
  // undefined yet `leadId` is the correct ULID. Using the explicit `leadId`
  // field avoids routing to a wrong URL when `id` happens to be a phone number.
  const stageMutation = useMutation({
    mutationFn: async ({ contact, stage }: { contact: Contact; stage: Stage }) => {
      if (contact.type === 'lead' || (contact.leadId ?? null) !== null) {
        // Prefer explicit leadId; fall back to id only when leadId is absent
        const leadId = contact.leadId ?? contact.id;
        return apiFetch(`/api/crm/leads/${leadId}/stage`, {
          method: 'PUT',
          body: JSON.stringify({ stage }),
        });
      }
      return apiFetch('/api/contacts/stage', {
        method: 'PUT',
        body: JSON.stringify({ phone: contact.phone, stage }),
      });
    },
    onMutate: async ({ contact, stage }) => {
      // Cancel any outgoing refetches (avoid race condition with optimistic update)
      await qc.cancelQueries({ queryKey: ['sales-contacts'] });
      // Snapshot previous value for rollback
      const previous = qc.getQueryData<Contact[]>(['sales-contacts']);
      // Apply optimistic update
      qc.setQueryData<Contact[]>(['sales-contacts'], (old = []) =>
        old.map((c) => (c.id === contact.id ? { ...c, stage } : c)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      // Rollback to pre-drag state
      if (context?.previous !== undefined) {
        qc.setQueryData(['sales-contacts'], context.previous);
      }
      const is429 = error instanceof ApiClientError && error.status === 429;
      toast.error(
        is429
          ? 'Too many stage changes — wait a moment and try again'
          : 'Failed to update stage',
      );
    },
    onSettled: () => {
      // Always refetch after mutation (success or error) to sync with server
      qc.invalidateQueries({ queryKey: ['sales-contacts'] });
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

      {/* Lifted card overlay — scale + shadow for "picked up" feel */}
      <DragOverlay>
        {activeContact && (
          <div
            style={{
              transform: 'scale(1.02)',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.06)',
              borderRadius: 8,
              cursor: 'grabbing',
            }}
          >
            <KanbanDragPreview contact={activeContact} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── List columns ──────────────────────────────────────────────────────────────

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

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  v3Role,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  v3Role: string;
}) {
  const isAdmin = ['owner', 'admin'].includes(v3Role);

  const { data: employeesData } = useQuery({
    queryKey: ['employees-list'],
    queryFn: () => apiFetch<{ employees: EmployeeItem[] }>('/api/admin/employees'),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const employees = employeesData?.employees ?? [];

  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () =>
      apiFetch<{ success: boolean; tags: Array<{ id: string; label: string; color: string }> }>(
        '/api/tags',
      ),
    staleTime: 5 * 60_000,
  });
  const tagCatalog = tagCatalogData?.tags ?? [];

  const activeCount = [
    filters.search,
    filters.stage,
    filters.owner,
    filters.tags.length > 0,
    filters.dateAdded,
  ].filter(Boolean).length;

  const selectCls =
    'h-8 rounded-lg border border-neutral-200 bg-white pl-2.5 pr-7 text-xs text-neutral-700 appearance-none focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950/60">
      {/* Search */}
      <div className="relative flex-1 min-w-40 max-w-56">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search name or phone…"
          className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        />
        {filters.search && (
          <button
            onClick={() => onChange({ search: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Stage filter */}
      <div className="relative">
        <select
          value={filters.stage}
          onChange={(e) => onChange({ stage: e.target.value as Stage | '' })}
          className={selectCls}
        >
          <option value="">All Stages</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
      </div>

      {/* Owner filter — admin/owner only */}
      {isAdmin && employees.length > 0 && (
        <div className="relative">
          <select
            value={filters.owner}
            onChange={(e) => onChange({ owner: e.target.value })}
            className={selectCls}
          >
            <option value="">All Owners</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
        </div>
      )}

      {/* Tags filter */}
      {tagCatalog.length > 0 && (
        <div className="relative">
          <select
            value={filters.tags[0] ?? ''}
            onChange={(e) =>
              onChange({ tags: e.target.value ? [e.target.value] : [] })
            }
            className={selectCls}
          >
            <option value="">All Tags</option>
            {tagCatalog.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
        </div>
      )}

      {/* Date added filter */}
      <div className="relative">
        <select
          value={filters.dateAdded}
          onChange={(e) => onChange({ dateAdded: e.target.value as DateFilter })}
          className={selectCls}
        >
          <option value="">Any Date</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
      </div>

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-error-600 hover:bg-error-50 dark:hover:bg-error-900/20"
        >
          <X className="h-3 w-3" />
          Clear {activeCount > 1 ? `(${activeCount})` : ''}
        </button>
      )}
    </div>
  );
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
          phone: cleanPhone(phone),
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
  const [view, setView]           = useState<'kanban' | 'list'>('kanban');
  const [showAddLead, setShowAddLead] = useState(false);
  const [sortKey, setSortKey]     = useState('name');
  const [sortDir, setSortDir]     = useState<SortDirection>('asc');
  const [filters, setFilters]     = useState<Filters>(EMPTY_FILTERS);

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

  // Client-side filter — all ops are O(n) on max 500 contacts
  const filteredContacts = useMemo(() => {
    const cutoff = filters.dateAdded
      ? subDays(new Date(), parseInt(filters.dateAdded, 10))
      : null;

    return contacts.filter((c) => {
      // Search by name or phone
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const name = contactName(c).toLowerCase();
        if (!name.includes(q) && !c.phone.includes(filters.search)) return false;
      }
      // Stage filter
      if (filters.stage && c.stage !== filters.stage) return false;
      // Owner filter (match by assignedTo id OR name)
      if (filters.owner) {
        const ownerMatch =
          c.assignedTo === filters.owner ||
          c.assignedToName === filters.owner ||
          c.ownerName === filters.owner;
        if (!ownerMatch) return false;
      }
      // Tag filter (any of selected tags)
      if (filters.tags.length > 0) {
        const contactTags = c.tags ?? [];
        if (!filters.tags.some((t) => contactTags.includes(t))) return false;
      }
      // Date range filter
      if (cutoff && c.createdAt) {
        if (new Date(c.createdAt) < cutoff) return false;
      }
      return true;
    });
  }, [contacts, filters]);

  function patchFilter(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  const listColumns = buildListColumns();
  const hasActiveFilters = Object.values(filters).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Sales CRM</h1>
          <p className="text-sm text-neutral-500">
            {isLoading
              ? 'Loading…'
              : hasActiveFilters
              ? `${filteredContacts.length} of ${contacts.length} leads`
              : `${contacts.length} leads across ${STAGE_ORDER.length} stages`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/sales/followups">
            <Button variant="secondary" size="sm" iconRight={<ArrowRight className="h-4 w-4" />}>
              Follow-ups
            </Button>
          </Link>

          {/* ── View toggle — icon only with tooltips ─────────────────────── */}
          <div
            className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700"
            role="group"
            aria-label="View mode"
          >
            <button
              onClick={() => setView('kanban')}
              title="Kanban View"
              aria-label="Kanban View"
              aria-pressed={view === 'kanban'}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150',
                view === 'kanban'
                  ? 'bg-neutral-900 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </button>
            <button
              onClick={() => setView('list')}
              title="List View"
              aria-label="List View"
              aria-pressed={view === 'list'}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150',
                view === 'list'
                  ? 'bg-neutral-900 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              <List className="h-4 w-4" aria-hidden />
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

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <FilterBar filters={filters} onChange={patchFilter} v3Role={v3Role} />

      {/* ── Content ────────────────────────────────────────────────────────── */}
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
      ) : filteredContacts.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={hasActiveFilters ? 'No leads match your filters' : 'No leads yet'}
          description={
            hasActiveFilters
              ? 'Try adjusting or clearing your filters'
              : 'Add your first lead to start tracking the pipeline'
          }
          action={
            hasActiveFilters
              ? { label: 'Clear filters', onClick: () => setFilters(EMPTY_FILTERS) }
              : canCreate
              ? { label: 'Add Lead', onClick: () => setShowAddLead(true) }
              : undefined
          }
          className="flex-1"
        />
      ) : view === 'kanban' ? (
        <KanbanBoard contacts={filteredContacts} />
      ) : (
        <div className="flex-1 overflow-auto">
          <Table
            columns={listColumns}
            data={filteredContacts}
            keyExtractor={(row) => row.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
            onRowClick={(row) => router.push(`/customers/${row.id}`)}
          />
        </div>
      )}

      {/* ── Add Lead drawer ────────────────────────────────────────────────── */}
      <AddLeadDrawer
        open={showAddLead}
        onClose={() => setShowAddLead(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['sales-contacts'] })}
      />
    </div>
  );
}
