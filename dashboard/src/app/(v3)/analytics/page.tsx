'use client';

import { useState } from 'react';
import {
  MessageSquare,
  Users,
  TrendingUp,
  CheckCircle2,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
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
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/v3/ui/Card';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';

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
  icon,
  label,
  value,
  change,
  loading,
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
      newContacts: number;
      newContactsChange: number;
      messages: number;
      messagesChange: number;
      followupsDone: number;
      followupsDoneChange: number;
      leadsConverted: number;
      leadsConvertedChange: number;
    };
    trend: { date: string; contacts: number; messages: number }[];
    leaderboard: { id: string; name: string; count: number }[];
  }

  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['analytics-overview', dateRange],
    queryFn: async () => {
      const res = await apiFetch(`/api/analytics/overview?range=${dateRange}`) as Response;
      return res.json() as Promise<OverviewData>;
    },
    staleTime: 300_000,
    placeholderData: {
      kpis: { newContacts: 0, newContactsChange: 0, messages: 0, messagesChange: 0, followupsDone: 0, followupsDoneChange: 0, leadsConverted: 0, leadsConvertedChange: 0 },
      trend: [],
      leaderboard: [],
    },
  });

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={<Users className="h-5 w-5" />}       label="New contacts"      value={data?.kpis.newContacts ?? 0}     change={data?.kpis.newContactsChange}    loading={isLoading} />
        <KpiCard icon={<MessageSquare className="h-5 w-5" />} label="Messages sent"    value={data?.kpis.messages ?? 0}        change={data?.kpis.messagesChange}       loading={isLoading} />
        <KpiCard icon={<CheckCircle2 className="h-5 w-5" />} label="Follow-ups done"  value={data?.kpis.followupsDone ?? 0}   change={data?.kpis.followupsDoneChange}  loading={isLoading} />
        <KpiCard icon={<TrendingUp className="h-5 w-5" />}   label="Leads converted"  value={data?.kpis.leadsConverted ?? 0}  change={data?.kpis.leadsConvertedChange} loading={isLoading} />
      </div>

      {/* Trend chart */}
      <Card noPadding>
        <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Activity over time
          </h3>
        </div>
        <div className="p-4">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
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

      {/* Leaderboard */}
      {(data?.leaderboard ?? []).length > 0 && (
        <Card noPadding>
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Team leaderboard</h3>
          </div>
          <ul>
            {(data?.leaderboard ?? []).map((person, i) => (
              <li
                key={person.id}
                className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800/50"
              >
                <span className="w-5 text-center text-sm font-bold text-neutral-400">
                  {i + 1}
                </span>
                <Avatar name={person.name} size={32} />
                <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {person.name}
                </span>
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
    queryFn: async () => {
      const res = await apiFetch(`/api/analytics/pipeline?range=${dateRange}`) as Response;
      return res.json() as Promise<PipelineData>;
    },
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
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data?.stages ?? []} dataKey="count" nameKey="stage" cx="50%" cy="50%" outerRadius={80}>
                    {(data?.stages ?? []).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
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
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
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

// ── Stub tabs ─────────────────────────────────────────────────────────────────

function StubTab({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center text-neutral-400 text-sm">
      {label} analytics — coming soon
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [dateRange, setDateRange] = useState<DateRange>('30d');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
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

      {/* Sub-tabs */}
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

      {/* Content */}
      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {activeTab === 'overview'      && <OverviewTab dateRange={dateRange} />}
        {activeTab === 'pipeline'      && <PipelineTab dateRange={dateRange} />}
        {activeTab === 'conversations' && <StubTab label="Conversations" />}
        {activeTab === 'team'          && <StubTab label="Team" />}
        {activeTab === 'sources'       && <StubTab label="Sources" />}
      </div>
    </div>
  );
}
