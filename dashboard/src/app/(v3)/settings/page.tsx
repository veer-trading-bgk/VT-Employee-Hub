'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { EditEmployeeModal } from '@/components/EditEmployeeModal';
import { DeleteEmployeeDialog } from '@/components/DeleteEmployeeDialog';
import { EmployeeActionMenu } from '@/components/EmployeeActionMenu';

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

// ── Employee types ─────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  email: string;
  mobileNumber?: string;
  role: Role;
  status: string;
  createdAt: string;
  totpEnabled?: boolean;
}

interface RegisterForm {
  name: string;
  email: string;
  mobileNumber: string;
  password: string;
  role: Role;
  panNumber: string;
  aadhaarNumber: string;
  homeAddress: string;
}

interface EmployeeMetricsResponse {
  success: boolean;
  employee: Employee;
  data: Record<string, Record<string, number>>;
  totalRecords: number;
}

type SortKey = 'name' | 'role' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

// ── Employee helpers ───────────────────────────────────────────────────────────

function generatePassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghijkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#$';
  const all     = upper + lower + digits + special;
  const rand    = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars   = [rand(upper), rand(digits), rand(special),
    ...Array.from({ length: 9 }, () => rand(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function validatePAN(v: string) {
  if (!v) return null;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'Format: ABCDE1234F';
}
function validateAadhaar(v: string) {
  if (!v) return null;
  return /^\d{12}$/.test(v) ? null : 'Must be exactly 12 digits';
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', team_lead: 'Team Lead',
  agent: 'Agent', telecaller: 'Telecaller', intern: 'Intern',
};
const ROLE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'agent', label: 'Agent' },
  { value: 'telecaller', label: 'Telecaller' },
  { value: 'intern', label: 'Intern' },
];

const slateInput = 'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 outline-none transition focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40 transition';
const ghostBtn   = 'inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition dark:border-neutral-700 dark:bg-transparent dark:text-neutral-300 dark:hover:bg-neutral-800';

// ── Mini SVG helpers for modals ───────────────────────────────────────────────

function Svg({ children, size = 14 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const IcX = () => <Svg><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Svg>;

function useEscape(fn: (() => void) | null) {
  useEffect(() => {
    if (!fn) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') fn(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fn]);
}

// ── Pagination bar ─────────────────────────────────────────────────────────────

function PaginationBar({ page, totalItems, pageSize, onPage }: {
  page: number; totalItems: number; pageSize: number; onPage: (p: number) => void;
}) {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalItems);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-400 tabular-nums">{from}–{to} of {totalItems}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page"
          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">‹</button>
        <span className="flex h-7 items-center px-2.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">{page}/{totalPages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages} aria-label="Next page"
          className="flex h-7 w-7 items-center justify-center rounded border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">›</button>
      </div>
    </div>
  );
}

// ── 2FA Setup Modal ────────────────────────────────────────────────────────────

function Setup2FAModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const queryClient = useQueryClient();
  const [result, setResult] = useState<Setup2FAResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const setupMutation = useMutation({
    mutationFn: () => api.setup2fa(employee.id),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['v3-employees'] });
      toast.success(`2FA enabled for ${employee.name}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyAll = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.backupCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Enable 2FA</h2>
            <p className="text-xs text-neutral-500">{employee.name} · {employee.email}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <IcX />
          </button>
        </div>
        <div className="px-6 py-5">
          {!result ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-xs text-primary-700 dark:border-primary-900/40 dark:bg-primary-900/20 dark:text-primary-300">
                <p className="mb-1 font-semibold">What happens next:</p>
                <ul className="list-inside list-disc space-y-0.5 text-primary-600 dark:text-primary-400">
                  <li>Unique TOTP secret generated for {employee.name}</li>
                  <li>5 single-use backup codes created</li>
                  <li>2FA enforced after 7-day grace period</li>
                </ul>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending} className={primaryBtn + ' flex-1 justify-center'}>
                  {setupMutation.isPending ? 'Generating…' : 'Generate 2FA credentials'}
                </button>
                <button onClick={onClose} className={ghostBtn}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-center">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Scan with authenticator app</p>
                <div className="inline-block rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.qrCode} alt="2FA QR Code" className="h-40 w-40" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Manual entry key</p>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 font-mono text-xs text-neutral-700 break-all select-all dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {result.manualEntryKey}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Backup codes — shown once</p>
                  <button onClick={copyAll} className="text-xs text-primary-600 hover:underline dark:text-primary-400">
                    {copied ? '✓ Copied' : 'Copy all'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                  {result.backupCodes.map((code, i) => (
                    <div key={i} className="rounded border border-neutral-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-neutral-700 select-all dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                      {code}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Save these now — they cannot be retrieved later.</p>
              </div>
              <button onClick={onClose} className={primaryBtn + ' w-full justify-center'}>Done — codes have been saved</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reset Password Modal ───────────────────────────────────────────────────────

function ResetPasswordModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const queryClient = useQueryClient();
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);

  const hasUpper  = /[A-Z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasLength = pwd.length >= 8;
  const isValid   = hasUpper && hasNumber && hasLength;
  const strength  = !pwd ? '' : !hasLength ? 'Weak' : (hasUpper && hasNumber) ? 'Strong' : 'Medium';
  const strengthColor = { '': '', Weak: 'bg-error-500', Medium: 'bg-warning-500', Strong: 'bg-success-500' }[strength];

  const mutation = useMutation({
    mutationFn: () => api.resetPassword(employee.id, pwd),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v3-employees'] });
      toast.success(`Password reset for ${employee.name}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Reset Password</h2>
            <p className="text-xs text-neutral-500">{employee.name} · {employee.email}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <IcX />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">New Password</label>
            <div className="relative">
              <input type={show ? 'text' : 'password'} value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Min 8 chars, uppercase, number"
                className={slateInput + ' pr-14'} />
              <button type="button" onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-neutral-400 hover:text-neutral-600">
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {pwd && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-500">Strength</span>
                <span className={cn('font-semibold', strength === 'Strong' ? 'text-success-600' : strength === 'Medium' ? 'text-warning-600' : 'text-error-500')}>{strength}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-700">
                <div className={cn('h-full rounded-full transition-all duration-300', strengthColor)}
                  style={{ width: strength === 'Weak' ? '33%' : strength === 'Medium' ? '66%' : '100%' }} />
              </div>
              <ul className="space-y-0.5 text-xs">
                {([
                  [hasLength,  'At least 8 characters'],
                  [hasUpper,   'Uppercase letter'],
                  [hasNumber,  'Number'],
                ] as [boolean, string][]).map(([ok, label]) => (
                  <li key={label} className={ok ? 'text-success-600' : 'text-neutral-400'}>
                    {ok ? '✓' : '○'} {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-400">
            Employee must use this password on their next login.
          </div>
        </div>
        <div className="flex gap-2 border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending} className={primaryBtn + ' flex-1 justify-center'}>
            {mutation.isPending ? 'Saving…' : 'Set Password'}
          </button>
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Reset 2FA Dialog ───────────────────────────────────────────────────────────

function Reset2FADialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const queryClient = useQueryClient();
  const resetMutation = useMutation({
    mutationFn: () => api.reset2fa(employee.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v3-employees'] });
      toast.success(`2FA disabled for ${employee.name}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Reset 2FA</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <IcX />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            This disables 2FA for <span className="font-semibold text-neutral-900 dark:text-white">{employee.name}</span> and permanently clears all backup codes.
          </p>
          <div className="flex gap-2">
            <button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}
              className="flex-1 rounded-lg bg-error-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-error-700 disabled:opacity-40 transition">
              {resetMutation.isPending ? 'Resetting…' : 'Reset 2FA'}
            </button>
            <button onClick={onClose} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Performance Report Modal ───────────────────────────────────────────────────

function PerformanceReportModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const { metrics, getMetricConfig } = useMetricsConfig();
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['emp-perf-report', employee.id, days],
    queryFn: () => apiFetch<EmployeeMetricsResponse>(`/api/admin/employees/${employee.id}/metrics?days=${days}`),
    staleTime: 2 * 60_000,
  });

  const byDate = data?.data ?? {};
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const metricTotals = metrics.reduce<Record<string, number>>((acc, m) => {
    acc[m.key] = sortedDates.reduce((s, d) => s + (byDate[d]?.[m.key] ?? 0), 0);
    return acc;
  }, {});

  const exportCSV = useCallback(() => {
    const header = ['Date', ...metrics.map((m) => m.label)].join(',');
    const rows = sortedDates.map((d) =>
      [d, ...metrics.map((m) => byDate[d]?.[m.key] ?? 0)].join(',')
    );
    const totalsRow = ['TOTAL', ...metrics.map((m) => metricTotals[m.key])].join(',');
    const csv = [header, ...rows, totalsRow].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance_${employee.name.replace(/\s+/g, '_')}_${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [metrics, byDate, sortedDates, employee.name, days, metricTotals]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Performance Report</h2>
            <p className="text-xs text-neutral-500">{employee.name} · {employee.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5 rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-700">
              {[7, 14, 30, 90].map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={cn('rounded-md px-3 py-1 text-xs font-semibold transition', days === d ? 'bg-primary-600 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400')}>
                  {d}d
                </button>
              ))}
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <IcX />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
                ))}
              </div>
              <div className="h-48 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                {metrics.map((m) => {
                  const cfg = getMetricConfig(m.key);
                  return (
                    <div key={m.key} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/50">
                      <p className="text-xs text-neutral-500">{m.icon} {m.label}</p>
                      <p className="mt-0.5 text-lg font-bold" style={{ color: m.color }}>
                        {cfg ? formatMetricValue(cfg, metricTotals[m.key] ?? 0) : metricTotals[m.key] ?? 0}
                      </p>
                    </div>
                  );
                })}
              </div>
              {sortedDates.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-neutral-200 py-10 text-center dark:border-neutral-700">
                  <p className="text-sm text-neutral-400">No metrics recorded in the last {days} days</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 dark:border-neutral-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400">Date</th>
                        {metrics.map((m) => (
                          <th key={m.key} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-400">{m.icon}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
                      {sortedDates.map((date) => (
                        <tr key={date} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                          <td className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">{date}</td>
                          {metrics.map((m) => {
                            const cfg = getMetricConfig(m.key);
                            const val = byDate[date]?.[m.key] ?? 0;
                            return (
                              <td key={m.key} className="px-4 py-2.5 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                                {val > 0 ? (cfg ? formatMetricValue(cfg, val) : val) : (
                                  <span className="text-neutral-300 dark:text-neutral-600">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <button onClick={exportCSV} disabled={sortedDates.length === 0} className={primaryBtn + ' flex-1 justify-center'}>
            Export CSV
          </button>
          <button onClick={onClose} className={ghostBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Employee Modal ─────────────────────────────────────────────────────────

function AddEmployeeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (name: string) => void }) {
  useEscape(onClose);
  const [form, setForm] = useState<RegisterForm>({
    name: '', email: '', mobileNumber: '', password: generatePassword(), role: 'telecaller',
    panNumber: '', aadhaarNumber: '', homeAddress: '',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [showAdditional, setShowAdditional] = useState(false);

  const panError     = validatePAN(form.panNumber.toUpperCase());
  const aadhaarError = validateAadhaar(form.aadhaarNumber);
  const hasErrors    = !!panError || !!aadhaarError;
  const canSubmit    = !!form.name.trim() && !!form.email.trim() && !hasErrors;

  const addMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {
        name: form.name, email: form.email, password: form.password, role: form.role,
      };
      if (form.mobileNumber)  body.mobileNumber  = form.mobileNumber;
      if (form.panNumber)     body.panNumber     = form.panNumber;
      if (form.aadhaarNumber) body.aadhaarNumber = form.aadhaarNumber;
      if (form.homeAddress)   body.homeAddress   = form.homeAddress;
      return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(body), retries: 0 });
    },
    onSuccess: () => onSuccess(form.name),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Add Employee</h2>
            <p className="text-xs text-neutral-500">Fill in the details below to create an account.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <IcX />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Full Name *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Rajesh Kumar" className={slateInput} autoFocus />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Work Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="rajesh@company.com" className={slateInput} />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Mobile Number</label>
                <input type="tel" inputMode="numeric" value={form.mobileNumber}
                  onChange={(e) => setForm(f => ({ ...f, mobileNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  placeholder="9876543210" maxLength={10} className={slateInput} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Role *</label>
                <select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value as Role }))} className={slateInput}>
                  <option value="telecaller">Telecaller</option>
                  <option value="agent">Agent</option>
                  <option value="intern">Intern</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Temp Password</label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input type={showPwd ? 'text' : 'password'} value={form.password} readOnly
                      className={slateInput + ' pr-10 font-mono text-xs'} />
                    <button type="button" onClick={() => setShowPwd(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-600">
                      {showPwd ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <button type="button" onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}
                    className="shrink-0 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    title="Regenerate">↺</button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700">
              <button type="button" onClick={() => setShowAdditional(v => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-xs font-semibold text-neutral-500">
                  Additional Info <span className="font-normal text-neutral-400">(optional)</span>
                </span>
                <span className="text-neutral-400 flex h-4 w-4 items-center justify-center">
                  {showAdditional ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
              </button>
              {showAdditional && (
                <div className="space-y-3 border-t border-neutral-100 px-4 pb-4 pt-3 dark:border-neutral-800">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">PAN Number</label>
                    <input value={form.panNumber}
                      onChange={(e) => setForm(f => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
                      maxLength={10} placeholder="ABCDE1234F"
                      className={slateInput + ' font-mono uppercase tracking-widest'} />
                    {panError && <p className="mt-1 text-xs text-error-500">{panError}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Aadhaar Number</label>
                    <input value={form.aadhaarNumber}
                      onChange={(e) => setForm(f => ({ ...f, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) }))}
                      placeholder="123456789012" inputMode="numeric"
                      className={slateInput + ' font-mono tracking-widest'} />
                    {aadhaarError && <p className="mt-1 text-xs text-error-500">{aadhaarError}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">Home Address</label>
                    <textarea value={form.homeAddress}
                      onChange={(e) => setForm(f => ({ ...f, homeAddress: e.target.value }))}
                      rows={2} placeholder="Street, City, State, PIN" className={slateInput} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !canSubmit}
            className={primaryBtn + ' flex-1 justify-center'}>
            {addMutation.isPending ? 'Creating…' : 'Create Employee'}
          </button>
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

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

function EmployeesSection() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch]             = useState('');
  const [roleFilter, setRoleFilter]     = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey]           = useState<SortKey>('name');
  const [sortDir, setSortDir]           = useState<SortDir>('asc');
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  const [showAdd, setShowAdd]               = useState(false);
  const [setup2fa, setSetup2fa]             = useState<Employee | null>(null);
  const [reset2fa, setReset2fa]             = useState<Employee | null>(null);
  const [editEmp, setEditEmp]               = useState<Employee | null>(null);
  const [deleteEmp, setDeleteEmp]           = useState<Employee | null>(null);
  const [resetPwd, setResetPwd]             = useState<Employee | null>(null);
  const [reportEmp, setReportEmp]           = useState<Employee | null>(null);
  const [togglingId, setTogglingId]         = useState<string | null>(null);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending]       = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['v3-employees'],
    queryFn: () =>
      apiFetch<{ success: boolean; data: Employee[] }>('/api/admin/employees').catch(() => ({
        success: true, data: [] as Employee[],
      })),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      api.updateEmployee(id, { status }),
    onMutate: ({ id }) => setTogglingId(id),
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['v3-employees'] });
      toast.success(status === 'active' ? 'Employee activated' : 'Employee deactivated');
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setTogglingId(null),
  });

  const employees: Employee[] = data?.data ?? [];

  const activeCount    = useMemo(() => employees.filter(e => e.status === 'active' || !e.status).length, [employees]);
  const frontlineCount = useMemo(() => employees.filter(e => ['agent','telecaller','intern'].includes(e.role)).length, [employees]);
  const active2fa      = useMemo(() => employees.filter(e => e.totpEnabled).length, [employees]);

  const filtered = useMemo(() => employees.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q);
    const matchRole   = roleFilter === 'all' || e.role === roleFilter;
    const isActive    = e.status === 'active' || !e.status;
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? isActive : !isActive);
    return matchSearch && matchRole && matchStatus;
  }), [employees, search, roleFilter, statusFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0;
    if      (sortKey === 'name')      cmp = (a.name ?? '').localeCompare(b.name ?? '');
    else if (sortKey === 'role')      cmp = a.role.localeCompare(b.role);
    else if (sortKey === 'status')    cmp = (+(b.status === 'active' || !b.status)) - (+(a.status === 'active' || !a.status));
    else if (sortKey === 'createdAt') cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    return sortDir === 'asc' ? cmp : -cmp;
  }), [filtered, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter, sortKey, sortDir]);

  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page]
  );

  const allVisibleSelected = paginated.length > 0 && paginated.every(e => selectedIds.has(e.id));
  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => { const s = new Set(prev); paginated.forEach(e => s.delete(e.id)); return s; });
    } else {
      setSelectedIds(prev => { const s = new Set(prev); paginated.forEach(e => s.add(e.id)); return s; });
    }
  };

  const bulkAction = async (status: 'active' | 'inactive') => {
    if (selectedIds.size === 0) return;
    setBulkPending(true);
    try {
      await apiFetch('/api/admin/employees/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selectedIds], status }),
      });
      toast.success(`${selectedIds.size} employees ${status === 'active' ? 'activated' : 'deactivated'}`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['v3-employees'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkPending(false);
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="h-3 w-3 opacity-30 inline ml-0.5" />;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 text-primary-600 inline ml-0.5" />
      : <ChevronDown className="h-3 w-3 text-primary-600 inline ml-0.5" />;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Employees</h2>
          <p className="text-sm text-neutral-500">Manage team members and their access</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800" aria-label="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <Button size="sm" iconLeft={<UserPlus className="h-4 w-4" />} onClick={() => setShowAdd(true)}>
            Add Employee
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total',       value: employees.length },
          { label: 'Active',      value: activeCount },
          { label: 'Frontline',   value: frontlineCount },
          { label: '2FA Secured', value: active2fa },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
            {isLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <>
                <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{label}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="h-9 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm placeholder-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500"
          />
        </div>
        <div className="flex gap-2">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm focus:border-primary-600 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Bulk bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 dark:border-primary-800/40 dark:bg-primary-900/20">
          <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">{selectedIds.size} selected</span>
          <button onClick={() => bulkAction('active')} disabled={bulkPending}
            className="text-xs font-semibold text-success-700 hover:underline disabled:opacity-40">Activate</button>
          <button onClick={() => bulkAction('inactive')} disabled={bulkPending}
            className="text-xs font-semibold text-error-600 hover:underline disabled:opacity-40">Deactivate</button>
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-neutral-400 hover:text-neutral-600">Clear</button>
        </div>
      )}

      {/* Employee table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 dark:border-neutral-800">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600" />
              </th>
              <th onClick={() => onSort('name')} className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600">
                Name <SortIcon col="name" />
              </th>
              <th onClick={() => onSort('role')} className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600">
                Role <SortIcon col="role" />
              </th>
              <th onClick={() => onSort('status')} className="cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600">
                Status <SortIcon col="status" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400">2FA</th>
              <th onClick={() => onSort('createdAt')} className="hidden cursor-pointer px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600 lg:table-cell">
                Joined <SortIcon col="createdAt" />
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/60">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {[0,1,2,3,4,5,6].map((j) => (
                      <td key={j} className="px-4 py-3.5">
                        <Skeleton className="h-3.5 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : paginated.length === 0
              ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-neutral-400">
                    {employees.length === 0 ? 'No employees yet' : 'No employees match your filters'}
                  </td>
                </tr>
              )
              : paginated.map((emp) => {
                  const isActive = emp.status === 'active' || !emp.status;
                  const isSelf   = emp.id === currentUser?.id;
                  return (
                    <tr key={emp.id} className={cn('hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30', selectedIds.has(emp.id) && 'bg-primary-50/40 dark:bg-primary-900/10')}>
                      <td className="px-4 py-3.5">
                        <input type="checkbox" checked={selectedIds.has(emp.id)}
                          onChange={() => {
                            setSelectedIds(prev => {
                              const s = new Set(prev);
                              s.has(emp.id) ? s.delete(emp.id) : s.add(emp.id);
                              return s;
                            });
                          }}
                          className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600"
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={emp.name} size={24} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{emp.name}</p>
                            <p className="truncate text-xs text-neutral-400">{emp.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700">
                          {ROLE_LABEL[emp.role] ?? emp.role}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={isActive ? 'success' : 'default'} dot>
                          {isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        {emp.totpEnabled
                          ? <Badge variant="success">On</Badge>
                          : <Badge variant="default">Off</Badge>}
                      </td>
                      <td className="hidden px-4 py-3.5 lg:table-cell">
                        <span className="text-xs text-neutral-400">
                          {emp.createdAt ? formatDate(emp.createdAt) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <EmployeeActionMenu
                          isActive={isActive}
                          isToggling={togglingId === emp.id}
                          totpEnabled={!!emp.totpEnabled}
                          isSelf={isSelf}
                          onEdit={() => setEditEmp(emp)}
                          onDelete={() => setDeleteEmp(emp)}
                          onResetPwd={() => setResetPwd(emp)}
                          onToggleStatus={() => toggleStatusMutation.mutate({ id: emp.id, status: isActive ? 'inactive' : 'active' })}
                          on2FA={() => emp.totpEnabled ? setReset2fa(emp) : setSetup2fa(emp)}
                          onReport={() => setReportEmp(emp)}
                        />
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {sorted.length > PAGE_SIZE && (
        <div className="flex justify-end">
          <PaginationBar page={page} totalItems={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onSuccess={(name) => {
            toast.success(`${name} has been added`);
            setShowAdd(false);
            queryClient.invalidateQueries({ queryKey: ['v3-employees'] });
          }}
        />
      )}
      {editEmp && <EditEmployeeModal employee={editEmp} onClose={() => setEditEmp(null)} />}
      {deleteEmp && <DeleteEmployeeDialog employee={deleteEmp} onClose={() => setDeleteEmp(null)} />}
      {setup2fa && <Setup2FAModal employee={setup2fa} onClose={() => setSetup2fa(null)} />}
      {reset2fa && <Reset2FADialog employee={reset2fa} onClose={() => setReset2fa(null)} />}
      {resetPwd && <ResetPasswordModal employee={resetPwd} onClose={() => setResetPwd(null)} />}
      {reportEmp && <PerformanceReportModal employee={reportEmp} onClose={() => setReportEmp(null)} />}
    </div>
  );
}

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
  }, [data?.data, metrics]);

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

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const v3Role = toV3Role((user?.role ?? 'telecaller') as Parameters<typeof toV3Role>[0]);
  const isAdmin = ['owner', 'admin'].includes(v3Role);

  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');

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
      case 'tags':          return <StubSection title="Tags" description="Create and manage contact tags" />;
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
