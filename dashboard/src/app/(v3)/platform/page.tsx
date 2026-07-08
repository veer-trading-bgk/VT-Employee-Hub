'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Building2, Activity, Search, ChevronRight, IndianRupee } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { api, apiFetch } from '@/lib/api';
import type { PlatformCompany } from '@/lib/api';
import { toast } from 'sonner';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AiCostsTab } from '@/components/platform/AiCostsTab';

// ── Helpers ───────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'internal' | 'paid' | 'trial' | 'expired' | 'suspended';

function getStatus(c: PlatformCompany): StatusFilter {
  if (c.plan === 'internal') return 'internal';
  if (c.planStatus === 'suspended') return 'suspended';
  if (c.plan === 'paid' || c.plan === 'enterprise') return 'paid';
  if ((c.daysLeftInTrial ?? 0) <= 0) return 'expired';
  return 'trial';
}

function statusVariant(s: StatusFilter): 'default' | 'warning' | 'primary' | 'success' | 'error' {
  const m: Record<StatusFilter, 'default' | 'warning' | 'primary' | 'success' | 'error'> = {
    all: 'default', internal: 'primary', paid: 'success', trial: 'default', expired: 'warning', suspended: 'error',
  };
  return m[s];
}

function statusLabel(c: PlatformCompany): string {
  const s = getStatus(c);
  if (s === 'trial') return `Trial · ${c.daysLeftInTrial ?? 0}d`;
  return { internal: 'Internal', paid: c.plan === 'enterprise' ? 'Enterprise' : 'Paid', expired: 'Expired', suspended: 'Suspended', all: '' }[s] ?? '';
}

