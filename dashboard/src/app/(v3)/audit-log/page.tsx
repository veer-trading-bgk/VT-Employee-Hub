'use client';

import { useState } from 'react';
import { Search, ScrollText } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

// ── Types & constants ─────────────────────────────────────────────────────────

interface AuditLog {
  PK: string; SK: string; userId: string; action: string; target: string;
  result: string; ip: string; timestamp: string;
}

const AUDIT_RESULT_BADGE: Record<string, string> = {
  success:  'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
  flagged:  'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300',
  approved: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  rejected: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
  failed:   'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

const ACTION_LABELS: Record<string, string> = {
  successful_login: 'Login', failed_login: 'Failed Login',
  metric_added: 'Metric Added', metric_corrected: 'Metric Corrected',
  verify_metric: 'Metric Verified', admin_edit_metric: 'Admin Edit',
  bulk_entry: 'Bulk Entry', create_employee: 'Employee Created',
  employee_updated: 'Employee Updated', employee_permanently_deleted: 'Employee Deleted',
  password_reset: 'Password Reset', setup_2fa: '2FA Setup', reset_2fa: '2FA Reset',
  update_targets: 'Targets Updated', view_analytics: 'Analytics Viewed',
  suspicious_metric_entry: '⚠️ Suspicious Entry',
};

type AuditTab = 'logs' | 'suspicious' | 'security';

// ── Table component ───────────────────────────────────────────────────────────

function AuditTable({ rows, suspicious }: { rows: AuditLog[]; suspicious?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            {['Time', 'Action', 'User', 'Target', 'Result', 'IP'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-neutral-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
          {rows.map((log, i) => (
            <tr key={log.PK + i} className={cn('hover:bg-neutral-50 dark:hover:bg-neutral-800/40', suspicious && 'bg-error-50/30 dark:bg-error-900/10')}>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-400">
                {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td className={cn('px-4 py-2.5 font-medium', suspicious ? 'text-error-700 dark:text-error-300' : 'text-neutral-800 dark:text-neutral-200')}>
                {ACTION_LABELS[log.action] ?? log.action}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{log.userId?.slice(0, 12)}…</td>
              <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-neutral-500" title={log.target}>{log.target}</td>
              <td className="px-4 py-2.5">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', AUDIT_RESULT_BADGE[log.result] ?? AUDIT_RESULT_BADGE.failed)}>
                  {log.result}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">{log.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="py-12 text-center text-sm text-neutral-400">No records in this time range</div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AuditLogPageInner() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AuditTab>('logs');
  const [hours, setHours] = useState(24);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['audit-logs', hours],
    queryFn: () => apiFetch<{ success: boolean; data: AuditLog[]; totalRecords: number; timeRange: string }>(`/api/audit/logs?hours=${hours}&limit=500`),
    enabled: tab === 'logs',
    staleTime: 60_000,
  });

  const { data: suspData, isLoading: suspLoading } = useQuery({
    queryKey: ['audit-suspicious', hours],
    queryFn: () => apiFetch<{ success: boolean; summary: { failedLogins: number; suspiciousMetrics: number; deletedEmployees: number; totalSuspicious: number }; details: AuditLog[] }>(`/api/audit/suspicious?hours=${hours}`),
    enabled: tab === 'suspicious',
    staleTime: 60_000,
  });

  const { data: secData, isLoading: secLoading } = useQuery({
    queryKey: ['audit-security'],
    queryFn: () => apiFetch<{
      success: boolean;
      statistics: { totalActions: number; successfulLogins: number; failedLogins: number; uniqueUsers: number; uniqueIPs: number; suspiciousActivities: number };
      highRiskIPs: { ip: string; failedAttempts: number }[];
      recommendations: string[];
      generatedAt: string;
      timeRange: string;
    }>('/api/audit/security-report'),
    enabled: tab === 'security',
    staleTime: 5 * 60_000,
  });

  const logs = logsData?.data ?? [];
  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();
  const filtered = logs.filter((log) => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return log.userId?.toLowerCase().includes(q) || log.action?.toLowerCase().includes(q) || log.target?.toLowerCase().includes(q) || log.ip?.includes(q);
  });

  const TIME_RANGES = [
    { label: '1h',  value: 1   },
    { label: '6h',  value: 6   },
    { label: '24h', value: 24  },
    { label: '48h', value: 48  },
    { label: '7d',  value: 168 },
  ] as const;

  return (
    <div className="flex h-full flex-col">
      {/* Sticky page header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
            <ScrollText className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Audit Log</h1>
            <p className="text-xs text-neutral-500">Complete trail of all admin and employee actions</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ['audit-logs', hours] })}>
            Refresh
          </Button>
          <Button size="sm" variant="secondary"
            onClick={() => window.open(`/api/audit/export?days=${Math.ceil(hours / 24)}`, '_blank')}>
            Export JSON
          </Button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-950">
        {([['logs', 'All Logs'], ['suspicious', 'Suspicious'], ['security', 'Security Report']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              tab === id
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-5">
          {/* Time range */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-neutral-500">Time range:</span>
            {TIME_RANGES.map(({ label, value }) => (
              <button key={value} onClick={() => setHours(value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold transition',
                  hours === value
                    ? 'bg-primary-600 text-white'
                    : 'border border-neutral-200 bg-white text-neutral-600 hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
                )}>
                {label}
              </button>
            ))}
          </div>

          {/* All Logs tab */}
          {tab === 'logs' && (
            <>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search user, action, target, IP…"
                    className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
                </div>
                <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
                  className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                  <option value="all">All Actions</option>
                  {uniqueActions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
                </select>
              </div>
              {logsLoading ? <Skeleton className="h-48 w-full" /> : <AuditTable rows={filtered} />}
              {logsData && (
                <p className="text-xs text-neutral-400">
                  Showing {filtered.length} of {logs.length} records · {logsData.timeRange}
                </p>
              )}
            </>
          )}

          {/* Suspicious tab */}
          {tab === 'suspicious' && (
            <>
              {suspLoading ? <Skeleton className="h-48 w-full" /> : suspData && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Total Suspicious',   value: suspData.summary.totalSuspicious,   color: 'text-error-600' },
                      { label: 'Failed Logins',       value: suspData.summary.failedLogins,       color: 'text-warning-600' },
                      { label: 'Suspicious Entries',  value: suspData.summary.suspiciousMetrics,  color: 'text-orange-600' },
                      { label: 'Employee Deletions',  value: suspData.summary.deletedEmployees,   color: 'text-error-700' },
                    ].map(({ label, value, color }) => (
                      <Card key={label}>
                        <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
                      </Card>
                    ))}
                  </div>
                  <AuditTable rows={suspData.details} suspicious />
                </>
              )}
            </>
          )}

          {/* Security tab */}
          {tab === 'security' && (
            <>
              {secLoading ? <Skeleton className="h-48 w-full" /> : secData && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {[
                      { label: 'Total Actions',     value: secData.statistics.totalActions,           color: 'text-neutral-900 dark:text-white' },
                      { label: 'Successful Logins', value: secData.statistics.successfulLogins,        color: 'text-success-600' },
                      { label: 'Failed Logins',     value: secData.statistics.failedLogins,            color: 'text-error-600' },
                      { label: 'Suspicious',        value: secData.statistics.suspiciousActivities,    color: 'text-warning-600' },
                      { label: 'Unique Users',      value: secData.statistics.uniqueUsers,             color: 'text-primary-600' },
                      { label: 'Unique IPs',        value: secData.statistics.uniqueIPs,               color: 'text-primary-500' },
                    ].map(({ label, value, color }) => (
                      <Card key={label}>
                        <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
                      </Card>
                    ))}
                  </div>
                  {secData.highRiskIPs.length > 0 && (
                    <Card>
                      <h3 className="mb-3 text-sm font-semibold text-error-700 dark:text-error-300">High-Risk IPs</h3>
                      <div className="space-y-2">
                        {secData.highRiskIPs.map(({ ip, failedAttempts }) => (
                          <div key={ip} className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                            <span className="font-mono text-sm font-medium text-neutral-900 dark:text-white">{ip}</span>
                            <Badge variant="error">{failedAttempts} failed attempts</Badge>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                  <Card>
                    <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Recommendations</h3>
                    <ul className="space-y-1.5">
                      {secData.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                          <span className="mt-0.5 shrink-0">{rec.startsWith('✅') ? '✅' : rec.startsWith('⚠️') ? '⚠️' : 'ℹ️'}</span>
                          <span>{rec.replace(/^[✅⚠️ℹ️]\s*/, '')}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-xs text-neutral-400">
                      Generated: {secData.generatedAt ? new Date(secData.generatedAt).toLocaleString('en-IN') : '—'} · {secData.timeRange}
                    </p>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Admin-only — nav already hides this (V3Sidebar's roles: ['owner','admin']),
// but that was nav-hiding only, not real route enforcement (Phase 2A audit,
// 2026-07-06). See docs/bible/19_DECISION_LOG.md's Era 24 entry.
export default function AuditLogPage() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <AuditLogPageInner />
    </ProtectedRoute>
  );
}
