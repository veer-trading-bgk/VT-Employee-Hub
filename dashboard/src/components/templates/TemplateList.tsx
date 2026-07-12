'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  Trash2,
  Send,
  Edit2,
  ArrowUpDown,
  CheckSquare,
  Square,
  MoreHorizontal,
  AlertCircle,
  X,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { Drawer } from '@/components/v3/ui/Drawer';
import { Button } from '@/components/v3/ui/Button';
import { TemplateStatusBadge } from './TemplateStatusBadge';
import { TemplateCategoryBadge } from './TemplateCategoryBadge';
import { TemplateQualityBadge } from './TemplateQualityBadge';
import { TemplateCreateDrawer } from './TemplateCreateDrawer';
import {
  fetchTemplates,
  deleteTemplate,
  submitTemplate,
  syncTemplates,
  generateAiTemplateDraft,
  templateKeys,
} from '@/lib/templates/api';
import { useAuth } from '@/context/AuthContext';
import type { WaTemplate, TemplateStatus, TemplateCategory, QualityScore, AiTemplateDraft } from '@/lib/templates/types';
import {
  SENDABLE_STATUSES,
  EDITABLE_STATUSES,
  STATUS_FILTER_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  QUALITY_FILTER_OPTIONS,
  LANGUAGE_OPTIONS,
} from '@/lib/templates/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

type SortField = 'name' | 'category' | 'status' | 'qualityScore' | 'updatedAt';
type SortDir = 'asc' | 'desc';

interface Filters {
  search: string;
  status: TemplateStatus | '';
  category: TemplateCategory | '';
  quality: QualityScore | '';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onSendTemplate?: (template: WaTemplate) => void;
}

