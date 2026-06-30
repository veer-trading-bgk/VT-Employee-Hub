'use client';

import { useState, useCallback, useMemo, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  User,
  Building2,
  Users,
  Smartphone,
  Bell,
  Lock,
  CreditCard,
  Globe,
  Tag,
  LayoutGrid,
  Zap,
  Activity,
  Sun,
  Moon,
  LogOut,
  UserPlus,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/v3/ui/Card';
import { Badge } from '@/components/v3/ui/Badge';
import { Toggle } from '@/components/v3/ui/Toggle';
import { Button } from '@/components/v3/ui/Button';
import { Avatar } from '@/components/v3/ui/Avatar';
import { Input, Textarea } from '@/components/v3/ui/Input';
import { Skeleton } from '@/components/v3/ui/Skeleton';
import { cn } from '@/lib/cn';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { toV3Role } from '@/types/v3';
import { apiFetch, api } from '@/lib/api';
import type { Setup2FAResponse } from '@/lib/api';
import { formatDate } from '@/utils/formatters';
import { useMetricsConfig } from '@/hooks/useMetricsConfig';
import { formatMetricValue } from '@/lib/metrics.config';
import type { Role } from '@/types';
import { toast } from 'sonner';
import { EmployeesSection } from '@/components/v3/team/EmployeesSection';

// ── Section definitions ───────────────────────────────────────────────────────

type SettingsSection =
  | 'profile'
  | 'organisation'
  | 'employees'
  | 'whatsapp'
  | 'notifications'
  | 'security'
  | 'billing'
  | 'integrations'
  | 'tags'
  | 'pipeline'
  | 'workflows'
  | 'audit'
  | 'targets'
  | 'metric-config'
  | 'appearance';

interface SectionDef {
  id: SettingsSection;
  label: string;
  description: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'profile',       label: 'Profile',         description: 'Your personal info and photo',           icon: <User className="h-5 w-5" /> },
  { id: 'appearance',    label: 'Appearance',       description: 'Theme, font size, display',              icon: <Sun className="h-5 w-5" /> },
  { id: 'notifications', label: 'Notifications',    description: 'What to be notified about',              icon: <Bell className="h-5 w-5" /> },
  { id: 'security',      label: 'Security',         description: 'Password and two-factor auth',           icon: <Lock className="h-5 w-5" /> },
  { id: 'organisation',  label: 'Organisation',     description: 'Company name, logo, settings',           icon: <Building2 className="h-5 w-5" />, adminOnly: true },
  { id: 'employees',     label: 'Employees',        description: 'Invite, manage roles and permissions',   icon: <Users className="h-5 w-5" />, adminOnly: true },
  { id: 'whatsapp',      label: 'WhatsApp',         description: 'Connect and manage WhatsApp Business',   icon: <Smartphone className="h-5 w-5" />, adminOnly: true },
  { id: 'pipeline',      label: 'Pipeline Stages',  description: 'Customise your sales stages',            icon: <LayoutGrid className="h-5 w-5" />, adminOnly: true },
  { id: 'tags',          label: 'Tags',             description: 'Manage contact tags',                    icon: <Tag className="h-5 w-5" />, adminOnly: true },
  { id: 'workflows',     label: 'Workflow settings',description: 'Manage and configure automations',       icon: <Zap className="h-5 w-5" />, adminOnly: true },
  { id: 'integrations',  label: 'Integrations',     description: 'Connect third-party tools',              icon: <Globe className="h-5 w-5" />, adminOnly: true },
  { id: 'billing',       label: 'Billing & Plan',   description: 'Subscription, invoices, usage',          icon: <CreditCard className="h-5 w-5" />, adminOnly: true },
  { id: 'targets',       label: 'Metric Targets',   description: 'Set daily or monthly targets',           icon: <Activity className="h-5 w-5" />, adminOnly: true },
  { id: 'metric-config', label: 'Metric Config',    description: 'Edit metric labels, icons and weights',  icon: <Zap className="h-5 w-5" />, adminOnly: true },
  { id: 'audit',         label: 'Audit Log',        description: 'Track all admin actions',                icon: <Activity className="h-5 w-5" />, adminOnly: true },
];

// ── Profile section ───────────────────────────────────────────────────────────

