'use client';

import { useState } from 'react';
import {
  MessageSquare,
  Users,
  TrendingUp,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Trophy,
  CheckCheck,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/v3/ui/Card';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { formatMetricValue } from '@/lib/metrics.config';
import { toast } from 'sonner';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';

type AnalyticsTab = 'overview' | 'pipeline' | 'conversations' | 'team' | 'sources';

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'overview',       label: 'Overview'       },
  { id: 'pipeline',       label: 'Pipeline'       },
  { id: 'conversations',  label: 'Conversations'  },
  { id: 'team',           label: 'Team'           },
  { id: 'sources',        label: 'Sources'        },
];

type DateRange = '7d' | '30d' | '90d' | 'all';

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, change, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  change?: number;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="h-24 rounded-xl" />;
  const positive = change === undefined || change >= 0;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20">
          {icon}
        </div>
        {change !== undefined && (
          <div className={cn('flex items-center gap-0.5 text-xs font-medium', positive ? 'text-success-600' : 'text-error-600')}>
            {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
        <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
      </div>
    </Card>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ dateRange }: { dateRange: DateRange }) {
  interface OverviewData {
    kpis: {
      newContacts: number; newContactsChange: number;
      messages: number; messagesChange: number;
      followupsDone: number; followupsDoneChange: number;
      leadsConverted: number; leadsConvertedChange: number;
    };
    trend: { date: string; contacts: number; messages: number }[];
    leaderboard: { id: string; name: string; count: number }[];
  }

  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['analytics-overview', dateRange],
    queryFn: () => apiFetch<OverviewData>(`/api/analytics/overview?range=${dateRange}`),
    staleTime: 300_000,
    placeholderData: {
      kpis: { newContacts: 0, newContactsChange: 0, messages: 0, messagesChange: 0, followupsDone: 0, followupsDoneChange: 0, leadsConverted: 0, leadsConvertedChange: 0 },
      trend: [], leaderboard: [],
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={<Users className="h-5 w-5" />}         label="New contacts"     value={data?.kpis.newContacts ?? 0}     change={data?.kpis.newContactsChange}    loading={isLoading} />
        <KpiCard icon={<MessageSquare className="h-5 w-5" />} label="Messages sent"    value={data?.kpis.messages ?? 0}        change={data?.kpis.messagesChange}       loading={isLoading} />
        <KpiCard icon={<CheckCircle2 className="h-5 w-5" />}  label="Follow-ups done"  value={data?.kpis.followupsDone ?? 0}   change={data?.kpis.followupsDoneChange}  loading={isLoading} />
        <KpiCard icon={<TrendingUp className="h-5 w-5" />}    label="Leads converted"  value={data?.kpis.leadsConverted ?? 0}  change={data?.kpis.leadsConvertedChange} loading={isLoading} />
      </div>
      <Card noPadding>
        <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Activity over time</h3>
        </div>
        <div className="p-4">
          {isLoading ? <Skeleton className="h-48 w-full" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data?.trend ?? []} margin={{ left: -20 }}>
                <defs>
                  <linearGradient id="grad-contacts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-messages" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                <Area type="monotone" dataKey="contacts" stroke="#2563EB" fill="url(#grad-contacts)" strokeWidth={2} name="Contacts" />
                <Area type="monotone" dataKey="messages" stroke="#16A34A" fill="url(#grad-messages)" strokeWidth={2} name="Messages" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
      {(data?.leaderboard ?? []).length > 0 && (
        <Card noPadding>
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Team leaderboard</h3>
          </div>
          <ul>
            {(data?.leaderboard ?? []).map((person, i) => (
              <li key={person.id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800/50">
                <span className="w-5 text-center text-sm font-bold text-neutral-400">{i + 1}</span>
                <Avatar name={person.name} size={32} />
                <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">{person.name}</span>
                <Badge variant="primary">{person.count}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Pipeline Tab ──────────────────────────────────────────────────────────────

function PipelineTab({ dateRange }: { dateRange: DateRange }) {
  interface PipelineData {
    stages: { stage: string; count: number; value: number }[];
    funnel: { stage: string; pct: number }[];
  }
  const { data, isLoading } = useQuery<PipelineData>({
    queryKey: ['analytics-pipeline', dateRange],
    queryFn: () => apiFetch<PipelineData>(`/api/analytics/pipeline?range=${dateRange}`),
    staleTime: 300_000,
    placeholderData: { stages: [], funnel: [] },
  });
  const COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#64748B'];
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card noPadding>
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Contacts by stage</h3>
          </div>
          <div className="p-4">
            {isLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data?.stages ?? []} dataKey="count" nameKey="stage" cx="50%" cy="50%" outerRadius={80}>
                    {(data?.stages ?? []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card noPadding>
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Stage breakdown</h3>
          </div>
          <div className="p-4">
            {isLoading ? <Skeleton className="h-48 w-full" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data?.stages ?? []} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} name="Contacts" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Team Tab ──────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  rank: number; userId: string; name: string; email: string;
  points: number; metrics: Record<string, number>;
}
interface LeaderboardResponse {
  success: boolean; month: string;
  data: LeaderboardEntry[];
  monthlyTargets: Record<string, number>;
  activeHeadcount?: number;
}
interface TeamSummaryEntry { email: string; name?: string; metrics: Record<string, number>; }
interface TeamSummaryResponse {
  success: boolean; date: string;
  data: Record<string, TeamSummaryEntry>;
  targets: Record<string, number>;
}
interface PendingEntry {
  metricId: string; userId: string; name?: string; email?: string;
  metric_type: string; value: number; date: string;
  notes?: string; enteredAt: string; flagged?: boolean;
}
interface PendingResponse { data: PendingEntry[]; total: number; }

const MEDAL = ['🥇', '🥈', '🥉'];

function TeamTab() {
  const { user } = useAuth();
  const { metrics, getMetricConfig } = useMetricsConfig();
  const qc = useQueryClient();
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const canVerify = ['admin', 'manager', 'team_lead'].includes(user?.role ?? '');

  const { data: lbData, isLoading: lbLoading } = useQuery<LeaderboardResponse>({
    queryKey: ['analytics-leaderboard'],
    queryFn: () => apiFetch<LeaderboardResponse>('/api/metrics/leaderboard'),
    staleTime: 300_000,
    refetchInterval: 300_000,
  });

  const { data: teamData, isLoading: teamLoading } = useQuery<TeamSummaryResponse>({
    queryKey: ['analytics-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery<PendingResponse>({
    queryKey: ['analytics-pending'],
    queryFn: () => apiFetch<PendingResponse>('/api/metrics/pending'),
    staleTime: 30_000,
    refetchInterval: 30_000,
    enabled: canVerify,
  });

  const verifyMutation = useMutation({
    mutationFn: ({ metricId, approved, notes }: { metricId: string; approved: boolean; notes?: string }) =>
      apiFetch('/api/metrics/verify', {
        method: 'POST',
        body: JSON.stringify({ metricId, approved, notes }),
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.approved ? 'Metric approved' : 'Metric rejected');
      qc.invalidateQueries({ queryKey: ['analytics-pending'] });
      setVerifyingId(null);
      setRejectId(null);
      setRejectNote('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lbEntries = lbData?.data ?? [];
  const teamEntries = Object.entries(teamData?.data ?? {});
  const pendingEntries = pendingData?.data ?? [];

  // Compute today's team totals vs targets
  const targets = teamData?.targets ?? {};
  const metricTotals = metrics.map((m) => {
    const total = teamEntries.reduce((s, [, e]) => s + (e.metrics?.[m.key] ?? 0), 0);
    const target = (targets[m.key] ?? 0) * (teamEntries.length || 1);
    const pct = target > 0 ? Math.round((total / target) * 100) : 0;
    return { ...m, total, target, pct };
  });

  return (
    <div className="space-y-6">

      {/* ── Monthly Leaderboard ─────────────────────────────────────────── */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Monthly Leaderboard
            </h3>
            {lbData?.month && (
              <Badge variant="default">{lbData.month}</Badge>
            )}
          </div>
          {lbData?.activeHeadcount && (
            <span className="text-xs text-neutral-400">{lbData.activeHeadcount} active</span>
          )}
        </div>

        {lbLoading ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {[0,1,2,3,4].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-3 w-32" />
                <div className="ml-auto flex gap-2">
                  {metrics.slice(0,3).map((m) => <Skeleton key={m.key} className="h-5 w-10 rounded-full" />)}
                </div>
              </div>
            ))}
          </div>
        ) : lbEntries.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">No leaderboard data yet</div>
        ) : (
          <ul>
            {lbEntries.map((entry, i) => (
              <li
                key={entry.userId}
                className={cn(
                  'flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800/50',
                  i === 0 && 'bg-amber-50/50 dark:bg-amber-900/10',
                )}
              >
                <span className="w-6 text-center text-base">
                  {i < 3 ? MEDAL[i] : <span className="text-sm font-bold text-neutral-400">{i + 1}</span>}
                </span>
                <Avatar name={entry.name || entry.email} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {entry.name || entry.email}
                  </p>
                  <p className="text-xs text-neutral-400">{entry.points} pts</p>
                </div>
                <div className="hidden items-center gap-1.5 sm:flex">
                  {metrics.slice(0, 4).map((m) => {
                    const val = entry.metrics[m.key] ?? 0;
                    const cfg = getMetricConfig(m.key);
                    return val > 0 ? (
                      <span
                        key={m.key}
                        className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                        title={m.label}
                      >
                        {m.icon} {cfg ? formatMetricValue(cfg, val) : val}
                      </span>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Today's Team Performance ────────────────────────────────────── */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary-600" aria-hidden />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Today's Team Performance
            </h3>
            {teamData?.date && (
              <Badge variant="default">{teamData.date}</Badge>
            )}
          </div>
        </div>

        {/* Metric totals row */}
        {!teamLoading && metricTotals.length > 0 && (
          <div className="grid grid-cols-2 gap-3 border-b border-neutral-100 p-4 dark:border-neutral-800 sm:grid-cols-3 lg:grid-cols-4">
            {metricTotals.map((m) => (
              <div key={m.key} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-xs text-neutral-500">{m.icon} {m.label}</p>
                <p className="mt-0.5 text-lg font-bold" style={{ color: m.color }}>
                  {formatMetricValue({ key: m.key, label: m.label, icon: m.icon, target: m.target, targetPeriod: 'day', color: m.color, pointsWeight: 1, unit: m.unit ?? 'count' }, m.total)}
                </p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <div
                    className="h-full rounded-full bg-primary-600 transition-all"
                    style={{ width: `${Math.min(m.pct, 100)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-neutral-400">{m.pct}% of target</p>
              </div>
            ))}
          </div>
        )}

        {/* Per-member rows */}
        {teamLoading ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {[0,1,2,3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-3 w-28" />
                <div className="ml-auto flex gap-2">
                  {[0,1,2].map((j) => <Skeleton key={j} className="h-5 w-12 rounded-full" />)}
                </div>
              </div>
            ))}
          </div>
        ) : teamEntries.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">No team data for today</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-neutral-400">Member</th>
                  {metrics.map((m) => (
                    <th key={m.key} className="px-3 py-2.5 text-right text-xs font-semibold text-neutral-400" title={m.label}>
                      {m.icon}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
                {teamEntries
                  .map(([userId, entry]) => ({
                    userId,
                    name: (entry as TeamSummaryEntry & { name?: string }).name ?? entry.email ?? userId,
                    metrics: entry.metrics ?? {},
                  }))
                  .sort((a, b) => {
                    const sumA = Object.values(a.metrics).reduce((s, v) => s + v, 0);
                    const sumB = Object.values(b.metrics).reduce((s, v) => s + v, 0);
                    return sumB - sumA;
                  })
                  .map(({ userId, name, metrics: memberMetrics }) => (
                    <tr key={userId} className="hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={name} size={24} />
                          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate max-w-[140px]">
                            {name}
                          </span>
                        </div>
                      </td>
                      {metrics.map((m) => {
                        const val = memberMetrics[m.key] ?? 0;
                        const cfg = getMetricConfig(m.key);
                        const target = targets[m.key] ?? 0;
                        const hit = target > 0 && val >= target;
                        return (
                          <td key={m.key} className="px-3 py-2.5 text-right tabular-nums">
                            <span className={cn(
                              'text-xs font-medium',
                              val === 0 ? 'text-neutral-300 dark:text-neutral-600'
                                : hit ? 'text-success-600' : 'text-neutral-700 dark:text-neutral-300',
                            )}>
                              {val === 0 ? '—' : cfg ? formatMetricValue(cfg, val) : val}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Verify Pending Metrics ──────────────────────────────────────── */}
      {canVerify && (
        <Card noPadding>
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <CheckCheck className="h-4 w-4 text-primary-600" aria-hidden />
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Verify Pending Entries
              </h3>
              {(pendingEntries.length > 0) && (
                <Badge variant="warning">{pendingEntries.length}</Badge>
              )}
            </div>
          </div>

          {pendingLoading ? (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {[0,1,2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                  <Skeleton className="h-7 w-16 rounded-lg" />
                  <Skeleton className="h-7 w-16 rounded-lg" />
                </div>
              ))}
            </div>
          ) : pendingEntries.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-success-400 mb-2" aria-hidden />
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">All caught up</p>
              <p className="text-xs text-neutral-400 mt-0.5">No pending entries to verify</p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {pendingEntries.map((entry) => {
                const cfg = getMetricConfig(entry.metric_type);
                const isRejecting = rejectId === entry.metricId;
                return (
                  <li key={entry.metricId} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Avatar name={entry.name ?? entry.email ?? '?'} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {entry.name ?? entry.email ?? entry.userId}
                          </p>
                          {entry.flagged && (
                            <Badge variant="warning">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5 inline" />Flagged
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          <span className="font-medium text-neutral-700 dark:text-neutral-300">
                            {cfg?.icon} {cfg?.label ?? entry.metric_type}:
                          </span>{' '}
                          <span className="font-semibold" style={{ color: cfg?.color }}>
                            {cfg ? formatMetricValue(cfg, entry.value) : entry.value}
                          </span>
                          {' · '}{entry.date}
                        </p>
                        {entry.notes && (
                          <p className="mt-0.5 text-xs text-neutral-400 italic">"{entry.notes}"</p>
                        )}
                      </div>

                      {!isRejecting && (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={verifyMutation.isPending && verifyingId === entry.metricId}
                            onClick={() => {
                              setVerifyingId(entry.metricId);
                              verifyMutation.mutate({ metricId: entry.metricId, approved: true });
                            }}
                            iconLeft={<CheckCheck className="h-3.5 w-3.5" />}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setRejectId(entry.metricId); setRejectNote(''); }}
                            iconLeft={<XCircle className="h-3.5 w-3.5 text-error-500" />}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Reject note input */}
                    {isRejecting && (
                      <div className="mt-2 ml-11 space-y-2">
                        <input
                          type="text"
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          placeholder="Reason for rejection (optional)"
                          autoFocus
                          className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            loading={verifyMutation.isPending}
                            onClick={() => {
                              setVerifyingId(entry.metricId);
                              verifyMutation.mutate({ metricId: entry.metricId, approved: false, notes: rejectNote });
                            }}
                          >
                            Confirm Reject
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRejectId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

// ── Stub tab ──────────────────────────────────────────────────────────────────

function StubTab({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center text-neutral-400 text-sm">
      {label} analytics — coming soon
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AnalyticsPageInner() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [dateRange, setDateRange] = useState<DateRange>('30d');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Analytics</h1>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          aria-label="Date range"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="flex border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-950">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {activeTab === 'overview'      && <OverviewTab dateRange={dateRange} />}
        {activeTab === 'pipeline'      && <PipelineTab dateRange={dateRange} />}
        {activeTab === 'conversations' && <StubTab label="Conversations" />}
        {activeTab === 'team'          && <TeamTab />}
        {activeTab === 'sources'       && <StubTab label="Sources" />}
      </div>
    </div>
  );
}

// Admin/manager — nav already hides this (V3Sidebar's roles: ['owner','admin','manager']),
// but that was nav-hiding only, not real route enforcement (Phase 2A audit,
// 2026-07-06). See docs/bible/19_DECISION_LOG.md's Era 24 entry.
export default function AnalyticsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'manager']}>
      <AnalyticsPageInner />
    </ProtectedRoute>
  );
}
