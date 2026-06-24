'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { PlatformCompany } from '@/lib/api';
import { Navbar } from '@/components/layout/Navbar';

// ── Icons ─────────────────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
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
function ChevronUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
type StatusFilter = 'all' | 'internal' | 'paid' | 'trial' | 'expired' | 'suspended';
type SortKey = 'companyName' | 'createdAt' | 'daysLeftInTrial' | 'planStatus';

function getStatusFilter(c: PlatformCompany): StatusFilter {
  if (c.plan === 'internal') return 'internal';
  if (c.planStatus === 'suspended') return 'suspended';
  if (c.plan === 'paid' || c.plan === 'enterprise') return 'paid';
  if ((c.daysLeftInTrial ?? 0) <= 0) return 'expired';
  return 'trial';
}

function PlanBadge({ company }: { company: PlatformCompany }) {
  const f = getStatusFilter(company);
  const map: Record<StatusFilter, string> = {
    all:       '',
    internal:  'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-800',
    paid:      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800',
    trial:     'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-800',
    expired:   'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800',
    suspended: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-800',
  };
  const labels: Record<StatusFilter, string> = {
    all: '', internal: '🏠 Internal',
    paid: company.plan === 'enterprise' ? 'Enterprise' : 'Paid',
    trial: `Trial · ${company.daysLeftInTrial ?? 0}d left`,
    expired: 'Trial Expired', suspended: 'Suspended',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[f]}`}>
      {labels[f]}
    </span>
  );
}

const TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'All'       },
  { key: 'internal',  label: 'Internal'  },
  { key: 'paid',      label: 'Paid'      },
  { key: 'trial',     label: 'On Trial'  },
  { key: 'expired',   label: 'Expired'   },
  { key: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 20;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PlatformCompaniesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['platform-companies'],
    queryFn: () => api.platformCompanies(),
  });

  const companies = data?.companies ?? [];

  const tabCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: companies.length, internal: 0, paid: 0, trial: 0, expired: 0, suspended: 0 };
    companies.forEach((c) => { counts[getStatusFilter(c)]++; });
    return counts;
  }, [companies]);

  const filtered = useMemo(() => {
    let list = companies;
    if (status !== 'all') list = list.filter((c) => getStatusFilter(c) === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.companyName?.toLowerCase().includes(q) ||
        c.adminEmail?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.broker?.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortKey === 'companyName') { av = a.companyName ?? ''; bv = b.companyName ?? ''; }
      if (sortKey === 'createdAt')   { av = a.createdAt ?? ''; bv = b.createdAt ?? ''; }
      if (sortKey === 'daysLeftInTrial') { av = a.daysLeftInTrial ?? -1; bv = b.daysLeftInTrial ?? -1; }
      if (sortKey === 'planStatus')  { av = a.planStatus ?? ''; bv = b.planStatus ?? ''; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [companies, status, search, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
    setPage(1);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 opacity-30"><ChevronDownIcon /></span>;
    return <span className="ml-1 text-rose-500">{sortAsc ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>;
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-rose-500 dark:focus:ring-rose-900/30';

  return (
    <>
      <Navbar title="Companies" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">

          {/* Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                All Companies
                <span className="ml-2 rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {companies.length}
                </span>
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Every AP office / tenant on APForce</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              className={`${inputCls} pl-9`}
              placeholder="Search by company name, email, city, broker…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          {/* Status Tabs */}
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => { setStatus(t.key); setPage(1); }}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  status === t.key
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  status === t.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                }`}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {isLoading ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
              </div>
            ) : isError ? (
              <p className="py-10 text-center text-sm text-rose-400">Failed to load companies</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14">
                <span className="text-4xl">🏢</span>
                <p className="text-sm text-slate-400">No companies match your filters</p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
                        <th className="px-5 py-3.5">
                          <button className="flex items-center" onClick={() => toggleSort('companyName')}>
                            Company <SortIcon col="companyName" />
                          </button>
                        </th>
                        <th className="px-4 py-3.5">Broker / City</th>
                        <th className="px-4 py-3.5">Admin Email</th>
                        <th className="px-4 py-3.5">
                          <button className="flex items-center" onClick={() => toggleSort('planStatus')}>
                            Plan <SortIcon col="planStatus" />
                          </button>
                        </th>
                        <th className="px-4 py-3.5">
                          <button className="flex items-center" onClick={() => toggleSort('createdAt')}>
                            Joined <SortIcon col="createdAt" />
                          </button>
                        </th>
                        <th className="px-4 py-3.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {paged.map((c) => (
                        <tr key={c.companyId} className="group transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-sm font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                                {c.companyName?.[0]?.toUpperCase() ?? '?'}
                              </div>
                              <span className="font-semibold text-slate-800 dark:text-white">{c.companyName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">
                            {c.broker ?? '—'} {c.city ? `· ${c.city}` : ''}
                          </td>
                          <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">{c.adminEmail ?? '—'}</td>
                          <td className="px-4 py-3.5"><PlanBadge company={c} /></td>
                          <td className="px-4 py-3.5 text-slate-400 dark:text-slate-500">
                            {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                          </td>
                          <td className="px-4 py-3.5">
                            <Link
                              href={`/platform/companies/${c.companyId}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 opacity-0 transition hover:border-rose-300 hover:text-rose-600 group-hover:opacity-100 dark:border-slate-700 dark:text-slate-300 dark:hover:border-rose-700 dark:hover:text-rose-400"
                            >
                              View <ArrowRightIcon />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="divide-y divide-slate-50 dark:divide-slate-800 md:hidden">
                  {paged.map((c) => (
                    <Link key={c.companyId} href={`/platform/companies/${c.companyId}`}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-base font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                        {c.companyName?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-800 dark:text-white">{c.companyName}</p>
                        <p className="truncate text-xs text-slate-400">{c.adminEmail}</p>
                      </div>
                      <PlanBadge company={c} />
                    </Link>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 dark:border-slate-800">
                    <p className="text-xs text-slate-400">
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                    </p>
                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`h-7 w-7 rounded-md text-xs font-medium transition ${
                            p === page ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
