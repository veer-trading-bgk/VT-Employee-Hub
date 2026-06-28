'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';
import { formatMetricValue } from '@/lib/metrics.config';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { MonthlyTeamProgress } from '@/components/charts/MonthlyTeamProgress';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { daysLeftInMonth, currentMonthLabel } from '@/utils/date-utils';
import type { TeamSummaryResponse } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────────
interface LeaderboardEntry {
  rank: number; userId: string; name: string; email: string;
  points: number; metrics: Record<string, number>;
}
interface LeaderboardResponse {
  success: boolean; month: string; data: LeaderboardEntry[];
  monthlyTargets: Record<string, number>; activeHeadcount?: number;
}
interface TargetsResponse {
  success: boolean;
  data: Record<string, { target: number; targetPeriod: 'day' | 'month' }>;
  isCustom: boolean;
}
interface CrmAnalytics {
  success: boolean;
  summary: { total: number; newToday: number; newThisWeek: number; convertedThisMonth: number };
  funnel: { key: string; label: string; color: string; count: number; conversionRate: number | null }[];
}
interface WaInboxResponse {
  success: boolean;
  conversations: unknown[];
  counts: { open: number; unassigned: number; resolved: number };
}
interface FollowupsResponse {
  success: boolean;
  followups: { date: string; done: boolean }[];
}
interface EmployeesResponse {
  success: boolean;
  data: { id: string; role: string }[];
}
interface TrialStatus {
  hasTrial: boolean; plan: string; daysLeft: number | null; isExpired: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const MEDAL = ['🥇', '🥈', '🥉'];

function toMonthlyTargetMap(data: TargetsResponse['data']): Record<string, number> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v.targetPeriod === 'month' ? v.target : v.target * 30])
  );
}
function toDailyTargetMap(data: TargetsResponse['data']): Record<string, number> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v.targetPeriod === 'day' ? v.target : +(v.target / 30).toFixed(2)])
  );
}