export function TemplateList({ onSendTemplate }: Props) {
  const qc = useQueryClient();

  // RBAC — raw backend role, not the v3Role display bucket (DL-021,
  // docs/v3/12_DECISION_LOG.md: display buckets must never be used for
  // permission gating, only raw roles). Matches the real checkRole() gates on
  // the template routes (src/routes/whatsapp.js): create/edit/delete/submit/
  // ai-draft are admin-only, sync/history/list are admin+manager.
  const { user } = useAuth();
  const rawRole = user?.role;
  const canManage = rawRole === 'superadmin' || rawRole === 'admin';
  const canSync = canManage || rawRole === 'manager';
  // Dead code today (Templates audit finding #5 — onSendTemplate is never
  // passed by either live caller, so the Send button this gates never
  // renders). Left role-equivalent to the old display-bucket check (which
  // treated team_lead as 'manager') rather than silently narrowing it.
  const canSendRole = canManage || rawRole === 'manager' || rawRole === 'team_lead';

  // Filters & sort
  const [filters, setFilters] = useState<Filters>({ search: '', status: '', category: '', quality: '' });
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showFilters, setShowFilters] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WaTemplate | undefined>();

  // AI draft
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiTemplateDraft | undefined>();

  // Data
  const { data: templates = [], isLoading, isError, refetch } = useQuery({
    queryKey: templateKeys.list(),
    queryFn: fetchTemplates,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      if (data.warning) {
        toast.warning(`Deleted locally — ${data.warning}`);
      } else {
        toast.success('Template deleted');
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Delete failed'),
  });

  // Submit mutation (push to Meta)
  const submitMutation = useMutation({
    mutationFn: (id: string) => submitTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      toast.success('Template submitted to Meta for review');
    },
    onError: (e: Error) => toast.error(e.message || 'Submit failed'),
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: () => syncTemplates(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: templateKeys.all });
      const parts: string[] = [`${data.synced} updated`];
      if (data.imported > 0) parts.push(`${data.imported} imported`);
      toast.success(`Synced from Meta: ${parts.join(', ')}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Sync failed'),
  });

  // Filter + sort
  const filtered = useMemo(() => {
    let result = [...templates];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.templateName.toLowerCase().includes(q),
      );
    }
    if (filters.status) result = result.filter((t) => t.status === filters.status);
    if (filters.category) result = result.filter((t) => t.category === filters.category);
    if (filters.quality) result = result.filter((t) => t.qualityScore === filters.quality);

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'category') cmp = a.category.localeCompare(b.category);
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortField === 'qualityScore') cmp = a.qualityScore.localeCompare(b.qualityScore);
      else cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [templates, filters, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((t) => t.id)));
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function handleEdit(t: WaTemplate) {
    setEditingTemplate(t);
    setDrawerOpen(true);
  }

  function handleCreate() {
    setEditingTemplate(undefined);
    setAiDraft(undefined);
    setDrawerOpen(true);
  }

  function handleAiDraftReady(draft: AiTemplateDraft) {
    setEditingTemplate(undefined);
    setAiDraft(draft);
    setDrawerOpen(true);
  }

  function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} template${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    for (const id of selected) deleteMutation.mutate(id);
  }

  const activeFilterCount = [filters.status, filters.category, filters.quality].filter(Boolean).length;

  return (
    <>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="text"
              placeholder="Search templates…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-500"
            />
          </div>

          {/* Filter toggle */}
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm',
              showFilters || activeFilterCount > 0
                ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400',
            )}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[10px] text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sync — manager+ */}
          {canSync && (
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
              title="Sync status from Meta"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', syncMutation.isPending && 'animate-spin')} aria-hidden />
              Sync
            </button>
          )}

          {/* AI Draft — admin+ only */}
          {canManage && (
            <button
              type="button"
              onClick={() => setAiPanelOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-sm font-medium text-primary-700 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-400 dark:hover:bg-primary-900/40"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI Draft
            </button>
          )}

          {/* New template — admin+ only */}
          {canManage && (
            <button
              type="button"
              onClick={handleCreate}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
            >
              + New Template
            </button>
          )}
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
            <FilterSelect
              label="Status"
              options={STATUS_FILTER_OPTIONS}
              value={filters.status}
              onChange={(v) => setFilters((f) => ({ ...f, status: v as TemplateStatus | '' }))}
            />
            <FilterSelect
              label="Category"
              options={CATEGORY_FILTER_OPTIONS}
              value={filters.category}
              onChange={(v) => setFilters((f) => ({ ...f, category: v as TemplateCategory | '' }))}
            />
            <FilterSelect
              label="Quality"
              options={QUALITY_FILTER_OPTIONS}
              value={filters.quality}
              onChange={(v) => setFilters((f) => ({ ...f, quality: v as QualityScore | '' }))}
            />
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters({ search: filters.search, status: '', category: '', quality: '' })}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <X className="h-3 w-3" aria-hidden /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Bulk actions bar — admin+ only */}
        {selected.size > 0 && canManage && (
          <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 dark:border-primary-800 dark:bg-primary-900/20">
            <span className="text-sm font-medium text-primary-700 dark:text-primary-400">
              {selected.size} selected
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-error-700 hover:bg-error-100 dark:text-error-400 dark:hover:bg-error-900/30"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50">
              <th className="w-10 px-3 py-2.5">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  aria-label={selected.size === filtered.length ? 'Deselect all' : 'Select all'}
                >
                  {selected.size > 0 && selected.size === filtered.length ? (
                    <CheckSquare className="h-4 w-4 text-primary-600" aria-hidden />
                  ) : (
                    <Square className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </th>
              <SortHeader label="Template" field="name" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Category" field="category" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Status" field="status" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Quality" field="qualityScore" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Updated" field="updatedAt" current={sortField} dir={sortDir} onSort={toggleSort} />
              <th className="w-16 px-3 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-neutral-400">
                  <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-neutral-300" aria-hidden />
                  Loading templates…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-6 w-6 text-error-500" aria-hidden />
                    <span className="text-sm text-neutral-500">Failed to load templates</span>
                    <button type="button" onClick={() => refetch()} className="text-xs text-primary-600 hover:underline">
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {templates.length === 0
                      ? 'No templates yet — create your first one'
                      : 'No templates match your filters'}
                  </p>
                  {templates.length === 0 && (
                    <button
                      type="button"
                      onClick={handleCreate}
                      className="mt-3 text-sm font-medium text-primary-600 hover:underline"
                    >
                      Create template →
                    </button>
                  )}
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                selected={selected.has(t.id)}
                canManage={canManage}
                canSendRole={canSendRole}
                onToggle={() => toggleOne(t.id)}
                onEdit={() => handleEdit(t)}
                onDelete={() => {
                  if (confirm(`Delete "${t.name}"? This cannot be undone.`)) deleteMutation.mutate(t.id);
                }}
                onSubmit={() => submitMutation.mutate(t.id)}
                onSend={onSendTemplate ? () => onSendTemplate(t) : undefined}
                submitting={submitMutation.isPending && submitMutation.variables === t.id}
                deleting={deleteMutation.isPending && deleteMutation.variables === t.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Count */}
      {!isLoading && filtered.length > 0 && (
        <p className="text-right text-xs text-neutral-400">
          {filtered.length} of {templates.length} template{templates.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Drawer */}
      <TemplateCreateDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditingTemplate(undefined); setAiDraft(undefined); }}
        editTemplate={editingTemplate}
        aiDraft={aiDraft}
      />

      {/* AI draft prompt panel */}
      <AiDraftPanel
        open={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        onDraftReady={handleAiDraftReady}
      />
    </>
  );
}

// ── AI draft prompt panel ────────────────────────────────────────────────────

function AiDraftPanel({
  open,
  onClose,
  onDraftReady,
}: {
  open: boolean;
  onClose: () => void;
  onDraftReady: (draft: AiTemplateDraft) => void;
}) {
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('en');

  const mutation = useMutation({
    mutationFn: () => generateAiTemplateDraft(description.trim(), language),
    onSuccess: (data) => {
      onDraftReady(data.draft);
      setDescription('');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to generate draft'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="AI Draft Template"
      description="Describe what you want — AI drafts the body, variables, and category for you to review"
      width={420}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            loading={mutation.isPending}
            disabled={!description.trim()}
            onClick={() => mutation.mutate()}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Generate Draft
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Describe what you want
          </label>
          <textarea
            rows={5}
            autoFocus
            placeholder="e.g. A renewal reminder for insurance policies expiring soon"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          AI drafts follow Meta&rsquo;s known template rules to maximize approval odds. Meta&rsquo;s review process is outside APForce&rsquo;s control and approval is never guaranteed.
        </p>
      </div>
    </Drawer>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  current,
  onSort,
}: {
  label: string;
  field: SortField;
  current: SortField;
  dir?: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = current === field;
  return (
    <th className="px-3 py-2.5 text-left">
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'flex items-center gap-1 text-xs font-semibold',
          active ? 'text-primary-700 dark:text-primary-400' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400',
        )}
      >
        {label}
        <ArrowUpDown className={cn('h-3 w-3', active ? 'text-primary-600' : 'text-neutral-300')} aria-hidden />
      </button>
    </th>
  );
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}:</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-xs text-neutral-700 focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

interface RowProps {
  template: WaTemplate;
  selected: boolean;
  canManage: boolean;
  canSendRole: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSubmit: () => void;
  onSend?: () => void;
  submitting: boolean;
  deleting: boolean;
}

function TemplateRow({
  template: t,
  selected,
  canManage,
  canSendRole,
  onToggle,
  onEdit,
  onDelete,
  onSubmit,
  onSend,
  submitting,
  deleting,
}: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const canEdit = canManage && EDITABLE_STATUSES.includes(t.status);
  const canSend = canSendRole && SENDABLE_STATUSES.includes(t.status);
  const canSubmit = canManage && (t.status === 'DRAFT' || t.status === 'REJECTED');

  return (
    <tr
      className={cn(
        'group border-b border-neutral-100 transition-colors last:border-0',
        'hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/50',
        selected && 'bg-primary-50/40 dark:bg-primary-900/10',
        deleting && 'opacity-50',
      )}
    >
      <td className="px-3 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          aria-label={selected ? `Deselect ${t.name}` : `Select ${t.name}`}
        >
          {selected ? (
            <CheckSquare className="h-4 w-4 text-primary-600" aria-hidden />
          ) : (
            <Square className="h-4 w-4 opacity-0 group-hover:opacity-100" aria-hidden />
          )}
        </button>
      </td>

      <td className="max-w-[240px] px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{t.name}</span>
          <span className="truncate text-xs text-neutral-400">{t.templateName}</span>
          {t.rejectedReason && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-error-600">
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{t.rejectedReason}</span>
            </span>
          )}
        </div>
      </td>

      <td className="px-3 py-3">
        <TemplateCategoryBadge category={t.category} size="xs" />
      </td>

      <td className="px-3 py-3">
        <TemplateStatusBadge status={t.status} showDot size="xs" />
      </td>

      <td className="px-3 py-3">
        <TemplateQualityBadge score={t.qualityScore} size="xs" />
      </td>

      <td className="px-3 py-3 text-xs text-neutral-400">
        {formatRelative(t.updatedAt)}
      </td>

      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          {canSend && onSend && (
            <button
              type="button"
              onClick={onSend}
              className="flex h-7 items-center gap-1 rounded-md bg-primary-600 px-2.5 text-[11px] font-medium text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
              title="Send this template"
            >
              <Send className="h-3 w-3" aria-hidden /> Send
            </button>
          )}

          {/* More menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  {canEdit && (
                    <MenuItem icon={Edit2} label="Edit" onClick={() => { setMenuOpen(false); onEdit(); }} />
                  )}
                  {canSubmit && !submitting && (
                    <MenuItem
                      icon={Send}
                      label="Submit to Meta"
                      onClick={() => { setMenuOpen(false); onSubmit(); }}
                    />
                  )}
                  {submitting && (
                    <MenuItem icon={RefreshCw} label="Submitting…" onClick={() => {}} disabled />
                  )}
                  <MenuItem icon={Clock} label="View History" onClick={() => { setMenuOpen(false); setHistoryOpen(true); }} />
                  {canManage && (
                    <>
                      <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
                      <MenuItem
                        icon={Trash2}
                        label="Delete"
                        onClick={() => { setMenuOpen(false); onDelete(); }}
                        danger
                      />
                    </>
                  )}
                </div>
              </>
            )}
            {historyOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                  <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
                    <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Status History</span>
                    <button type="button" onClick={() => setHistoryOpen(false)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-56 overflow-y-auto py-1">
                    {[...(t.statusHistory ?? [])].reverse().map((entry, i) => (
                      <div key={i} className="flex items-start gap-2.5 border-b border-neutral-50 px-3 py-2 last:border-0 dark:border-neutral-800/50">
                        <TemplateStatusBadge status={entry.status} size="xs" />
                        <div className="flex min-w-0 flex-col">
                          <span className="text-[10px] text-neutral-400">
                            {new Date(entry.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {entry.reason && (
                            <span className="truncate text-[10px] text-error-600 dark:text-error-400">{entry.reason}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {(t.statusHistory?.length ?? 0) === 0 && (
                      <p className="px-3 py-4 text-center text-xs text-neutral-400">No history available</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
        danger
          ? 'text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-900/20'
          : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