function ProfileSection() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600));
    toast.success('Profile updated');
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Profile</h2>
        <p className="text-sm text-neutral-500">Your personal information</p>
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={user?.name ?? '?'} size={64} />
          <div>
            <Button variant="secondary" size="sm" type="button">Change photo</Button>
            <p className="mt-1 text-xs text-neutral-400">JPG, PNG up to 2MB</p>
          </div>
        </div>
        <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Email" type="email" value={user?.email ?? ''} disabled hint="Contact your admin to change your email" />
        <Button type="submit" loading={saving}>Save changes</Button>
      </form>
    </div>
  );
}

// ── Appearance section ────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Appearance</h2>
        <p className="text-sm text-neutral-500">Personalise how APForce looks</p>
      </div>
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon className="h-5 w-5 text-neutral-500" aria-hidden />
            ) : (
              <Sun className="h-5 w-5 text-neutral-500" aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </p>
              <p className="text-xs text-neutral-500">Toggle between light and dark interface</p>
            </div>
          </div>
          <Toggle checked={theme === 'dark'} onChange={toggleTheme} aria-label="Toggle dark mode" />
        </div>
      </Card>
    </div>
  );
}

// ── Employees section ─────────────────────────────────────────────────────────

// ── WhatsApp section ──────────────────────────────────────────────────────────

interface WabaConnection {
  connected: boolean;
  phoneNumber?: string | null;
  wabaId?: string | null;
  connectedAt?: string | null;
}

