'use client';

import { useMemo } from 'react';
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { TemplateStatusBadge } from './TemplateStatusBadge';
import { TemplateCategoryBadge } from './TemplateCategoryBadge';
import { fetchTemplates, templateKeys } from '@/lib/templates/api';
import type { TemplateStatus, TemplateCategory, QualityScore } from '@/lib/templates/types';

interface Props {
  onViewAll?: () => void;
}

export function TemplateDashboard({ onViewAll }: Props) {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: templateKeys.list(),
    queryFn: fetchTemplates,
  });

  const stats = useMemo(() => {
    const total = templates.length;
    const byStatus: Partial<Record<TemplateStatus, number>> = {};
    const byCategory: Partial<Record<TemplateCategory, number>> = {};
    const byQuality: Partial<Record<QualityScore, number>> = {};
    let sendable = 0;

    for (const t of templates) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
      byQuality[t.qualityScore] = (byQuality[t.qualityScore] ?? 0) + 1;
      if (t.status === 'APPROVED' || t.status === 'REINSTATED') sendable++;
    }

    const alerts: Array<{ id: string; title: string; body: string; severity: 'error' | 'warning' }> = [];

    if ((byQuality.LOW ?? 0) > 0) {
      alerts.push({
        id: 'low-quality',
        title: `${byQuality.LOW} template${byQuality.LOW! > 1 ? 's' : ''} with LOW quality score`,
        body: 'Templates with low quality may be paused by Meta. Review content and reduce opt-out rates.',
        severity: 'error',
      });
    }
    if ((byStatus.FLAGGED ?? 0) > 0) {
      alerts.push({
        id: 'flagged',
        title: `${byStatus.FLAGGED} flagged template${byStatus.FLAGGED! > 1 ? 's' : ''}`,
        body: 'Flagged templates risk being paused. Investigate quality issues immediately.',
        severity: 'error',
      });
    }
    if ((byStatus.PAUSED ?? 0) > 0) {
      alerts.push({
        id: 'paused',
        title: `${byStatus.PAUSED} paused template${byStatus.PAUSED! > 1 ? 's' : ''}`,
        body: 'Paused templates cannot be sent. Resolve quality issues to reinstate.',
        severity: 'warning',
      });
    }
    if ((byStatus.REJECTED ?? 0) > 0) {
      alerts.push({
        id: 'rejected',
        title: `${byStatus.REJECTED} rejected template${byStatus.REJECTED! > 1 ? 's' : ''}`,
        body: 'Edit and resubmit rejected templates. Check the rejection reason for guidance.',
        severity: 'warning',
      });
    }

    const recentTemplates = [...templates]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);

    return { total, byStatus, byCategory, byQuality, sendable, alerts, recentTemplates };
  }, [templates]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={FileText}
          iconColor="text-primary-600 dark:text-primary-400"
          iconBg="bg-primary-50 dark:bg-primary-900/20"
          label="Total Templates"
          value={stats.total}
        />
        <KpiCard
          icon={CheckCircle2}
          iconColor="text-success-600 dark:text-success-400"
          iconBg="bg-success-50 dark:bg-success-900/20"
          label="Sendable"
          value={stats.sendable}
          sub={stats.total > 0 ? `${Math.round((stats.sendable / stats.total) * 100)}% of total` : undefined}
        />
        <KpiCard
          icon={Clock}
          iconColor="text-amber-600 dark:text-amber-400"
          iconBg="bg-amber-50 dark:bg-amber-900/20"
          label="Pending Review"
          value={stats.byStatus.PENDING ?? 0}
          sub="Awaiting Meta approval"
        />
        <KpiCard
          icon={TrendingUp}
          iconColor="text-success-600 dark:text-success-400"
          iconBg="bg-success-50 dark:bg-success-900/20"
          label="High Quality"
          value={stats.byQuality.HIGH ?? 0}
          sub={stats.total > 0 ? `${Math.round(((stats.byQuality.HIGH ?? 0) / stats.total) * 100)}% of total` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* ── Alerts ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5 md:col-span-2">
          {stats.alerts.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-success-200 bg-success-50 p-3.5 dark:border-success-900/40 dark:bg-success-900/10">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600" aria-hidden />
              <div>
                <p className="text-sm font-medium text-success-700 dark:text-success-400">All templates healthy</p>
                <p className="text-xs text-success-600/70 dark:text-success-400/60">No quality or policy alerts</p>
              </div>
            </div>
          ) : (
            stats.alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3.5',
                  alert.severity === 'error'
                    ? 'border-error-200 bg-error-50 dark:border-error-900/40 dark:bg-error-900/10'
                    : 'border-warning-200 bg-warning-50 dark:border-warning-900/40 dark:bg-warning-900/10',
                )}
              >
                {alert.severity === 'error' ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error-600 dark:text-error-400" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400" aria-hidden />
                )}
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-semibold',
                    alert.severity === 'error'
                      ? 'text-error-700 dark:text-error-400'
                      : 'text-warning-700 dark:text-warning-400',
                  )}>
                    {alert.title}
                  </p>
                  <p className={cn('mt-0.5 text-xs',
                    alert.severity === 'error'
                      ? 'text-error-600/80 dark:text-error-400/70'
                      : 'text-warning-600/80 dark:text-warning-400/70',
                  )}>
                    {alert.body}
                  </p>
                </div>
              </div>
            ))
          )}

          {/* Category breakdown */}
          {stats.total > 0 && (
            <div className="rounded-xl border border-neutral-200 p-3.5 dark:border-neutral-800">
              <p className="mb-2.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                By Category
              </p>
              <div className="flex flex-col gap-2">
                {(['MARKETING', 'UTILITY', 'AUTHENTICATION'] as TemplateCategory[]).map((cat) => {
                  const count = stats.byCategory[cat] ?? 0;
                  const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                  return (
                    <div key={cat} className="flex items-center gap-2">
                      <TemplateCategoryBadge category={cat} size="xs" className="w-24 shrink-0 justify-center" />
                      <div className="flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" style={{ height: 4 }}>
                        <div
                          className={cn('h-full rounded-full transition-all', {
                            'bg-purple-400': cat === 'MARKETING',
                            'bg-primary-500': cat === 'UTILITY',
                            'bg-amber-400': cat === 'AUTHENTICATION',
                          })}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-neutral-500">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Recent templates ─────────────────────────────────────── */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-100 px-3.5 py-2.5 dark:border-neutral-800">
            <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              Recent
            </p>
            {onViewAll && (
              <button
                type="button"
                onClick={onViewAll}
                className="flex items-center gap-0.5 text-[11px] text-primary-600 hover:text-primary-700 dark:text-primary-400"
              >
                View all <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
          <div className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
            {stats.recentTemplates.length === 0 && (
              <p className="px-3.5 py-6 text-center text-xs text-neutral-400">No templates yet</p>
            )}
            {stats.recentTemplates.map((t) => (
              <div key={t.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{t.name}</p>
                  <p className="truncate text-[10px] text-neutral-400">{t.templateName}</p>
                </div>
                <TemplateStatusBadge status={t.status} size="xs" showDot />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconBg)}>
        <Icon className={cn('h-4.5 w-4.5', iconColor)} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
          {value}
        </p>
        {sub && <p className="mt-0.5 text-[11px] text-neutral-400">{sub}</p>}
      </div>
    </div>
  );
}
