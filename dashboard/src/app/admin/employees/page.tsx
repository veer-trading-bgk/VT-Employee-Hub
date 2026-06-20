'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/layout/Navbar';
import { apiFetch, api } from '@/lib/api';
import type { Setup2FAResponse } from '@/lib/api';
import { toast } from 'sonner';
import { formatDate } from '@/utils/formatters';
import { EditEmployeeModal } from '@/components/EditEmployeeModal';
import { DeleteEmployeeDialog } from '@/components/DeleteEmployeeDialog';
import { EmployeeActionMenu } from '@/components/EmployeeActionMenu';
import { METRICS, formatMetricValue, getMetricConfig } from '@/lib/metrics.config';
import type { Role } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  email: string;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  'bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-rose-600',
  'bg-amber-600', 'bg-cyan-600', 'bg-pink-600', 'bg-indigo-600',
  'bg-teal-600', 'bg-orange-500',
];
function avatarColor(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h) ^ id.charCodeAt(i);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function initials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0][0].toUpperCase();
  }
  return (email?.[0] ?? '?').toUpperCase();
}

function validatePAN(v: string) {
  if (!v) return null;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'Format: ABCDE1234F';
}
function validateAadhaar(v: string) {
  if (!v) return null;
  return /^\d{12}$/.test(v) ? null : 'Must be exactly 12 digits';
}

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

// ── Constants ─────────────────────────────────────────────────────────────────
const ROLE_STYLE: Record<string, string> = {
  admin:      'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:ring-violet-800',
  manager:    'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:ring-blue-800',
  team_lead:  'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-300 dark:ring-cyan-800',
  agent:      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800',
  telecaller: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  intern:     'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800',
};
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

const inputCls  = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30';
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition';
const ghostBtn   = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800';

// ── SVG icons (page-level) ────────────────────────────────────────────────────
function Svg({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const IcUsers      = () => <Svg><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Svg>;
const IcUserCheck  = () => <Svg><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></Svg>;
const IcBriefcase  = () => <Svg><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></Svg>;
const IcShieldOk   = () => <Svg><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></Svg>;
const IcSearch     = () => <Svg size={16}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Svg>;
const IcX          = () => <Svg size={14}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Svg>;
const IcRefresh    = () => <Svg size={16}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></Svg>;
const IcPlus       = () => <Svg size={16}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></Svg>;
const IcChevronUp  = () => <Svg size={12}><polyline points="18 15 12 9 6 15"/></Svg>;
const IcChevronDown= () => <Svg size={12}><polyline points="6 9 12 15 18 9"/></Svg>;
const IcSort       = () => <Svg size={12}><line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 5 19 12"/></Svg>;

// ── Escape key hook ───────────────────────────────────────────────────────────
function useEscape(fn: (() => void) | null) {
  useEffect(() => {
    if (!fn) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') fn(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fn]);
}

// ── Pagination bar ────────────────────────────────────────────────────────────
function PaginationBar({ page, totalItems, pageSize, onPage }: {
  page: number; totalItems: number; pageSize: number; onPage: (p: number) => void;
}) {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalItems);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{from}–{to} of {totalItems}</span>
      <div className="flex gap-1">
        <button
          onClick={() => onPage(page - 1)} disabled={page === 1}
          aria-label="Previous page"
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-slate-700 dark:hover:bg-slate-800"
        >‹</button>
        <span className="flex h-7 items-center px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPage(page + 1)} disabled={page === totalPages}
          aria-label="Next page"
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-slate-700 dark:hover:bg-slate-800"
        >›</button>
      </div>
    </div>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr>
      <td className="px-4 py-3.5">
        <div className="h-3.5 w-3.5 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-3.5 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      </td>
      <td className="px-4 py-3.5"><div className="h-3 w-36 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-18 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-16 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-8 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></td>
      <td className="px-4 py-3.5"><div className="h-7 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></td>
    </tr>
  );
}
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-32 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-44 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="h-7 w-7 rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-5 w-16 rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="h-5 w-14 rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  );
}

// ── Sortable column header ────────────────────────────────────────────────────
function SortTh({ label, col, current, dir, onSort }: {
  label: string; col: SortKey; current: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === col;
  return (
    <th
      onClick={() => onSort(col)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col); } }}
      tabIndex={0}
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 dark:hover:text-slate-300"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? 'text-blue-500' : 'opacity-30'}>
          {active ? (dir === 'asc' ? <IcChevronUp /> : <IcChevronDown />) : <IcSort />}
        </span>
      </span>
    </th>
  );
}

