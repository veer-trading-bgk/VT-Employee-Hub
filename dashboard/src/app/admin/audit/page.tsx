'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';

interface AuditLog {
  PK: string;
  SK: string;
  userId: string;
  action: string;
  target: string;
  result: string;
  ip: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

interface AuditLogsResponse {
  success: boolean;
  data: AuditLog[];
  totalRecords: number;
  timeRange: string;
}

interface SuspiciousResponse {
  success: boolean;
  summary: {
    failedLogins: number;
    suspiciousMetrics: number;
    deletedEmployees: number;
    totalSuspicious: number;
  };
  details: AuditLog[];
  timeRange: string;
}

interface SecurityReportResponse {
  success: boolean;
  timeRange: string;
  generatedAt: string;
  statistics: {
    totalActions: number;
    successfulLogins: number;
    failedLogins: number;
    metricAdded: number;
    adminActions: number;
    uniqueUsers: number;
    uniqueIPs: number;
    suspiciousActivities: number;
  };
  highRiskIPs: { ip: string; failedAttempts: number }[];
  recommendations: string[];
}

const RESULT_BADGE: Record<string, string> = {
  success:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  flagged:  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  rejected: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  failed:   'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const ACTION_LABELS: Record<string, string> = {
  successful_login:            'Login',
  failed_login:                'Failed Login',
  metric_added:                'Metric Added',
  metric_corrected:            'Metric Corrected',
  verify_metric:               'Metric Verified',
  admin_edit_metric:           'Admin Metric Edit',
  bulk_entry:                  'Bulk Entry',
  create_employee:             'Employee Created',
  employee_updated:            'Employee Updated',
  employee_permanently_deleted:'Employee Deleted',
  password_reset:              'Password Reset',
  setup_2fa:                   '2FA Setup',
  reset_2fa:                   '2FA Reset',
  update_targets:              'Targets Updated',
  reset_targets:               'Targets Reset',
  view_leaderboard:            'Leaderboard Viewed',
  view_analytics:              'Analytics Viewed',
  view_audit_logs:             'Audit Viewed',
  suspicious_metric_entry:     '⚠️ Suspicious Entry',
  bulk_status_update:          'Bulk Status Update',
  bulk_delete_employees:       'Bulk Delete',
};

type Tab = 'logs' | 'suspicious' | 'security';

export default function AuditPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('logs');
  const [hours, setHours] = useState(24);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['audit-logs', hours],
    queryFn: () => apiFetch<AuditLogsResponse>(`/api/audit/logs?hours=${hours}&limit=500`),
    enabled: tab === 'logs',
    staleTime: 60_000,
  });

  const { data: suspData, isLoading: suspLoading } = useQuery({
    queryKey: ['audit-suspicious', hours],
    queryFn: () => apiFetch<SuspiciousResponse>(`/api/audit/suspicious?hours=${hours}`),
    enabled: tab === 'suspicious',
    staleTime: 60_000,
  });

  const { data: secData, isLoading: secLoading } = useQuery({
    queryKey: ['audit-security'],
    queryFn: () => apiFetch<SecurityReportResponse>('/api/audit/security-report'),
    enabled: tab === 'security',
    staleTime: 5 * 60_000,
  });

  const exportLogs = () => {
    const url = `/api/audit/export?days=${Math.ceil(hours / 24)}`;
    window.open(url, '_blank');
  };

  const logs = logsData?.data ?? [];
  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();

  const filtered = logs.filter((log) => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        log.userId?.toLowerCase().includes(q) ||
        log.action?.toLowerCase().includes(q) ||
        log.target?.toLowerCase().includes(q) ||
        log.ip?.includes(q)
      );
    }
    return true;
  });

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'logs',      label: 'All Logs',     icon: '📋' },
    { id: 'suspicious',label: 'Suspicious',   icon: '⚠️' },
    { id: 'security',  label: 'Security',     icon: '🔐' },
  ];

  return (
    <>
      <Navbar title="Audit Logs" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-6">

          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Audit Log Viewer</h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Complete trail of all admin and employee actions
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['audit-logs', hours] })}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                🔄 Refresh
              </button>
              <button
                onClick={exportLogs}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                ⬇️ Export JSON
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit dark:border-slate-700 dark:bg-slate-900">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition ${
                  tab === t.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Time range selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Time range:</span>
            {[
              { label: '1h', value: 1 },
              { label: '6h', value: 6 },
              { label: '24h', value: 24 },
              { label: '48h', value: 48 },
              { label: '7d', value: 168 },
            ].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setHours(value)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  hours === value
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── ALL LOGS TAB ─────────────────────────────────── */}
          {tab === 'logs' && (
            <>
              <div className="flex flex-wrap gap-2">
                <input
                  placeholder="Search user, action, target, IP…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-56 flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
                />
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <option value="all">All Actions</option>
                  {uniqueActions.map((a) => (
                    <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
                  ))}
                </select>
              </div>

              {logsLoading ? (
                <div className="flex justify-center py-20"><Loading /></div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          {['Time', 'Action', 'User', 'Target', 'Result', 'IP'].map((h) => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                        {filtered.map((log, i) => (
                          <tr key={log.PK + i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                              {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                              {ACTION_LABELS[log.action] ?? log.action}
                            </td>
                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs">
                              {log.userId?.slice(0, 12)}…
                            </td>
                            <td className="max-w-[200px] truncate px-4 py-3 text-xs text-slate-500 dark:text-slate-400" title={log.target}>
                              {log.target}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RESULT_BADGE[log.result] ?? RESULT_BADGE.failed}`}>
                                {log.result}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-400">{log.ip}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filtered.length === 0 && (
                      <div className="py-16 text-center text-sm text-slate-400">No logs in this time range</div>
                    )}
                    <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800">
                      Showing {filtered.length} of {logs.length} records · {logsData?.timeRange}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── SUSPICIOUS TAB ────────────────────────────────── */}
          {tab === 'suspicious' && (
            <>
              {suspLoading ? (
                <div className="flex justify-center py-20"><Loading /></div>
              ) : suspData ? (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {[
                      { label: 'Total Suspicious', value: suspData.summary.totalSuspicious, color: 'text-rose-600' },
                      { label: 'Failed Logins',    value: suspData.summary.failedLogins,    color: 'text-amber-600' },
                      { label: 'Suspicious Entries',value: suspData.summary.suspiciousMetrics, color: 'text-orange-600' },
                      { label: 'Employee Deletions',value: suspData.summary.deletedEmployees, color: 'text-red-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                        <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            {['Time', 'Action', 'User', 'Target', 'Result', 'IP'].map((h) => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                          {suspData.details.map((log, i) => (
                            <tr key={log.PK + i} className="bg-rose-50/40 hover:bg-rose-50 dark:bg-rose-900/10 dark:hover:bg-rose-900/20">
                              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                                {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                              </td>
                              <td className="px-4 py-3 font-medium text-rose-700 dark:text-rose-300">
                                {ACTION_LABELS[log.action] ?? log.action}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-500">{log.userId?.slice(0, 12)}…</td>
                              <td className="max-w-[200px] truncate px-4 py-3 text-xs text-slate-500" title={log.target}>{log.target}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RESULT_BADGE[log.result] ?? RESULT_BADGE.failed}`}>
                                  {log.result}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-400">{log.ip}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {suspData.details.length === 0 && (
                        <div className="py-16 text-center text-sm text-slate-400">No suspicious activity in this window</div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}

          {/* ── SECURITY REPORT TAB ───────────────────────────── */}
          {tab === 'security' && (
            <>
              {secLoading ? (
                <div className="flex justify-center py-20"><Loading /></div>
              ) : secData ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {[
                      { label: 'Total Actions',    value: secData.statistics.totalActions,    color: 'text-slate-900 dark:text-white' },
                      { label: 'Successful Logins',value: secData.statistics.successfulLogins, color: 'text-emerald-600' },
                      { label: 'Failed Logins',    value: secData.statistics.failedLogins,    color: 'text-rose-600' },
                      { label: 'Suspicious',       value: secData.statistics.suspiciousActivities, color: 'text-amber-600' },
                      { label: 'Unique Users',     value: secData.statistics.uniqueUsers,     color: 'text-blue-600' },
                      { label: 'Unique IPs',       value: secData.statistics.uniqueIPs,       color: 'text-indigo-600' },
                      { label: 'Metrics Added',    value: secData.statistics.metricAdded,     color: 'text-slate-700 dark:text-slate-300' },
                      { label: 'Admin Actions',    value: secData.statistics.adminActions,    color: 'text-violet-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                        <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {secData.highRiskIPs.length > 0 && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-900/20">
                      <h3 className="mb-3 font-semibold text-rose-700 dark:text-rose-300">High-Risk IPs</h3>
                      <div className="space-y-2">
                        {secData.highRiskIPs.map(({ ip, failedAttempts }) => (
                          <div key={ip} className="flex items-center justify-between rounded-lg border border-rose-200 bg-white px-4 py-3 dark:border-rose-800 dark:bg-slate-900">
                            <span className="font-mono text-sm font-medium text-slate-900 dark:text-white">{ip}</span>
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                              {failedAttempts} failed attempts
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="mb-3 font-semibold text-slate-900 dark:text-white">Recommendations</h3>
                    <ul className="space-y-2">
                      {secData.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                          <span className="mt-0.5 shrink-0">{rec.startsWith('✅') ? '✅' : rec.startsWith('⚠️') ? '⚠️' : 'ℹ️'}</span>
                          <span>{rec.replace(/^[✅⚠️ℹ️]\s*/, '')}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-xs text-slate-400">
                      Generated: {new Date(secData.generatedAt).toLocaleString('en-IN')} · {secData.timeRange}
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
