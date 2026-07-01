'use client';

import { Send, FileEdit, CalendarDays, CheckCircle2, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/v3/ui/Badge';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { CAMPAIGN_STATUS_META, type Campaign, type CampaignStatsResponse, type CampaignsResponse } from '@/types/campaigns';

interface CampaignsDashboardProps {
  onViewAll:        () => void;
  onCreateCampaign: () => void;
}

export function CampaignsDashboard({ onViewAll, onCreateCampaign }: CampaignsDashboardProps) {
  const { data: statsData, isLoading: statsLoading } = useQuery<CampaignStatsResponse>({
    queryKey: ['campaign-stats'],
    queryFn:  () => apiFetch('/api/campaigns/stats'),
  });
  const { data: listData, isLoading: listLoading } = useQuery<CampaignsResponse>({
    queryKey: ['campaigns'],
    queryFn:  () => apiFetch('/api/campaigns'),
  });

  const s      = statsData?.stats;
  const recent = (listData?.campaigns ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Campaign status KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statsLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)
          : [
              { label: 'Total',     value: s?.total     ?? 0, icon: Send,         color: 'text-primary-600 dark:text-primary-400' },
              { label: 'Active',    value: s?.active    ?? 0, icon: Zap,          color: 'text-success-600 dark:text-success-400' },
              { label: 'Draft',     value: s?.draft     ?? 0, icon: FileEdit,     color: 'text-neutral-500' },
              { label: 'Scheduled', value: s?.scheduled ?? 0, icon: CalendarDays, color: 'text-warning-600 dark:text-warning-400' },
              { label: 'Completed', value: s?.completed ?? 0, icon: CheckCircle2, color: 'text-primary-600 dark:text-primary-400' },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <kpi.icon className={cn('mb-2 h-4 w-4', kpi.color)} aria-hidden />
                <p className="text-2xl font-bold text-neutral-900 dark:text-white">{kpi.value}</p>
                <p className="text-xs text-neutral-500">{kpi.label}</p>
              </div>
            ))}
      </div>

      {/* Performance KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          : [
              { label: 'Total Audience',  value: (s?.totalAudience ?? 0).toLocaleString(), sub: 'contacts reached'   },
              { label: 'Messages Sent',   value: (s?.totalMessages  ?? 0).toLocaleString(), sub: 'all campaigns'      },
              { label: 'Delivery Rate',   value: `${s?.deliveryRate ?? 0}%`,                sub: 'delivered / sent'  },
              { label: 'Read Rate',       value: `${s?.readRate     ?? 0}%`,                sub: 'read / delivered'  },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-xl font-bold text-neutral-900 dark:text-white">{kpi.value}</p>
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{kpi.label}</p>
                <p className="text-xs text-neutral-400">{kpi.sub}</p>
              </div>
            ))}
      </div>

      {/* Recent campaigns */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Recent Campaigns</h2>
          <button onClick={onViewAll} className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400">
            View all
          </button>
        </div>

        {listLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-12 text-center dark:border-neutral-800 dark:bg-neutral-900/50">
            <Send className="mx-auto h-8 w-8 text-neutral-300" aria-hidden />
            <p className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">No campaigns yet</p>
            <p className="mt-1 text-xs text-neutral-400">Create your first campaign to reach contacts at scale</p>
            <button
              onClick={onCreateCampaign}
              className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((c) => <CampaignRow key={c.id} campaign={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign: c }: { campaign: Campaign }) {
  const meta         = CAMPAIGN_STATUS_META[c.status] ?? CAMPAIGN_STATUS_META.draft;
  const deliveryRate = c.stats.sent > 0 ? Math.round((c.stats.delivered / c.stats.sent) * 100) : null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{c.name}</p>
        <p className="text-xs text-neutral-400">
          {c.type === 'whatsapp_broadcast' ? 'WA Broadcast' : 'CTWA'}
          {' · '}
          {new Date(c.createdAt).toLocaleDateString()}
        </p>
      </div>
      <Badge variant={meta.variant} dot>{meta.label}</Badge>
      {c.status === 'completed' && (
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">{c.stats.sent.toLocaleString()}</p>
          <p className="text-xs text-neutral-400">sent{deliveryRate !== null ? ` · ${deliveryRate}% del.` : ''}</p>
        </div>
      )}
    </div>
  );
}
