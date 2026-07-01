'use client';

import { Zap, Play, FileEdit, PauseCircle, Activity, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { Badge } from '@/components/v3/ui/Badge';
import { cn } from '@/lib/cn';
import { format } from 'date-fns';
import {
  type AutomationStatsResponse, type ExecutionsResponse, type Execution,
  EXECUTION_STATUS_META,
} from '@/types/automations';

interface AutomationDashboardProps {
  onViewWorkflows?: () => void;
  onViewExecutions: () => void;
  onCreateWorkflow: () => void;
}

export function AutomationDashboard({
  onViewExecutions, onCreateWorkflow,
}: AutomationDashboardProps) {
  const { data: statsData, isLoading: statsLoading } = useQuery<AutomationStatsResponse>({
    queryKey: ['automation-stats'],
    queryFn:  () => apiFetch('/api/automations/stats'),
  });

  const { data: execData, isLoading: execLoading } = useQuery<ExecutionsResponse>({
    queryKey: ['executions'],
    queryFn:  () => apiFetch('/api/automations/executions?limit=5'),
    refetchInterval: 15_000,
  });

  const s       = statsData?.stats;
  const recent  = execData?.executions ?? [];

  return (
    <div className="space-y-6">
      {/* Workflow status KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)
          : [
              { label: 'Total',           value: s?.total  ?? 0, icon: Zap,        color: 'text-primary-600 dark:text-primary-400'  },
              { label: 'Active',          value: s?.active ?? 0, icon: Play,       color: 'text-success-600 dark:text-success-400'  },
              { label: 'Draft',           value: s?.draft  ?? 0, icon: FileEdit,   color: 'text-neutral-400'                        },
              { label: 'Paused',          value: s?.paused ?? 0, icon: PauseCircle,color: 'text-warning-600 dark:text-warning-400'  },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <kpi.icon className={cn('mb-2 h-4 w-4', kpi.color)} aria-hidden />
                <p className="text-2xl font-bold text-neutral-900 dark:text-white">{kpi.value}</p>
                <p className="text-xs text-neutral-500">{kpi.label}</p>
              </div>
            ))}
      </div>

      {/* Execution performance */}
      <div className="grid grid-cols-2 gap-3">
        {statsLoading
          ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          : [
              { label: 'Total Executions', value: (s?.totalExecutions ?? 0).toLocaleString(), sub: 'all workflows'    },
              { label: 'Success Rate',     value: `${s?.successRate ?? 0}%`,                  sub: 'completed / run'  },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-xl font-bold text-neutral-900 dark:text-white">{kpi.value}</p>
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{kpi.label}</p>
                <p className="text-xs text-neutral-400">{kpi.sub}</p>
              </div>
            ))}
      </div>

      {/* Recent executions */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Recent Executions</h2>
          <button
            onClick={onViewExecutions}
            className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            View all
          </button>
        </div>

        {execLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-10 text-center dark:border-neutral-800 dark:bg-neutral-900/50">
            <Activity className="mx-auto h-8 w-8 text-neutral-300" aria-hidden />
            <p className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">No executions yet</p>
            <p className="mt-1 text-xs text-neutral-400">Activate a workflow to see executions here</p>
            <button
              onClick={onCreateWorkflow}
              className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Create Workflow
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((e) => <ExecutionRow key={e.executionId} execution={e} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionRow({ execution: e }: { execution: Execution }) {
  const meta = EXECUTION_STATUS_META[e.status] ?? EXECUTION_STATUS_META.failed;
  const StatusIcon =
    e.status === 'completed' ? CheckCircle2 :
    e.status === 'failed'    ? XCircle      :
    e.status === 'running'   ? Activity     : Clock;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <StatusIcon
        className={cn(
          'h-4 w-4 shrink-0',
          e.status === 'completed' ? 'text-success-500'  :
          e.status === 'failed'    ? 'text-error-500'    :
          e.status === 'running'   ? 'text-primary-500 animate-pulse' :
                                     'text-warning-500',
        )}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{e.workflowName}</p>
        <p className="text-xs text-neutral-400">
          {e.contactName ? `For: ${e.contactName} · ` : ''}
          {format(new Date(e.startedAt), 'd MMM, h:mm a')}
          {e.durationMs ? ` · ${e.durationMs}ms` : ''}
        </p>
      </div>
      <Badge variant={meta.variant}>{meta.label}</Badge>
    </div>
  );
}
