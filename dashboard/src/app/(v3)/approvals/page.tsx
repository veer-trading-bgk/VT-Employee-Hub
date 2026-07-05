'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge, type BadgeVariant } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Approval {
  approvalId: string;
  useCase: string;
  output: Record<string, unknown>;
  confidence?: number | null;
  riskLevel?: string | null;
  assignedTo: string | null;
  originalAssignee?: string | null;
  routingReason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

interface ApprovalsResponse { success: boolean; approvals: Approval[] }

interface EmployeeRecord { id: string; name: string; email: string; role: string; status: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

// AI use cases are registered as kebab-case keys in src/config/aiConfig.js
// (e.g. 'inbox-intent-detection') — same display convention AISection.tsx's
// MODULES list already establishes for the same registry.
function useCaseLabel(useCase: string) {
  return useCase.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROUTING_LABEL: Record<string, string> = {
  direct: 'Routed directly',
  'leave-fallback-teamlead': 'Routed to team lead — assignee on leave',
  'leave-fallback-admin': 'Routed to admin — assignee and team lead on leave',
  unassigned: 'Unassigned — nobody was available',
};

const RISK_VARIANT: Record<string, BadgeVariant> = {
  low: 'default', medium: 'warning', high: 'error',
};

const STATUS_VARIANT: Record<Approval['status'], BadgeVariant> = {
  pending: 'warning', approved: 'success', rejected: 'error',
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// The output shape is whichever future customerFacing AI use case produced it —
// no schema exists yet to render a purpose-built preview against (see
// ApprovalService.js's own header comment), so this stays a generic, honest
// JSON preview rather than guessing at fields a real feature hasn't defined.
function OutputPreview({ output }: { output: Record<string, unknown> }) {
  return (
    <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-neutral-50 p-2.5 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

// ── Approval row ──────────────────────────────────────────────────────────────

function ApprovalRow({
  approval, employeeMap, onResolved,
}: {
  approval: Approval;
  employeeMap?: Record<string, EmployeeRecord>;
  onResolved: (id: string, status: 'approved' | 'rejected', note: string) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [pendingAction, setPendingAction] = useState<'approved' | 'rejected' | null>(null);

  const assignee = approval.assignedTo ? employeeMap?.[approval.assignedTo] : null;

  function submit(status: 'approved' | 'rejected') {
    setPendingAction(status);
    onResolved(approval.approvalId, status, note);
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {employeeMap && (
          <Avatar name={assignee?.name ?? (approval.assignedTo ? approval.assignedTo : '?')} size={32} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {useCaseLabel(approval.useCase)}
            </p>
            {approval.riskLevel && (
              <Badge variant={RISK_VARIANT[approval.riskLevel] ?? 'default'}>{approval.riskLevel} risk</Badge>
            )}
            {typeof approval.confidence === 'number' && (
              <span className="text-[10px] text-neutral-400">
                {Math.round(approval.confidence * 100)}% confidence
              </span>
            )}
          </div>
          {employeeMap && (
            <p className="mt-0.5 text-xs text-neutral-500">
              {assignee ? `Assigned to ${assignee.name}` : approval.assignedTo ? approval.assignedTo : 'Unassigned'}
              {' · '}{ROUTING_LABEL[approval.routingReason] ?? approval.routingReason}
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-neutral-400">{fmtDateTime(approval.createdAt)}</p>
          <OutputPreview output={approval.output} />
          {approval.resolutionNote && (
            <p className="mt-1.5 text-xs italic text-neutral-500">Note: {approval.resolutionNote}</p>
          )}
        </div>
        {approval.status === 'pending' && !reviewing ? (
          <Button size="sm" variant="secondary" onClick={() => setReviewing(true)} className="shrink-0">
            Review
          </Button>
        ) : approval.status === 'pending' ? null : (
          <Badge variant={STATUS_VARIANT[approval.status]} className="shrink-0">{approval.status}</Badge>
        )}
      </div>

      {reviewing && (
        <div className="mt-2 ml-11 space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={pendingAction === 'approved'} onClick={() => submit('approved')}>
              Approve
            </Button>
            <Button size="sm" variant="danger" loading={pendingAction === 'rejected'} onClick={() => submit('rejected')}>
              Reject
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReviewing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Approval list (shared shape, different endpoint per view) ────────────────

function ApprovalsList({ endpoint, queryKeyPrefix, employeeMap }: {
  endpoint: string;
  queryKeyPrefix: string;
  employeeMap?: Record<string, EmployeeRecord>;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const { data, isLoading } = useQuery({
    queryKey: [queryKeyPrefix, tab],
    queryFn: () => apiFetch<ApprovalsResponse>(`${endpoint}${tab === 'pending' ? '?status=pending' : ''}`),
    staleTime: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'approved' | 'rejected'; note: string }) =>
      apiFetch(`/api/approvals/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status, resolutionNote: note.trim() || null }),
      }),
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: [queryKeyPrefix] });
      toast.success(`Approval ${status === 'approved' ? 'approved' : 'rejected'}`);
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to resolve approval'),
  });

  const approvals = data?.approvals ?? [];

  return (
    <Card noPadding>
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {queryKeyPrefix === 'admin-approvals' ? 'All Approvals' : 'My Approvals'}
        </p>
        <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
          {(['pending', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('rounded-md px-3 py-1 text-xs font-medium transition', tab === t ? 'bg-primary-600 text-white' : 'text-neutral-500')}
            >
              {t === 'pending' ? 'Pending' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="divide-y divide-neutral-50 dark:divide-neutral-800">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-6 w-16 ml-auto rounded-lg" />
            </div>
          ))}
        </div>
      ) : approvals.length === 0 ? (
        <div className="py-8 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-success-400 mb-2" />
          <p className="text-sm text-neutral-400">No {tab === 'pending' ? 'pending ' : ''}approvals</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
          {approvals.map((approval) => (
            <ApprovalRow
              key={approval.approvalId}
              approval={approval}
              employeeMap={employeeMap}
              onResolved={(id, status, note) => resolveMutation.mutate({ id, status, note })}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { user } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const isAdmin = ['owner', 'admin', 'manager'].includes(v3Role);

  // Employee names for the admin view's "assigned to" line — same
  // /api/admin/employees + id→record map pattern AdminAttendanceView already
  // uses, since ApprovalService's own record stores assignedTo as a bare
  // employee id, not a name.
  const { data: empData } = useQuery({
    queryKey: ['v3-employees'],
    queryFn: () => apiFetch<{ success: boolean; data: EmployeeRecord[] }>('/api/admin/employees')
      .catch(() => ({ success: true, data: [] as EmployeeRecord[] })),
    staleTime: 10 * 60_000,
    enabled: isAdmin,
  });
  const employeeMap = Object.fromEntries((empData?.data ?? []).map((e) => [e.id, e]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <ClipboardCheck className="h-5 w-5 text-primary-600" />
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Approvals</h1>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <ApprovalsList endpoint="/api/approvals" queryKeyPrefix="my-approvals" />
          {isAdmin && (
            <ApprovalsList endpoint="/api/approvals/admin" queryKeyPrefix="admin-approvals" employeeMap={employeeMap} />
          )}
        </div>
      </div>
    </div>
  );
}
