'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Building2, Users, Activity, Timer } from 'lucide-react';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Button } from '@/components/v3/ui/Button';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { deriveDaysLeftInTrial } from './trialDays';

type Plan = 'trial' | 'paid' | 'enterprise' | 'internal';
type PlanStatus = 'active' | 'suspended' | 'expired';

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtPlanEnum(plan?: string) {
  if (!plan) return '—';
  const labels: Record<string, string> = {
    trial: 'Trial',
    paid: 'Paid',
    enterprise: 'Enterprise',
    internal: 'Internal',
  };
  return labels[plan] ?? plan;
}

function fmtStatus(status?: string) {
  if (!status) return '—';
  const labels: Record<string, string> = {
    active: 'Active',
    suspended: 'Suspended',
    expired: 'Expired',
  };
  return labels[status] ?? status;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-neutral-500 shrink-0">{label}</span>
      <span className="font-medium text-neutral-900 dark:text-neutral-100 text-right">{value ?? '—'}</span>
    </div>
  );
}

function PlanModal({ companyId, current, onClose, onSaved }: {
  companyId: string;
  current: { plan: string; planStatus: string; trialEndsAt?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan]           = useState<Plan>(current.plan as Plan ?? 'trial');
  const [status, setStatus]       = useState<PlanStatus>(current.planStatus as PlanStatus ?? 'active');
  const [trialEndsAt, setTrialEndsAt] = useState(current.trialEndsAt ? current.trialEndsAt.split('T')[0] : '');

  const saveMut = useMutation({
    mutationFn: () => api.platformUpdatePlan(companyId, {
      plan,
      planStatus: status,
      ...(trialEndsAt ? { trialEndsAt: new Date(trialEndsAt).toISOString() } : {}),
    }),
    onSuccess: () => { toast.success('Plan updated'); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 focus:border-primary-600 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-100">Change Plan</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Plan</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={selectCls}>
              <option value="trial">Trial</option>
              <option value="paid">Paid</option>
              <option value="enterprise">Enterprise</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} className={selectCls}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          {plan === 'trial' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500">Trial Ends At</label>
              <input type="date" value={trialEndsAt} onChange={(e) => setTrialEndsAt(e.target.value)} className={selectCls} />
            </div>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          <Button loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [planModalOpen, setPlanModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-company', id],
    queryFn: () => api.platformCompany(id),
    enabled: !!id,
    staleTime: 60_000,
  });

  const company = data?.company;
  const stats = data?.stats;

  const suspendMut = useMutation({
    mutationFn: () => api.platformUpdatePlan(id, { plan: company!.plan as Plan, planStatus: 'suspended' }),
    onSuccess: () => { toast.success('Company suspended'); qc.invalidateQueries({ queryKey: ['platform-company', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const activateMut = useMutation({
    mutationFn: () => api.platformUpdatePlan(id, { plan: company!.plan as Plan, planStatus: 'active' }),
    onSuccess: () => { toast.success('Company activated'); qc.invalidateQueries({ queryKey: ['platform-company', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="p-6 space-y-4">
          {[0,1,2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-400">Company not found</p>
      </div>
    );
  }

  const daysLeft = deriveDaysLeftInTrial(
    company.trialEndsAt as string | null | undefined,
    company.daysLeftInTrial as number | null | undefined,
  );
  const isTrial = company.plan === 'trial';

  // Header badge: status-first when suspended; else plan + trial days (CD-01/CD-03).
  const badgeLabel =
    company.planStatus === 'suspended' ? 'Suspended' :
    company.plan === 'internal' ? 'Internal' :
    company.plan === 'enterprise' ? 'Enterprise' :
    company.plan === 'paid' ? 'Paid' :
    daysLeft === null ? 'Trial' :
    daysLeft <= 0 ? 'Trial Expired' :
    `Trial · ${daysLeft}d left`;

  const badgeVariant: 'default' | 'primary' | 'success' | 'error' | 'warning' =
    company.planStatus === 'suspended' ? 'error' :
    company.plan === 'internal' ? 'primary' :
    (company.plan === 'paid' || company.plan === 'enterprise') ? 'success' :
    daysLeft !== null && daysLeft <= 0 ? 'warning' :
    'default';

  // CD-04: email · city under title
  const headerMeta = [company.adminEmail, company.city].filter(Boolean).join(' · ');

  const kpiCards: { icon: React.ReactNode; label: string; value: string | number }[] = [
    { icon: <Users className="h-4 w-4" />, label: 'Employees', value: stats?.employeeCount ?? 0 },
    { icon: <Activity className="h-4 w-4" />, label: 'Leads', value: stats?.leadCount ?? 0 },
  ];
  // CD-06: Trial days KPI only when plan is trial
  if (isTrial) {
    kpiCards.push({
      icon: <Timer className="h-4 w-4" />,
      label: 'Trial days',
      value: daysLeft === null ? '—' : daysLeft,
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-primary-600 mb-2">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800">
              <Building2 className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">{company.companyName}</h1>
              {headerMeta ? (
                <p className="text-xs text-neutral-500 truncate">{headerMeta}</p>
              ) : null}
              <p className="text-xs text-neutral-400 font-mono truncate">{company.companyId}</p>
            </div>
          </div>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {/* Stats */}
          <div className={`grid gap-3 ${kpiCards.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {kpiCards.map(({ icon, label, value }) => (
              <Card key={label}>
                <div className="flex items-center gap-2 text-neutral-500 mb-1">{icon}<span className="text-xs">{label}</span></div>
                <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </p>
              </Card>
            ))}
          </div>

          {/* Details — CD-02, CD-03, CD-05 */}
          <Card noPadding>
            <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Account Details</p>
            </div>
            <div className="divide-y divide-neutral-50 px-4 dark:divide-neutral-800/60">
              <InfoRow label="Owner name" value={(company.ownerName as string | null | undefined) || '—'} />
              <InfoRow label="Owner email" value={company.adminEmail || '—'} />
              <InfoRow label="Owner mobile" value={(company.ownerMobile as string | null | undefined) || '—'} />
              <InfoRow
                label="Industry"
                value={
                  (company.industry as string | undefined)
                  || (company.broker as string | undefined)
                  || '—'
                }
              />
              {(company.industry === 'Other' || company.businessType) ? (
                <InfoRow label="Business type" value={(company.businessType as string | undefined) || '—'} />
              ) : null}
              <InfoRow label="City" value={company.city || '—'} />
              <InfoRow label="Company ID" value={<span className="font-mono text-xs">{company.companyId}</span>} />
              <InfoRow label="Plan" value={fmtPlanEnum(company.plan)} />
              <InfoRow label="Status" value={fmtStatus(company.planStatus)} />
              {isTrial && company.trialEndsAt ? (
                <InfoRow label="Trial ends" value={fmtDate(company.trialEndsAt as string)} />
              ) : null}
              {isTrial ? (
                <InfoRow
                  label="Trial days"
                  value={daysLeft === null ? '—' : String(daysLeft)}
                />
              ) : null}
              <InfoRow label="Created" value={fmtDate(company.createdAt as string | undefined)} />
              <InfoRow
                label="Updated"
                value={company.updatedAt ? fmtDate(company.updatedAt as string) : '—'}
              />
            </div>
          </Card>

          {/* Actions — unchanged */}
          <Card noPadding>
            <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Actions</p>
            </div>
            <div className="flex flex-wrap gap-2 p-4">
              <Button size="sm" variant="secondary" onClick={() => setPlanModalOpen(true)}>Change Plan</Button>
              {company.planStatus === 'suspended' ? (
                <Button size="sm" loading={activateMut.isPending}
                  onClick={() => { if (confirm('Activate this company?')) activateMut.mutate(); }}>
                  Activate
                </Button>
              ) : (
                <Button size="sm" variant="danger" loading={suspendMut.isPending}
                  onClick={() => { if (confirm('Suspend this company? Users will lose access.')) suspendMut.mutate(); }}>
                  Suspend
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {planModalOpen && company && (
        <PlanModal
          companyId={id}
          current={{ plan: company.plan, planStatus: company.planStatus, trialEndsAt: company.trialEndsAt }}
          onClose={() => setPlanModalOpen(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['platform-company', id] })}
        />
      )}
    </div>
  );
}
