'use client';

import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { api } from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  internal:  '#8b5cf6',
  paid:      '#10b981',
  trial:     '#38bdf8',
  expired:   '#f59e0b',
  suspended: '#f43f5e',
};

function getStatus(c: { plan: string; planStatus: string; daysLeftInTrial?: number | null }) {
  if (c.plan === 'internal') return 'internal';
  if (c.planStatus === 'suspended') return 'suspended';
  if (c.plan === 'paid' || c.plan === 'enterprise') return 'paid';
  if ((c.daysLeftInTrial ?? 0) <= 0) return 'expired';
  return 'trial';
}

function MetricTile({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PlatformAnalyticsPage() {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => api.platformStats(),
    refetchInterval: 60_000,
  });

  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['platform-companies'],
    queryFn: () => api.platformCompanies(),
  });

  const stats     = statsData?.stats;
  const companies = companiesData?.companies ?? [];

  // Growth: signups by month
  const signupsByMonth: Record<string, number> = {};
  companies.forEach((c) => {
    if (!c.createdAt) return;
    const month = c.createdAt.slice(0, 7); // YYYY-MM
    signupsByMonth[month] = (signupsByMonth[month] ?? 0) + 1;
  });
  const growthChart = Object.entries(signupsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, count]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      signups: count,
    }));

  // Status breakdown for pie
  const statusCounts: Record<string, number> = { internal: 0, paid: 0, trial: 0, expired: 0, suspended: 0 };
  companies.forEach((c) => { statusCounts[getStatus(c)]++; });
  const pieData = Object.entries(statusCounts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value, fill: STATUS_COLORS[name] }));

  // Broker breakdown
  const byBroker: Record<string, number> = {};
  companies.forEach((c) => { const b = c.broker || 'Unknown'; byBroker[b] = (byBroker[b] ?? 0) + 1; });
  const brokerChart = Object.entries(byBroker)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // City breakdown
  const byCity: Record<string, number> = {};
  companies.forEach((c) => { const city = c.city || 'Unknown'; byCity[city] = (byCity[city] ?? 0) + 1; });
  const cityChart = Object.entries(byCity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Trial conversion rate
  const totalEverTrial = companies.filter((c) => c.plan === 'trial' || c.plan === 'paid').length;
  const converted      = stats?.active ?? 0;
  const conversionRate = totalEverTrial > 0 ? Math.round((converted / totalEverTrial) * 100) : 0;

  // Trials expiring in next 7 days
  const expiringSoon = companies.filter((c) => {
    if (c.plan === 'internal' || c.plan !== 'trial' || c.planStatus !== 'active') return false;
    return (c.daysLeftInTrial ?? 99) <= 7 && (c.daysLeftInTrial ?? 99) >= 0;
  });

  const loading = statsLoading || companiesLoading;

  return (
    <>
      <Navbar title="Platform Analytics" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">

          {/* Header */}
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Platform Analytics</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Cross-company growth, health and conversion insights</p>
          </div>

          {/* KPI tiles */}
          {loading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile label="Total Tenants"      value={stats?.totalCompanies ?? 0} color="text-slate-800 dark:text-white"             sub="All time" />
              <MetricTile label="Paying Clients"     value={stats?.active ?? 0}         color="text-emerald-600 dark:text-emerald-400"      sub="Paid / Enterprise" />
              <MetricTile label="Trial Conversion"   value={`${conversionRate}%`}       color="text-indigo-600 dark:text-indigo-400"        sub="Trial → Paid" />
              <MetricTile label="Expiring This Week" value={expiringSoon.length}         color="text-amber-600 dark:text-amber-400"          sub="Needs follow-up" />
            </div>
          )}

          {/* Growth + Pie */}
          <div className="grid gap-6 lg:grid-cols-3">

            {/* Monthly Signups */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Monthly Signups</h2>
              {loading ? (
                <div className="h-52 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
              ) : growthChart.length === 0 ? (
                <div className="flex h-52 items-center justify-center text-sm text-slate-400">No signup data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={growthChart} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,.1)', fontSize: 13 }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="signups" fill="#f43f5e" radius={[6, 6, 0, 0]} name="Signups" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Status Pie */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Account Status Mix</h2>
              {loading ? (
                <div className="h-52 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', fontSize: 13 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Broker + City breakdown */}
          <div className="grid gap-6 lg:grid-cols-2">

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Top Brokers</h2>
              {loading ? (
                <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={brokerChart} layout="vertical" barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={90} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', fontSize: 13 }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="Companies" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Top Cities</h2>
              {loading ? (
                <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={cityChart} layout="vertical" barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={80} />
                    <Tooltip contentStyle={{ borderRadius: 10, border: 'none', fontSize: 13 }} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                    <Bar dataKey="count" fill="#0ea5e9" radius={[0, 4, 4, 0]} name="Companies" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Expiring Soon table */}
          {expiringSoon.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-white dark:border-amber-800/40 dark:bg-slate-900">
              <div className="border-b border-amber-100 px-5 py-4 dark:border-amber-800/30">
                <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  ⚠️ Trials Expiring This Week ({expiringSoon.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Follow up to convert these to paid plans</p>
              </div>
              <div className="divide-y divide-slate-50 dark:divide-slate-800">
                {expiringSoon.map((c) => (
                  <div key={c.companyId} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{c.companyName}</p>
                      <p className="text-xs text-slate-400">{c.adminEmail} · {c.broker} · {c.city}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800">
                      {c.daysLeftInTrial === 0 ? 'Expires today' : `${c.daysLeftInTrial}d left`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Future roadmap */}
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-400">Coming Soon</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: '📞', label: 'Cross-company lead volume' },
                { icon: '💬', label: 'WhatsApp message volume' },
                { icon: '💰', label: 'MRR & ARR tracking' },
                { icon: '📉', label: 'Churn risk scoring' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