function KpiCard({ label, value, icon, sub, href, color = 'indigo' }: {
  label: string; value: string | number; icon: string; sub?: string; href?: string;
  color?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky';
}) {
  const colorMap = {
    indigo:  'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-400',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400',
    amber:   'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',
    rose:    'text-rose-600 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-400',
    sky:     'text-sky-600 bg-sky-50 dark:bg-sky-900/20 dark:text-sky-400',
  };
  const card = (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-xl ${colorMap[color]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

function SectionHeader({ title, icon, href, linkLabel }: {
  title: string; icon: string; href?: string; linkLabel?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      {href && <Link href={href} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">{linkLabel ?? 'View all →'}</Link>}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AdminDashboardPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { metrics } = useMetricsConfig();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: trialData } = useQuery<TrialStatus>({
    queryKey: ['trial-status'],
    queryFn: () => apiFetch('/api/companies/trial'),
    enabled: !!user?.companyId, staleTime: 600_000,
  });
  const { data: teamData, isLoading: teamLoading, isError: teamError } = useQuery({
    queryKey: ['admin-team-summary'],
    queryFn: () => apiFetch<TeamSummaryResponse>('/api/metrics/team-summary'),
    refetchInterval: 300_000, // WS push drives updates; this is the 5-min fallback
  });
  const { data: lbData, isLoading: lbLoading, isError: lbError } = useQuery({
    queryKey: ['admin-leaderboard-monthly'],
    queryFn: () => apiFetch<LeaderboardResponse>('/api/metrics/leaderboard'),
    refetchInterval: 300_000,
  });
  const { data: targetsData } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 300_000,
  });
  const { data: crmData } = useQuery({
    queryKey: ['dashboard-crm'],
    queryFn: () => apiFetch<CrmAnalytics>('/api/crm/crm-analytics'),
    staleTime: 60_000, refetchInterval: 300_000,
  });
  const { data: waData } = useQuery({
    queryKey: ['dashboard-wa'],
    queryFn: () => apiFetch<WaInboxResponse>('/api/whatsapp/inbox?status=open'),
    staleTime: 30_000, refetchInterval: 300_000,
  });
  const { data: followupsData } = useQuery({
    queryKey: ['dashboard-followups'],
    queryFn: () => apiFetch<FollowupsResponse>('/api/crm/followups?days=1&overdue=true'),
    staleTime: 60_000, refetchInterval: 300_000,
  });
  const { data: empData } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () => apiFetch<EmployeesResponse>('/api/admin/employees').catch(() => ({ success: true, data: [] })),
    staleTime: 300_000,
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const teamEntries = useMemo(() => (teamData ? Object.entries(teamData.data) : []), [teamData]);
  const dailyTargets = useMemo(
    () => targetsData ? toDailyTargetMap(targetsData.data) : (teamData?.targets ?? {}),
    [targetsData, teamData]
  );
  const monthlyTargets = useMemo(
    () => targetsData ? toMonthlyTargetMap(targetsData.data) : {},
    [targetsData]
  );
  const lbEntries = useMemo(() => lbData?.data ?? [], [lbData]);
  const teamSize = lbData?.activeHeadcount || lbEntries.length || teamEntries.length || 1;

  const metricTotals = useMemo(() => metrics.map((m) => {
    const total = teamEntries.reduce((sum, [, entry]) => sum + (entry.metrics?.[m.key] ?? 0), 0);
    const target = (dailyTargets[m.key] ?? 0) * teamSize;
    const pct = target > 0 ? Math.round((total / target) * 100) : 0;
    return { ...m, total, target, pct };
  }), [metrics, teamEntries, dailyTargets, teamSize]);

  const overallPct = useMemo(() =>
    metricTotals.length > 0
      ? Math.round(metricTotals.reduce((s, m) => s + m.pct, 0) / metricTotals.length)
      : 0,
  [metricTotals]);

  const monthlyChartData = useMemo(() => metrics.map((m) => {
    const total = lbEntries.reduce((sum, e) => sum + (e.metrics[m.key] ?? 0), 0);
    const mTarget = (monthlyTargets[m.key] ?? lbData?.monthlyTargets?.[m.key] ?? 0) * (lbEntries.length || 1);
    const pct = mTarget > 0 ? Math.min(Math.round((total / mTarget) * 100), 999) : 0;
    return { label: m.label, icon: m.icon, value: total, target: mTarget, progress: pct, color: m.color, unit: m.unit };
  }), [metrics, lbEntries, monthlyTargets, lbData]);

  const todayTop5 = useMemo(() => teamEntries
    .map(([userId, entry]) => {
      const avgScore = Math.round(
        metrics.reduce((sum, m) => {
          const v = entry.metrics?.[m.key] ?? 0;
          const t = dailyTargets[m.key] || 1;
          return sum + (v / t) * 100;
        }, 0) / metrics.length
      );
      return {
        userId,
        name: (entry as unknown as { name?: string }).name ?? entry.email ?? userId,
        avgScore,
        metrics: entry.metrics ?? {},
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 5),
  [metrics, teamEntries, dailyTargets]);

  const barData = useMemo(() => metricTotals.map((m) => ({
    name: m.key.toUpperCase(),
    actual: m.total,
    target: Math.round(m.target),
  })), [metricTotals]);

  // Derived CRM / WA / HR values
  const today = new Date().toISOString().slice(0, 10);
  const newLeadsToday = crmData?.summary?.newToday ?? 0;
  const totalLeads = crmData?.summary?.total ?? 0;
  const openWaChats = waData?.counts?.open ?? 0;
  const unassignedWa = waData?.counts?.unassigned ?? 0;
  const overdueFollowups = (followupsData?.followups ?? []).filter((f) => f.date < today).length;
  const todayFollowups = (followupsData?.followups ?? []).filter((f) => f.date === today).length;
  const funnelTop4 = (crmData?.funnel ?? []).slice(0, 4);
  const activeEmployees = (empData?.data ?? []).filter((e) =>
    ['telecaller', 'agent', 'intern', 'team_lead', 'manager'].includes(e.role)
  ).length;

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['admin-team-summary'] });
    qc.invalidateQueries({ queryKey: ['admin-leaderboard-monthly'] });
    qc.invalidateQueries({ queryKey: ['admin-targets'] });
    qc.invalidateQueries({ queryKey: ['dashboard-crm'] });
    qc.invalidateQueries({ queryKey: ['dashboard-wa'] });
    qc.invalidateQueries({ queryKey: ['dashboard-followups'] });
  }, [qc]);

  return (
    <>
      <Navbar title="Dashboard" />
      <div className="space-y-6 p-4 md:p-6">

        {/* ── Trial banners ───────────────────────────────────────────────── */}
        {trialData?.hasTrial && !trialData.isExpired && (trialData.daysLeft ?? 14) <= 7 && (
          <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm
            ${(trialData.daysLeft ?? 7) <= 2
              ? 'border-rose-800 bg-rose-950/50 text-rose-300'
              : 'border-amber-700/50 bg-amber-950/40 text-amber-300'}`}>
            <span>⏳ Trial ends in <strong>{trialData.daysLeft} day{trialData.daysLeft === 1 ? '' : 's'}</strong>.</span>
            <Link href="/admin/billing" className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500 transition">Upgrade</Link>
          </div>
        )}
        {trialData?.isExpired && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-700 bg-rose-950/60 px-4 py-3 text-sm text-rose-300">
            <span>⚠️ Trial expired. Upgrade to keep your data and access.</span>
            <Link href="/admin/billing" className="shrink-0 rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white hover:bg-rose-500 transition">Upgrade Now</Link>
          </div>
        )}

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name?.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {currentMonthLabel()} · {daysLeftInMonth()} days left
              {targetsData?.isCustom && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">Custom targets</span>
              )}
            </p>
          </div>
          <button onClick={refresh}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            🔄 Refresh
          </button>
        </div>

        {/* ── 4 Cross-domain KPIs ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="New Leads Today"    value={newLeadsToday} icon="🤝" color="indigo"  sub={`${totalLeads} total`}          href="/admin/crm" />
          <KpiCard label="Open WA Chats"      value={openWaChats}   icon="💬" color="emerald" sub={`${unassignedWa} unassigned`}    href="/admin/whatsapp" />
          <KpiCard label="Follow-ups Due"     value={overdueFollowups + todayFollowups} icon="📅"
            color={overdueFollowups > 0 ? 'rose' : 'amber'}
            sub={overdueFollowups > 0 ? `${overdueFollowups} overdue` : `${todayFollowups} today`}
            href="/admin/crm/followups" />
          <KpiCard label="Team Progress"      value={`${overallPct}%`} icon="🎯"
            color={overallPct >= 80 ? 'emerald' : overallPct >= 50 ? 'amber' : 'rose'}
            sub={`${teamEntries.length} of ${teamSize} logged`} />
        </div>

        {/* ── Sales + HR row ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* Sales Snapshot */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader title="Sales Snapshot" icon="🤝" href="/admin/crm" linkLabel="Open CRM →" />
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: 'New this week', value: crmData?.summary?.newThisWeek ?? 0, color: 'text-indigo-600' },
                { label: 'Converted MTD', value: crmData?.summary?.convertedThisMonth ?? 0, color: 'text-emerald-600' },
                { label: 'WA unassigned', value: unassignedWa, color: unassignedWa > 0 ? 'text-amber-600' : 'text-slate-400' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[11px] text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
            {funnelTop4.length > 0 ? (
              <>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pipeline</p>
                <div className="space-y-2">
                  {funnelTop4.map((stage) => {
                    const maxCount = Math.max(...(crmData?.funnel ?? []).map((s) => s.count), 1);
                    const pct = Math.round((stage.count / maxCount) * 100);
                    return (
                      <div key={stage.key} className="flex items-center gap-3">
                        <span className="w-24 truncate text-xs text-slate-500">{stage.label}</span>
                        <div className="flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" style={{ height: 6 }}>
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: stage.color }} />
                        </div>
                        <span className="w-8 text-right text-xs font-bold text-slate-700 dark:text-slate-300">{stage.count}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="py-4 text-center text-sm text-slate-400">No pipeline data yet</p>
            )}
          </div>

          {/* HR Pulse */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader title="HR Pulse" icon="👥" href="/admin/employees" linkLabel="Open Team →" />
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Active employees', value: activeEmployees, color: 'text-indigo-600' },
                { label: 'Logged today', value: teamEntries.length, color: 'text-emerald-600' },
                { label: 'Not logged', value: Math.max(0, teamSize - teamEntries.length), color: teamSize - teamEntries.length > 0 ? 'text-amber-600' : 'text-slate-400' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[11px] text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick access</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Attendance', href: '/admin/attendance', icon: '📅' },
                { label: 'Payroll', href: '/admin/compensation', icon: '💰' },
                { label: 'Verify', href: '/admin/verification', icon: '✅' },
              ].map((a) => (
                <Link key={a.href} href={a.href}
                  className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 py-3 text-center transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-900/20">
                  <span className="text-lg">{a.icon}</span>
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{a.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Performance — daily metric totals ───────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader title="Performance — Today" icon="🎯" href="/admin/analytics" linkLabel="Full analytics →" />
          {teamLoading ? <Loading /> : teamError ? (
            <p className="py-6 text-center text-sm text-rose-400">Failed to load team data</p>
          ) : teamEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center dark:border-slate-700">
              <p className="text-sm text-slate-400">No entries logged today yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {metricTotals.map((m) => {
                const badge =
                  m.pct >= 100 ? { label: 'Excellent',       cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' }
                  : m.pct >= 70 ? { label: 'On Track',        cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' }
                  : m.pct >  0  ? { label: 'Needs Attention', cls: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' }
                  :               { label: 'Not Started',      cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' };
                return (
                  <div key={m.key} className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xl">{m.icon}</span>
                      <span className={`text-xs font-bold ${m.pct >= 100 ? 'text-emerald-600' : m.pct >= 70 ? 'text-amber-600' : m.pct > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {m.pct}%
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{m.label}</p>
                    <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{formatMetricValue(m, m.total)}</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(m.pct, 100)}%`, backgroundColor: m.color, minWidth: m.pct > 0 ? '3px' : '0' }} />
                    </div>
                    <span className={`mt-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Charts + Leaderboard row ────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

          {/* Target vs Actual chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader title="Target vs Actual (Today)" icon="📊" />
            {teamLoading ? <Loading size="sm" /> : teamError ? (
              <p className="py-8 text-center text-sm text-rose-400">Failed to load</p>
            ) : barData.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [v, name === 'actual' ? 'Actual' : 'Target']} />
                  <Bar dataKey="target" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top performers */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader title="Top Performers (Today)" icon="🏆" href="/leaderboard" linkLabel="Full MTD →" />
            {teamLoading ? <Loading size="sm" /> : teamError ? (
              <p className="py-8 text-center text-sm text-rose-400">Failed to load</p>
            ) : todayTop5.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
            ) : (
              <div className="space-y-2">
                {todayTop5.map((entry, i) => (
                  <div key={entry.userId} className={`flex items-center gap-3 rounded-xl p-3 ${i === 0 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                    <span className="w-8 text-center text-lg">{MEDAL[i] ?? `#${i + 1}`}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{entry.name}</p>
                      <p className="text-xs text-slate-400">KYC: {entry.metrics.kyc ?? 0} · Demat: {entry.metrics.demat ?? 0}</p>
                    </div>
                    <span className={`text-sm font-bold ${entry.avgScore >= 100 ? 'text-emerald-600' : entry.avgScore >= 70 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {entry.avgScore}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Monthly progress ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader title="Monthly Team Progress" icon="📈" linkLabel={currentMonthLabel()} />
          {lbLoading ? <Loading size="sm" /> : lbError ? (
            <p className="py-4 text-center text-sm text-rose-400">Failed to load monthly data</p>
          ) : (
            <MonthlyTeamProgress data={monthlyChartData} teamSize={teamSize} />
          )}
        </div>

        {/* ── Quick Actions ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader title="Quick Actions" icon="⚡" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Add Lead',      icon: '🤝', href: '/admin/crm',        cls: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400' },
              { label: 'WA Broadcast',  icon: '📢', href: '/admin/whatsapp/broadcast', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400' },
              { label: 'Bulk Entry',    icon: '📋', href: '/admin/bulk-entry', cls: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400' },
              { label: 'Add Employee',  icon: '👤', href: '/admin/employees',  cls: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400' },
            ].map((a) => (
              <Link key={a.href} href={a.href}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition ${a.cls}`}>
                <span className="text-xl">{a.icon}</span>
                {a.label}
              </Link>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
