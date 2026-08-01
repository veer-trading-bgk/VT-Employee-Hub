'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Route } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Table, type TableColumn } from '@/components/v3/ui/Table';
import { apiErrorMessage, ApiClientError } from '@/lib/api';
import {
  deleteJourneyDefinition,
  fetchJourneyDefinitions,
  journeyKeys,
} from '@/lib/journeys/api';
import type { JourneyDefinition } from '@/lib/journeys/types';
import { JourneyDefinitionDrawer } from './JourneyDefinitionDrawer';

/**
 * Settings → Journey Definitions (Phase 2 Task 3a).
 * List + basic CRUD against GET/POST/PUT/DELETE /api/journeys/definitions.
 * Screens/fields builder is Task 3b — definitions created here have screens: [].
 */
export function SettingsJourneyDefinitionsSection() {
  const qc = useQueryClient();
  const [drawerDef, setDrawerDef] = useState<JourneyDefinition | null | undefined>(undefined);

  const { data: definitions = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: journeyKeys.list(),
    queryFn: fetchJourneyDefinitions,
    staleTime: 30_000,
    retry: false,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteJourneyDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journeyKeys.list() });
      toast.success('Journey definition deactivated');
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e, 'Failed to deactivate definition')),
  });

  const flagDisabled =
    isError
    && error instanceof ApiClientError
    && error.status === 403
    && /Journey Platform is not enabled/i.test(String(error.body?.error ?? error.message));

  const columns: TableColumn<JourneyDefinition>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Name',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{row.name}</p>
          <p className="truncate font-mono text-[11px] text-neutral-400">{row.id}</p>
        </div>
      ),
    },
    {
      key: 'industryPack',
      header: 'Industry',
      cell: (row) => (
        <span className="text-neutral-700 dark:text-neutral-300">{row.industryPack || '—'}</span>
      ),
    },
    {
      key: 'linkedWorkflowId',
      header: 'Workflow',
      cell: (row) => (
        row.linkedWorkflowId
          ? <span className="font-mono text-xs text-neutral-600 dark:text-neutral-400">{row.linkedWorkflowId}</span>
          : <span className="text-neutral-300 dark:text-neutral-600">—</span>
      ),
    },
    {
      key: 'active',
      header: 'Status',
      cell: (row) => (
        row.active !== false
          ? <Badge variant="success">Active</Badge>
          : <Badge variant="default">Inactive</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 'w-28',
      cell: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {row.active !== false && (
            <Button
              size="sm"
              variant="secondary"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (window.confirm(
                  `Deactivate “${row.name}”? It will no longer be openable for new journeys. Existing journey instances that reference it keep that reference.`,
                )) {
                  deleteMut.mutate(row.id);
                }
              }}
            >
              Deactivate
            </Button>
          )}
        </div>
      ),
    },
  ], [deleteMut]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Journey Definitions
          </h2>
          <p className="text-sm text-neutral-500">
            Named journey forms linked to workflows. Screen fields and branding come in a later step —
            definitions created here are valid with an empty form.
          </p>
        </div>
        <Button
          size="sm"
          disabled={flagDisabled}
          onClick={() => setDrawerDef(null)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> New definition
        </Button>
      </div>

      {flagDisabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Journey Platform is not enabled for this company
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/70">
            Ask a platform admin to set the <code className="font-mono">journeys_platform</code> feature flag.
          </p>
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-neutral-200 py-8 text-center dark:border-neutral-800">
          <p className="text-sm text-error-600 dark:text-error-400">
            {apiErrorMessage(error, 'Failed to load journey definitions')}
          </p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <Table
          columns={columns}
          data={definitions}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => setDrawerDef(row)}
          emptyState={(
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <Route className="h-8 w-8 text-neutral-300" aria-hidden />
              <p className="text-sm text-neutral-500">
                No journey definitions yet — create your first one.
              </p>
            </div>
          )}
        />
      )}

      <JourneyDefinitionDrawer
        open={drawerDef !== undefined}
        onClose={() => setDrawerDef(undefined)}
        definition={drawerDef ?? null}
      />
    </div>
  );
}
