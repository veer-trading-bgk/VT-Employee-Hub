'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Navbar } from '@/components/layout/Navbar';

// ── Icons ─────────────────────────────────────────────────────────────────────
function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function CircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}
function UserGroupIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LeadsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function UnlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Plan        = 'trial' | 'paid' | 'enterprise' | 'internal';
type PlanStatus  = 'active' | 'suspended' | 'expired';

// ── Helpers ───────────────────────────────────────────────────────────────────
function planColor(planStatus: string, plan: string) {
  if (plan === 'internal') return 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-800';
  if (planStatus === 'suspended') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:ring-rose-800';
  if (plan === 'paid' || plan === 'enterprise') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800';
  return 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:ring-sky-800';
}

function planLabel(planStatus: string, plan: string, daysLeft: number | null | undefined) {
  if (plan === 'internal') return '🏠 Internal';
  if (planStatus === 'suspended') return 'Suspended';
  if (plan === 'enterprise') return 'Enterprise';
  if (plan === 'paid') return 'Paid';
  if ((daysLeft ?? 0) <= 0) return 'Trial Expired';
  return `Trial · ${daysLeft}d left`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="font-medium text-slate-800 dark:text-white text-right">{value ?? '—'}</span>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className={`flex items-center gap-4 rounded-xl border p-4 ${color}`}>
      <div className="rounded-lg bg-white/50 p-2.5 dark:bg-black/20">{icon}</div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs font-medium opacity-70">{label}</p>
      </div>
    </div>
  );
}

