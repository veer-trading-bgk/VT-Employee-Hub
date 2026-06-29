'use client';

import { memo, useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useCustomer360 } from '@/contexts/Customer360Context';
import type { PipelineStage } from '@/contexts/Customer360Context';
import { useContactMutations } from '@/hooks/useContactMutations';
import { TagSelector } from '@/components/tags/TagSelector';
import { TagBadge } from '@/components/tags/TagBadge';
import type { Tag } from '@/components/tags/TagBadge';
import type { ContactDetail } from '@/lib/contacts/types';
import { FollowUpForm } from '@/components/ui/FollowUpForm';

// ── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: 'whatsapp',    label: 'WhatsApp Inbound' },
  { value: 'instagram',   label: 'Instagram' },
  { value: 'form',        label: 'Form Submission' },
  { value: 'api',         label: 'API' },
  { value: 'import',      label: 'Import' },
  { value: 'manual',      label: 'Manual Entry' },
  { value: 'referral',    label: 'Referral' },
  { value: 'webinar',     label: 'Webinar' },
  { value: 'social',      label: 'Social Media' },
  { value: 'walk_in',     label: 'Walk-in' },
  { value: 'whatsapp_ai', label: 'WhatsApp AI' },
] as const;

const PRODUCT_OPTIONS = [
  { value: 'kyc',       label: 'KYC' },
  { value: 'demat',     label: 'Demat' },
  { value: 'mf',        label: 'Mutual Funds' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'pms',       label: 'PMS' },
  { value: 'algo',      label: 'Algo Trading' },
] as const;

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((o) => [o.value, o.label])
);
const PRODUCT_LABELS: Record<string, string> = Object.fromEntries(
  PRODUCT_OPTIONS.map((o) => [o.value, o.label])
);

// ── Helper types ──────────────────────────────────────────────────────────────

interface EmployeeRecord { id: string; name: string; role: string; }

// ── Priority derivation ───────────────────────────────────────────────────────

function derivePriority(contact: ContactDetail): 'hot' | 'warm' | 'cold' {
  if (contact.closureDeadline) {
    const daysLeft = Math.ceil(
      (new Date(contact.closureDeadline).getTime() - Date.now()) / 86_400_000
    );
    if (daysLeft >= 0 && daysLeft <= 7) return 'hot';
  }
  if (!contact.lastInboundAt) return 'cold';
  const daysSince = (Date.now() - new Date(contact.lastInboundAt).getTime()) / 86_400_000;
  if (daysSince < 1) return 'hot';
  if (daysSince < 7) return 'warm';
  return 'cold';
}