function WhatsAppSection() {
  const qc = useQueryClient();
  const [manualOpen, setManualOpen] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');

  const { data, isLoading } = useQuery<WabaConnection>({
    queryKey: ['whatsapp-connection'],
    queryFn: () => apiFetch<WabaConnection>('/api/whatsapp/connection'),
    staleTime: 30_000,
  });

  const disconnectMut = useMutation({
    mutationFn: () => apiFetch('/api/whatsapp/connection', { method: 'DELETE' }),
    onSuccess: () => { toast.success('WhatsApp disconnected'); qc.invalidateQueries({ queryKey: ['whatsapp-connection'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const manualMut = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; phoneNumber: string }>('/api/whatsapp/manual-connect', {
      method: 'POST',
      body: JSON.stringify({ accessToken: accessToken.trim(), phoneNumberId: phoneNumberId.trim() }),
    }),
    onSuccess: (res) => {
      toast.success(`Connected: ${res.phoneNumber ?? 'WhatsApp Business'}`);
      setManualOpen(false);
      setAccessToken('');
      setPhoneNumberId('');
      qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleOAuthConnect() {
    try {
      const res = await apiFetch<{ url: string }>('/api/whatsapp/auth/init');
      const popup = window.open(res.url, 'wa_connect', 'width=600,height=700');
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === 'waba_connected') {
          toast.success(e.data.message ?? 'WhatsApp connected');
          qc.invalidateQueries({ queryKey: ['whatsapp-connection'] });
          window.removeEventListener('message', onMessage);
        } else if (e.data?.type === 'waba_failed') {
          toast.error(e.data.message ?? 'Connection failed');
          window.removeEventListener('message', onMessage);
        }
      };
      window.addEventListener('message', onMessage);
      const timer = setInterval(() => {
        if (popup?.closed) { clearInterval(timer); window.removeEventListener('message', onMessage); }
      }, 500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start OAuth flow';
      if (msg.includes('META_APP_ID')) {
        toast.error('Meta App ID not configured on server — use manual connect below');
        setManualOpen(true);
      } else {
        toast.error(msg);
      }
    }
  }

  const connected = data?.connected;

  const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 focus:border-primary-600 focus:outline-none';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp Business</h2>
        <p className="text-sm text-neutral-500">Connect your Meta WhatsApp Business API to enable messaging</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : connected ? (
        <Card>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-50 dark:bg-success-900/20">
                <Smartphone className="h-5 w-5 text-success-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">WhatsApp Business API</p>
                <p className="text-xs text-neutral-500">Connected via Meta Cloud API</p>
              </div>
            </div>
            <Badge variant="success" dot>Connected</Badge>
          </div>
          <div className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800 text-sm">
            {data?.phoneNumber && (
              <div className="flex justify-between py-2.5">
                <span className="text-neutral-500">Phone number</span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">{data.phoneNumber}</span>
              </div>
            )}
            {data?.wabaId && (
              <div className="flex justify-between py-2.5">
                <span className="text-neutral-500">WABA ID</span>
                <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">{data.wabaId}</span>
              </div>
            )}
            {data?.connectedAt && (
              <div className="flex justify-between py-2.5">
                <span className="text-neutral-500">Connected</span>
                <span className="text-neutral-700 dark:text-neutral-300">{new Date(data.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleOAuthConnect}>Reconnect</Button>
            <Button variant="danger" size="sm" loading={disconnectMut.isPending}
              onClick={() => { if (confirm('Disconnect WhatsApp? All messaging will stop.')) disconnectMut.mutate(); }}>
              Disconnect
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800">
              <Smartphone className="h-5 w-5 text-neutral-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Not connected</p>
              <p className="text-xs text-neutral-500">Connect your WhatsApp Business number to start messaging</p>
            </div>
          </div>

          <div className="space-y-3">
            <Button onClick={handleOAuthConnect} className="w-full">
              Connect with Meta (OAuth)
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-xs text-neutral-400">or connect manually</span>
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>
            <button onClick={() => setManualOpen((v) => !v)}
              className="w-full text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 text-left">
              {manualOpen ? 'Hide manual setup ↑' : 'Paste Access Token + Phone Number ID ↓'}
            </button>

            {manualOpen && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">Permanent Access Token</label>
                  <input value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="EAAxxxxxx..." className={inputCls} />
                  <p className="mt-1 text-xs text-neutral-400">From Meta Business Suite → WhatsApp → API Setup → Generate Token</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">Phone Number ID</label>
                  <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)}
                    placeholder="1234567890123..." className={inputCls} />
                  <p className="mt-1 text-xs text-neutral-400">From Meta Business Suite → WhatsApp → API Setup → Phone Number ID</p>
                </div>
                <Button loading={manualMut.isPending}
                  disabled={!accessToken.trim() || !phoneNumberId.trim()}
                  onClick={() => manualMut.mutate()}
                  className="w-full">
                  Verify &amp; Connect
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card variant="ghost" className="text-sm text-neutral-500 space-y-1.5">
        <p className="font-medium text-neutral-700 dark:text-neutral-300">How to get your credentials</p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Go to <strong>Meta Business Suite</strong> → <strong>Settings</strong> → <strong>WhatsApp</strong> → <strong>API Setup</strong></li>
          <li>Copy the <strong>Phone Number ID</strong> from the top of the page</li>
          <li>Click <strong>Generate Access Token</strong> and copy the permanent token</li>
          <li>Paste both above and click Verify &amp; Connect</li>
        </ol>
        <p className="text-xs mt-2">Your webhook URL (tell Meta): <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded text-xs">{typeof window !== 'undefined' ? window.location.origin.replace('dashboard', 'api').replace('3001', '3000') : ''}/api/whatsapp/webhook</code></p>
      </Card>
    </div>
  );
}

// ── Targets section ───────────────────────────────────────────────────────────

type TargetPeriod = 'day' | 'month';
interface TargetEntry { target: number; targetPeriod: TargetPeriod; pointsWeight?: number; }
interface TargetsResponse { success: boolean; data: Record<string, TargetEntry>; isCustom: boolean; }

function TargetsSection() {
  const qc = useQueryClient();
  const { metrics } = useMetricsConfig();
  const [form, setForm] = useState<Record<string, TargetEntry>>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-targets'],
    queryFn: () => apiFetch<TargetsResponse>('/api/admin/targets'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (data?.data) {
      const merged: Record<string, TargetEntry> = {};
      metrics.forEach((m) => {
        const stored = data.data[m.key];
        merged[m.key] = {
          target:       stored?.target       ?? m.target,
          targetPeriod: (stored?.targetPeriod ?? m.targetPeriod) as TargetPeriod,
          pointsWeight: stored?.pointsWeight  ?? m.pointsWeight,
        };
      });
      setForm(merged);
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.data]);

  const saveMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'PUT', body: JSON.stringify({ targets: form }) }),
    onSuccess: () => { toast.success('Targets saved'); setDirty(false); qc.invalidateQueries({ queryKey: ['admin-targets'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => apiFetch('/api/admin/targets', { method: 'DELETE' }),
    onSuccess: () => { toast.success('Targets reset to defaults'); qc.invalidateQueries({ queryKey: ['admin-targets'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rebuildMut = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; employeesUpdated: number }>('/api/admin/points-rebuild', { method: 'POST' }),
    onSuccess: (res) => toast.success(`Points rebuilt for ${res.employeesUpdated} employees`),
    onError: (e: Error) => toast.error(e.message),
  });

  function updateField(key: string, field: keyof TargetEntry, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [field]: field === 'targetPeriod' ? value : Number(value) } }));
    setDirty(true);
  }

  const inputCls = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Metric Targets</h2>
          <p className="text-sm text-neutral-500">Set daily or monthly targets for each metric. Changes apply to all employees.</p>
          {data?.isCustom && <span className="mt-1 inline-block rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">Custom targets active</span>}
        </div>
        {data?.isCustom && (
          <Button size="sm" variant="secondary" loading={resetMut.isPending}
            onClick={() => { if (confirm('Reset all targets to system defaults?')) resetMut.mutate(); }}>
            Reset to Defaults
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0,1,2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <Card noPadding>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {metrics.map((m) => {
              const entry = form[m.key];
              if (!entry) return null;
              return (
                <li key={m.key} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <div className="flex w-44 items-center gap-2 shrink-0">
                    <span className="text-lg">{m.icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{m.label}</p>
                      <p className="text-xs text-neutral-400">{m.unit === 'currency' ? '₹ amount' : 'count'}</p>
                    </div>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-24">
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Target ({entry.targetPeriod === 'day' ? 'per day' : 'per month'})</label>
                      <input type="number" min={0} step={m.unit === 'currency' ? 1000 : 1} value={entry.target} onChange={(e) => updateField(m.key, 'target', e.target.value)} className={inputCls} />
                    </div>
                    <div className="w-32">
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Period</label>
                      <select value={entry.targetPeriod} onChange={(e) => updateField(m.key, 'targetPeriod', e.target.value)} className={inputCls}>
                        <option value="day">Daily</option>
                        <option value="month">Monthly</option>
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Points Wt</label>
                      <input type="number" min={1} step={m.unit === 'currency' ? 1000 : 1} value={entry.pointsWeight ?? m.pointsWeight} onChange={(e) => updateField(m.key, 'pointsWeight', e.target.value)} className={inputCls} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={saveMut.isPending} disabled={!dirty} onClick={() => saveMut.mutate()}>Save Targets</Button>
        {dirty && <span className="text-xs text-warning-600">Unsaved changes</span>}
        <div className="ml-auto">
          <Button size="sm" variant="secondary" loading={rebuildMut.isPending}
            onClick={() => { if (confirm('Recalculate ALL employee points from raw metric data?\nThis overwrites the Achievements leaderboard totals.')) rebuildMut.mutate(); }}>
            Rebuild Points
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Audit section ─────────────────────────────────────────────────────────────

const AUDIT_RESULT_BADGE: Record<string, string> = {
  success: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300',
  flagged: 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300',
  approved: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  rejected: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
  failed: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
};

interface AuditLog {
  PK: string; SK: string; userId: string; action: string; target: string;
  result: string; ip: string; timestamp: string;
}

const ACTION_LABELS: Record<string, string> = {
  successful_login: 'Login', failed_login: 'Failed Login',
  metric_added: 'Metric Added', metric_corrected: 'Metric Corrected',
  verify_metric: 'Metric Verified', admin_edit_metric: 'Admin Edit',
  bulk_entry: 'Bulk Entry', create_employee: 'Employee Created',
  employee_updated: 'Employee Updated', employee_permanently_deleted: 'Employee Deleted',
  password_reset: 'Password Reset', setup_2fa: '2FA Setup', reset_2fa: '2FA Reset',
  update_targets: 'Targets Updated', view_analytics: 'Analytics Viewed',
  suspicious_metric_entry: '⚠️ Suspicious Entry',
};

function AuditTable({ rows, suspicious }: { rows: AuditLog[]; suspicious?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            {['Time', 'Action', 'User', 'Target', 'Result', 'IP'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase text-neutral-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
          {rows.map((log, i) => (
            <tr key={log.PK + i} className={cn('hover:bg-neutral-50 dark:hover:bg-neutral-800/40', suspicious && 'bg-error-50/30 dark:bg-error-900/10')}>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-400">
                {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td className={cn('px-4 py-2.5 font-medium', suspicious ? 'text-error-700 dark:text-error-300' : 'text-neutral-800 dark:text-neutral-200')}>
                {ACTION_LABELS[log.action] ?? log.action}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-500">{log.userId?.slice(0, 12)}…</td>
              <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-neutral-500" title={log.target}>{log.target}</td>
              <td className="px-4 py-2.5">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', AUDIT_RESULT_BADGE[log.result] ?? AUDIT_RESULT_BADGE.failed)}>{log.result}</span>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">{log.ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="py-12 text-center text-sm text-neutral-400">No records in this time range</div>}
    </div>
  );
}

function AuditSection() {
  const qc = useQueryClient();
  const [auditTab, setAuditTab] = useState<'logs' | 'suspicious' | 'security'>('logs');
  const [hours, setHours] = useState(24);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['audit-logs', hours],
    queryFn: () => apiFetch<{ success: boolean; data: AuditLog[]; totalRecords: number; timeRange: string }>(`/api/audit/logs?hours=${hours}&limit=500`),
    enabled: auditTab === 'logs',
    staleTime: 60_000,
  });

  const { data: suspData, isLoading: suspLoading } = useQuery({
    queryKey: ['audit-suspicious', hours],
    queryFn: () => apiFetch<{ success: boolean; summary: { failedLogins: number; suspiciousMetrics: number; deletedEmployees: number; totalSuspicious: number }; details: AuditLog[] }>(`/api/audit/suspicious?hours=${hours}`),
    enabled: auditTab === 'suspicious',
    staleTime: 60_000,
  });

  const { data: secData, isLoading: secLoading } = useQuery({
    queryKey: ['audit-security'],
    queryFn: () => apiFetch<{ success: boolean; statistics: { totalActions: number; successfulLogins: number; failedLogins: number; uniqueUsers: number; uniqueIPs: number; suspiciousActivities: number }; highRiskIPs: { ip: string; failedAttempts: number }[]; recommendations: string[]; generatedAt: string; timeRange: string }>('/api/audit/security-report'),
    enabled: auditTab === 'security',
    staleTime: 5 * 60_000,
  });

  const logs = logsData?.data ?? [];
  const uniqueActions = [...new Set(logs.map((l) => l.action))].sort();
  const filtered = logs.filter((log) => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return log.userId?.toLowerCase().includes(q) || log.action?.toLowerCase().includes(q) || log.target?.toLowerCase().includes(q) || log.ip?.includes(q);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Audit Log</h2>
          <p className="text-sm text-neutral-500">Complete trail of all admin and employee actions</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ['audit-logs', hours] })}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={() => window.open(`/api/audit/export?days=${Math.ceil(hours / 24)}`, '_blank')}>
            Export JSON
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 w-fit dark:border-neutral-700 dark:bg-neutral-900">
        {([['logs', 'All Logs'], ['suspicious', 'Suspicious'], ['security', 'Security']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setAuditTab(id)}
            className={cn('rounded-md px-4 py-1.5 text-xs font-medium transition', auditTab === id ? 'bg-primary-600 text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800')}>
            {label}
          </button>
        ))}
      </div>

      {/* Time range */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Time range:</span>
        {([{l:'1h',v:1},{l:'6h',v:6},{l:'24h',v:24},{l:'48h',v:48},{l:'7d',v:168}] as const).map(({l,v}) => (
          <button key={v} onClick={() => setHours(v)}
            className={cn('rounded-full px-3 py-1 text-xs font-semibold transition', hours === v ? 'bg-primary-600 text-white' : 'border border-neutral-200 bg-white text-neutral-600 hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300')}>
            {l}
          </button>
        ))}
      </div>

      {/* Logs tab */}
      {auditTab === 'logs' && (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, action, target, IP…"
                className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
            </div>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
              className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              <option value="all">All Actions</option>
              {uniqueActions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>)}
            </select>
          </div>
          {logsLoading ? <Skeleton className="h-48 w-full" /> : <AuditTable rows={filtered} />}
          {logsData && <p className="text-xs text-neutral-400">Showing {filtered.length} of {logs.length} records · {logsData.timeRange}</p>}
        </>
      )}

      {/* Suspicious tab */}
      {auditTab === 'suspicious' && (
        <>
          {suspLoading ? <Skeleton className="h-48 w-full" /> : suspData && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Suspicious', value: suspData.summary.totalSuspicious, color: 'text-error-600' },
                  { label: 'Failed Logins',    value: suspData.summary.failedLogins,    color: 'text-warning-600' },
                  { label: 'Suspicious Entries',value: suspData.summary.suspiciousMetrics, color: 'text-orange-600' },
                  { label: 'Employee Deletions',value: suspData.summary.deletedEmployees, color: 'text-error-700' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
                  </Card>
                ))}
              </div>
              <AuditTable rows={suspData.details} suspicious />
            </>
          )}
        </>
      )}

      {/* Security tab */}
      {auditTab === 'security' && (
        <>
          {secLoading ? <Skeleton className="h-48 w-full" /> : secData && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Actions',    value: secData.statistics.totalActions,    color: 'text-neutral-900 dark:text-white' },
                  { label: 'Successful Logins',value: secData.statistics.successfulLogins, color: 'text-success-600' },
                  { label: 'Failed Logins',    value: secData.statistics.failedLogins,    color: 'text-error-600' },
                  { label: 'Suspicious',       value: secData.statistics.suspiciousActivities, color: 'text-warning-600' },
                  { label: 'Unique Users',     value: secData.statistics.uniqueUsers,     color: 'text-primary-600' },
                  { label: 'Unique IPs',       value: secData.statistics.uniqueIPs,       color: 'text-primary-500' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
                  </Card>
                ))}
              </div>
              {secData.highRiskIPs.length > 0 && (
                <Card>
                  <h3 className="mb-3 text-sm font-semibold text-error-700 dark:text-error-300">High-Risk IPs</h3>
                  <div className="space-y-2">
                    {secData.highRiskIPs.map(({ ip, failedAttempts }) => (
                      <div key={ip} className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                        <span className="font-mono text-sm font-medium text-neutral-900 dark:text-white">{ip}</span>
                        <Badge variant="error">{failedAttempts} failed attempts</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Recommendations</h3>
                <ul className="space-y-1.5">
                  {secData.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                      <span className="mt-0.5 shrink-0">{rec.startsWith('✅') ? '✅' : rec.startsWith('⚠️') ? '⚠️' : 'ℹ️'}</span>
                      <span>{rec.replace(/^[✅⚠️ℹ️]\s*/, '')}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-neutral-400">Generated: {secData.generatedAt ? new Date(secData.generatedAt).toLocaleString('en-IN') : '—'} · {secData.timeRange}</p>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tags section ──────────────────────────────────────────────────────────────

interface TagEntry { id: string; label: string; color: string; }

const TAG_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#ec4899', '#64748b',
];

function TagsSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [showPalette, setShowPalette] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tag-catalog'],
    queryFn: () => apiFetch<{ success: boolean; tags: TagEntry[] }>('/api/tags'),
    staleTime: 60_000,
  });
  const tags = data?.tags ?? [];
  const filtered = tags.filter((t) => t.label.toLowerCase().includes(search.toLowerCase()));

  const createMut = useMutation({
    mutationFn: ({ label, color }: { label: string; color: string }) =>
      apiFetch('/api/tags', { method: 'POST', body: JSON.stringify({ label, color }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-catalog'] });
      setNewLabel('');
      setCreating(false);
      toast.success('Tag created');
    },
    onError: () => toast.error('Failed to create tag'),
  });

  const canCreate =
    newLabel.trim().length > 0 &&
    !tags.some((t) => t.label.toLowerCase() === newLabel.trim().toLowerCase());

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Tag Manager</h2>
        <p className="text-sm text-neutral-500">Centrally manage all contact tags. Tags created here are available across Inbox, Contacts, Sales, and Automation.</p>
      </div>

      {/* Create new tag */}
      <Card>
        <p className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">Create New Tag</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="mb-1 block text-xs font-medium text-neutral-500">Tag name</label>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canCreate && !creating) { setCreating(true); createMut.mutate({ label: newLabel.trim(), color: newColor }); } }}
              placeholder="e.g. Hot Lead, VIP, Follow Up"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">Color</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPalette((v) => !v)}
                className="relative h-9 w-9 rounded-lg border-2 border-white shadow transition hover:scale-105"
                style={{ backgroundColor: newColor }}
                title="Pick color"
              />
              {showPalette && (
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  {TAG_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setNewColor(c); setShowPalette(false); }}
                      className="h-6 w-6 rounded-full transition hover:scale-110"
                      style={{
                        backgroundColor: c,
                        outline: newColor === c ? `2px solid ${c}` : 'none',
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button
            onClick={() => { setCreating(true); createMut.mutate({ label: newLabel.trim(), color: newColor }); }}
            disabled={!canCreate || createMut.isPending}
            loading={createMut.isPending}
          >
            Create Tag
          </Button>
        </div>
        {newLabel.trim() && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-neutral-400">Preview:</span>
            <span
              className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: newColor + '20', color: newColor, borderColor: newColor + '50' }}
            >
              {newLabel.trim()}
            </span>
          </div>
        )}
      </Card>

      {/* Tag list */}
      <Card noPadding>
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
          <span className="shrink-0 text-xs text-neutral-400">{tags.length} tags</span>
          <button onClick={() => refetch()} className="shrink-0 text-neutral-400 hover:text-neutral-600" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {isLoading && (
          <div className="space-y-2 p-4">
            {[0,1,2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}

        {isError && (
          <div className="py-8 text-center">
            <p className="text-sm text-error-600 dark:text-error-400">Failed to load tags</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {filtered.length === 0 ? (
              <li className="py-10 text-center text-sm text-neutral-400">
                {search ? 'No tags match your search' : 'No tags yet — create your first one above'}
              </li>
            ) : (
              filtered.map((tag) => (
                <li key={tag.id} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: tag.color + '20', color: tag.color, borderColor: tag.color + '50' }}
                  >
                    {tag.label}
                  </span>
                  <span className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">{tag.label}</span>
                  <span className="font-mono text-[10px] text-neutral-300 dark:text-neutral-600">{tag.id?.slice(0, 8)}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </Card>

      <p className="text-xs text-neutral-400">
        Tags are shared across all modules. Newly created tags are immediately available in Inbox, Customer360, Broadcast filters, and Automation workflows.
      </p>
    </div>
  );
}

// ── Stub sections ─────────────────────────────────────────────────────────────

function StubSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        <p className="text-sm text-neutral-500">{description}</p>
      </div>
      <Card variant="ghost" className="py-10 text-center text-sm text-neutral-400">
        {title} settings — coming soon
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SettingsPageInner() {
  const { user, logout } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const isAdmin = ['owner', 'admin'].includes(v3Role);
  const searchParams = useSearchParams();

  const initialSection = (searchParams.get('tab') as SettingsSection | null) ?? 'profile';
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);

  // Sync tab when URL param changes (e.g. navigating from sidebar)
  useEffect(() => {
    const tab = searchParams.get('tab') as SettingsSection | null;
    if (tab) setActiveSection(tab);
  }, [searchParams]);

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  function renderContent() {
    switch (activeSection) {
      case 'profile':       return <ProfileSection />;
      case 'appearance':    return <AppearanceSection />;
      case 'employees':     return <EmployeesSection />;
      case 'whatsapp':      return <WhatsAppSection />;
      case 'notifications': return <StubSection title="Notifications" description="Manage your notification preferences" />;
      case 'security':      return <StubSection title="Security" description="Password, 2FA, and session management" />;
      case 'organisation':  return <StubSection title="Organisation" description="Company name, logo, and timezone" />;
      case 'pipeline':      return <StubSection title="Pipeline Stages" description="Customise your sales pipeline stages" />;
      case 'tags':          return <TagsSection />;
      case 'workflows':     return <StubSection title="Workflow settings" description="Default workflow behaviour" />;
      case 'integrations':  return <StubSection title="Integrations" description="Connect to third-party tools" />;
      case 'billing':       return <StubSection title="Billing & Plan" description="Subscription and payment details" />;
      case 'targets':       return <TargetsSection />;
      case 'metric-config': return <StubSection title="Metric Config" description="Edit metric labels, icons and weights — contact support" />;
      case 'audit':         return <AuditSection />;
      default:              return null;
    }
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 md:flex">
        <div className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Settings</h1>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Settings sections">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              aria-current={activeSection === section.id ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                activeSection === section.id
                  ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800',
              )}
            >
              <span className="shrink-0 text-current opacity-70">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-error-600 hover:bg-error-50 transition-colors dark:hover:bg-error-900/20"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Logout
          </button>
        </div>
      </aside>

      <main className="scrollbar-thin flex-1 overflow-y-auto p-6">
        {renderContent()}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}
