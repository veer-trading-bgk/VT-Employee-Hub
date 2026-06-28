'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { PlatformCompany } from '@/lib/api';
import { Navbar } from '@/components/layout/Navbar';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ── Icons ─────────────────────────────────────────────────────────────────────
function BuildingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
    </svg>
  );
}
function TrendUpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function planBadge(company: PlatformCompany) {
  const status = company.planStatus;
  const plan   = company.plan;
  if (plan === 'internal') return { label: 'Internal', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-800' };
  if (status === 'suspended') return { label: 'Suspended', cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-800' };
  if (plan === 'paid' || plan === 'enterprise') return { label: plan === 'enterprise' ? 'Enterprise' : 'Paid', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800' };
  const daysLeft = company.daysLeftInTrial ?? 0;
  if (daysLeft <= 0) return { label: 'Expired', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800' };
  return { label: `Trial · ${daysLeft}d`, cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-800' };
}

function timeAgo(dateStr?: string) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color, sub }: {
  label: string; value: number | string; icon: React.ReactNode;
  color: string; sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
        </div>
        <div className={`rounded-xl p-2.5 ${color.replace('text-', 'bg-').replace('-600', '-50').replace('-400', '-950/40')} ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PlatformPage() {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => api.platformStats(),
    refetchInterval: 60_000,
  });

  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['platform-companies'],
    queryFn: () => api.platformCompanies(),
  });

  const stats = statsData?.stats;
  const companies = companiesData?.companies ?? [];

  const recentCompanies = [...companies]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 8);

  const chartData = [
    { name: 'Internal', value: stats?.internal ?? 0, fill: '#8b5cf6' },
    { name: 'Paid', value: stats?.active ?? 0, fill: '#10b981' },
    { name: 'Trial', value: stats?.onTrial ?? 0, fill: '#38bdf8' },
    { name: 'Expired', value: stats?.trialExpired ?? 0, fill: '#f59e0b' },
    { name: 'Suspended', value: stats?.suspended ?? 0, fill: '#f43f5e' },
  ].filter((d) => d.value > 0 || d.name !== 'Internal');

  const needsAttention = companies.filter(
    (c) => c.plan !== 'internal' && (
      c.planStatus === 'suspended' || (c.plan === 'trial' && (c.daysLeftInTrial ?? 99) <= 3 && (c.daysLeftInTrial ?? 99) >= 0)
    )
  );

  return (
    <>
      <Navbar title="APForce Control Center" />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">

          {/* Header */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Platform Overview</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {statsData?.generatedAt ? `Updated ${new Date(statsData.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : 'Loading...'}
              </p>
            </div>
            <Link
              href="/platform/companies"
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
            >
              View All Companies <ArrowRightIcon />
            </Link>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            {statsLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
              ))
            ) : (
              <>
                <KpiCard label="Total Companies" value={stats?.totalCompanies ?? 0} icon={<BuildingIcon />} color="text-slate-700 dark:text-slate-200" />
                <KpiCard label="Internal" value={stats?.internal ?? 0} icon={<BuildingIcon />} color="text-violet-600 dark:text-violet-400" sub="Owner-owned" />
                <KpiCard label="Paying Clients" value={stats?.active ?? 0} icon={<TrendUpIcon />} color="text-emerald-600 dark:text-emerald-400" sub="Paid / Enterprise" />
                <KpiCard label="On Trial" value={stats?.onTrial ?? 0} icon={<BuildingIcon />} color="text-sky-600 dark:text-sky-400" sub="Active trials" />
                <KpiCard label="Trial Expired" value={stats?.trialExpired ?? 0} icon={<AlertIcon />} color="text-amber-600 dark:text-amber-400" sub="Convert opportunity" />
                <KpiCard label="Suspended" value={stats?.suspended ?? 0} icon={<PauseIcon />} color="text-rose-600 dark:text-rose-400" sub="Needs action" />
              </>
            )}
          </div>

          {/* Chart + Attention Panel */}
          <div className="grid gap-6 lg:grid-cols-3">

            {/* Bar Chart */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Company Distribution</h2>
              {statsLoading ? (
                <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} barSize={40}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 13 }}
                      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Needs Attention */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Needs Attention</h2>
              {companiesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
                </div>
              ) : needsAttention.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                  <span className="text-2xl">✅</span>
                  <p className="text-xs text-slate-400">All companies are healthy</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {needsAttention.map((c) => {
                    const badge = planBadge(c);
                    return (
                      <Link key={c.companyId} href={`/platform/companies/${c.companyId}`}
                        className="flex items-center justify-between rounded-lg border border-slate-100 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 transition">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800 dark:text-white">{c.companyName}</p>
                          <p className="text-[10px] text-slate-400">{c.adminEmail}</p>
                        </div>
                        <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent Signups */}
          <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Recent Signups</h2>
              <Link href="/platform/companies" className="text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400">
                View all →
              </Link>
            </div>
            {companiesLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-800">
                {recentCompanies.map((c) => {
                  const badge = planBadge(c);
                  return (
                    <Link key={c.companyId} href={`/platform/companies/${c.companyId}`}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-lg font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                        {c.companyName?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{c.companyName}</p>
                        <p className="text-xs text-slate-400">{c.broker} · {c.city}</p>
                      </div>
                      <span className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-block ${badge.cls}`}>{badge.label}</span>
                      <span className="shrink-0 text-xs text-slate-400">{timeAgo(c.createdAt)}</span>
                      <ArrowRightIcon />
                    </Link>
                  );
                })}
                {recentCompanies.length === 0 && (
                  <p className="p-8 text-center text-sm text-slate-400">No companies yet</p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
