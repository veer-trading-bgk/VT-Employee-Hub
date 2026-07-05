'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  Clock,
  Users,
  CheckCircle2,
  Circle,
  AlertCircle,
  ChevronRight,
  ArrowUpRight,
  Flame,
  Target,
  Phone,
  ClipboardCheck,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Button } from '@/components/v3/ui/Button';
import { SkeletonCard, SkeletonRow, SkeletonTable } from '@/components/v3/ui/Skeleton';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { ProgressBarChart, type ProgressRow } from '@/components/charts/ProgressBarChart';
import { cn } from '@/lib/cn';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toV3Role, type Contact } from '@/types/v3';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { format, isToday, isTomorrow, isPast } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UrgentReply {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  lastMessage: string;
  waitingMinutes: number;
}

interface OverdueFollowup {
  id: string;
  contactId: string;
  contactName: string;
  type: string;
  dueAt: string;
  assignedToName?: string;
}

interface Followup {
  id: string;
  contactId: string;
  contactName: string;
  type: string;
  notes?: string;
  dueAt: string;
}

interface RecentContact {
  id: string;
  name: string;
  phone: string;
  // Company pipeline stage key — display-only here, so a plain string is
  // enough; a customized pipeline's keys aren't in the closed Stage union.
  stage: string;
  updatedAt: string;
}

interface KpiData {
  followupsDone: number;
  newContacts: number;
}

interface MyWorkData {
  urgentReplies: UrgentReply[];
  overdueFollowups: OverdueFollowup[];
  todayFollowups: Followup[];
  recentContacts: RecentContact[];
  kpis: KpiData;
  isNewEmployee: boolean;
  gettingStartedProgress: string[];
}

// ── Getting Started Checklist (new employees) ──────────────────────────────────

const CHECKLIST_ITEMS = [
  { id: 'contact',    label: 'Add your first contact',         href: '/contacts'             },
  { id: 'followup',   label: 'Schedule a follow-up',           href: '/sales/followups'       },
];

