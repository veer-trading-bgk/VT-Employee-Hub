'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch } from '@/lib/api';

interface FunnelStage { key: string; label: string; color: string; count: number; conversionRate: number | null; }
interface SourceEntry { source: string; count: number; }
interface TrendEntry { date: string; count: number; }
interface Analytics {
  summary: { total: number; newToday: number; newThisWeek: number; convertedThisMonth: number; };
  funnel: FunnelStage[];
  bySource: SourceEntry[];
  avgDaysPerStage: Record<string, number>;
  trend: TrendEntry[];
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', import: 'CSV Import', whatsapp: 'WhatsApp',
  web_form: 'Web Form', meta_lead_ads: 'Meta Ads', referral: 'Referral',
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function CrmAnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-analytics'],
    queryFn: () => apiFetch<{ success: boolean } & Analytics>('/api/crm/crm-analytics'),
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading) return <><Navbar title="CRM Analytics" showBack /><div className="flex justify-center py-20"><Loading /></div></>;

  const { summary, funnel, bySource, avgDaysPerStage, trend } = data ?? {
    summary: { total: 0, newToday: 0, newThisWeek: 0, convertedThisMonth: 0 },
    funnel: [], bySource: [], avgDaysPerStage: {}, trend: [],
  };

  const maxCount = Math.max(...(funnel.map((s) => s.count)), 1);

  return (
    <>
      <Navbar title="CRM Analytics" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-5xl p-4 pb-10 space-y-5">

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total Leads" value={summary.total} />
            <StatCard label="New Today" value={summary.newToday} />
            <StatCard label="New This Week" value={summary.newThisWeek} />
            <StatCard label="Converted This Month" value={summary.convertedThisMonth} />
          </div>

          {/* Pipeline Funnel */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Pipeline Funnel</h2>
            {funnel.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No leads data yet</p>
            ) : (
              <div className="space-y-3">
                {funnel.map((stage) => {
                  const pct = Math.round((stage.count / maxCount) * 100);
                  const avgDays = avgDaysPerStage[stage.key];
                  return (
                    <div key={stage.key}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                          <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{stage.label}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {avgDays !== undefined && (
                            <span className="text-xs text-slate-400">avg {avgDays}d</span>
                          )}
                          {stage.conversionRate !== null && (
                            <span className={`text-xs font-semibold ${stage.conversionRate >= 50 ? 'text-emerald-600' : stage.conversionRate >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
                              {stage.conversionRate}% conv.
                            </span>
                          )}
                          <span className="w-10 text-right text-sm font-bold text-slate-900 dark:text-white">{stage.count}</span>
                        </div>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: stage.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Trend chart */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Leads Created (Last 30 Days)</h2>
              {trend.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                    <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="Leads" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Source breakdown */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Leads by Source</h2>
              {bySource.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No data</p>
              ) : (
                <div className="space-y-2.5">
                  {bySource.map((s) => {
                    const total = bySource.reduce((a, b) => a + b.count, 0);
                    const pct = Math.round((s.count / total) * 100);
                    return (
                      <div key={s.source}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-300">{SOURCE_LABELS[s.source] ?? s.source}</span>
                          <span className="text-slate-400">{s.count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bar chart: leads per stage */}
          {funnel.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Leads per Stage</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={funnel} barSize={28}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Leads" radius={[6, 6, 0, 0]}>
                    {funnel.map((s) => <Cell key={s.key} fill={s.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Avg days per stage */}
          {Object.keys(avgDaysPerStage).length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Average Days per Stage</h2>
              <p className="mb-3 text-xs text-slate-400">Based on stage change history. Older leads without history are excluded.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {funnel.filter((s) => avgDaysPerStage[s.key] !== undefined).map((s) => (
                  <div key={s.key} className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                      <p className="truncate text-xs text-slate-500">{s.label}</p>
                    </div>
                    <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{avgDaysPerStage[s.key]}<span className="ml-1 text-xs font-normal text-slate-400">days</span></p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