// ── Plan Modal ────────────────────────────────────────────────────────────────
function PlanModal({ companyId, current, onClose, onSaved }: {
  companyId: string;
  current: { plan: string; planStatus: string; trialEndsAt?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState<Plan>(current.plan as Plan ?? 'trial');
  const [status, setStatus] = useState<PlanStatus>(current.planStatus as PlanStatus ?? 'active');
  const [trialEndsAt, setTrialEndsAt] = useState(
    current.trialEndsAt ? current.trialEndsAt.split('T')[0] : ''
  );
  const [saving, setSaving] = useState(false);

  const selectCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  const inputCls  = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

  async function handleSave() {
    setSaving(true);
    try {
      await api.platformUpdatePlan(companyId, {
        plan,
        planStatus: status,
        ...(trialEndsAt ? { trialEndsAt: new Date(trialEndsAt).toISOString() } : {}),
      });
      toast.success('Plan updated successfully');
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to update plan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-5 text-lg font-bold text-slate-900 dark:text-white">Change Plan</h3>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Plan</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)} className={selectCls}>
              <option value="trial">Trial</option>
              <option value="paid">Paid</option>
              <option value="enterprise">Enterprise</option>
              <option value="internal">🏠 Internal (Owner-owned — never expires)</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Account Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} className={selectCls}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
            </select>
          </div>

          {plan === 'trial' && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <CalendarIcon /> Trial End Date
              </label>
              <input type="date" value={trialEndsAt} onChange={(e) => setTrialEndsAt(e.target.value)} className={inputCls} />
            </div>
          )}

          {plan === 'internal' && (
            <div className="rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
              🏠 Internal plan: never expires, never blocked, cannot be suspended. Use only for owner-operated companies.
            </div>
          )}

          {status === 'suspended' && plan !== 'internal' && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
              ⚠️ Suspending will block all API writes for this company. Their data is preserved.
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-lg bg-rose-600 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Extend Trial Modal ─────────────────────────────────────────────────────────
function ExtendTrialModal({ companyId, current, onClose, onSaved }: {
  companyId: string;
  current: { trialEndsAt?: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [days, setDays] = useState(14);
  const [saving, setSaving] = useState(false);

  const newDate = new Date(
    Math.max(
      Date.now(),
      current.trialEndsAt ? new Date(current.trialEndsAt).getTime() : Date.now()
    ) + days * 86_400_000
  );

  async function handleExtend() {
    setSaving(true);
    try {
      await api.platformUpdatePlan(companyId, {
        plan: 'trial',
        planStatus: 'active',
        trialEndsAt: newDate.toISOString(),
      });
      toast.success(`Trial extended to ${newDate.toLocaleDateString('en-IN')}`);
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to extend trial');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Extend Trial</h3>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold text-slate-500">Extend by</label>
          <div className="flex gap-2">
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${days === d ? 'bg-rose-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300'}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
          New trial end: <strong>{newDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            Cancel
          </button>
          <button onClick={handleExtend} disabled={saving}
            className="flex-1 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Extending…' : 'Extend Trial'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel, confirmColor, onConfirm, onClose, loading }: {
  title: string; message: string; confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300 hover:bg-slate-50 transition">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${confirmColor}`}>
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [unsuspendModalOpen, setUnsuspendModalOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['platform-company', id],
    queryFn: () => api.platformCompany(id),
    enabled: !!id,
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => api.platformUnsuspend(id),
    onSuccess: () => {
      toast.success('Company unsuspended');
      refetch();
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      setUnsuspendModalOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const suspendMutation = useMutation({
    mutationFn: () => api.platformUpdatePlan(id, { planStatus: 'suspended' }),
    onSuccess: () => {
      toast.success('Company suspended');
      refetch();
      qc.invalidateQueries({ queryKey: ['platform-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      setSuspendModalOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const company  = data?.company;
  const stats    = data?.stats;

  const daysLeft = company?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(company.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

  const isSuspended = company?.planStatus === 'suspended';
  const isInternal  = company?.plan === 'internal';
  const isPaid      = isInternal || company?.plan === 'paid' || company?.plan === 'enterprise';

  const btnPrimary = 'inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-40';
  const btnGhost   = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800';
  const btnDanger  = 'inline-flex items-center gap-1.5 rounded-lg bg-rose-100 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/70';
  const btnSuccess = 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950/70';

  if (isLoading) {
    return (
      <>
        <Navbar title="Company" showBack />
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
          <div className="mx-auto max-w-4xl space-y-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}
          </div>
        </div>
      </>
    );
  }

  if (isError || !company) {
    return (
      <>
        <Navbar title="Company" showBack />
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
          <p className="text-sm text-rose-400">Company not found or failed to load</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar title={company.companyName ?? 'Company'} showBack />

      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">

          {/* Header Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-2xl font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                  {company.companyName?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">{company.companyName}</h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{company.broker} · {company.city}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${planColor(company.planStatus, company.plan)}`}>
                      {planLabel(company.planStatus, company.plan, daysLeft)}
                    </span>
                    {company.companyId && (
                      <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {company.companyId}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setPlanModalOpen(true)} className={btnGhost}>
                  <EditIcon /> Change Plan
                </button>
                {!isPaid && (
                  <button onClick={() => setExtendModalOpen(true)} className={btnGhost}>
                    <CalendarIcon /> Extend Trial
                  </button>
                )}
                {!isInternal && (
                  isSuspended ? (
                    <button onClick={() => setUnsuspendModalOpen(true)} className={btnSuccess}>
                      <UnlockIcon /> Unsuspend
                    </button>
                  ) : (
                    <button onClick={() => setSuspendModalOpen(true)} className={btnDanger}>
                      <LockIcon /> Suspend
                    </button>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Team Members"
              value={stats?.employeeCount ?? 0}
              icon={<UserGroupIcon />}
              color="border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-400"
            />
            <StatCard
              label="Total Leads"
              value={stats?.leadCount ?? 0}
              icon={<LeadsIcon />}
              color="border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400"
            />
          </div>

          {/* Info Grid */}
          <div className="grid gap-5 md:grid-cols-2">

            {/* Company Details */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Company Details</h2>
              <div className="divide-y divide-slate-50 dark:divide-slate-800">
                <InfoRow label="Company Name" value={company.companyName} />
                <InfoRow label="Broker" value={company.broker} />
                <InfoRow label="City" value={company.city} />
                <InfoRow label="Admin Email" value={company.adminEmail} />
                <InfoRow label="Company ID" value={<span className="font-mono text-xs">{company.companyId}</span>} />
                <InfoRow label="Joined" value={company.createdAt ? new Date(company.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} />
              </div>
            </div>

            {/* Plan Details */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Plan & Billing</h2>
              <div className="divide-y divide-slate-50 dark:divide-slate-800">
                <InfoRow label="Current Plan" value={
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${planColor(company.planStatus, company.plan)}`}>
                    {planLabel(company.planStatus, company.plan, daysLeft)}
                  </span>
                } />
                <InfoRow label="Account Status" value={company.planStatus} />
                <InfoRow label="Trial Ends" value={
                  company.trialEndsAt
                    ? new Date(company.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'
                } />
                <InfoRow label="Days Left" value={daysLeft !== null ? `${daysLeft} days` : '—'} />
                <InfoRow label="Updated" value={
                  (company as { updatedAt?: string }).updatedAt
                    ? new Date((company as { updatedAt?: string }).updatedAt!).toLocaleDateString('en-IN')
                    : '—'
                } />
              </div>

              {/* Plan action hint */}
              {isInternal && (
                <div className="mt-3 rounded-xl bg-violet-50 px-4 py-3 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
                  🏠 Owner-operated company — permanently free, never expires, cannot be suspended.
                </div>
              )}
              {!isPaid && !isSuspended && (daysLeft ?? 99) <= 7 && (
                <div className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  ⚠️ Trial ending soon — follow up to convert to paid.
                </div>
              )}
              {isSuspended && (
                <div className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                  🔴 Account suspended — writes are blocked. Unsuspend to restore access.
                </div>
              )}
            </div>
          </div>

          {/* Onboarding Checklist */}
          <OnboardingCard companyId={id} />

          {/* Danger Zone */}
          {isInternal ? (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 dark:border-violet-900/40 dark:bg-violet-950/10">
              <h2 className="mb-1 text-sm font-semibold text-violet-700 dark:text-violet-400">🏠 Owner-Protected Company</h2>
              <p className="text-xs text-violet-600 dark:text-violet-500">
                This is an internal (owner-owned) company. It cannot be suspended, billed, or blocked. Use the Change Plan button above to adjust the plan type if needed.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-rose-200 bg-white p-5 dark:border-rose-900/40 dark:bg-slate-900">
              <h2 className="mb-3 text-sm font-semibold text-rose-600 dark:text-rose-400">Danger Zone</h2>
              <div className="flex flex-col gap-3 sm:flex-row">
                {isSuspended ? (
                  <div className="flex-1">
                    <p className="mb-1 text-xs text-slate-500">Company is currently suspended.</p>
                    <button onClick={() => setUnsuspendModalOpen(true)} className={`${btnSuccess} w-full justify-center`}>
                      <UnlockIcon /> Restore Access
                    </button>
                  </div>
                ) : (
                  <div className="flex-1">
                    <p className="mb-1 text-xs text-slate-500">Block all writes immediately. Data is preserved.</p>
                    <button onClick={() => setSuspendModalOpen(true)} className={`${btnDanger} w-full justify-center`}>
                      <LockIcon /> Suspend Company
                    </button>
                  </div>
                )}
                <div className="flex-1">
                  <p className="mb-1 text-xs text-slate-500">Upgrade to paid — removes all trial limits.</p>
                  <button onClick={() => setPlanModalOpen(true)} className={`${btnPrimary} w-full justify-center`}>
                    ⬆️ Upgrade to Paid
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modals */}
      {planModalOpen && (
        <PlanModal
          companyId={id}
          current={{ plan: company.plan, planStatus: company.planStatus, trialEndsAt: company.trialEndsAt as string }}
          onClose={() => setPlanModalOpen(false)}
          onSaved={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ['platform-companies'] });
            qc.invalidateQueries({ queryKey: ['platform-stats'] });
          }}
        />
      )}
      {extendModalOpen && (
        <ExtendTrialModal
          companyId={id}
          current={{ trialEndsAt: company.trialEndsAt as string }}
          onClose={() => setExtendModalOpen(false)}
          onSaved={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ['platform-companies'] });
          }}
        />
      )}
      {suspendModalOpen && (
        <ConfirmModal
          title="Suspend Company"
          message={`Suspending "${company.companyName}" will immediately block all API write access. Their data is safe and can be restored anytime.`}
          confirmLabel="Suspend"
          confirmColor="bg-rose-600 hover:bg-rose-700"
          onConfirm={() => suspendMutation.mutate()}
          onClose={() => setSuspendModalOpen(false)}
          loading={suspendMutation.isPending}
        />
      )}
      {unsuspendModalOpen && (
        <ConfirmModal
          title="Restore Access"
          message={`Unsuspending "${company.companyName}" will restore full API access immediately.`}
          confirmLabel="Unsuspend"
          confirmColor="bg-emerald-600 hover:bg-emerald-700"
          onConfirm={() => unsuspendMutation.mutate()}
          onClose={() => setUnsuspendModalOpen(false)}
          loading={unsuspendMutation.isPending}
        />
      )}
    </>
  );
}

// ── Onboarding Checklist Sub-component ────────────────────────────────────────
function OnboardingCard({ companyId }: { companyId: string }) {
  // We can't call the admin onboarding endpoint for another company from platform,
  // so we show a placeholder that will be extended when per-company fetch is available.
  // For now show the data from the company detail stats we already have.
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Onboarding Progress</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { id: 'profile',  label: 'Company profile' },
          { id: 'waba',     label: 'WhatsApp connected' },
          { id: 'employee', label: 'First team member' },
          { id: 'lead',     label: 'First lead received' },
        ].map((step) => (
          <div key={step.id} className="flex items-center gap-2 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <span className="text-slate-300 dark:text-slate-600"><CircleIcon /></span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{step.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Per-company onboarding status coming soon — connect the platform onboarding endpoint for live progress.
      </p>
    </div>
  );
  void companyId;
}
