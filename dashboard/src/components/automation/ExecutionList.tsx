'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Clock, Activity, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/v3/ui/Badge';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonTable } from '@/components/v3/ui/Skeleton';
import { SearchBar } from '@/components/v3/ui/SearchBar';
import { FilterBar, type FilterChip } from '@/components/v3/ui/FilterBar';
import { Table, type TableColumn, type SortDirection } from '@/components/v3/ui/Table';
import { Pagination } from '@/components/v3/ui/Pagination';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { format } from 'date-fns';
import {
  type ExecutionsResponse, type Execution, type ExecutionStep, type ExecutionPathEntry, type ActionType,
  EXECUTION_STATUS_META, ACTION_META, isGraphExecution,
} from '@/types/automations';

const STATUS_OPTIONS = [
  { value: 'completed',        label: 'Completed'       },
  { value: 'partial_failure',  label: 'Partial Failure' },
  { value: 'failed',           label: 'Failed'          },
  { value: 'running',          label: 'Running'         },
  { value: 'paused',           label: 'Paused'          },
];

interface ExecutionListProps {
  workflowFilter?: string;
}

export function ExecutionList({ workflowFilter }: ExecutionListProps) {
  const [search,     setSearch]     = useState('');
  const [status,     setStatus]     = useState('');
  const [page,       setPage]       = useState(1);
  const [pageSize,   setPageSize]   = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Only one sortable column exists today (Started), so a single SortDirection
  // is enough — 'desc' (newest first) matches the prior implicit order.
  const [sortDir,    setSortDir]    = useState<SortDirection>('desc');

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (workflowFilter) params.set('workflowId', workflowFilter);
  if (status)         params.set('status', status);
  if (search)         params.set('q', search);
  if (sortDir)         params.set('sortDir', sortDir);

  const { data, isLoading } = useQuery<ExecutionsResponse>({
    queryKey: ['executions', workflowFilter, status, search, page, pageSize, sortDir],
    queryFn:  () => apiFetch(`/api/automations/executions?${params.toString()}`),
    refetchInterval: 15_000,
  });

  function handleSort(_key: string, dir: SortDirection) {
    setSortDir(dir);
    setPage(1);
  }

  const executions = data?.executions ?? [];
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label;
  const chips: FilterChip[] = status ? [{ key: 'status', label: 'Status', value: statusLabel ?? status }] : [];

  const columns: TableColumn<Execution>[] = [
    {
      key: 'expand', header: '', width: 'w-8',
      cell: (e) => (
        expandedId === e.executionId
          ? <ChevronDown className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
          : <ChevronRight className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
      ),
    },
    {
      key: 'workflow', header: 'Workflow',
      cell: (e) => <p className="max-w-[160px] truncate font-medium text-neutral-900 dark:text-white">{e.workflowName}</p>,
    },
    {
      key: 'contact', header: 'Contact',
      cell: (e) => e.contactName ?? <span className="text-neutral-300 dark:text-neutral-600">—</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (e) => {
        const meta = EXECUTION_STATUS_META[e.status] ?? EXECUTION_STATUS_META.failed;
        const StatusIcon =
          e.status === 'completed' ? CheckCircle2 :
          e.status === 'failed'    ? XCircle      :
          e.status === 'running'   ? Activity     : Clock;
        return (
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                e.status === 'completed' ? 'text-success-500'  :
                e.status === 'failed'    ? 'text-error-500'    :
                e.status === 'running'   ? 'text-primary-500 animate-pulse' : 'text-warning-500',
              )}
              aria-hidden
            />
            <Badge variant={meta.variant} className="text-[10px]">{meta.label}</Badge>
          </div>
        );
      },
    },
    {
      key: 'trigger', header: 'Trigger',
      cell: (e) => (
        e.triggeredBy?.type
          ? <Badge variant="default" className="text-[10px]">{e.triggeredBy.type}</Badge>
          : <span className="text-xs text-neutral-400">—</span>
      ),
    },
    {
      key: 'started', header: 'Started', sortable: true,
      cell: (e) => <span className="text-xs text-neutral-400">{format(new Date(e.startedAt), 'd MMM, h:mm a')}</span>,
    },
    {
      key: 'duration', header: 'Duration',
      cell: (e) => <span className="text-xs text-neutral-400">{e.durationMs != null ? `${e.durationMs}ms` : '—'}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder="Search executions…"
          className="max-w-xs"
        />
        <FilterBar
          chips={chips}
          onRemoveChip={() => { setStatus(''); setPage(1); }}
        >
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FilterBar>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <SkeletonTable rows={5} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          <Table<Execution>
            columns={columns}
            data={executions}
            keyExtractor={(e) => e.executionId}
            onRowClick={(e) => setExpandedId(expandedId === e.executionId ? null : e.executionId)}
            expandedRowId={expandedId}
            renderExpandedRow={(e) => (isGraphExecution(e) ? <PathTrace path={e.path ?? []} /> : <StepTrace steps={e.steps ?? []} />)}
            sortKey="started"
            sortDir={sortDir}
            onSort={handleSort}
            emptyState={
              <EmptyState
                icon={Activity}
                title={search || status ? 'No executions match your filters' : 'No executions yet'}
                description={!search && !status ? 'Executions appear here when active workflows run.' : undefined}
              />
            }
          />
          <Pagination
            page={data?.page ?? page}
            pageSize={data?.pageSize ?? pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      )}
    </div>
  );
}