function timeAgo(dateStr?: string) {
  if (!dateStr) return '—';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Tab components ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: statsData, isLoading } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => api.platformStats(),
    refetchInterval: 60_000,
  });
  const { data: companiesData } = useQuery({
    queryKey: ['platform-companies'],
    queryFn: () => api.platformCompanies(),
  });

  const stats = statsData?.stats;
  const companies = companiesData?.companies ?? [];
  const recentCompanies = [...companies]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 8);

  const needsAttention = companies.filter((c) =>
    c.plan !== 'internal' && (
      c.planStatus === 'suspended' ||
      (c.plan === 'trial' && (c.daysLeftInTrial ?? 99) <= 3 && (c.daysLeftInTrial ?? 99) >= 0)
    )
  );

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : (
          [
            { label: 'Total', value: stats?.totalCompanies ?? 0, color: 'text-neutral-900 dark:text-neutral-100' },
            { label: 'Internal', value: stats?.internal ?? 0, color: 'text-purple-600 dark:text-purple-400' },
            { label: 'Paying', value: stats?.active ?? 0, color: 'text-success-600' },
            { label: 'On Trial', value: stats?.onTrial ?? 0, color: 'text-primary-600' },
            { label: 'Expired', value: stats?.trialExpired ?? 0, color: 'text-warning-600' },
            { label: 'Suspended', value: stats?.suspended ?? 0, color: 'text-error-600' },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
              <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
            </Card>
          ))
        )}
      </div>

      {/* Needs attention */}
      {needsAttention.length > 0 && (
        <Card noPadding>
          <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <p className="text-sm font-semibold text-error-700 dark:text-error-400">Needs Attention ({needsAttention.length})</p>
          </div>
          <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
            {needsAttention.map((c) => (
              <li key={c.companyId}>
                <Link href={`/platform/companies/${c.companyId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{c.companyName}</p>
                    <p className="text-xs text-neutral-400">Last active: {timeAgo(c.createdAt)}</p>
                  </div>
                  <Badge variant={statusVariant(getStatus(c))}>{statusLabel(c)}</Badge>
                  <ChevronRight className="h-4 w-4 text-neutral-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Recent companies */}
      <Card noPadding>
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Recent Companies</p>
        </div>
        <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
          {recentCompanies.map((c) => (
            <li key={c.companyId}>
              <Link href={`/platform/companies/${c.companyId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                  <Building2 className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{c.companyName}</p>
                  <p className="text-xs text-neutral-400">Joined {timeAgo(c.createdAt)}</p>
                </div>
                <Badge variant={statusVariant(getStatus(c))}>{statusLabel(c)}</Badge>
                <ChevronRight className="h-4 w-4 text-neutral-300" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function CompaniesTab() {
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState<StatusFilter>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['platform-companies'],
    queryFn: () => api.platformCompanies(),
  });

  const companies = data?.companies ?? [];
  const filtered = companies.filter((c) => {
    if (filter !== 'all' && getStatus(c) !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.companyName?.toLowerCase().includes(q) || c.companyId?.toLowerCase().includes(q);
  });

  const FILTERS: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'internal', label: 'Internal' },
    { id: 'paid', label: 'Paid' }, { id: 'trial', label: 'Trial' },
    { id: 'expired', label: 'Expired' }, { id: 'suspended', label: 'Suspended' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company…"
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(({ id, label }) => (
            <button key={id} onClick={() => setFilter(id)}
              className={cn('rounded-full px-3 py-1 text-xs font-medium transition', filter === id ? 'bg-primary-600 text-white' : 'border border-neutral-200 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <Card noPadding>
          <ul className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
            {filtered.map((c) => (
              <li key={c.companyId}>
                <Link href={`/platform/companies/${c.companyId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                    <Building2 className="h-4 w-4 text-neutral-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{c.companyName}</p>
                    <p className="text-xs text-neutral-400">
                      Last active: {timeAgo(c.createdAt)} · Joined {timeAgo(c.createdAt)}
                    </p>
                  </div>
                  <Badge variant={statusVariant(getStatus(c))}>{statusLabel(c)}</Badge>
                  <ChevronRight className="h-4 w-4 text-neutral-300" />
                </Link>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-10 text-center text-sm text-neutral-400">No companies match</li>
            )}
          </ul>
        </Card>
      )}
      <p className="text-xs text-neutral-400">{filtered.length} of {companies.length} companies</p>
    </div>
  );
}

function HealthTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['platform-health'],
    queryFn: () => apiFetch<{ status: string; timestamp: string }>('/health'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Lambda API</p>
          <button onClick={() => refetch()} disabled={isFetching}
            className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-40">
            {isFetching ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        {isLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="flex items-center gap-3">
            <span className={cn('h-3 w-3 rounded-full animate-pulse', data?.status === 'ok' ? 'bg-success-500' : 'bg-error-500')} />
            <span className={cn('text-sm font-semibold', data?.status === 'ok' ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400')}>
              {data?.status === 'ok' ? 'Operational' : 'Degraded'}
            </span>
            <span className="text-xs text-neutral-400">
              {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'}
            </span>
          </div>
        )}
      </Card>

      <Card variant="ghost" className="py-12 text-center text-sm text-neutral-400">
        DynamoDB, CloudWatch metrics, and error rate graphs — coming soon
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PlatformTab = 'overview' | 'companies' | 'ai-costs' | 'health';

function PlatformPageInner() {
  const [tab, setTab] = useState<PlatformTab>('overview');

  const TABS: { id: PlatformTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',  label: 'Overview',  icon: <ShieldCheck className="h-4 w-4" /> },
    { id: 'companies', label: 'Companies', icon: <Building2 className="h-4 w-4" /> },
    { id: 'ai-costs',  label: 'AI Costs',  icon: <IndianRupee className="h-4 w-4" /> },
    { id: 'health',    label: 'Health',    icon: <Activity className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-center gap-3 px-6 py-4">
          <ShieldCheck className="h-5 w-5 text-primary-600" />
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Platform Control</h1>
        </div>
        <div className="flex gap-1 px-6 pb-0">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
                tab === t.id
                  ? 'border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
              )}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          {tab === 'overview'  && <OverviewTab />}
          {tab === 'companies' && <CompaniesTab />}
          {tab === 'ai-costs'  && <AiCostsTab />}
          {tab === 'health'    && <HealthTab />}
        </div>
      </div>
    </div>
  );
}

// Superadmin-only — nav already hides this from everyone else (V3Sidebar's
// roles: ['owner']), but that was nav-hiding only, not real route
// enforcement (found during the Phase 2A audit, 2026-07-06). allowedRoles=[]
// is correct here, not ['superadmin']: ProtectedRoute already bypasses its
// own check unconditionally for superadmin, so an empty list is exactly
// "nobody else gets in."
export default function PlatformPage() {
  return (
    <ProtectedRoute allowedRoles={[]}>
      <PlatformPageInner />
    </ProtectedRoute>
  );
}
