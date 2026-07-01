'use client';

import { useState } from 'react';
import { Plus, Search, Trash2, Rocket } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/v3/ui/Button';
import { Badge } from '@/components/v3/ui/Badge';
import { EmptyState } from '@/components/v3/ui/EmptyState';
import { SkeletonTable } from '@/components/v3/ui/Skeleton';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toV3Role } from '@/types/v3';
import { CAMPAIGN_STATUS_META, type Campaign, type CampaignsResponse } from '@/types/campaigns';
import { CampaignCreateDrawer } from './CampaignCreateDrawer';
import { cn } from '@/lib/cn';

interface CampaignListProps {
  statusFilter?: string;
}

export function CampaignList({ statusFilter }: CampaignListProps) {
  const [search,     setSearch]     = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const canDelete = v3Role === 'owner' || v3Role === 'admin';
  const qc = useQueryClient();

  const queryKey = statusFilter ? ['campaigns', statusFilter] : ['campaigns'];
  const { data, isLoading } = useQuery<CampaignsResponse>({
    queryKey,
    queryFn: () => apiFetch(`/api/campaigns${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-stats'] });
      toast.success('Campaign deleted');
    },
    onError: (err: Error) => toast.error(err.message ?? 'Delete failed'),
  });

  const launchMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean; sent: number; failed: number }>(`/api/campaigns/${id}/launch`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-stats'] });
      toast.success(`Campaign launched — ${r.sent} sent, ${r.failed} failed`);
    },
    onError: (err: Error) => toast.error(err.message ?? 'Launch failed'),
  });

  const campaigns = (data?.campaigns ?? []).filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="search"
              placeholder="Search campaigns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => setDrawerOpen(true)}
          >
            Create Campaign
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <SkeletonTable rows={4} />
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title={search ? 'No campaigns match your search' : statusFilter ? 'No campaigns here yet' : 'No campaigns yet'}
            description={!search && !statusFilter ? 'Create your first campaign to reach multiple contacts at once.' : undefined}
            action={!search ? { label: 'Create Campaign', onClick: () => setDrawerOpen(true) } : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/70">
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">Campaign</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Audience</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Sent</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Delivery</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Created</th>
                  <th className="w-16 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {campaigns.map((c) => <CampaignRow key={c.id} campaign={c} canDelete={canDelete} onDelete={(id) => { if (window.confirm('Delete this campaign permanently?')) deleteMutation.mutate(id); }} onLaunch={(id) => { if (window.confirm('Launch this campaign now?')) launchMutation.mutate(id); }} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CampaignCreateDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

function CampaignRow({
  campaign: c, canDelete, onDelete, onLaunch,
}: {
  campaign:  Campaign;
  canDelete: boolean;
  onDelete:  (id: string) => void;
  onLaunch:  (id: string) => void;
}) {
  const meta         = CAMPAIGN_STATUS_META[c.status] ?? CAMPAIGN_STATUS_META.draft;
  const deliveryRate = c.stats.sent > 0 ? Math.round((c.stats.delivered / c.stats.sent) * 100) : null;

  return (
    <tr className="bg-white hover:bg-neutral-50/70 dark:bg-neutral-950 dark:hover:bg-neutral-900/70">
      <td className="px-4 py-3">
        <p className="max-w-[180px] truncate font-medium text-neutral-900 dark:text-white">{c.name}</p>
        {c.description && (
          <p className="max-w-[180px] truncate text-xs text-neutral-400">{c.description}</p>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-neutral-500">
        {c.type === 'whatsapp_broadcast' ? 'WA Broadcast' : 'CTWA'}
      </td>
      <td className="px-4 py-3">
        <Badge variant={meta.variant} dot>{meta.label}</Badge>
      </td>
      <td className="px-4 py-3 text-right text-sm text-neutral-600 dark:text-neutral-400">
        {c.stats.totalAudience > 0 ? c.stats.totalAudience.toLocaleString() : '—'}
      </td>
      <td className="px-4 py-3 text-right text-sm text-neutral-600 dark:text-neutral-400">
        {c.stats.sent > 0 ? c.stats.sent.toLocaleString() : '—'}
      </td>
      <td className="px-4 py-3 text-right text-sm">
        {deliveryRate !== null ? (
          <span className={cn('font-medium', deliveryRate >= 90 ? 'text-success-600' : deliveryRate >= 70 ? 'text-warning-600' : 'text-error-600')}>
            {deliveryRate}%
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-right text-xs text-neutral-400">
        {new Date(c.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {c.status === 'draft' && c.type === 'whatsapp_broadcast' && (
            <button
              onClick={() => onLaunch(c.id)}
              title="Launch now"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-success-50 hover:text-success-600 dark:hover:bg-success-900/20"
            >
              <Rocket className="h-4 w-4" aria-hidden />
            </button>
          )}
          {canDelete && ['draft', 'failed', 'cancelled'].includes(c.status) && (
            <button
              onClick={() => onDelete(c.id)}
              title="Delete"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-900/20"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
