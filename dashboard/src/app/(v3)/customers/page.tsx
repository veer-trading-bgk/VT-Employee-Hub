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
  Filter,
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
import type { Contact, Stage } from '@/types/v3';
import { STAGE_LABELS } from '@/types/v3';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { toast } from 'sonner';
import Link from 'next/link';
import { format } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactsResponse {
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
}

const STAGE_OPTIONS = (Object.entries(STAGE_LABELS) as [Stage, string][]).map(([value, label]) => ({
  value,
  label,
}));

const PAGE_SIZE = 50;

// ── Column definitions ────────────────────────────────────────────────────────

function buildColumns(onOpenContact: (c: Contact) => void): TableColumn<Contact>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (row) => (
        <Link href={`/customers/${row.id}`} className="flex items-center gap-2.5 group">
          <Avatar name={row.name} size={32} />
          <div>
            <p className="font-medium text-neutral-900 group-hover:text-primary-600 dark:text-neutral-100">
              {row.name}
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
      width: 'w-32',
      cell: (row) => (
        <Badge variant="stage" stage={row.stage}>
          {STAGE_LABELS[row.stage]}
        </Badge>
      ),
    },
    {
      key: 'owner',
      header: 'Assigned to',
      sortable: true,
      width: 'w-40',
      cell: (row) => (
        <span className="text-sm text-neutral-700 dark:text-neutral-300">
          {row.ownerName ?? '—'}
        </span>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      width: 'w-48',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="default" className="text-[10px]">
              {tag}
            </Badge>
          ))}
          {row.tags.length > 2 && (
            <Badge variant="default" className="text-[10px]">
              +{row.tags.length - 2}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last updated',
      sortable: true,
      width: 'w-32',
      cell: (row) => (
        <span className="text-sm text-neutral-500">
          {format(new Date(row.updatedAt), 'd MMM yyyy')}
        </span>
      ),
    },
  ];
}

// ── Main component ────────────────────────────────────────────────────────────

function CustomersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(PAGE_SIZE);
  const [sortKey, setSortKey]       = useState('updatedAt');
  const [sortDir, setSortDir]       = useState<SortDirection>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<string>('');

  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const canCreate = ['owner', 'admin', 'manager', 'sales'].includes(v3Role);
  const canImport = ['owner', 'admin', 'manager'].includes(v3Role);

  const queryKey = ['contacts', { search, page, pageSize, sortKey, sortDir, stageFilter }];

  const { data, isLoading } = useQuery<ContactsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        search,
        page: String(page),
        pageSize: String(pageSize),
        sortKey,
        sortDir: sortDir ?? 'desc',
        ...(stageFilter && { stage: stageFilter }),
      });
      return apiFetch<ContactsResponse>(`/api/contacts?${params}`);
    },
    staleTime: 30_000,
    placeholderData: { contacts: [], total: 0, page: 1, pageSize: PAGE_SIZE },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return apiFetch('/api/contacts/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: () => {
      toast.success(`Deleted ${selectedIds.size} contacts`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => toast.error('Bulk delete failed'),
  });

  function handleSort(key: string, dir: SortDirection) {
    setSortKey(key);
    setSortDir(dir);
    setPage(1);
  }

  function handleBulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.size} contacts? This cannot be undone.`)) return;
    bulkDeleteMutation.mutate([...selectedIds]);
  }

  const columns = buildColumns((c) => router.push(`/customers/${c.id}`));

  const filterChips = stageFilter
    ? [{ key: 'stage', label: 'Stage', value: STAGE_LABELS[stageFilter as Stage] ?? stageFilter }]
    : [];

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Customers</h1>
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
                aria-label="Import contacts"
              >
                Import
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Download className="h-4 w-4" />}
                aria-label="Export contacts"
              >
                Export
              </Button>
            </>
          )}
          {canCreate && (
            <Button
              variant="primary"
              size="sm"
              iconLeft={<UserPlus className="h-4 w-4" />}
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
            onRowClick={(row) => router.push(`/customers/${row.id}`)}
            emptyState={
              <EmptyState
                icon={UserPlus}
                title={search ? 'No contacts match your search' : 'No contacts yet'}
                description={
                  search
                    ? 'Try a different search term'
                    : 'Import a CSV or add your first contact manually'
                }
                action={canCreate ? { label: 'Add contact', onClick: () => {} } : undefined}
                secondaryAction={canImport ? { label: 'Import CSV', onClick: () => {} } : undefined}
              />
            }
            bulkActions={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={<UserCheck className="h-4 w-4" />}
                  disabled={selectedIds.size === 0}
                >
                  Assign
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={<Tag className="h-4 w-4" />}
                  disabled={selectedIds.size === 0}
                >
                  Tag
                </Button>
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
  );
}

export default function CustomersPage() {
  return (
    <Suspense>
      <CustomersContent />
    </Suspense>
  );
}
