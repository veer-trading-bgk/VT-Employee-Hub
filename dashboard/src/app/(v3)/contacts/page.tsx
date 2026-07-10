'use client';

import { useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  UserPlus,
  Download,
  Upload,
  Trash2,
  UserCheck,
  Tag,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { Avatar } from '@/components/v3/ui/Avatar';
import { SearchBar } from '@/components/v3/ui/SearchBar';
import { FilterBar } from '@/components/v3/ui/FilterBar';
import { Table, type TableColumn, type SortDirection } from '@/components/v3/ui/Table';
import { Pagination } from '@/components/v3/ui/Pagination';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonTable } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import type { Contact } from '@/types/v3';
import { useAuth } from '@/context/AuthContext';
import { canAssignOwner } from '@/lib/permissions';
import { toast } from 'sonner';
import Link from 'next/link';
import { format } from 'date-fns';
import { OwnerSelect } from '@/components/v3/ui/OwnerSelect';
import { NewContactDrawer } from '@/components/contacts/NewContactDrawer';
import { ImportContactsDrawer } from '@/components/contacts/ImportContactsDrawer';
import { type Tag as CatalogTag } from '@/components/tags/TagBadge';
import { TagSelector } from '@/components/tags/TagSelector';
import { ContactTags } from '@/components/tags/ContactTags';
import { EditableName } from '@/components/shared/EditableName';
import { useContactMutations } from '@/hooks/useContactMutations';
import { useEmployeesList } from '@/hooks/useEmployeesList';
import { useTagCatalog } from '@/hooks/useTagCatalog';
import { usePipelineStages, type PipelineStage } from '@/hooks/usePipelineStages';
import { decideBulkOutcome, type BulkUpdateResponse } from '@/lib/bulkUpdateFeedback';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactsResponse {
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

interface ContactsExportResponse {
  contacts: Contact[];
  total: number;
}

const PAGE_SIZE = 50;

// ── CSV export ─────────────────────────────────────────────────────────────────

function escapeCell(v: string | null | undefined): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const CSV_HEADERS = ['Name', 'Phone', 'Email', 'Stage', 'Assigned To', 'Tags', 'Source', 'Created At'];

function contactToRow(c: Contact, tagLabel: (id: string) => string, stageLabel: (key: string) => string): string[] {
  return [
    c.displayName ?? c.name ?? '',
    c.phone ?? '',
    c.email ?? '',
    c.stage ? stageLabel(c.stage) : '',
    c.assignedToName ?? '',
    (c.tags ?? []).map(tagLabel).join('; '),
    (c as any).source ?? '',
    c.createdAt ? format(new Date(c.createdAt), 'd MMM yyyy') : '',
  ];
}

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function buildCSV(contacts: Contact[], tagLabel: (id: string) => string, stageLabel: (key: string) => string): string {
  return [CSV_HEADERS, ...contacts.map((c) => contactToRow(c, tagLabel, stageLabel))]
    .map((r) => r.map(escapeCell).join(','))
    .join('\n');
}

// Selected-only export — instant, no API call needed
function exportSelected(contacts: Contact[], tagLabel: (id: string) => string, stageLabel: (key: string) => string) {
  if (contacts.length === 0) { toast.info('Select at least one contact to export'); return; }
  triggerDownload(buildCSV(contacts, tagLabel, stageLabel), `contacts_selected_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  toast.success(`Exported ${contacts.length} selected contact${contacts.length !== 1 ? 's' : ''}`);
}

// Full export — one call to the dedicated export endpoint (GET /api/contacts/
// export), which reuses the exact same fetch+merge+filter as the paginated
// list route but returns every matching row unsliced. Previously paginated
// through GET /api/contacts itself (PAGE=100), which re-ran that entire
// company-wide fetch+sort+filter from scratch on every single page just to
// return a 100-row slice — O(pages x company-size) instead of one fetch
// (found + fixed 2026-07-09, docs/phase3/TECHNICAL_DEBT.md).
async function exportAllCSV(
  search: string,
  stageFilter: string,
  tagLabel: (id: string) => string,
  stageLabel: (key: string) => string,
): Promise<void> {
  const params = new URLSearchParams({
    ...(search      && { q: search }),
    ...(stageFilter && { stage: stageFilter }),
  });
  const res = await apiFetch<ContactsExportResponse>(`/api/contacts/export?${params}`);
  const rows = res.contacts;

  if (rows.length === 0) { toast.info('No contacts to export'); return; }
  triggerDownload(buildCSV(rows, tagLabel, stageLabel), `contacts_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  toast.success(`Exported ${rows.length} contact${rows.length !== 1 ? 's' : ''}`);
}

// ── Column definitions ────────────────────────────────────────────────────────

function contactDisplayName(row: Contact): string {
  return row.displayName ?? row.name ?? row.phone ?? '';
}

// Own instance of useContactMutations per row — leadId-scoped, same as
// ContactTags below. Not inlined into the cell() callback: hooks must be
// called from a real component instance, not a plain per-row function.
function ContactNameCell({ leadId, value, onSaved }: { leadId: string; value: string; onSaved: () => void }) {
  const { updateField } = useContactMutations(leadId);
  return (
    <EditableName
      value={value}
      onSave={(name) => updateField.mutate({ name }, { onSuccess: onSaved })}
      className="text-left font-medium text-neutral-900 hover:text-primary-600 dark:text-neutral-100"
      ariaLabel="Edit contact name"
    />
  );
}

function buildColumns(canEditOwner: boolean, onRowChanged: () => void, pipelineStages: PipelineStage[]): TableColumn<Contact>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (row) => {
        const leadId = row.leadId ?? (row.type === 'lead' ? row.id : undefined);
        return (
          <div className="flex items-center gap-2.5">
            <Link href={`/contacts/${row.id}`} className="shrink-0">
              <Avatar name={contactDisplayName(row)} size={32} />
            </Link>
            <div className="min-w-0">
              {leadId ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <ContactNameCell leadId={leadId} value={contactDisplayName(row)} onSaved={onRowChanged} />
                </div>
              ) : (
                <Link href={`/contacts/${row.id}`}>
                  <p className="font-medium text-neutral-900 hover:text-primary-600 dark:text-neutral-100">
                    {contactDisplayName(row)}
                  </p>
                </Link>
              )}
              <p className="text-xs text-neutral-500">{row.phone}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'stage',
      header: 'Stage',
      sortable: true,
      width: 'w-32',
      cell: (row) => {
        const stageObj = pipelineStages.find((s) => s.key === row.stage);
        return (
          <Badge variant="stage" stage={row.stage} color={stageObj?.color}>
            {stageObj?.label ?? row.stage}
          </Badge>
        );
      },
    },
    {
      key: 'owner',
      header: 'Assigned to',
      sortable: false,
      width: 'w-48',
      cell: (row) => (
        <OwnerSelect
          contactId={row.id}
          isLead={row.type === 'lead' || !!row.leadId}
          currentOwnerName={row.assignedToName ?? row.ownerName}
          currentOwnerId={row.assignedTo ?? row.ownerId}
          canEdit={canEditOwner}
          compact
        />
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      width: 'w-56',
      // stopPropagation — this cell is interactive (add/remove tags inline);
      // without it, clicks bubble to the row's onClick and navigate to Customer 360.
      cell: (row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ContactTags
            tagIds={row.tags ?? []}
            leadId={row.leadId ?? (row.type === 'lead' ? row.id : undefined)}
            phone={row.phone}
            onMutated={onRowChanged}
          />
        </div>
      ),
    },
    {
      key: 'lastActivity',
      header: 'Last activity',
      sortable: false,
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

// ── Main component ────────────────────────────────────────────────────────────

function ContactsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch]           = useState('');
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(PAGE_SIZE);
  const [sortKey, setSortKey]         = useState('updatedAt');
  const [sortDir, setSortDir]         = useState<SortDirection>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<string>('');

  const [newContactOpen,  setNewContactOpen]  = useState(false);
  const [importOpen,      setImportOpen]      = useState(false);
  const [exporting,       setExporting]       = useState(false);
  const [bulkTagOpen,     setBulkTagOpen]     = useState(false);
  const [bulkAssignOpen,  setBulkAssignOpen]  = useState(false);

  const { tags: tagCatalog } = useTagCatalog();
  const { employees: assignableEmployees } = useEmployeesList({ enabled: bulkAssignOpen, assignableOnly: true });
  const tagLabel = useCallback(
    (id: string) => tagCatalog.find((t) => t.id === id)?.label ?? id,
    [tagCatalog],
  );
  const { stages: pipelineStages } = usePipelineStages();
  const stageLabel = useCallback(
    (key: string) => pipelineStages.find((s) => s.key === key)?.label ?? key,
    [pipelineStages],
  );
  const STAGE_OPTIONS = pipelineStages.map((s) => ({ value: s.key, label: s.label }));

  // Raw role, not v3Role — matches POST /api/crm/leads's checkRole(['admin','manager'])
  // exactly (same gate canAssignOwner already encodes for the equivalent Inbox/CrmTab
  // assign controls). v3Role would wrongly include 'sales' (agent/telecaller, backend
  // rejects them) and wrongly include team_lead in its shared 'manager' bucket
  // (backend rejects team_lead too — only raw manager is allowed).
  const canCreate    = canAssignOwner(user?.role);
  // Raw role, not v3Role — matches POST /api/crm/import's checkRole(['admin','manager'])
  // exactly (same scope canAssignOwner already encodes). v3Role would wrongly include
  // team_lead in its shared 'manager' bucket — backend rejects team_lead here too.
  const canImport    = canAssignOwner(user?.role);
  // Raw role, not v3Role — matches PUT /api/crm/leads/:id/assign's
  // checkRole(['admin','manager']) exactly. Was ['owner','admin'].includes(v3Role),
  // which wrongly EXCLUDED raw manager (backend allows manager) — the opposite-
  // direction bug from canCreate/canImport, found during the Part 2 v3Role sweep.
  // Now consistent with Inbox's OwnerSelect call site, which already used this.
  const canEditOwner = canAssignOwner(user?.role);

  const queryKey = ['contacts', { search, page, pageSize, sortKey, sortDir, stageFilter }];

  const { data, isLoading } = useQuery<ContactsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        ...(search && { q: search }),
        page: String(page),
        pageSize: String(pageSize),
        ...(stageFilter && { stage: stageFilter }),
      });
      return apiFetch<ContactsResponse>(`/api/contacts?${params}`);
    },
    staleTime: 30_000,
    placeholderData: { contacts: [], total: 0, page: 1, pageSize: PAGE_SIZE },
  });

  // ── True bulk endpoint (2026-07-10, docs/phase3/TECHNICAL_DEBT.md) ──────────
  // Replaces the old N-concurrent-individual-calls pattern for assign/tag —
  // that fanned out up to 50 simultaneous requests against a 10-slot AWS
  // Lambda concurrency ceiling (account-wide, confirmed via
  // `aws lambda get-account-settings`), which is what actually caused the
  // reported partial failures, not a race condition (see
  // ContactBulkOpsService.js). One request now, processed sequentially
  // server-side; the response is a real per-id result, read and reported
  // honestly here instead of assumed successful.
  //
  // The decision logic itself (what toast, what happens to the selection)
  // lives in decideBulkOutcome() (lib/bulkUpdateFeedback.ts) — pulled out of
  // this component so it's testable as a plain function. On partial failure
  // it leaves only the FAILED ids selected instead of clearing the whole
  // selection, so the failed contacts are identifiable (still checked/
  // highlighted in the table) and hitting the same bulk action again
  // immediately retries just what didn't land.
  function reportBulkOutcome(action: string, res: BulkUpdateResponse) {
    const decision = decideBulkOutcome(action, res);
    if (decision.toastType === 'success') toast.success(decision.message);
    else if (decision.toastType === 'error') toast.error(decision.message);
    if (decision.retrySelectedIds !== null) setSelectedIds(new Set(decision.retrySelectedIds));
  }

  // Bulk tag — apply one catalog tag to every selected contact
  const bulkTagMutation = useMutation({
    mutationFn: async (tagId: string): Promise<BulkUpdateResponse> => {
      const targets = (data?.contacts ?? []).filter((c) => selectedIds.has(c.id));
      if (targets.length === 0) return { success: true, results: [], succeeded: 0, failed: 0 };
      const contacts = targets.map((c) => {
        const isLead = c.type === 'lead' || (c.leadId ?? null) !== null;
        return { id: c.id, ...(isLead ? { leadId: c.leadId ?? c.id } : { phone: c.phone }) };
      });
      return apiFetch<BulkUpdateResponse>('/api/contacts/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ contacts, operation: 'tag', params: { tagId } }),
      });
    },
    onSuccess: (res) => {
      reportBulkOutcome('Tagged', res);
      if (res.succeeded > 0) qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => toast.error('Tagging failed unexpectedly — please try again'),
  });

  // Bulk assign — only applies to CRM leads (unknown/INBOX# contacts have no
  // assignedTo concept); non-lead selections are skipped and called out.
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ employeeId, employeeName }: { employeeId: string; employeeName: string }) => {
      const targets = (data?.contacts ?? []).filter((c) => selectedIds.has(c.id) && c.type === 'lead');
      const skippedNonLeads = selectedIds.size - targets.length;
      if (targets.length === 0) {
        return { success: true, results: [], succeeded: 0, failed: 0, skippedNonLeads } as BulkUpdateResponse & { skippedNonLeads: number };
      }
      const contacts = targets.map((c) => ({ id: c.id, leadId: c.leadId ?? c.id }));
      const res = await apiFetch<BulkUpdateResponse>('/api/contacts/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ contacts, operation: 'assign', params: { assignedTo: employeeId, assignedToName: employeeName } }),
      });
      return { ...res, skippedNonLeads };
    },
    onSuccess: (res) => {
      reportBulkOutcome('Assigned', res);
      if (res.skippedNonLeads > 0) {
        toast.info(`${res.skippedNonLeads} selected contact${res.skippedNonLeads !== 1 ? 's are' : ' is'} not a CRM lead yet — skipped (assign only applies to leads)`);
      }
      if (res.succeeded > 0) qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => toast.error('Assignment failed unexpectedly — please try again'),
  });

  // Bulk delete — Track A5 fast-follow (2026-07-10): the last of the four
  // bulk operations still on the old N-concurrent-calls pattern, which is
  // exactly what produced the reported partial failures under load ("50
  // deleted, 5 failed: Too many requests" — same class already fixed for
  // assign/tag above). Now the same true bulk endpoint; the shared
  // decideBulkOutcome()/reportBulkOutcome() honest-feedback pattern is
  // reused unmodified. This is the most destructive of the four operations
  // (a hard, unrecoverable purge — see ContactBulkOpsService.deleteLead/
  // deleteUnknownContact) — handleBulkDelete's window.confirm below is the
  // only checkpoint before it fires, same as before this fix.
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]): Promise<BulkUpdateResponse> => {
      const targets = (data?.contacts ?? []).filter((c) => ids.includes(c.id));
      if (targets.length === 0) return { success: true, results: [], succeeded: 0, failed: 0 };
      const contacts = targets.map((c) => {
        const isLead = c.type === 'lead' || (c.leadId ?? null) !== null;
        return { id: c.id, ...(isLead ? { leadId: c.leadId ?? c.id } : { phone: c.phone }) };
      });
      return apiFetch<BulkUpdateResponse>('/api/contacts/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ contacts, operation: 'delete' }),
      });
    },
    onSuccess: (res) => {
      reportBulkOutcome('Deleted', res);
      if (res.succeeded > 0) qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => toast.error('Delete failed unexpectedly — please try again'),
  });

  function handleSort(key: string, dir: SortDirection) {
    setSortKey(key);
    setSortDir(dir);
    setPage(1);
  }

  function handleBulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.size} contact${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    bulkDeleteMutation.mutate([...selectedIds]);
  }

  async function handleExport() {
    if (selectedIds.size > 0) {
      // Export only the checked rows — already in memory, instant
      const selected = (data?.contacts ?? []).filter((c) => selectedIds.has(c.id));
      exportSelected(selected, tagLabel, stageLabel);
      return;
    }
    // No selection — export everything matching the current filters
    setExporting(true);
    try {
      await exportAllCSV(search, stageFilter, tagLabel, stageLabel);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  const columns = buildColumns(canEditOwner, () => qc.invalidateQueries({ queryKey: ['contacts'] }), pipelineStages);

  const filterChips = stageFilter
    ? [{ key: 'stage', label: 'Stage', value: stageLabel(stageFilter) }]
    : [];

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Contacts</h1>
            {data && (
              <p className="text-sm text-neutral-500">
                {data.total.toLocaleString()} contacts
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canImport && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Upload className="h-4 w-4" />}
                  onClick={() => setImportOpen(true)}
                  aria-label="Import contacts"
                >
                  Import
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Download className="h-4 w-4" />}
                  onClick={handleExport}
                  loading={exporting}
                  aria-label="Export contacts"
                >
                  {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export'}
                </Button>
              </>
            )}
            {canCreate && (
              <Button
                variant="primary"
                size="sm"
                iconLeft={<UserPlus className="h-4 w-4" />}
                onClick={() => setNewContactOpen(true)}
              >
                New Contact
              </Button>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder="Search by name, phone, email…"
            className="w-80"
          />

          {/* Stage filter */}
          <select
            value={stageFilter}
            onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            aria-label="Filter by stage"
          >
            <option value="">All stages</option>
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <FilterBar
            chips={filterChips}
            onRemoveChip={(key) => {
              if (key === 'stage') setStageFilter('');
            }}
            onClearAll={() => setStageFilter('')}
            className="flex-1"
          />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <SkeletonTable rows={10} />
          ) : (
            <Table
              columns={columns}
              data={data?.contacts ?? []}
              keyExtractor={(row) => row.id}
              selectable
              selectedIds={selectedIds}
              onSelectChange={setSelectedIds}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              onRowClick={(row) => router.push(`/contacts/${row.id}`)}
              emptyState={
                <EmptyState
                  icon={UserPlus}
                  title={search ? 'No contacts match your search' : 'No contacts yet'}
                  description={
                    search
                      ? 'Try a different search term'
                      : 'Import a CSV or add your first contact manually'
                  }
                  action={canCreate ? { label: 'Add contact', onClick: () => setNewContactOpen(true) } : undefined}
                  secondaryAction={canImport ? { label: 'Import CSV', onClick: () => setImportOpen(true) } : undefined}
                />
              }
              bulkActions={
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={<UserCheck className="h-4 w-4" />}
                      disabled={selectedIds.size === 0}
                      loading={bulkAssignMutation.isPending}
                      onClick={() => setBulkAssignOpen((v) => !v)}
                    >
                      Assign
                    </Button>
                    {bulkAssignOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                        {assignableEmployees.length === 0 ? (
                          <p className="px-2 py-1.5 text-xs text-neutral-400">Loading employees…</p>
                        ) : (
                          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                            {assignableEmployees.map((emp) => (
                              <li key={emp.id}>
                                <button
                                  type="button"
                                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                                  onClick={() => {
                                    bulkAssignMutation.mutate({ employeeId: emp.id, employeeName: emp.name });
                                    setBulkAssignOpen(false);
                                  }}
                                >
                                  {emp.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Button
                      size="sm"
                      variant="secondary"
                      iconLeft={<Tag className="h-4 w-4" />}
                      disabled={selectedIds.size === 0}
                      loading={bulkTagMutation.isPending}
                      onClick={() => setBulkTagOpen((v) => !v)}
                    >
                      Tag
                    </Button>
                    {bulkTagOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1">
                        <TagSelector
                          catalogTags={tagCatalog}
                          selectedIds={[]}
                          loading={bulkTagMutation.isPending}
                          onToggle={(tagId) => {
                            bulkTagMutation.mutate(tagId);
                            setBulkTagOpen(false);
                          }}
                          onCreate={async (label, color) => {
                            const res = await apiFetch<{ success: boolean; tag: CatalogTag }>('/api/tags', {
                              method: 'POST',
                              body: JSON.stringify({ label, color }),
                            });
                            await qc.invalidateQueries({ queryKey: ['tag-catalog'] });
                            if (res.tag?.id) {
                              bulkTagMutation.mutate(res.tag.id);
                              setBulkTagOpen(false);
                            }
                          }}
                          onClose={() => setBulkTagOpen(false)}
                        />
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    iconLeft={<Trash2 className="h-4 w-4" />}
                    disabled={selectedIds.size === 0}
                    loading={bulkDeleteMutation.isPending}
                    onClick={handleBulkDelete}
                  >
                    Delete
                  </Button>
                </div>
              }
            />
          )}
        </div>

        {/* Pagination */}
        {data && data.total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        )}
      </div>

      {/* Drawers */}
      <NewContactDrawer
        open={newContactOpen}
        onClose={() => setNewContactOpen(false)}
      />
      <ImportContactsDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </>
  );
}

export default function ContactsPage() {
  return (
    <Suspense>
      <ContactsContent />
    </Suspense>
  );
}
