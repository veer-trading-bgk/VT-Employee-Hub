'use client';

import { Fragment, useState } from 'react';
import { Search, CheckCircle2, XCircle, Clock, Activity, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/v3/ui/Badge';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonTable } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { format } from 'date-fns';
import {
  type ExecutionsResponse, type Execution, type ExecutionStep, type ExecutionPathEntry, type ActionType,
  EXECUTION_STATUS_META, ACTION_META, isGraphExecution,
} from '@/types/automations';

interface ExecutionListProps {
  workflowFilter?: string;
}

export function ExecutionList({ workflowFilter }: ExecutionListProps) {
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status,   setStatus]   = useState('');

  const url = `/api/automations/executions?limit=100${workflowFilter ? `&workflowId=${workflowFilter}` : ''}${status ? `&status=${status}` : ''}`;

  const { data, isLoading } = useQuery<ExecutionsResponse>({
    queryKey: ['executions', workflowFilter, status],
    queryFn:  () => apiFetch(url),
    refetchInterval: 15_000,
  });

  const executions = (data?.executions ?? []).filter((e) =>
    !search || e.workflowName.toLowerCase().includes(search.toLowerCase()) || (e.contactName ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
          <input
            type="search"
            placeholder="Search executions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="partial_failure">Partial Failure</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <SkeletonTable rows={5} />
        </div>
      ) : executions.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={search || status ? 'No executions match your filters' : 'No executions yet'}
          description={!search && !status ? 'Executions appear here when active workflows run.' : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/70">
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Workflow</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">Trigger</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-neutral-500">Started</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-neutral-500">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {executions.map((e) => (
                <Fragment key={e.executionId}>
                  <ExecutionRow
                    execution={e}
                    expanded={expanded === e.executionId}
                    onToggle={() => setExpanded(expanded === e.executionId ? null : e.executionId)}
                  />
                  {expanded === e.executionId && (
                    <tr className="bg-neutral-50/50 dark:bg-neutral-900/30">
                      <td colSpan={7} className="px-6 py-3">
                        {isGraphExecution(e) ? <PathTrace path={e.path ?? []} /> : <StepTrace steps={e.steps ?? []} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExecutionRow({
  execution: e, expanded, onToggle,
}: { execution: Execution; expanded: boolean; onToggle: () => void }) {
  const meta = EXECUTION_STATUS_META[e.status] ?? EXECUTION_STATUS_META.failed;
  const StatusIcon =
    e.status === 'completed' ? CheckCircle2 :
    e.status === 'failed'    ? XCircle      :
    e.status === 'running'   ? Activity     : Clock;

  return (
    <tr
      className="cursor-pointer bg-white hover:bg-neutral-50/70 dark:bg-neutral-950 dark:hover:bg-neutral-900/70"
      onClick={onToggle}
    >
      <td className="px-4 py-3">
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
          : <ChevronRight className="h-3.5 w-3.5 text-neutral-400" aria-hidden />}
      </td>
      <td className="px-4 py-3">
        <p className="max-w-[160px] truncate font-medium text-neutral-900 dark:text-white">{e.workflowName}</p>
      </td>
      <td className="px-4 py-3 text-sm text-neutral-500">
        {e.contactName ?? <span className="text-neutral-300 dark:text-neutral-600">—</span>}
      </td>
      <td className="px-4 py-3">
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
      </td>
      <td className="px-4 py-3 text-xs text-neutral-400">{e.triggeredBy?.type ?? '—'}</td>
      <td className="px-4 py-3 text-right text-xs text-neutral-400">
        {format(new Date(e.startedAt), 'd MMM, h:mm a')}
      </td>
      <td className="px-4 py-3 text-right text-xs text-neutral-400">
        {e.durationMs != null ? `${e.durationMs}ms` : '—'}
      </td>
    </tr>
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
