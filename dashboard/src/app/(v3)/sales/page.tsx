'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  List, LayoutGrid, Plus, GripVertical, ArrowRight,
  User, Search, X, ChevronDown, Download, Clock,
  MessageCircle, TrendingUp, Target, Settings,
  Upload, Users, ArrowUp, ArrowDown, Trash2,
} from 'lucide-react';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
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
import { Checkbox } from '@/components/v3/ui/Checkbox';
import { TagBadge, type Tag } from '@/components/tags/TagBadge';
import { PriorityBadge } from '@/components/shared/PriorityBadge';
import { cn } from '@/lib/cn';
import { apiFetch, ApiClientError } from '@/lib/api';
import type { Contact, Stage } from '@/types/v3';
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { canAssignOwner } from '@/lib/permissions';
import { toast } from 'sonner';
import { format, subDays, differenceInDays, isToday, isYesterday } from 'date-fns';

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'stage';
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmployeeItem { id: string; name: string; role: string; }
type DateFilter = '' | '7' | '30' | '90';

interface Filters {
  search: string;
  stage: string;
  owner: string;
  tags: string[];
  dateAdded: DateFilter;
}

const EMPTY_FILTERS: Filters = { search: '', stage: '', owner: '', tags: [], dateAdded: '' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function contactName(c: Contact): string {
  return c.displayName ?? c.name ?? c.phone ?? '';
}

function relTime(ts: string | undefined | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  const days = differenceInDays(new Date(), d);
  if (days < 30) return `${days}d ago`;
  return format(d, 'd MMM');
}

function getStageLabel(key: string, stages: PipelineStage[]): string {
  // usePipelineStages() always returns a full list (falls back to defaults
  // itself while loading/on error), so no second fallback layer is needed here.
  return stages.find((s) => s.key === key)?.label ?? key;
}

function exportCSV(contacts: Contact[], stages: PipelineStage[]) {
  const headers = ['Name', 'Phone', 'Stage', 'Priority Score', 'Priority Tier', 'Assigned To', 'Last Activity', 'Added'];
  const rows = contacts.map((c) => [
    contactName(c),
    c.phone,
    getStageLabel(c.stage, stages),
    c.priorityScore != null ? String(c.priorityScore) : '',
    c.priorityTier ?? '',
    c.assignedToName ?? c.ownerName ?? '',
    relTime(c.lastMessageAt ?? c.createdAt),
    c.createdAt ? format(new Date(c.createdAt), 'dd/MM/yyyy') : '',
  ]);
  const csv = [headers, ...rows].map((row) => row.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apforce-pipeline-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── KPI Header ────────────────────────────────────────────────────────────────

function KPIHeader({ contacts, stages }: { contacts: Contact[]; stages: PipelineStage[] }) {
  const total       = contacts.length;
  const active      = contacts.filter((c) => c.stage !== 'lost').length;
  const converted   = contacts.filter((c) => c.stage === 'demat_done').length;
  const lost        = contacts.filter((c) => c.stage === 'lost').length;
  const winBase     = converted + lost;
  const winRate     = winBase > 0 ? Math.round((converted / winBase) * 100) : 0;
  // priorityTier is LeadScoringScheduler's persisted, company-wide computed value —
  // replaces the old ad hoc "interested or kyc_done stage" heuristic, which
  // disagreed with Contact 360's separate derivePriority() heuristic for the
  // same lead. Single source of truth now, not a second independent guess.
  const hot         = contacts.filter((c) => c.priorityTier === 'hot').length;

  const kpis = [
    { label: 'Total Leads', value: total,         sub: 'in pipeline',         color: 'text-neutral-900 dark:text-neutral-100' },
    { label: 'Active',      value: active,         sub: `${total ? Math.round((active/total)*100) : 0}% of total`, color: 'text-primary-600 dark:text-primary-400' },
    { label: 'Hot Leads',   value: hot,            sub: 'Priority score ≥70', color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Converted',   value: converted,      sub: 'Demat Done',          color: 'text-green-600 dark:text-green-400' },
    { label: 'Win Rate',    value: `${winRate}%`,  sub: `${lost} lost`,        color: winRate >= 20 ? 'text-green-600 dark:text-green-400' : 'text-neutral-700 dark:text-neutral-300' },
  ];

  const stageGroups = stages.map((s) => ({
    stage: s,
    count: contacts.filter((c) => c.stage === s.key).length,
    pct: total > 0 ? (contacts.filter((c) => c.stage === s.key).length / total) * 100 : 0,
  }));

  return (
    <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
            <p className={cn('text-2xl font-bold tabular-nums', k.color)}>{k.value}</p>
            <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 mt-0.5">{k.label}</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">Pipeline Distribution</p>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            {stageGroups.filter((g) => g.pct > 0).map((g) => (
              <div
                key={g.stage.key}
                className="h-full transition-all duration-500"
                style={{ width: `${g.pct}%`, backgroundColor: g.stage.color }}
                title={`${g.stage.label}: ${g.count} (${Math.round(g.pct)}%)`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {stageGroups.map((g) => (
              <div key={g.stage.key} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: g.stage.color }} />
                <span className="text-[11px] text-neutral-500">
                  {g.stage.label} <span className="font-medium text-neutral-700 dark:text-neutral-300">{g.count}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Drag preview ──────────────────────────────────────────────────────────────

function KanbanDragPreview({ contact, tagMap }: { contact: Contact; tagMap: Map<string, Tag> }) {
  const assignee = contact.assignedToName ?? contact.ownerName ?? null;
  const tags = (contact.tags ?? []).slice(0, 2).map((id) => tagMap.get(id)).filter(Boolean) as Tag[];

  return (
    <div className="w-[240px] rounded-xl border border-primary-300 bg-white p-3 dark:border-primary-700 dark:bg-neutral-900 shadow-xl">
      <div className="flex items-start gap-2.5">
        <Avatar name={contactName(contact)} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{contactName(contact)}</p>
          <p className="text-[11px] text-neutral-500">{contact.phone}</p>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t) => <TagBadge key={t.id} tag={t} />)}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        {assignee ? <Avatar name={assignee} size={20} title={assignee} /> : <span className="text-[11px] text-neutral-400">Unassigned</span>}
        <span className="text-[11px] text-neutral-400">{relTime(contact.lastMessageAt ?? contact.createdAt)}</span>
      </div>
    </div>
  );
}

// ── Kanban Card ───────────────────────────────────────────────────────────────

function KanbanCard({
  contact, tagMap, bulkMode, selected, onSelect, stage, onOpenStagePicker,
}: {
  contact: Contact;
  tagMap: Map<string, Tag>;
  bulkMode: boolean;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  stage: PipelineStage;
  onOpenStagePicker: (contact: Contact) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: contact.id,
    data: { contact },
    disabled: bulkMode,
  });

  const style = transform ? { transform: `translate(${transform.x}px,${transform.y}px)` } : undefined;
  const assignee = contact.assignedToName ?? contact.ownerName ?? null;
  const tags = (contact.tags ?? []).slice(0, 2).map((id) => tagMap.get(id)).filter(Boolean) as Tag[];
  const lastSeen = relTime(contact.lastMessageAt ?? contact.createdAt);

  const chatDot: Record<string, string> = {
    open:       'bg-green-500',
    pending:    'bg-amber-400',
    unassigned: 'bg-neutral-400',
    resolved:   'bg-neutral-300',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative rounded-xl border bg-white shadow-sm',
        'dark:bg-neutral-900',
        'transition-[opacity,box-shadow,border-color] duration-150',
        isDragging ? 'opacity-30 shadow-none' : 'opacity-100 hover:shadow-md',
        selected
          ? 'border-primary-400 dark:border-primary-600'
          : 'border-neutral-200 dark:border-neutral-800',
      )}
    >
      {bulkMode && (
        <div className="absolute left-2 top-2 z-10">
          <Checkbox
            checked={selected}
            onChange={(e) => onSelect(contact.id, e.target.checked)}
            aria-label={`Select ${contactName(contact)}`}
          />
        </div>
      )}

      {!bulkMode && (
        <button
          {...listeners}
          {...attributes}
          className="absolute right-2 top-2 z-10 hidden h-6 w-6 cursor-grab items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 group-hover:flex active:cursor-grabbing dark:hover:bg-neutral-800"
          aria-label="Drag"
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      )}

      {/* Mobile stage-change entry point (M2-C) — dnd-kit drag has no touch
          equivalent, so tapping this pill opens a Drawer-based stage picker
          instead. Sibling of <Link>, same absolute-positioning slot pattern
          as the drag handle above, so it never conflicts with card navigation.
          md:hidden — per the approved design, desktop keeps its existing
          hover-revealed drag handle as the only top-corner affordance;
          this pill is mobile-only and (unlike the drag handle) not
          hover-gated there, since touch devices have no hover. */}
      {!bulkMode && (
        <button
          type="button"
          onClick={() => onOpenStagePicker(contact)}
          className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-sm md:hidden dark:border-neutral-900"
          style={{ backgroundColor: stage.color }}
          aria-label={`Change stage — currently ${stage.label}`}
          title={`Stage: ${stage.label} — tap to change`}
        />
      )}

      <Link
        href={`/contacts/${contact.id}`}
        className={cn('block p-3', bulkMode && 'pl-8')}
        tabIndex={isDragging ? -1 : 0}
        onClick={(e) => bulkMode && e.preventDefault()}
      >
        <div className="flex items-start gap-2.5">
          <div className="relative shrink-0">
            <Avatar name={contactName(contact)} size={32} />
            {contact.chatStatus && contact.chatStatus !== 'resolved' && (
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-neutral-900',
                  chatDot[contact.chatStatus] ?? 'bg-neutral-300',
                )}
                title={contact.chatStatus}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-900 hover:text-primary-600 dark:text-neutral-100">
              {contactName(contact)}
            </p>
            <p className="text-[11px] text-neutral-500">{contact.phone}</p>
          </div>
        </div>

        {contact.priorityTier && (
          <div className="mt-2">
            <PriorityBadge tier={contact.priorityTier} score={contact.priorityScore} />
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((t) => <TagBadge key={t.id} tag={t} />)}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          {assignee ? (
            <div className="flex items-center gap-1.5">
              <Avatar name={assignee} size={20} />
              <span className="text-[11px] text-neutral-500 truncate max-w-[90px]">{assignee}</span>
            </div>
          ) : (
            <span className="text-[11px] text-neutral-400">Unassigned</span>
          )}
          <span className="text-[11px] text-neutral-400 shrink-0">{lastSeen}</span>
        </div>
      </Link>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, contacts, tagMap, totalContacts, bulkMode, selectedIds, onSelect, onOpenStagePicker,
}: {
  stage: PipelineStage;
  contacts: Contact[];
  tagMap: Map<string, Tag>;
  totalContacts: number;
  bulkMode: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onOpenStagePicker: (contact: Contact) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.key });
  const pct = totalContacts > 0 ? Math.round((contacts.length / totalContacts) * 100) : 0;

  return (
    <div className="flex min-h-0 w-[252px] shrink-0 flex-col" ref={setNodeRef}>
      <div
        className="rounded-t-xl border border-b-0 border-neutral-200 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-950"
        style={{ borderTop: `3px solid ${stage.color}` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {stage.label}
            </span>
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-100 px-1.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {contacts.length}
            </span>
          </div>
          <span className="text-[11px] text-neutral-400">{pct}%</span>
        </div>
      </div>

      {/* min-h-0 + overflow-y-auto so THIS list scrolls once it exceeds the
          column's stretched height, instead of growing unbounded and forcing
          the whole page (including the header/KPI/filter bar above) to scroll —
          Track A3, docs/phase3/TECHNICAL_DEBT.md. The droppable ref stays on
          the outer column div above, so drag-and-drop hit-testing is against
          that unscrolled bounding box, unaffected by this inner scroll. */}
      <div className={cn(
        'flex-1 min-h-[200px] overflow-y-auto rounded-b-xl border border-neutral-200 bg-neutral-50/80 p-2 space-y-2',
        'transition-colors duration-150',
        isOver
          ? 'bg-primary-50 border-primary-300 dark:bg-primary-900/15 dark:border-primary-700'
          : 'dark:border-neutral-800 dark:bg-neutral-900/40',
      )}>
        {contacts.map((c) => (
          <KanbanCard
            key={c.id}
            contact={c}
            tagMap={tagMap}
            bulkMode={bulkMode}
            selected={selectedIds.has(c.id)}
            onSelect={onSelect}
            stage={stage}
            onOpenStagePicker={onOpenStagePicker}
          />
        ))}
        {contacts.length === 0 && (
          <div className={cn(
            'flex h-20 items-center justify-center rounded-lg border-2 border-dashed text-xs transition-colors duration-150',
            isOver
              ? 'border-primary-300 text-primary-500 dark:border-primary-700'
              : 'border-neutral-200 text-neutral-400 dark:border-neutral-800',
          )}>
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Kanban Board ──────────────────────────────────────────────────────────────

function KanbanBoard({
  contacts, tagMap, bulkMode, selectedIds, onSelect, stages,
}: {
  contacts: Contact[];
  tagMap: Map<string, Tag>;
  bulkMode: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  stages: PipelineStage[];
}) {
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [stagePickerContact, setStagePickerContact] = useState<Contact | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const stageMutation = useStageMutation();

  function handlePickStage(stageKey: string) {
    if (stagePickerContact && stageKey !== stagePickerContact.stage) {
      stageMutation.mutate({ contact: stagePickerContact, stageKey });
    }
    setStagePickerContact(null);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveContact((event.active.data.current?.contact as Contact) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveContact(null);
    const { active, over } = event;
    if (!over) return;
    const contact = active.data.current?.contact as Contact;
    const newStageKey = over.id as string;
    if (contact && newStageKey !== contact.stage) stageMutation.mutate({ contact, stageKey: newStageKey });
  }

  const grouped = stages.reduce<Record<string, Contact[]>>(
    (acc, s) => ({ ...acc, [s.key]: contacts.filter((c) => c.stage === s.key) }),
    {},
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 p-4 overflow-x-auto min-h-0 flex-1">
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.key}
            stage={stage}
            contacts={grouped[stage.key] ?? []}
            tagMap={tagMap}
            totalContacts={contacts.length}
            bulkMode={bulkMode}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onOpenStagePicker={setStagePickerContact}
          />
        ))}
      </div>

      <StagePickerDrawer
        contact={stagePickerContact}
        stages={stages}
        pending={stageMutation.isPending}
        onClose={() => setStagePickerContact(null)}
        onSelectStage={handlePickStage}
      />

      <DragOverlay>
        {activeContact && (
          <div style={{ transform: 'scale(1.02)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.06)', borderRadius: 12, cursor: 'grabbing' }}>
            <KanbanDragPreview contact={activeContact} tagMap={tagMap} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Mobile stage picker (M2-C) ───────────────────────────────────────────────
// Bottom-sheet on mobile / right-side drawer on desktop (Drawer's own
// max-md: breakpoint), listing every pipeline stage so a tap can do what
// dnd-kit drag can't on a touchscreen. Uses the same useStageMutation() the
// desktop Kanban drag calls — same optimistic update, same error toast.

function StagePickerDrawer({
  contact, stages, pending, onClose, onSelectStage,
}: {
  contact: Contact | null;
  stages: PipelineStage[];
  pending: boolean;
  onClose: () => void;
  onSelectStage: (stageKey: string) => void;
}) {
  return (
    <Drawer
      open={!!contact}
      onClose={onClose}
      title="Change Stage"
      description={contact ? contactName(contact) : undefined}
    >
      <div className="flex flex-col gap-2">
        {stages.map((s) => {
          const isCurrent = contact?.stage === s.key;
          return (
            <button
              key={s.key}
              type="button"
              disabled={pending}
              onClick={() => onSelectStage(s.key)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left text-sm font-medium transition-colors disabled:opacity-50',
                isCurrent
                  ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-900/20'
                  : 'border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800',
              )}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="text-neutral-900 dark:text-neutral-100">{s.label}</span>
              {isCurrent && <span className="ml-auto text-xs text-primary-600 dark:text-primary-400">Current</span>}
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}

// ── Team Pipeline View ────────────────────────────────────────────────────────

function TeamPipelineView({
  contacts, employees, onSelectEmployee, stages,
}: {
  contacts: Contact[];
  employees: EmployeeItem[];
  onSelectEmployee: (id: string) => void;
  stages: PipelineStage[];
}) {
  const rows = employees.map((emp) => {
    const mine = contacts.filter(
      (c) => c.assignedTo === emp.id || c.assignedToName === emp.name || c.ownerName === emp.name,
    );
    const stageCounts = stages.reduce<Record<string, number>>(
      (acc, s) => ({ ...acc, [s.key]: mine.filter((c) => c.stage === s.key).length }),
      {},
    );
    const total = mine.length;
    const converted = stageCounts['demat_done'] ?? 0;
    const lost = stageCounts['lost'] ?? 0;
    const winBase = converted + lost;
    const winRate = winBase > 0 ? Math.round((converted / winBase) * 100) : 0;
    return { emp, stageCounts, total, winRate };
  }).filter((r) => r.total > 0);

  const unassigned = contacts.filter(
    (c) => !c.assignedTo && !c.assignedToName && !c.ownerName,
  );

  if (rows.length === 0 && unassigned.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-400">No employee data available</p>
      </div>
    );
  }

  const stageCols = { display: 'grid', gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: '4px' };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 overflow-hidden">
        <div className="grid gap-4 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5 bg-neutral-50 dark:bg-neutral-900"
          style={{ gridTemplateColumns: '200px 1fr 80px 80px' }}>
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Employee</span>
          <div style={stageCols}>
            {stages.map((s) => (
              <span key={s.key} className="text-[10px] font-medium text-neutral-400 text-center truncate">{s.label}</span>
            ))}
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 text-center">Total</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 text-center">Win%</span>
        </div>

        {rows.map(({ emp, stageCounts, total, winRate }) => (
          <button
            key={emp.id}
            onClick={() => onSelectEmployee(emp.id)}
            className="grid w-full gap-4 border-b border-neutral-100 dark:border-neutral-800 px-4 py-3 text-left hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-colors last:border-0"
            style={{ gridTemplateColumns: '200px 1fr 80px 80px' }}
          >
            <div className="flex items-center gap-2.5">
              <Avatar name={emp.name} size={24} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{emp.name}</p>
                <p className="text-[10px] text-neutral-400 capitalize">{emp.role}</p>
              </div>
            </div>
            <div style={stageCols} className="items-center">
              {stages.map((s) => {
                const cnt = stageCounts[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex justify-center">
                    {cnt > 0 ? (
                      <span
                        className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full text-xs font-semibold text-white px-1.5"
                        style={{ backgroundColor: s.color }}
                      >
                        {cnt}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-300 dark:text-neutral-700">—</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-center">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{total}</span>
            </div>
            <div className="text-center">
              <span className={cn('text-sm font-semibold', winRate >= 20 ? 'text-green-600 dark:text-green-400' : 'text-neutral-500')}>
                {winRate}%
              </span>
            </div>
          </button>
        ))}

        {unassigned.length > 0 && (
          <div
            className="grid w-full gap-4 border-t border-neutral-200 dark:border-neutral-800 px-4 py-3 bg-neutral-50/60 dark:bg-neutral-900/40"
            style={{ gridTemplateColumns: '200px 1fr 80px 80px' }}
          >
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
                <Users className="h-3.5 w-3.5 text-neutral-500" />
              </div>
              <p className="text-sm text-neutral-500">Unassigned</p>
            </div>
            <div style={stageCols} className="items-center">
              {stages.map((s) => {
                const cnt = unassigned.filter((c) => c.stage === s.key).length;
                return (
                  <div key={s.key} className="flex justify-center">
                    {cnt > 0 ? (
                      <span
                        className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full text-xs font-semibold text-white px-1.5 opacity-60"
                        style={{ backgroundColor: s.color }}
                      >
                        {cnt}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-300 dark:text-neutral-700">—</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-center"><span className="text-sm font-semibold text-neutral-500">{unassigned.length}</span></div>
            <div className="text-center"><span className="text-sm text-neutral-400">—</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── List columns ──────────────────────────────────────────────────────────────

function buildListColumns(tagMap: Map<string, Tag>, stages: PipelineStage[]): TableColumn<Contact>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (row) => (
        <Link href={`/contacts/${row.id}`} className="flex items-center gap-2.5 group">
          <div className="relative shrink-0">
            <Avatar name={contactName(row)} size={32} />
          </div>
          <div>
            <p className="font-semibold text-neutral-900 group-hover:text-primary-600 dark:text-neutral-100">{contactName(row)}</p>
            <p className="text-xs text-neutral-500">{row.phone}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      sortable: true,
      width: 'w-32',
      cell: (row) => (
        <Badge variant="stage" stage={row.stage} color={stages.find((s) => s.key === row.stage)?.color}>
          {getStageLabel(row.stage, stages)}
        </Badge>
      ),
    },
    {
      key: 'priorityScore',
      header: 'Priority',
      sortable: true,
      width: 'w-24',
      cell: (row) => <PriorityBadge tier={row.priorityTier} score={row.priorityScore} />,
    },
    {
      key: 'tags',
      header: 'Tags',
      width: 'w-40',
      cell: (row) => {
        const tags = (row.tags ?? []).slice(0, 2).map((id) => tagMap.get(id)).filter(Boolean) as Tag[];
        return tags.length > 0
          ? <div className="flex flex-wrap gap-1">{tags.map((t) => <TagBadge key={t.id} tag={t} />)}</div>
          : <span className="text-neutral-300 dark:text-neutral-700">—</span>;
      },
    },
    {
      key: 'owner',
      header: 'Assigned to',
      width: 'w-40',
      cell: (row) => {
        const name = row.assignedToName ?? row.ownerName;
        return name
          ? <div className="flex items-center gap-1.5"><Avatar name={name} size={20} /><span className="text-sm text-neutral-700 dark:text-neutral-300">{name}</span></div>
          : <span className="text-neutral-400">—</span>;
      },
    },
    {
      key: 'lastActivity',
      header: 'Last activity',
      sortable: true,
      width: 'w-32',
      cell: (row) => <span className="text-sm text-neutral-500">{relTime(row.lastMessageAt ?? row.createdAt)}</span>,
    },
    {
      key: 'createdAt',
      header: 'Added',
      width: 'w-28',
      cell: (row) => <span className="text-sm text-neutral-500">{row.createdAt ? format(new Date(row.createdAt), 'd MMM yy') : '—'}</span>,
    },
  ];
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const selectCls = 'h-8 rounded-lg border border-neutral-200 bg-white pl-2.5 pr-7 text-xs text-neutral-700 appearance-none focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200';

function SalesFilterBar({
  filters, onChange, v3Role, employees, tagCatalog, stages,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  v3Role: string;
  employees: EmployeeItem[];
  tagCatalog: Tag[];
  stages: PipelineStage[];
}) {
  const isAdmin = ['owner', 'admin'].includes(v3Role);

  const activeCount = [
    filters.search, filters.stage, filters.owner,
    filters.tags.length > 0, filters.dateAdded,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-950/60">
      <div className="relative flex-1 min-w-40 max-w-56">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search name or phone…"
          className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        />
        {filters.search && (
          <button onClick={() => onChange({ search: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="relative">
        <select value={filters.stage} onChange={(e) => onChange({ stage: e.target.value })} className={selectCls}>
          <option value="">All Stages</option>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
      </div>

      {isAdmin && employees.length > 0 && (
        <div className="relative">
          <select value={filters.owner} onChange={(e) => onChange({ owner: e.target.value })} className={selectCls}>
            <option value="">All Owners</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
        </div>
      )}

      {tagCatalog.length > 0 && (
        <div className="relative">
          <select value={filters.tags[0] ?? ''} onChange={(e) => onChange({ tags: e.target.value ? [e.target.value] : [] })} className={selectCls}>
            <option value="">All Tags</option>
            {tagCatalog.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
        </div>
      )}

      <div className="relative">
        <select value={filters.dateAdded} onChange={(e) => onChange({ dateAdded: e.target.value as DateFilter })} className={selectCls}>
          <option value="">Any Date</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
      </div>

      {activeCount > 0 && (
        <button onClick={() => onChange(EMPTY_FILTERS)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-error-600 hover:bg-error-50 dark:hover:bg-error-900/20">
          <X className="h-3 w-3" />
          Clear {activeCount > 1 ? `(${activeCount})` : ''}
        </button>
      )}
    </div>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

function BulkBar({
  selectedIds, contacts, onClear, onBulkStage, stages,
}: {
  selectedIds: Set<string>;
  contacts: Contact[];
  onClear: () => void;
  onBulkStage: (stage: string) => void;
  stages: PipelineStage[];
}) {
  const count = selectedIds.size;
  if (count === 0) return null;

  const selected = contacts.filter((c) => selectedIds.has(c.id));

  return (
    <div className="fixed bottom-6 left-1/2 z-[300] -translate-x-1/2 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-5 py-3 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900 animate-in slide-in-from-bottom-4 fade-in duration-200">
      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
        {count} lead{count !== 1 ? 's' : ''} selected
      </span>
      <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

      <div className="relative">
        <select
          defaultValue=""
          onChange={(e) => { if (e.target.value) onBulkStage(e.target.value); e.target.value = ''; }}
          className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 pl-2.5 pr-7 text-xs font-medium text-neutral-700 appearance-none focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          <option value="" disabled>Move to stage…</option>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
      </div>

      <button
        onClick={() => exportCSV(selected, stages)}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </button>

      <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

      <button onClick={onClear} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <X className="h-3.5 w-3.5" />
        Clear
      </button>
    </div>
  );
}

// ── Add Lead drawer ───────────────────────────────────────────────────────────

function AddLeadDrawer({
  open, onClose, onSuccess, stages,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  stages: PipelineStage[];
}) {
  const defaultStage = stages[0]?.key ?? 'new_lead';

  const [name, setName]             = useState('');
  const [phone, setPhone]           = useState('');
  const [stage, setStage]           = useState(defaultStage);
  const [notes, setNotes]           = useState('');
  const [nameError, setNameError]   = useState('');
  const [phoneError, setPhoneError] = useState('');

  // Reset stage default when stages list changes (e.g. after pipeline edit)
  useEffect(() => {
    if (stages.length > 0 && !stages.find((s) => s.key === stage)) {
      setStage(stages[0].key);
    }
  }, [stages, stage]);

  function reset() { setName(''); setPhone(''); setStage(defaultStage); setNotes(''); setNameError(''); setPhoneError(''); }
  function clean(raw: string) { return raw.replace(/\D/g, ''); }

  function validate(): boolean {
    let ok = true;
    if (!name.trim()) { setNameError('Name is required'); ok = false; } else setNameError('');
    const d = clean(phone);
    if (!d) { setPhoneError('Phone is required'); ok = false; }
    else if (d.length !== 10) { setPhoneError(`Must be 10 digits — you entered ${d.length}`); ok = false; }
    else setPhoneError('');
    return ok;
  }

  const addMut = useMutation({
    mutationFn: async () => apiFetch('/api/crm/leads', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), phone: clean(phone), stage, notes: notes.trim() }),
    }),
    onSuccess: () => { toast.success('Lead added'); reset(); onSuccess(); onClose(); },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.status === 409) setPhoneError('A lead with this phone already exists');
        else {
          const detail = (err.body?.details as Array<{ message: string }> | undefined)?.[0]?.message;
          toast.error(detail ?? err.message ?? 'Failed to add lead');
        }
      } else toast.error('Failed to add lead');
    },
  });

  function handleSubmit(e: React.FormEvent) { e.preventDefault(); if (!validate()) return; addMut.mutate(); }
  function handleClose() { reset(); onClose(); }

  return (
    <Drawer open={open} onClose={handleClose} title="Add Lead" description="Create a new lead in the pipeline"
      footer={
        <DrawerFooter>
          <Button variant="secondary" size="md" onClick={handleClose} type="button">Cancel</Button>
          <Button variant="primary" size="md" loading={addMut.isPending} onClick={handleSubmit}>Add Lead</Button>
        </DrawerFooter>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Full name" required placeholder="e.g. Rahul Sharma" value={name}
          onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
          iconLeft={<User className="h-4 w-4" />} error={nameError} autoFocus />
        <Input label="Phone number" required placeholder="9876543210" hint="10-digit mobile number (without +91)"
          value={phone} onChange={(e) => { setPhone(e.target.value); if (phoneError) setPhoneError(''); }}
          type="tel" phonePrefix error={phoneError} />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Notes <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Any initial notes about this lead…"
            className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" />
        </div>
      </form>
    </Drawer>
  );
}

// ── Manage Pipeline Drawer ────────────────────────────────────────────────────

function ManagePipelineDrawer({
  open, onClose, initialStages, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initialStages: PipelineStage[];
  onSaved: () => void;
}) {
  const [stages, setStages] = useState<PipelineStage[]>([]);

  useEffect(() => {
    if (open) setStages(initialStages.map((s, i) => ({ ...s, order: i })));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMut = useMutation({
    mutationFn: () =>
      apiFetch('/api/crm/pipeline', {
        method: 'PUT',
        body: JSON.stringify({ stages: stages.map((s, i) => ({ ...s, order: i })) }),
      }),
    onSuccess: () => {
      toast.success('Pipeline updated');
      onSaved();
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.body?.error ?? err?.message ?? 'Failed to save pipeline';
      toast.error(msg);
    },
  });

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next);
  }

  function rename(i: number, label: string) {
    setStages((p) => p.map((s, idx) => idx === i ? { ...s, label } : s));
  }

  function recolor(i: number, color: string) {
    setStages((p) => p.map((s, idx) => idx === i ? { ...s, color } : s));
  }

  function remove(i: number) {
    setStages((p) => p.filter((_, idx) => idx !== i));
  }

  function addStage() {
    const existingKeys = new Set(stages.map((s) => s.key));
    let key = 'new_stage';
    let n = 2;
    while (existingKeys.has(key)) key = `new_stage_${n++}`;
    setStages((p) => [...p, { key, label: 'New Stage', color: '#64748b', order: p.length }]);
  }

  function handleLabelBlur(i: number, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    const existingKeys = new Set(stages.map((s) => s.key));
    const base = slugify(trimmed);
    if (!existingKeys.has(base) || stages[i].key === base) {
      setStages((p) => p.map((s, idx) => idx === i ? { ...s, key: base, label: trimmed } : s));
    } else {
      setStages((p) => p.map((s, idx) => idx === i ? { ...s, label: trimmed } : s));
    }
  }

  const isDirty = JSON.stringify(stages) !== JSON.stringify(initialStages.map((s, i) => ({ ...s, order: i })));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Manage Pipeline Stages"
      description="Rename, reorder, or add stages for your sales pipeline"
      confirmClose={isDirty}
      width={480}
      footer={
        <DrawerFooter>
          <Button variant="secondary" size="md" onClick={onClose} type="button">Cancel</Button>
          <Button variant="primary" size="md" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
            Save Stages
          </Button>
        </DrawerFooter>
      }
    >
      <div className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900">
            {/* Color picker — native OS color picker */}
            <label className="relative flex-shrink-0 cursor-pointer" title="Change color">
              <span
                className="block h-7 w-7 rounded-full border-2 border-white shadow ring-1 ring-neutral-200 dark:ring-neutral-700"
                style={{ backgroundColor: s.color }}
              />
              <input
                type="color"
                value={s.color}
                onChange={(e) => recolor(i, e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>

            {/* Label */}
            <input
              value={s.label}
              onChange={(e) => rename(i, e.target.value)}
              onBlur={(e) => handleLabelBlur(i, e.target.value)}
              className="flex-1 rounded-lg border border-neutral-200 bg-transparent px-2.5 py-1.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:text-neutral-100"
              maxLength={40}
              placeholder="Stage name"
            />

            {/* Move up */}
            <button
              type="button"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              title="Move up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>

            {/* Move down */}
            <button
              type="button"
              disabled={i === stages.length - 1}
              onClick={() => move(i, 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              title="Move down"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={stages.length <= 1}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-error-500 hover:bg-error-50 disabled:opacity-30 dark:hover:bg-error-900/20"
              title="Remove stage"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addStage}
          className="flex items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 p-3 text-sm text-neutral-500 hover:border-primary-300 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Stage
        </button>

        <p className="text-xs text-neutral-400 mt-1">
          Click the colored circle to change a stage color. Stages with active leads cannot be deleted — move leads first.
        </p>
      </div>
    </Drawer>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [view, setView]                       = useState<'kanban' | 'list' | 'team'>('kanban');
  const [showAddLead, setShowAddLead]         = useState(false);
  const [showManagePipeline, setShowManagePipeline] = useState(false);
  // Defaults to the highest-priority lead first — LeadScoringScheduler's whole
  // point is "who to follow up with first," so that should be the view an
  // agent lands on, not something they have to click a column header to reach.
  const [sortKey, setSortKey]                 = useState('priorityScore');
  const [sortDir, setSortDir]                 = useState<SortDirection>('desc');
  const [filters, setFilters]                 = useState<Filters>(EMPTY_FILTERS);
  const [bulkMode, setBulkMode]               = useState(false);
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());
  const [showKPIs, setShowKPIs]               = useState(true);

  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  // Raw role, not v3Role (DL-021, docs/v3/12_DECISION_LOG.md: display buckets
  // must never be used for permission gating, only raw roles).
  const rawRole = user?.role;
  const isAdmin  = rawRole === 'superadmin' || rawRole === 'admin';
  // Raw role, not v3Role — matches POST /api/crm/leads's checkRole(['admin','manager'])
  // exactly (same gate canAssignOwner already encodes for the equivalent Inbox/CrmTab
  // assign controls). v3Role would wrongly include 'sales' (agent/telecaller, backend
  // rejects them) and wrongly include team_lead in its shared 'manager' bucket
  // (backend rejects team_lead too — only raw manager is allowed).
  const canCreate = canAssignOwner(user?.role);

  // ── Pipeline stages (dynamic, single shared owner of ['pipeline-stages']) ──

  const { stages } = usePipelineStages();

  // ── Queries ───────────────────────────────────────────────────────────────

  // GET /api/contacts/all — every matching contact in one response, not the
  // paginated GET / route: this board (plus its KPI/List/Team sub-views) needs
  // the complete set to group by stage correctly. GET /?pageSize=500 used to be
  // called here expecting everything back, but the backend hard-caps pageSize
  // at 100 — silently truncating any company past 100 leads (Track A3,
  // docs/phase3/TECHNICAL_DEBT.md; confirmed live at 114 leads for viir_trading,
  // 14 of them invisible on the old pattern).
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['sales-contacts'],
    queryFn: async () => {
      const data = await apiFetch<{ contacts: Contact[] }>('/api/contacts/all');
      return data.contacts ?? [];
    },
    staleTime: 30_000,
  });

  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 5 * 60_000,
  });
  const tagCatalog = tagCatalogData?.tags ?? [];

  const { data: employeesData } = useQuery({
    queryKey: ['employees-list'],
    queryFn: () => apiFetch<{ employees: EmployeeItem[] }>('/api/admin/employees'),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const employees = employeesData?.employees ?? [];

  const tagMap = useMemo(
    () => new Map(tagCatalog.map((t) => [t.id, t])),
    [tagCatalog],
  );

  // ── Client-side filter ────────────────────────────────────────────────────

  const filteredContacts = useMemo(() => {
    const cutoff = filters.dateAdded ? subDays(new Date(), parseInt(filters.dateAdded, 10)) : null;
    return contacts.filter((c) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!contactName(c).toLowerCase().includes(q) && !c.phone.includes(filters.search)) return false;
      }
      if (filters.stage && c.stage !== filters.stage) return false;
      if (filters.owner) {
        const match = c.assignedTo === filters.owner || c.assignedToName === filters.owner || c.ownerName === filters.owner;
        if (!match) return false;
      }
      if (filters.tags.length > 0) {
        if (!filters.tags.some((t) => (c.tags ?? []).includes(t))) return false;
      }
      if (cutoff && c.createdAt && new Date(c.createdAt) < cutoff) return false;
      return true;
    });
  }, [contacts, filters]);

  // Applies sortKey/sortDir to the filtered list — previously sortKey/sortDir only
  // drove the List View's column-header chevron icon, never actually reordering
  // the rows (Table.tsx has no sort logic of its own; it's purely a controlled
  // display). A real, pre-existing bug clicking any column header silently did
  // nothing — fixed here as part of making Priority genuinely sortable, since
  // "must sort correctly" was the whole point of this feature.
  const sortedContacts = useMemo(() => {
    if (!sortDir) return filteredContacts; // Table's 3-state toggle (asc→desc→null) — null means "no sort"
    const stageOrder = new Map(stages.map((s) => [s.key, s.order]));
    function compare(a: Contact, b: Contact): number {
      switch (sortKey) {
        case 'name':
          return contactName(a).localeCompare(contactName(b));
        case 'stage':
          return (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0);
        case 'priorityScore':
          return (a.priorityScore ?? -1) - (b.priorityScore ?? -1);
        case 'lastActivity': {
          const tA = a.lastMessageAt ?? a.createdAt ?? '';
          const tB = b.lastMessageAt ?? b.createdAt ?? '';
          return tA.localeCompare(tB);
        }
        default:
          return 0;
      }
    }
    const sorted = [...filteredContacts].sort(compare);
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [filteredContacts, sortKey, sortDir, stages]);

  function patchFilter(patch: Partial<Filters>) { setFilters((prev) => ({ ...prev, ...patch })); }

  const hasActiveFilters = Object.values(filters).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

  // ── Bulk ops ──────────────────────────────────────────────────────────────

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const stageMutBulk = useMutation({
    mutationFn: async ({ contact, stageKey }: { contact: Contact; stageKey: string }) => {
      if (contact.type === 'lead' || (contact.leadId ?? null) !== null) {
        return apiFetch(`/api/crm/leads/${contact.leadId ?? contact.id}/stage`, { method: 'PUT', body: JSON.stringify({ stage: stageKey }) });
      }
      return apiFetch('/api/contacts/stage', { method: 'PUT', body: JSON.stringify({ phone: contact.phone, stage: stageKey }) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sales-contacts'] }),
  });

  async function handleBulkStage(stageKey: string) {
    const toMove = contacts.filter((c) => selectedIds.has(c.id) && c.stage !== stageKey);
    qc.setQueryData<Contact[]>(['sales-contacts'], (old = []) =>
      old.map((c) => selectedIds.has(c.id) ? { ...c, stage: stageKey as Stage } : c),
    );
    let failed = 0;
    for (const c of toMove) {
      try { await stageMutBulk.mutateAsync({ contact: c, stageKey }); }
      catch { failed++; }
    }
    const label = getStageLabel(stageKey, stages);
    if (failed > 0) toast.error(`${failed} leads failed to update — refreshing…`);
    else toast.success(`${toMove.length} leads moved to ${label}`);
    setSelectedIds(new Set());
    setBulkMode(false);
  }


  const listColumns = useMemo(() => buildListColumns(tagMap, stages), [tagMap, stages]);

  return (
    <div className="flex h-full flex-col">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Sales CRM</h1>
          <p className="text-sm text-neutral-500">
            {isLoading ? 'Loading…'
              : hasActiveFilters ? `${sortedContacts.length} of ${contacts.length} leads`
              : `${contacts.length} leads · ${stages.length} stages`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* KPI toggle */}
          <button
            onClick={() => setShowKPIs((v) => !v)}
            title={showKPIs ? 'Hide KPIs' : 'Show KPIs'}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg border text-neutral-500 transition-colors',
              showKPIs
                ? 'border-primary-200 bg-primary-50 text-primary-600 dark:border-primary-800 dark:bg-primary-900/20'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800',
            )}
          >
            <Target className="h-4 w-4" />
          </button>

          {/* Manage pipeline (admin only) */}
          {isAdmin && (
            <button
              onClick={() => setShowManagePipeline(true)}
              title="Manage pipeline stages"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800 transition-colors"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          <Link href="/sales/followups">
            <Button variant="secondary" size="sm" iconRight={<ArrowRight className="h-4 w-4" />}>Follow-ups</Button>
          </Link>

          <button
            onClick={() => { setBulkMode((v) => !v); setSelectedIds(new Set()); }}
            title={bulkMode ? 'Exit select mode' : 'Select leads'}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
              bulkMode
                ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/20'
                : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800',
            )}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {bulkMode ? 'Selecting' : 'Select'}
          </button>

          <div className="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700" role="group" aria-label="View mode">
            {([
              { id: 'kanban', icon: <LayoutGrid className="h-4 w-4" />, label: 'Kanban View' },
              { id: 'list',   icon: <List className="h-4 w-4" />,        label: 'List View' },
              ...(isAdmin ? [{ id: 'team', icon: <Users className="h-4 w-4" />, label: 'Team View' }] : []),
            ] as const).map(({ id, icon, label }) => (
              <button
                key={id}
                onClick={() => setView(id as typeof view)}
                title={label}
                aria-label={label}
                aria-pressed={view === id}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md transition-all duration-150',
                  view === id
                    ? 'bg-neutral-900 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800',
                )}
              >
                {icon}
              </button>
            ))}
          </div>

          {canCreate && (
            <Button size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowAddLead(true)}>
              Add Lead
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI header ───────────────────────────────────────────────────────── */}
      {showKPIs && !isLoading && contacts.length > 0 && (
        <KPIHeader contacts={contacts} stages={stages} />
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <SalesFilterBar
        filters={filters}
        onChange={patchFilter}
        v3Role={v3Role}
        employees={employees}
        tagCatalog={tagCatalog}
        stages={stages}
      />

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {isLoading ? (
        view === 'kanban' ? (
          <div className="flex gap-3 p-4 overflow-x-auto">
            {stages.map((s) => (
              <div key={s.key} className="w-[252px] shrink-0 space-y-2">
                <SkeletonCard /><SkeletonCard />
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4"><SkeletonCard /></div>
        )
      ) : sortedContacts.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={hasActiveFilters ? 'No leads match your filters' : 'No leads yet'}
          description={hasActiveFilters ? 'Try adjusting or clearing your filters' : 'Add your first lead to start tracking the pipeline'}
          action={hasActiveFilters
            ? { label: 'Clear filters', onClick: () => setFilters(EMPTY_FILTERS) }
            : canCreate ? { label: 'Add Lead', onClick: () => setShowAddLead(true) } : undefined}
          className="flex-1"
        />
      ) : view === 'team' ? (
        <TeamPipelineView
          contacts={sortedContacts}
          employees={employees}
          stages={stages}
          onSelectEmployee={(id) => {
            patchFilter({ owner: id });
            setView('kanban');
          }}
        />
      ) : view === 'kanban' ? (
        <KanbanBoard
          contacts={sortedContacts}
          tagMap={tagMap}
          bulkMode={bulkMode}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          stages={stages}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          <Table
            columns={listColumns}
            data={sortedContacts}
            keyExtractor={(row) => row.id}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
            onRowClick={(row) => router.push(`/contacts/${row.id}`)}
          />
        </div>
      )}

      {/* ── Bulk action bar ───────────────────────────────────────────────────── */}
      <BulkBar
        selectedIds={selectedIds}
        contacts={contacts}
        onClear={() => { setSelectedIds(new Set()); setBulkMode(false); }}
        onBulkStage={handleBulkStage}
        stages={stages}
      />


      {/* ── Drawers ───────────────────────────────────────────────────────────── */}
      <AddLeadDrawer
        open={showAddLead}
        onClose={() => setShowAddLead(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['sales-contacts'] })}
        stages={stages}
      />
      <ManagePipelineDrawer
        open={showManagePipeline}
        onClose={() => setShowManagePipeline(false)}
        initialStages={stages}
        onSaved={() => qc.invalidateQueries({ queryKey: ['pipeline-stages'] })}
      />
    </div>
  );
}