// ── 2FA Setup Modal ───────────────────────────────────────────────────────────
function Setup2FAModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const queryClient = useQueryClient();
  const [result, setResult] = useState<Setup2FAResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const setupMutation = useMutation({
    mutationFn: () => api.setup2fa(employee.id),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
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
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Enable 2FA</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.name} · {employee.email}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <IcX />
          </button>
        </div>
        <div className="px-6 py-5">
          {!result ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                <p className="mb-1 font-semibold">What happens next:</p>
                <ul className="list-inside list-disc space-y-0.5 text-blue-600 dark:text-blue-400">
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
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scan with authenticator app</p>
                <div className="inline-block rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.qrCode} alt="2FA QR Code" className="h-40 w-40" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Manual entry key</p>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-xs text-slate-700 break-all select-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {result.manualEntryKey}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Backup codes — shown once</p>
                  <button onClick={copyAll} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                    {copied ? '✓ Copied' : 'Copy all'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  {result.backupCodes.map((code, i) => (
                    <div key={i} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-slate-700 select-all dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
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

// ── Reset Password Modal ──────────────────────────────────────────────────────
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
  const strengthColor = { '': '', Weak: 'bg-red-500', Medium: 'bg-amber-500', Strong: 'bg-emerald-500' }[strength];

  const mutation = useMutation({
    mutationFn: () => api.resetPassword(employee.id, pwd),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      toast.success(`Password reset for ${employee.name}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Reset Password</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.name} · {employee.email}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <IcX />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">New Password</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Min 8 chars, uppercase, number"
                className={inputCls + ' pr-14'}
              />
              <button type="button" onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 hover:text-slate-600">
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {pwd && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Strength</span>
                <span className={strength === 'Strong' ? 'font-semibold text-emerald-600' : strength === 'Medium' ? 'font-semibold text-amber-600' : 'font-semibold text-red-500'}>{strength}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={`h-full rounded-full transition-all duration-300 ${strengthColor}`}
                  style={{ width: strength === 'Weak' ? '33%' : strength === 'Medium' ? '66%' : '100%' }} />
              </div>
              <ul className="space-y-0.5 text-xs">
                {[
                  [hasLength,  'At least 8 characters'],
                  [hasUpper,   'Uppercase letter'],
                  [hasNumber,  'Number'],
                ].map(([ok, label]) => (
                  <li key={label as string} className={ok ? 'text-emerald-600' : 'text-slate-400'}>
                    {ok ? '✓' : '○'} {label as string}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-400">
            Employee must use this password on their next login.
          </div>
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending} className={primaryBtn + ' flex-1 justify-center'}>
            {mutation.isPending ? 'Saving…' : 'Set Password'}
          </button>
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Reset 2FA Dialog ──────────────────────────────────────────────────────────
function Reset2FADialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const queryClient = useQueryClient();
  const resetMutation = useMutation({
    mutationFn: () => api.reset2fa(employee.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      toast.success(`2FA disabled for ${employee.name}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Reset 2FA</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <IcX />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            This disables 2FA for <span className="font-semibold text-slate-900 dark:text-white">{employee.name}</span> and permanently clears all backup codes.
          </p>
          <div className="flex gap-2">
            <button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 transition">
              {resetMutation.isPending ? 'Resetting…' : 'Reset 2FA'}
            </button>
            <button onClick={onClose} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Performance Report Modal ──────────────────────────────────────────────────
function PerformanceReportModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  useEscape(onClose);
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ['employee-metrics', employee.id, days],
    queryFn: () => apiFetch<EmployeeMetricsResponse>(`/api/admin/employees/${employee.id}/metrics?days=${days}`),
    staleTime: 2 * 60_000,
  });

  const byDate = data?.data ?? {};
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const metricTotals = METRICS.reduce<Record<string, number>>((acc, m) => {
    acc[m.key] = sortedDates.reduce((s, d) => s + (byDate[d]?.[m.key] ?? 0), 0);
    return acc;
  }, {});

  const exportCSV = useCallback(() => {
    const header = ['Date', ...METRICS.map((m) => m.label)].join(',');
    const rows = sortedDates.map((d) =>
      [d, ...METRICS.map((m) => byDate[d]?.[m.key] ?? 0)].join(',')
    );
    const totalsRow = ['TOTAL', ...METRICS.map((m) => metricTotals[m.key])].join(',');
    const csv = [header, ...rows, totalsRow].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance_${employee.name.replace(/\s+/g, '_')}_${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [byDate, sortedDates, employee.name, days, metricTotals]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Performance Report</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.name} · {employee.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              {[7, 14, 30, 90].map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${days === d ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}>
                  {d}d
                </button>
              ))}
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <IcX />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
              <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                {METRICS.map((m) => {
                  const cfg = getMetricConfig(m.key);
                  return (
                    <div key={m.key} className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                      <p className="text-xs text-slate-500">{m.icon} {m.label}</p>
                      <p className="mt-0.5 text-lg font-bold" style={{ color: m.color }}>
                        {cfg ? formatMetricValue(cfg, metricTotals[m.key] ?? 0) : metricTotals[m.key] ?? 0}
                      </p>
                    </div>
                  );
                })}
              </div>
              {sortedDates.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
                  <p className="text-sm text-slate-400">No metrics recorded in the last {days} days</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Date</th>
                        {METRICS.map((m) => (
                          <th key={m.key} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">{m.icon}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {sortedDates.map((date) => (
                        <tr key={date} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">{date}</td>
                          {METRICS.map((m) => {
                            const cfg = getMetricConfig(m.key);
                            const val = byDate[date]?.[m.key] ?? 0;
                            return (
                              <td key={m.key} className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                                {val > 0 ? (cfg ? formatMetricValue(cfg, val) : val) : (
                                  <span className="text-slate-300 dark:text-slate-600">—</span>
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
        <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button onClick={exportCSV} disabled={sortedDates.length === 0}
            className={primaryBtn + ' flex-1 justify-center'}>
            Export CSV
          </button>
          <button onClick={onClose} className={ghostBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Employee Modal ────────────────────────────────────────────────────────
function AddEmployeeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (name: string) => void }) {
  useEscape(onClose);
  const [form, setForm] = useState<RegisterForm>({
    name: '', email: '', mobileNumber: '', password: generatePassword(), role: 'telecaller',
    panNumber: '', aadhaarNumber: '', homeAddress: '',
  });
  const [showPwd, setShowPwd]           = useState(false);
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
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Add Employee</h2>
            <p className="text-xs text-slate-500">Fill in the details below to create an account.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <IcX />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">Full Name *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Rajesh Kumar" className={inputCls} autoFocus />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">Work Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="rajesh@viirtrading.com" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">Mobile Number</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={form.mobileNumber}
                  onChange={(e) => setForm(f => ({ ...f, mobileNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  placeholder="9876543210"
                  maxLength={10}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">Role *</label>
                <select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value as Role }))} className={inputCls}>
                  <option value="telecaller">Telecaller</option>
                  <option value="agent">Agent</option>
                  <option value="intern">Intern</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">Temp Password</label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input type={showPwd ? 'text' : 'password'} value={form.password} readOnly
                      className={inputCls + ' pr-10 font-mono text-xs'} />
                    <button type="button" onClick={() => setShowPwd(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600">
                      {showPwd ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <button type="button" onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    title="Regenerate">↺</button>
                </div>
              </div>
            </div>

            {/* Optional info accordion */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setShowAdditional(v => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Additional Info <span className="font-normal text-slate-400">(optional)</span>
                </span>
                <span className="text-slate-400">{showAdditional ? <IcChevronUp /> : <IcChevronDown />}</span>
              </button>
              {showAdditional && (
                <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">PAN Number</label>
                    <input value={form.panNumber}
                      onChange={(e) => setForm(f => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
                      maxLength={10} placeholder="ABCDE1234F"
                      className={inputCls + ' font-mono uppercase tracking-widest'} />
                    {panError && <p className="mt-1 text-xs text-rose-500">{panError}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Aadhaar Number</label>
                    <input value={form.aadhaarNumber}
                      onChange={(e) => setForm(f => ({ ...f, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) }))}
                      placeholder="123456789012" inputMode="numeric"
                      className={inputCls + ' font-mono tracking-widest'} />
                    {aadhaarError && <p className="mt-1 text-xs text-rose-500">{aadhaarError}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Home Address</label>
                    <textarea value={form.homeAddress}
                      onChange={(e) => setForm(f => ({ ...f, homeAddress: e.target.value }))}
                      rows={2} placeholder="Street, City, State, PIN" className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminEmployeesPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  // Filter state
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Pagination
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  // Modal state
  const [showAddModal, setShowAddModal]         = useState(false);
  const [setup2faEmployee, setSetup2faEmployee] = useState<Employee | null>(null);
  const [reset2faEmployee, setReset2faEmployee] = useState<Employee | null>(null);
  const [editEmployee, setEditEmployee]         = useState<Employee | null>(null);
  const [deleteEmployee, setDeleteEmployee]     = useState<Employee | null>(null);
  const [resetPwdEmployee, setResetPwdEmployee] = useState<Employee | null>(null);
  const [reportEmployee, setReportEmployee]     = useState<Employee | null>(null);
  const [togglingId, setTogglingId]             = useState<string | null>(null);

  // Bulk state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-employees'],
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
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      toast.success(status === 'active' ? 'Employee activated' : 'Employee deactivated');
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setTogglingId(null),
  });

  const employees: Employee[] = data?.data ?? [];

  // Stats
  const byRole        = useMemo(() => employees.reduce<Record<string, number>>((a, e) => { a[e.role] = (a[e.role] ?? 0) + 1; return a; }, {}), [employees]);
  const activeCount   = useMemo(() => employees.filter(e => e.status === 'active' || !e.status).length, [employees]);
  const inactiveCount = useMemo(() => employees.length - activeCount, [employees, activeCount]);
  const active2fa     = useMemo(() => employees.filter(e => e.totpEnabled).length, [employees]);
  const frontlineCount = useMemo(() => (byRole['agent'] ?? 0) + (byRole['telecaller'] ?? 0) + (byRole['intern'] ?? 0), [byRole]);

  // Filter
  const filtered = useMemo(() => employees.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q);
    const matchRole   = roleFilter === 'all' || e.role === roleFilter;
    const isActive    = e.status === 'active' || !e.status;
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? isActive : !isActive);
    return matchSearch && matchRole && matchStatus;
  }), [employees, search, roleFilter, statusFilter]);

  // Sort
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

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter, sortKey, sortDir]);

  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page, PAGE_SIZE]
  );

  const hasFilters = search !== '' || roleFilter !== 'all' || statusFilter !== 'all';
  const clearFilters = () => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); };

  // Bulk
  const filteredIds          = useMemo(() => filtered.map(e => e.id), [filtered]);
  const allFilteredSelected  = useMemo(
    () => filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id)),
    [filteredIds, selectedIds]
  );
  const someFilteredSelected = useMemo(
    () => !allFilteredSelected && filteredIds.some(id => selectedIds.has(id)),
    [filteredIds, selectedIds, allFilteredSelected]
  );
  const toggleSelectAll      = () => setSelectedIds(allFilteredSelected ? new Set() : new Set(filteredIds));
  const toggleSelectOne     = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulkSetStatus = async (status: 'active' | 'inactive') => {
    const ids = [...selectedIds].filter(id => !(status === 'inactive' && id === currentUser?.id));
    if (!ids.length) { toast.error('No eligible employees selected'); return; }
    setBulkPending(true);
    try {
      const res = await apiFetch<{ success: boolean; succeeded: number; failed: number }>(
        '/api/admin/employees/bulk-status', { method: 'POST', body: JSON.stringify({ ids, status }), retries: 0 }
      );
      toast.success(`${res.succeeded} employee(s) ${status === 'active' ? 'activated' : 'deactivated'}`);
      if (res.failed) toast.warning(`${res.failed} update(s) failed`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk operation failed');
    } finally {
      setBulkPending(false);
    }
  };

  // KPI card data
  const kpiCards = useMemo(() => [
    {
      label: 'Total',
      value: employees.length,
      icon: <IcUsers />,
      accent: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
      value_color: 'text-slate-900 dark:text-white',
      sub: `${Object.keys(byRole).length} roles`,
      onClick: () => clearFilters(),
      clickable: hasFilters,
    },
    {
      label: 'Active',
      value: activeCount,
      icon: <IcUserCheck />,
      accent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      value_color: 'text-emerald-700 dark:text-emerald-300',
      sub: `${inactiveCount} inactive`,
      onClick: () => setStatusFilter('active'),
      clickable: statusFilter !== 'active',
    },
    {
      label: 'Frontline',
      value: frontlineCount,
      icon: <IcBriefcase />,
      accent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      value_color: 'text-blue-700 dark:text-blue-300',
      sub: 'agents, callers, interns',
      onClick: undefined,
      clickable: false,
    },
    {
      label: '2FA Secured',
      value: active2fa,
      icon: <IcShieldOk />,
      accent: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
      value_color: 'text-violet-700 dark:text-violet-300',
      sub: employees.length ? `${Math.round(active2fa / employees.length * 100)}% coverage` : '—',
      onClick: undefined,
      clickable: false,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [employees.length, activeCount, inactiveCount, frontlineCount, active2fa, byRole, statusFilter, hasFilters]);

  return (
    <>
      <Navbar title="Employee Management" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">

          {/* ── Page header ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                <IcUsers />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900 dark:text-white sm:text-lg">Employee Directory</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isLoading ? 'Loading…' : `${employees.length} members · ${activeCount} active · ${active2fa} with 2FA`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-employees'] })}
                title="Refresh"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <IcRefresh />
              </button>
              <button onClick={() => setShowAddModal(true)} className={primaryBtn}>
                <IcPlus /> Add Employee
              </button>
            </div>
          </div>

          {/* ── KPI cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpiCards.map(({ label, value, icon, accent, value_color, sub, onClick, clickable }) => (
              <button
                key={label}
                onClick={onClick}
                disabled={!clickable}
                className={`group rounded-xl border border-slate-200 bg-white p-4 text-left transition dark:border-slate-800 dark:bg-slate-900 ${
                  clickable ? 'cursor-pointer hover:border-blue-300 hover:shadow-sm dark:hover:border-blue-700' : 'cursor-default'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm ${accent}`}>
                    {icon}
                  </span>
                  {clickable && (
                    <span className="text-xs font-medium text-blue-500 opacity-0 transition group-hover:opacity-100">
                      Filter →
                    </span>
                  )}
                </div>
                <p className={`mt-3 text-2xl font-bold tabular-nums leading-none ${value_color} ${isLoading ? 'opacity-20' : ''}`}>
                  {isLoading ? '–' : value}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
                {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
              </button>
            ))}
          </div>

          {/* ── Search + filters ───────────────────────────────────────────── */}
          <div className="space-y-2.5">
            {/* Search */}
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                <IcSearch />
              </div>
              <input
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-24 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
                aria-label="Search employees"
              />
              <div className="absolute inset-y-0 right-2 flex items-center gap-1.5">
                {search && (
                  <>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {filtered.length}
                    </span>
                    <button
                      onClick={() => setSearch('')}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                      aria-label="Clear search"
                    >
                      <IcX />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Role chips + status segmented */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Role chips */}
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
                {ROLE_OPTIONS.map(({ value, label }) => {
                  const count = value === 'all' ? employees.length : (byRole[value] ?? 0);
                  const active = roleFilter === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setRoleFilter(value)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? value === 'all'
                            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                            : `${ROLE_STYLE[value] ?? ROLE_STYLE.telecaller} ring-2`
                          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700'
                      }`}
                    >
                      {label}
                      {value !== 'all' && count > 0 && (
                        <span className="opacity-60">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Status segmented control */}
              <div className="ml-auto flex shrink-0 gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                {[
                  { val: 'all', label: 'All' },
                  { val: 'active', label: 'Active' },
                  { val: 'inactive', label: 'Inactive' },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => setStatusFilter(val)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      statusFilter === val
                        ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Active filter summary */}
            {hasFilters && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Showing <strong className="text-slate-700 dark:text-slate-200">{filtered.length}</strong> of {employees.length} employees
                </span>
                <button onClick={clearFilters} className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                  Clear all filters
                </button>
              </div>
            )}
          </div>

          {/* ── Bulk action bar ────────────────────────────────────────────── */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-800/50 dark:bg-indigo-900/20">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                {selectedIds.size}
              </div>
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {selectedIds.size === 1 ? '1 employee' : `${selectedIds.size} employees`} selected
              </span>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => bulkSetStatus('active')}
                  disabled={bulkPending}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                >
                  <span className="sm:hidden">Activate</span>
                  <span className="hidden sm:inline">Activate selected</span>
                </button>
                <button
                  onClick={() => bulkSetStatus('inactive')}
                  disabled={bulkPending}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                >
                  <span className="sm:hidden">Deactivate</span>
                  <span className="hidden sm:inline">Deactivate selected</span>
                </button>
                <button onClick={() => setSelectedIds(new Set())}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-600 dark:hover:bg-slate-800">
                  <IcX />
                </button>
              </div>
            </div>
          )}

          {/* ── Content ───────────────────────────────────────────────────── */}
          {isLoading ? (
            <>
              {/* Desktop skeleton */}
              <div className="hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <th className="px-4 py-3" />
                        {['Employee', 'Email', 'Role', 'Status', '2FA', 'Joined', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-300 dark:text-slate-600">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}</tbody>
                  </table>
                </div>
              </div>
              {/* Mobile skeleton */}
              <div className="space-y-3 md:hidden">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            </>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                <IcUsers />
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                {hasFilters ? 'No employees match your filters' : 'No employees yet'}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {hasFilters ? 'Try adjusting your search or filters.' : 'Add your first team member to get started.'}
              </p>
              {hasFilters ? (
                <button onClick={clearFilters} className="mt-4 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
                  Clear all filters
                </button>
              ) : (
                <button onClick={() => setShowAddModal(true)} className={`mt-4 ${primaryBtn}`}>
                  <IcPlus /> Add first employee
                </button>
              )}
            </div>
          ) : (
            <>
              {/* ── Mobile cards ─────────────────────────────────────────── */}
              <div className="space-y-2.5 md:hidden">
                {paginated.map((emp) => {
                  const isActive = emp.status === 'active' || !emp.status;
                  const isSelf   = emp.id === currentUser?.id;
                  const ac       = avatarColor(emp.id);
                  const init     = initials(emp.name, emp.email);
                  return (
                    <div key={emp.id}
                      className={`rounded-xl border bg-white p-4 transition dark:bg-slate-900 ${
                        selectedIds.has(emp.id)
                          ? 'border-indigo-300 ring-1 ring-indigo-300 dark:border-indigo-700 dark:ring-indigo-700'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {/* Top row */}
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(emp.id)}
                          onChange={() => toggleSelectOne(emp.id)}
                          aria-label={`Select ${emp.name ?? emp.email}`}
                          className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
                        />
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${ac}`}>
                          {init}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{emp.name ?? '—'}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{emp.email}</p>
                        </div>
                        <EmployeeActionMenu
                          isActive={isActive} isToggling={togglingId === emp.id}
                          totpEnabled={emp.totpEnabled ?? false} isSelf={isSelf}
                          onEdit={() => setEditEmployee(emp)}
                          onDelete={() => setDeleteEmployee(emp)}
                          onResetPwd={() => setResetPwdEmployee(emp)}
                          onToggleStatus={() => toggleStatusMutation.mutate({ id: emp.id, status: isActive ? 'inactive' : 'active' })}
                          on2FA={() => emp.totpEnabled ? setReset2faEmployee(emp) : setSetup2faEmployee(emp)}
                          onReport={() => setReportEmployee(emp)}
                        />
                      </div>

                      {/* Badges */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_STYLE[emp.role] ?? ROLE_STYLE.telecaller}`}>
                          {ROLE_LABEL[emp.role] ?? emp.role}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800'
                            : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          emp.totpEnabled
                            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-800'
                            : 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800'
                        }`}>
                          {emp.totpEnabled ? '2FA on' : '2FA off'}
                        </span>
                      </div>

                      {/* Bottom row: quick actions + join date */}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {emp.createdAt && (
                          <p className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                            {formatDate(emp.createdAt, 'short')}
                          </p>
                        )}
                        <div className="ml-auto flex gap-1.5">
                          <button
                            onClick={() => setEditEmployee(emp)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            Edit
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => toggleStatusMutation.mutate({ id: emp.id, status: isActive ? 'inactive' : 'active' })}
                              disabled={togglingId === emp.id}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
                                isActive
                                  ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
                              }`}
                            >
                              {togglingId === emp.id ? '…' : isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mobile pagination */}
              {sorted.length > PAGE_SIZE && (
                <div className="flex justify-center py-2 md:hidden">
                  <PaginationBar page={page} totalItems={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
                </div>
              )}

              {/* ── Desktop table ─────────────────────────────────────────── */}
              <div className="hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <th className="w-10 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }}
                            onChange={toggleSelectAll}
                            className="h-3.5 w-3.5 accent-indigo-600"
                            aria-label="Select all"
                          />
                        </th>
                        <SortTh label="Employee" col="name"      current={sortKey} dir={sortDir} onSort={onSort} />
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Email</th>
                        <SortTh label="Role"     col="role"      current={sortKey} dir={sortDir} onSort={onSort} />
                        <SortTh label="Status"   col="status"    current={sortKey} dir={sortDir} onSort={onSort} />
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">2FA</th>
                        <SortTh label="Joined"   col="createdAt" current={sortKey} dir={sortDir} onSort={onSort} />
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {paginated.map((emp) => {
                        const isActive = emp.status === 'active' || !emp.status;
                        const isSelf   = emp.id === currentUser?.id;
                        const ac       = avatarColor(emp.id);
                        const init     = initials(emp.name, emp.email);
                        return (
                          <tr key={emp.id} className={`transition-colors ${
                            selectedIds.has(emp.id)
                              ? 'bg-indigo-50/60 dark:bg-indigo-900/10'
                              : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                          }`}>
                            <td className="px-4 py-3.5">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(emp.id)}
                                onChange={() => toggleSelectOne(emp.id)}
                                className="h-3.5 w-3.5 accent-indigo-600"
                              />
                            </td>
                            <td className="px-4 py-3.5" style={{ maxWidth: '260px' }}>
                              <div className="flex min-w-0 items-center gap-3">
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${ac}`}>
                                  {init}
                                </div>
                                <span className="min-w-0 truncate font-medium text-slate-900 dark:text-white" title={emp.name ?? undefined}>{emp.name ?? '—'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400" style={{ maxWidth: '280px' }}>
                              <span className="block truncate" title={emp.email}>{emp.email}</span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_STYLE[emp.role] ?? ROLE_STYLE.telecaller}`}>
                                {ROLE_LABEL[emp.role] ?? emp.role}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                isActive
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800'
                                  : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'
                              }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                                {isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                emp.totpEnabled
                                  ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-800'
                                  : 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800'
                              }`}>
                                {emp.totpEnabled ? 'On' : 'Off'}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-400 dark:text-slate-500">
                              {emp.createdAt ? formatDate(emp.createdAt, 'long') : '—'}
                            </td>
                            <td className="px-4 py-3.5">
                              <EmployeeActionMenu
                                isActive={isActive} isToggling={togglingId === emp.id}
                                totpEnabled={emp.totpEnabled ?? false} isSelf={isSelf}
                                onEdit={() => setEditEmployee(emp)}
                                onDelete={() => setDeleteEmployee(emp)}
                                onResetPwd={() => setResetPwdEmployee(emp)}
                                onToggleStatus={() => toggleStatusMutation.mutate({ id: emp.id, status: isActive ? 'inactive' : 'active' })}
                                on2FA={() => emp.totpEnabled ? setReset2faEmployee(emp) : setSetup2faEmployee(emp)}
                                onReport={() => setReportEmployee(emp)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {hasFilters
                        ? `${sorted.length} of ${employees.length} employees`
                        : `${employees.length} employee${employees.length !== 1 ? 's' : ''}`}
                      {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
                    </p>
                    <div className="flex items-center gap-4">
                      {selectedIds.size > 0 && (
                        <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                          Clear selection
                        </button>
                      )}
                      <PaginationBar page={page} totalItems={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddEmployeeModal
          onClose={() => setShowAddModal(false)}
          onSuccess={(name) => {
            toast.success(`${name} added successfully`);
            queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
            setShowAddModal(false);
          }}
        />
      )}
      {editEmployee     && <EditEmployeeModal employee={editEmployee} onClose={() => setEditEmployee(null)} />}
      {deleteEmployee   && <DeleteEmployeeDialog employee={deleteEmployee} onClose={() => setDeleteEmployee(null)} />}
      {setup2faEmployee && <Setup2FAModal employee={setup2faEmployee} onClose={() => setSetup2faEmployee(null)} />}
      {reset2faEmployee && <Reset2FADialog employee={reset2faEmployee} onClose={() => setReset2faEmployee(null)} />}
      {resetPwdEmployee && <ResetPasswordModal employee={resetPwdEmployee} onClose={() => setResetPwdEmployee(null)} />}
      {reportEmployee   && <PerformanceReportModal employee={reportEmployee} onClose={() => setReportEmployee(null)} />}
    </>
  );
}