function GettingStartedChecklist({ completed }: { completed: string[] }) {
  const done = completed.length;
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((done / total) * 100);

  return (
    <Card className="border-primary-200 bg-primary-50 dark:border-primary-900/30 dark:bg-primary-900/10">
      <CardHeader>
        <div>
          <CardTitle className="text-primary-800 dark:text-primary-200">Get started with APForce</CardTitle>
          <p className="text-xs text-primary-600 mt-0.5">{done} of {total} steps done</p>
        </div>
        <span className="text-2xl font-bold text-primary-700">{pct}%</span>
      </CardHeader>
      <div className="mt-3 h-1.5 rounded-full bg-primary-200 dark:bg-primary-900">
        <div
          className="h-1.5 rounded-full bg-primary-600 transition-all duration-500"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <ul className="mt-4 space-y-2" role="list">
        {CHECKLIST_ITEMS.map((item) => {
          const done = completed.includes(item.id);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 text-sm transition-colors',
                  done
                    ? 'text-neutral-400 line-through'
                    : 'text-primary-700 hover:text-primary-800 dark:text-primary-300',
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-primary-400" aria-hidden />
                )}
                {item.label}
                {!done && <ChevronRight className="ml-auto h-4 w-4" aria-hidden />}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── Section 1: Urgent Replies ─────────────────────────────────────────────────

function UrgentRepliesSection({ items, loading }: { items: UrgentReply[]; loading: boolean }) {
  return (
    <Card noPadding>
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-error-600" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Urgent replies
            </h2>
            {items.length > 0 && (
              <Badge variant="error">{items.length}</Badge>
            )}
          </div>
          <Link
            href="/communications"
            className="text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            View all
          </Link>
        </div>
      </div>

      {loading ? (
        <div>{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No urgent replies"
          description="You're all caught up"
          className="py-8"
        />
      ) : (
        <ul role="list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <Link
                href={`/communications?contactId=${item.contactId}`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors border-b border-neutral-100 dark:border-neutral-800/50 last:border-0"
              >
                <Avatar name={item.contactName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {item.contactName}
                    </p>
                    <Badge variant="error" className="shrink-0 text-[10px]">
                      {item.waitingMinutes >= 60
                        ? `${Math.floor(item.waitingMinutes / 60)}h`
                        : `${item.waitingMinutes}m`}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">{item.lastMessage}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Section 2: Overdue Follow-ups ─────────────────────────────────────────────

function OverdueFollowupsSection({ items, loading }: { items: OverdueFollowup[]; loading: boolean }) {
  return (
    <Card noPadding>
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-warning-600" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Overdue follow-ups
            </h2>
            {items.length > 0 && (
              <Badge variant="warning">{items.length}</Badge>
            )}
          </div>
          <Link
            href="/sales/followups"
            className="text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            View all
          </Link>
        </div>
      </div>

      {loading ? (
        <div>{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No overdue follow-ups"
          description="You're on top of your schedule"
          className="py-8"
        />
      ) : (
        <ul role="list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <Link
                href={`/contacts/${item.contactId}?tab=followups`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors border-b border-neutral-100 dark:border-neutral-800/50 last:border-0"
              >
                <Avatar name={item.contactName} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {item.contactName}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="text-xs text-neutral-500 capitalize">{item.type}</p>
                    <span className="text-neutral-300">·</span>
                    <p className="text-xs text-error-600 font-medium">
                      Due {format(new Date(item.dueAt), 'd MMM')}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Section 3: Today's Follow-ups ─────────────────────────────────────────────

function TodaysFollowupsSection({ items, loading }: { items: Followup[]; loading: boolean }) {
  return (
    <Card noPadding>
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-neutral-500" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Today&apos;s follow-ups
            </h2>
          </div>
          <Link
            href="/sales/followups"
            className="text-xs font-medium text-primary-600 hover:text-primary-700"
          >
            View all
          </Link>
        </div>
      </div>

      {loading ? (
        <div>{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nothing scheduled today"
          description="Add a follow-up to get started"
          className="py-8"
        />
      ) : (
        <ul role="list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              <Link
                href={`/contacts/${item.contactId}?tab=followups`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors border-b border-neutral-100 dark:border-neutral-800/50 last:border-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-50 dark:bg-warning-900/20">
                  <Phone className="h-4 w-4 text-warning-600" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {item.contactName}
                  </p>
                  <p className="text-xs text-neutral-500 capitalize">
                    {item.type} · {format(new Date(item.dueAt), 'h:mm a')}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Section 4: Recent Contacts ────────────────────────────────────────────────

function RecentContactsSection({ items, loading }: { items: RecentContact[]; loading: boolean }) {
  const { stages: pipelineStages } = usePipelineStages();
  return (
    <Card noPadding>
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-neutral-500" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Recently active
            </h2>
          </div>
          <Link href="/contacts" className="text-xs font-medium text-primary-600 hover:text-primary-700">
            All contacts
          </Link>
        </div>
      </div>

      {loading ? (
        <div>{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Import contacts or add your first one"
          action={{ label: 'Add contact', onClick: () => {} }}
          className="py-8"
        />
      ) : (
        <ul role="list">
          {items.slice(0, 5).map((item) => {
            const stageObj = pipelineStages.find((s) => s.key === item.stage);
            return (
              <li key={item.id}>
                <Link
                  href={`/contacts/${item.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors border-b border-neutral-100 dark:border-neutral-800/50 last:border-0"
                >
                  <Avatar name={item.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {item.name}
                    </p>
                    <p className="text-xs text-neutral-500">{item.phone}</p>
                  </div>
                  <Badge variant="stage" stage={item.stage} color={stageObj?.color}>
                    {stageObj?.label ?? item.stage}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── AI Insights: Lead Priority Distribution ───────────────────────────────────
// Surfaces LeadScoringScheduler's persisted priorityTier (recomputed on a
// ~60min cycle) as a hot/warm/cold share of the pipeline — same field CrmTab
// and sales/page.tsx already render per-contact via PriorityBadge, just
// aggregated here for the first time.

const PRIORITY_META: Record<'hot' | 'warm' | 'cold', { label: string; icon: string; color: string }> = {
  hot:  { label: 'Hot leads',  icon: '🔥', color: '#DC2626' },
  warm: { label: 'Warm leads', icon: '🌤️', color: '#D97706' },
  cold: { label: 'Cold leads', icon: '❄️', color: '#94A3B8' },
};

function LeadPriorityWidget({ contacts, loading }: { contacts: Contact[]; loading: boolean }) {
  const total = contacts.length;
  const rows: ProgressRow[] = (['hot', 'warm', 'cold'] as const).map((tier) => {
    const value = contacts.filter((c) => c.priorityTier === tier).length;
    return {
      label: PRIORITY_META[tier].label,
      icon: PRIORITY_META[tier].icon,
      value,
      target: total,
      progress: total > 0 ? Math.round((value / total) * 100) : 0,
      color: PRIORITY_META[tier].color,
      unit: 'count',
    };
  });

  return (
    <Card noPadding>
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-error-600" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Lead priority
            </h2>
          </div>
          <Link href="/sales" className="text-xs font-medium text-primary-600 hover:text-primary-700">
            View pipeline
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="p-4">{[0, 1, 2].map((i) => <SkeletonRow key={i} />)}</div>
      ) : total === 0 ? (
        <EmptyState
          icon={Users}
          title="No scored leads yet"
          description="Priority scores are recomputed on a ~60 minute cycle"
          className="py-8"
        />
      ) : (
        <div className="p-4">
          <ProgressBarChart data={rows} showStatusBadge={false} />
        </div>
      )}
    </Card>
  );
}

// ── AI Insights: Approvals Pending ────────────────────────────────────────────
// Same /api/approvals?status=pending query V3Sidebar.tsx already runs for its
// nav badge — reusing the identical query key shares the cache rather than
// firing a second request for the same count.

function ApprovalsPendingWidget({ count, loading }: { count: number; loading: boolean }) {
  return (
    <Card noPadding>
      <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary-600" aria-hidden />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Approvals pending
            </h2>
          </div>
          <Link href="/approvals" className="text-xs font-medium text-primary-600 hover:text-primary-700">
            Review
          </Link>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <SkeletonRow />
        ) : count === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Nothing waiting"
            description="No AI-drafted actions need review right now"
            className="py-4"
          />
        ) : (
          <Link href="/approvals" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <span className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">{count}</span>
            <span className="text-sm text-neutral-500">
              {count === 1 ? 'item needs' : 'items need'} your review
            </span>
          </Link>
        )}
      </div>
    </Card>
  );
}

// ── Section 5: KPIs ───────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  href?: string;
}

function KpiCard({ label, value, icon, href }: KpiCardProps) {
  const content = (
    <Card variant={href ? 'interactive' : 'default'} className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
        <span className="text-primary-600">{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
        <p className="text-xs text-neutral-500">{label}</p>
      </div>
      {href && <ArrowUpRight className="ml-auto h-4 w-4 text-neutral-400" aria-hidden />}
    </Card>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MyWorkPage() {
  const { user } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const today = format(new Date(), 'EEEE, d MMMM');

  const { data, isLoading } = useQuery<MyWorkData>({
    queryKey: ['my-work', user?.id],
    queryFn: async () => {
      return apiFetch<MyWorkData>('/api/crm/my-work');
    },
    staleTime: 60_000,
    // Return empty defaults so the page renders immediately
    placeholderData: {
      urgentReplies: [],
      overdueFollowups: [],
      todayFollowups: [],
      recentContacts: [],
      kpis: { followupsDone: 0, newContacts: 0 },
      isNewEmployee: false,
      gettingStartedProgress: [],
    },
  });

  const isNew = data?.isNewEmployee ?? false;

  // AI Insights — each widget owns its own small query rather than the
  // (non-existent) /api/v3/my-work blob above; see docs/bible/19_DECISION_LOG.md
  // Era 11 for why this is additive, not a /api/v3/my-work fix.
  const { data: priorityContacts, isLoading: priorityLoading } = useQuery<Contact[]>({
    // Shared cache key with sales/page.tsx's identical /api/contacts?pageSize=500
    // fetch — same data, avoids a duplicate round trip when navigating between
    // /home and /sales within the staleTime window.
    queryKey: ['sales-contacts'],
    queryFn: async () => {
      const res = await apiFetch<{ contacts: Contact[] }>('/api/contacts?pageSize=500');
      return res.contacts ?? [];
    },
    staleTime: 30_000,
  });

  const { data: approvalsData, isLoading: approvalsLoading } = useQuery({
    // Shared cache key with V3Sidebar.tsx's nav badge query — same endpoint,
    // already mounted app-wide, so this just subscribes rather than refetching.
    queryKey: ['approvals-badge-count'],
    queryFn: () => apiFetch<{ success: boolean; approvals: unknown[] }>('/api/approvals?status=pending'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const pendingApprovalsCount = approvalsData?.approvals.length ?? 0;

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            My Work
          </h1>
          <p className="text-sm text-neutral-500">{today}</p>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5">
        {/* Getting started checklist (new employees) */}
        {isNew && (
          <div className="mb-5">
            <GettingStartedChecklist completed={data?.gettingStartedProgress ?? []} />
          </div>
        )}

        {/* AI Insights — additive section, independent of the placeholder-fed
            widgets below; visible to all roles per 2026-07-05 review. */}
        <div className="mb-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            AI insights
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            <LeadPriorityWidget contacts={priorityContacts ?? []} loading={priorityLoading} />
            <ApprovalsPendingWidget count={pendingApprovalsCount} loading={approvalsLoading} />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {/* Left column — action items (2/3 width on desktop) */}
          <div className="space-y-5 lg:col-span-2">
            <UrgentRepliesSection
              items={data?.urgentReplies ?? []}
              loading={isLoading}
            />
            <OverdueFollowupsSection
              items={data?.overdueFollowups ?? []}
              loading={isLoading}
            />
            <TodaysFollowupsSection
              items={data?.todayFollowups ?? []}
              loading={isLoading}
            />
            <RecentContactsSection
              items={data?.recentContacts ?? []}
              loading={isLoading}
            />
          </div>

          {/* Right column — KPIs (1/3 width on desktop) */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Today&apos;s activity
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                label="Follow-ups done"
                value={data?.kpis?.followupsDone ?? 0}
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
                href="/sales/followups"
              />
              <KpiCard
                label="New contacts"
                value={data?.kpis?.newContacts ?? 0}
                icon={<Users className="h-5 w-5" aria-hidden />}
                href="/contacts"
              />
            </div>

            {/* Shortcut reference */}
            <Card variant="ghost" className="mt-4">
              <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                Shortcuts
              </h3>
              <ul className="space-y-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                {[
                  ['G then H', 'My Work'],
                  ['G then C', 'Communications'],
                  ['G then U', 'Contacts'],
                  ['G then S', 'Sales'],
                  ['Cmd+K', 'Command Palette'],
                  ['/', 'Quick Actions'],
                  ['Ctrl+L', 'Log a Call'],
                ].map(([key, label]) => (
                  <li key={key} className="flex items-center justify-between gap-2">
                    <span>{label}</span>
                    <kbd className="font-mono text-[10px] bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded shrink-0">
                      {key}
                    </kbd>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