const PRIORITY_STYLES = {
  hot:  { label: 'Hot',  cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', dot: 'bg-red-500' },
  warm: { label: 'Warm', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  cold: { label: 'Cold', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
} as const;

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

function classifyFu(date: string): 'overdue' | 'today' | 'upcoming' {
  const today = todayISO();
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}

const FU_STYLES = {
  overdue:  { badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',       border: 'border-red-200 dark:border-red-800',       label: 'Overdue'  },
  today:    { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800',  label: 'Today'    },
  upcoming: { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', label: 'Upcoming' },
} as const;

// ── UI helpers ────────────────────────────────────────────────────────────────

function Section({
  title, children, action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-500';

const selectCls =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-500';

// ── Pipeline Bar ──────────────────────────────────────────────────────────────

function PipelineBar({
  stages,
  currentStageKey,
}: {
  stages: PipelineStage[];
  currentStageKey: string;
}) {
  if (stages.length === 0) return null;
  const currentIdx = stages.findIndex((s) => s.key === currentStageKey);

  return (
    <div className="flex items-center overflow-x-auto pb-1" role="list" aria-label="Pipeline stages">
      {stages.map((stage, idx) => {
        const isCurrent = idx === currentIdx;
        const isPast = idx < currentIdx;
        return (
          <div key={stage.key} className="flex flex-shrink-0 items-center" role="listitem">
            <div
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                isCurrent || isPast
                  ? 'text-white'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
              } ${isCurrent ? 'shadow-md ring-2 ring-offset-1' : ''}`}
              style={
                isCurrent || isPast
                  ? { backgroundColor: stage.color, ...(isCurrent ? { ringColor: stage.color } : { opacity: 0.7 }) }
                  : {}
              }
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isPast && <span aria-hidden="true" className="mr-1 opacity-80">✓</span>}
              {stage.label}
            </div>
            {idx < stages.length - 1 && (
              <div
                className={`mx-1 h-px w-3 flex-shrink-0 ${idx < currentIdx ? 'bg-indigo-300 dark:bg-indigo-700' : 'bg-slate-200 dark:bg-slate-700'}`}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── CRM Panel ─────────────────────────────────────────────────────────────────

function CrmPanel() {
  const {
    leadId, contact, stages, followups, nextFollowup,
    refreshFollowups,
  } = useCustomer360();

  const { changeStage, reassign, updateCrm, addTag, removeTag, createTask } =
    useContactMutations(leadId);
  const qc = useQueryClient();

  // ── Queries (served from cache in most cases) ─────────────────────────
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () =>
      apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees').catch(
        () => ({ success: true, data: [] as EmployeeRecord[] })
      ),
    staleTime: 10 * 60_000,
  });
  const employees: EmployeeRecord[] = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role)
  );

  const { data: tagCatalogData } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () =>
      apiFetch<{ success: boolean; tags: Tag[] }>('/api/tags'),
    staleTime: 2 * 60_000,
  });
  const tagCatalog: Tag[] = useMemo(() => tagCatalogData?.tags ?? [], [tagCatalogData]);

  // ── Optimistic stage (shows immediately on change) ────────────────────
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const displayStage = pendingStage ?? contact?.stage ?? '';

  // ── Edit mode for deal fields ─────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editSource, setEditSource] = useState('');
  const [editProducts, setEditProducts] = useState<string[]>([]);
  const [editDeadline, setEditDeadline] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editExpected, setEditExpected] = useState('');
  const [editProbability, setEditProbability] = useState('');

  // ── Tag selector ──────────────────────────────────────────────────────
  const [showTagSelector, setShowTagSelector] = useState(false);

  const [showDoneHistory, setShowDoneHistory] = useState(false);

  // ── Mark done mutation (matches existing CRM page endpoint) ───────────
  const doneMutation = useMutation({
    mutationFn: ({ date, fuLeadId }: { date: string; fuLeadId: string }) =>
      apiFetch(`/api/crm/followups/${date}/${fuLeadId}/done`, { method: 'PUT' }),
    onSuccess: () => {
      refreshFollowups();
      toast.success('Marked done');
    },
    onError: () => toast.error('Failed to mark done'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────

  function handleStageChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStage = e.target.value;
    setPendingStage(newStage);
    changeStage.mutate(newStage, {
      onSettled: () => setPendingStage(null),
    });
  }

  function startEditing() {
    setEditSource(contact?.source ?? '');
    setEditProducts(contact?.productInterest ?? []);
    setEditDeadline(contact?.closureDeadline ?? '');
    setEditNotes(contact?.notes ?? '');
    setEditExpected(contact?.expectedValue != null ? String(contact.expectedValue) : '');
    setEditProbability(contact?.probability != null ? String(contact.probability) : '');
    setEditing(true);
  }

  function handleSaveCrm() {
    updateCrm.mutate(
      {
        source: editSource,
        productInterest: editProducts,
        closureDeadline: editDeadline || null,
        notes: editNotes,
        expectedValue: editExpected ? parseFloat(editExpected) : null,
        probability: editProbability ? parseFloat(editProbability) : null,
      },
      { onSuccess: () => setEditing(false) }
    );
  }

  function toggleProduct(val: string) {
    setEditProducts((prev) =>
      prev.includes(val) ? prev.filter((p) => p !== val) : [...prev, val]
    );
  }

  async function handleCreateTag(label: string, color: string) {
    const res = await apiFetch<{ success: boolean; tag: Tag }>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ label, color }),
    });
    await qc.invalidateQueries({ queryKey: ['tag-catalog'] });
    if (res.tag) addTag.mutate(res.tag.id);
  }

  // ── Derived ───────────────────────────────────────────────────────────

  const resolvedTags = useMemo(
    () =>
      (contact?.tags ?? [])
        .map((id) => tagCatalog.find((t) => t.id === id))
        .filter((t): t is Tag => !!t),
    [contact?.tags, tagCatalog]
  );

  const priority = contact ? derivePriority(contact) : 'cold';
  const priorityStyle = PRIORITY_STYLES[priority];

  const activeFu = useMemo(
    () =>
      followups
        .filter((f) => !f.done)
        .map((f) => ({ ...f, cls: classifyFu(f.date) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [followups]
  );

  const doneFu = useMemo(
    () => followups.filter((f) => f.done).slice(-5),
    [followups]
  );

  if (!contact) return null;

  const isSaving = updateCrm.isPending;
  const isDoning = doneMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-4">

        {/* ── Pipeline Bar ──────────────────────────────────────── */}
        <Section title="Pipeline">
          <PipelineBar stages={stages} currentStageKey={displayStage} />
          <div data-slot="stage-history" className="hidden" aria-hidden="true" />
        </Section>

        {/* ── Deal Information ───────────────────────────────────── */}
        <Section
          title="Deal Information"
          action={
            editing ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCrm}
                  disabled={isSaving}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <button
                onClick={startEditing}
                className="rounded-lg px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
              >
                Edit
              </button>
            )
          }
        >
          <div className="space-y-4">
            {/* Stage + Assign row (always interactive) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Stage
                </label>
                <select
                  value={displayStage}
                  onChange={handleStageChange}
                  disabled={changeStage.isPending}
                  className={`${selectCls} w-full`}
                  aria-label="Lead stage"
                >
                  {stages.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Assigned To
                </label>
                <select
                  value={contact.assignedTo}
                  onChange={(e) => reassign.mutate(e.target.value)}
                  disabled={reassign.isPending}
                  className={`${selectCls} w-full`}
                  aria-label="Assigned employee"
                >
                  <option value="">— Unassigned —</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Priority (derived, always read-only) */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Priority</span>
              <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityStyle.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${priorityStyle.dot}`} aria-hidden="true" />
                {priorityStyle.label}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">(derived)</span>
            </div>

            {editing ? (
              /* ── Edit form ──────────────────────────────────────── */
              <div className="space-y-4">
                {/* Source */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Lead Source
                  </label>
                  <select
                    value={editSource}
                    onChange={(e) => setEditSource(e.target.value)}
                    className={`${selectCls} w-full`}
                  >
                    <option value="">— Select source —</option>
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                {/* Products */}
                <div>
                  <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Product Interest
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCT_OPTIONS.map((p) => {
                      const active = editProducts.includes(p.value);
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => toggleProduct(p.value)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            active
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                          aria-pressed={active}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Closure Deadline */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Closure Target Date
                  </label>
                  <input
                    type="date"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    className={inputCls}
                  />
                </div>

                {/* Expected Value + Probability */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Expected Value (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 50000"
                      value={editExpected}
                      onChange={(e) => setEditExpected(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Probability (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="e.g. 70"
                      value={editProbability}
                      onChange={(e) => setEditProbability(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    CRM Notes
                  </label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    placeholder="Add deal context, objections, next steps…"
                    className={`${inputCls} resize-none`}
                  />
                </div>
              </div>
            ) : (
              /* ── View mode ─────────────────────────────────────── */
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Source</dt>
                  <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                    {SOURCE_LABELS[contact.source] ?? contact.source ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Closure Target</dt>
                  <dd className="mt-0.5 text-slate-700 dark:text-slate-300">{fmtDate(contact.closureDeadline)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Product Interest</dt>
                  <dd className="mt-1">
                    {contact.productInterest.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {contact.productInterest.map((p) => (
                          <span
                            key={p}
                            className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                          >
                            {PRODUCT_LABELS[p] ?? p}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Expected Value</dt>
                  <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                    {contact.expectedValue != null ? `₹${contact.expectedValue.toLocaleString('en-IN')}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Probability</dt>
                  <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                    {contact.probability != null ? `${contact.probability}%` : '—'}
                  </dd>
                </div>
                {contact.notes && (
                  <div className="col-span-2">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">CRM Notes</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-300">{contact.notes}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </Section>

        {/* ── Tags ───────────────────────────────────────────────── */}
        <Section
          title="Tags"
          action={
            <div className="relative">
              <button
                onClick={() => setShowTagSelector((p) => !p)}
                className="rounded-lg px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
                aria-label="Add tag"
                aria-expanded={showTagSelector}
              >
                + Add Tag
              </button>
              {showTagSelector && (
                <div className="absolute right-0 top-8 z-20">
                  <TagSelector
                    catalogTags={tagCatalog}
                    selectedIds={contact.tags}
                    loading={addTag.isPending || removeTag.isPending}
                    onToggle={(tagId) => {
                      if (contact.tags.includes(tagId)) {
                        removeTag.mutate(tagId);
                      } else {
                        addTag.mutate(tagId);
                      }
                    }}
                    onCreate={handleCreateTag}
                    onClose={() => setShowTagSelector(false)}
                  />
                </div>
              )}
            </div>
          }
        >
          {resolvedTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {resolvedTags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  size="sm"
                  onRemove={() => removeTag.mutate(tag.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No tags — click &quot;Add Tag&quot; to categorise this lead.</p>
          )}
        </Section>

        {/* ── Follow-ups ─────────────────────────────────────────── */}
        <Section title="Follow-ups">
          {/* Create form */}
          <div className="mb-4">
            <FollowUpForm
              onSubmit={(data, reset) => {
                createTask.mutate(data, {
                  onSuccess: () => {
                    refreshFollowups();
                    toast.success('Follow-up added');
                    reset();
                  },
                });
              }}
              isLoading={createTask.isPending}
              minDate={todayISO()}
              label="Schedule New"
            />
          </div>

          {/* Active follow-ups grouped */}
          {activeFu.length === 0 ? (
            <p className="text-center text-xs text-slate-400 py-4">No pending follow-ups</p>
          ) : (
            <div className="space-y-2">
              {(['overdue', 'today', 'upcoming'] as const).map((cls) => {
                const group = activeFu.filter((f) => f.cls === cls);
                if (group.length === 0) return null;
                const style = FU_STYLES[cls];
                return (
                  <div key={cls}>
                    <p className={`mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.badge}`}>
                      {style.label} ({group.length})
                    </p>
                    <ul className="space-y-1.5">
                      {group.map((fu) => (
                        <li
                          key={`${fu.date}-${fu.leadId}`}
                          className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${style.border} bg-white dark:bg-slate-900`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{fmtDate(fu.date)}</p>
                            {fu.note && (
                              <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{fu.note}</p>
                            )}
                          </div>
                          <button
                            onClick={() => doneMutation.mutate({ date: fu.date, fuLeadId: fu.leadId })}
                            disabled={isDoning}
                            className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Done ✓
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {/* Done history */}
          {doneFu.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowDoneHistory((p) => !p)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <span aria-hidden="true">{showDoneHistory ? '▼' : '▶'}</span>
                {doneFu.length} completed
              </button>
              {showDoneHistory && (
                <ul className="mt-2 space-y-1.5">
                  {doneFu.map((fu) => (
                    <li
                      key={`done-${fu.date}-${fu.leadId}`}
                      className="flex items-start gap-2 rounded-lg border border-slate-100 p-2.5 opacity-60 dark:border-slate-800"
                    >
                      <span className="mt-0.5 text-[11px] text-slate-400">✓</span>
                      <div>
                        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 line-through">{fmtDate(fu.date)}</p>
                        {fu.note && <p className="text-[10px] text-slate-400">{fu.note}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        {/* ── Customer Summary ───────────────────────────────────── */}
        <Section title="Customer Summary">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total Messages</dt>
              <dd className="mt-0.5 font-semibold text-slate-700 dark:text-slate-300">
                {contact.messageCount ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Last Activity</dt>
              <dd className="mt-0.5 text-slate-700 dark:text-slate-300">{fmtRelative(contact.lastInboundAt)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Created</dt>
              <dd className="mt-0.5 text-slate-700 dark:text-slate-300">{fmtDate(contact.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Source</dt>
              <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                {SOURCE_LABELS[contact.source] ?? contact.source ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Chat Status</dt>
              <dd className="mt-0.5 capitalize text-slate-700 dark:text-slate-300">{contact.chatStatus ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lead Stage</dt>
              <dd className="mt-0.5 capitalize text-slate-700 dark:text-slate-300">{contact.stage}</dd>
            </div>
            {nextFollowup && (
              <div className="col-span-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Next Follow-up</dt>
                <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                  {fmtDate(nextFollowup.date)}
                  {nextFollowup.note && (
                    <span className="ml-2 text-[11px] text-slate-500">— {nextFollowup.note}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </Section>

      </div>
    </div>
  );
}

export const CrmTab = memo(CrmPanel);