function StepTrace({ steps }: { steps: ExecutionStep[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => {
        const label = ACTION_META[s.type]?.label ?? s.type;
        const icon  =
          s.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-success-500 shrink-0" /> :
          s.status === 'failed'    ? <XCircle      className="h-3.5 w-3.5 text-error-500 shrink-0" />   :
          s.status === 'waiting'   ? <Clock        className="h-3.5 w-3.5 text-warning-500 shrink-0" />  :
          s.status === 'running'   ? <Activity     className="h-3.5 w-3.5 text-primary-500 animate-pulse shrink-0" /> :
                                     <div className="h-3.5 w-3.5 rounded-full border-2 border-neutral-300 shrink-0" />;
        return (
          <li key={`${s.stepId}-${i}`} className="flex items-start gap-2 text-xs">
            {icon}
            <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
            {s.error && <span className="text-error-500 ml-1">— {s.error}</span>}
            {s.resumeAt && <span className="text-warning-500 ml-1">— resumes {format(new Date(s.resumeAt), 'd MMM, h:mm a')}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// Sibling to StepTrace, reading a graph execution's append-only path[] instead of
// linear's fixed-size steps[] — see Execution.path (automations.ts) and
// AutomationEngine.js's _finalizeExecution() on the backend. Reads as a decision
// log: each condition node's resolved branchKey is shown inline.
function PathTrace({ path }: { path: ExecutionPathEntry[] }) {
  return (
    <ol className="space-y-1.5">
      {path.map((p, i) => {
        const label =
          p.type === 'condition' ? 'Condition' : (ACTION_META[p.type as ActionType]?.label ?? p.type);
        const icon =
          p.status === 'completed'     ? <CheckCircle2 className="h-3.5 w-3.5 text-success-500 shrink-0" /> :
          p.status === 'failed'        ? <XCircle      className="h-3.5 w-3.5 text-error-500 shrink-0" />   :
          p.status === 'evaluated'     ? <GitBranch    className="h-3.5 w-3.5 text-primary-500 shrink-0" /> :
          p.status === 'waiting'       ? <Clock        className="h-3.5 w-3.5 text-warning-500 shrink-0" /> :
          p.status === 'waiting_reply' ? <Clock        className="h-3.5 w-3.5 text-warning-500 shrink-0" /> :
          p.status === 'timed_out'     ? <Clock        className="h-3.5 w-3.5 text-warning-600 shrink-0" /> :
                                          <div className="h-3.5 w-3.5 rounded-full border-2 border-neutral-300 shrink-0" />;
        return (
          <li key={`${p.nodeId}-${i}`} className="flex items-start gap-2 text-xs">
            {icon}
            <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
            {p.branchKey && <span className="text-primary-500 ml-1">→ {p.branchKey}</span>}
            {p.status === 'timed_out' && <span className="text-warning-600 ml-1">(timed out, no reply)</span>}
            {p.error && <span className="text-error-500 ml-1">— {p.error}</span>}
            {p.resumeAt && (p.status === 'waiting' || p.status === 'waiting_reply') && (
              <span className="text-warning-500 ml-1">— resumes {format(new Date(p.resumeAt), 'd MMM, h:mm a')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
