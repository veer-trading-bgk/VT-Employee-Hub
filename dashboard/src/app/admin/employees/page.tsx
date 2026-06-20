'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/layout/Navbar';
import { Loading } from '@/components/common/Loading';
import { apiFetch, api } from '@/lib/api';
import type { Setup2FAResponse } from '@/lib/api';
import { toast } from 'sonner';
import { formatDate } from '@/utils/formatters';
import { EditEmployeeModal } from '@/components/EditEmployeeModal';
import { DeleteEmployeeDialog } from '@/components/DeleteEmployeeDialog';
import { EmployeeActionMenu } from '@/components/EmployeeActionMenu';
import { METRICS, formatMetricValue, getMetricConfig } from '@/lib/metrics.config';
import type { Role } from '@/types';

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

function validatePAN(v: string) {
  if (!v) return null;
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'Format: ABCDE1234F (5 letters, 4 digits, 1 letter)';
}
function validateAadhaar(v: string) {
  if (!v) return null;
  return /^\d{12}$/.test(v) ? null : 'Must be exactly 12 digits';
}
function FieldError({ msg }: { msg: string }) {
  return <p className="mt-1 text-xs text-rose-500">{msg}</p>;
}
function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function generatePassword(): string {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower   = 'abcdefghijkmnpqrstuvwxyz';
  const digits  = '23456789';
  const special = '!@#$';
  const all     = upper + lower + digits + special;
  const rand    = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars = [rand(upper), rand(digits), rand(special),
    ...Array.from({ length: 9 }, () => rand(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

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

const inputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30';
const primaryBtn = 'rounded bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition';
const ghostBtn   = 'rounded border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800';

// ── 2FA Setup Modal ───────────────────────────────────────────────────────────
function Setup2FAModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
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
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Enable 2FA</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.name} · {employee.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">✕</button>
        </div>
        <div className="px-6 py-5">
          {!result ? (
            <div className="space-y-4">
              <div className="rounded border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
                <p className="mb-1 font-semibold">What happens when you generate:</p>
                <ul className="list-inside list-disc space-y-0.5 text-blue-600 dark:text-blue-400">
                  <li>Unique TOTP secret generated for {employee.name}</li>
                  <li>5 single-use backup codes created</li>
                  <li>2FA required after 7-day grace period</li>
                </ul>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending} className={primaryBtn + ' flex-1'}>
                  {setupMutation.isPending ? 'Generating…' : 'Generate 2FA credentials'}
                </button>
                <button onClick={onClose} className={ghostBtn}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-center">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Scan with authenticator app</p>
                <div className="inline-block rounded border border-slate-200 bg-white p-3 dark:border-slate-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.qrCode} alt="2FA QR Code" className="h-40 w-40" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Manual entry key</p>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-xs text-slate-700 break-all select-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {result.manualEntryKey}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Backup codes — shown once</p>
                  <button onClick={copyAll} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                    {copied ? '✓ Copied' : 'Copy all'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  {result.backupCodes.map((code, i) => (
                    <div key={i} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-center font-mono text-xs text-slate-700 select-all dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      {code}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Save these now — they cannot be retrieved later.</p>
              </div>
              <button onClick={onClose} className={primaryBtn + ' w-full'}>Done — codes have been saved</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);

  const hasUpper  = /[A-Z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasLength = pwd.length >= 8;
  const isValid   = hasUpper && hasNumber && hasLength;
  const strength  = !pwd ? '' : !hasLength ? 'Weak' : hasUpper && hasNumber ? 'Strong' : 'Medium';
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
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Reset Password</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.name} · {employee.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">New Password</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Min 8 chars, uppercase, number"
                className="w-full rounded border border-slate-200 bg-white px-3 py-3 pr-14 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
              />
              <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600">
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {pwd && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Strength</span>
                <span className={strength === 'Strong' ? 'text-emerald-600' : strength === 'Medium' ? 'text-amber-600' : 'text-red-500'}>{strength}</span>
              </div>
              <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-700">
                <div className={`h-full rounded transition-all ${strengthColor}`} style={{ width: strength === 'Weak' ? '33%' : strength === 'Medium' ? '66%' : '100%' }} />
              </div>
              <ul className="space-y-0.5 text-xs">
                <li className={hasLength  ? 'text-emerald-600' : 'text-slate-400'}>✓ At least 8 characters</li>
                <li className={hasUpper   ? 'text-emerald-600' : 'text-slate-400'}>✓ Uppercase letter</li>
                <li className={hasNumber  ? 'text-emerald-600' : 'text-slate-400'}>✓ Number</li>
              </ul>
            </div>
          )}
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-400">
            Employee must use this new password on next login.
          </div>
        </div>
        <div className="flex gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button onClick={() => mutation.mutate()} disabled={!isValid || mutation.isPending}
            className="flex-1 rounded bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition">
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
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Reset 2FA</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">✕</button>
        </div>
        <div className="px-6 py-5">
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            This disables 2FA for <span className="font-semibold text-slate-900 dark:text-white">{employee.name}</span> and clears all backup codes.
          </p>
          <div className="flex gap-2">
            <button onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}
              className="flex-1 rounded bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 transition">
              {resetMutation.isPending ? 'Resetting…' : 'Reset 2FA'}
            </button>
            <button onClick={onClose} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Employee Performance Report Modal ─────────────────────────────────────────
function PerformanceReportModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
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
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Performance Report</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{employee.name} · {employee.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700">
              {[7, 14, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`rounded px-3 py-1 text-xs font-semibold transition ${
                    days === d ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loading /></div>
          ) : (
            <div className="space-y-5">
              {/* Metric totals summary */}
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

              {/* Daily breakdown */}
              {sortedDates.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
                  <p className="text-sm text-slate-400">No metrics in last {days} days</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Date</th>
                        {METRICS.map((m) => (
                          <th key={m.key} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                            {m.icon}
                          </th>
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
          <button
            onClick={exportCSV}
            disabled={sortedDates.length === 0}
            className="flex-1 rounded bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition"
          >
            ⬇️ Export CSV
          </button>
          <button onClick={onClose} className={ghostBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminEmployeesPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState<RegisterForm>({ name: '', email: '', password: generatePassword(), role: 'telecaller', panNumber: '', aadhaarNumber: '', homeAddress: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [showAdditional, setShowAdditional] = useState(false);
  const [setup2faEmployee, setSetup2faEmployee] = useState<Employee | null>(null);
  const [reset2faEmployee, setReset2faEmployee] = useState<Employee | null>(null);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [deleteEmployee, setDeleteEmployee] = useState<Employee | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resetPwdEmployee, setResetPwdEmployee] = useState<Employee | null>(null);
  const [reportEmployee, setReportEmployee] = useState<Employee | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-employees'],
    queryFn: () =>
      apiFetch<{ success: boolean; data: Employee[] }>('/api/admin/employees').catch(() => ({
        success: true,
        data: [],
      })),
  });

  const addMutation = useMutation({
    mutationFn: (payload: RegisterForm) => {
      const body: Record<string, string> = {
        name: payload.name, email: payload.email, password: payload.password, role: payload.role,
      };
      if (payload.panNumber)     body.panNumber     = payload.panNumber;
      if (payload.aadhaarNumber) body.aadhaarNumber = payload.aadhaarNumber;
      if (payload.homeAddress)   body.homeAddress   = payload.homeAddress;
      return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(body), retries: 0 });
    },
    onSuccess: () => {
      toast.success(`${form.name} added successfully`);
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      setShowAddModal(false);
      setShowAdditional(false);
      setForm({ name: '', email: '', password: generatePassword(), role: 'telecaller', panNumber: '', aadhaarNumber: '', homeAddress: '' });
    },
    onError: (e: Error) => toast.error(e.message),
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

  const filtered = employees.filter((e) => {
    const matchSearch = !search ||
      e.name?.toLowerCase().includes(search.toLowerCase()) ||
      e.email?.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || e.role === roleFilter;
    const isActive = e.status === 'active' || !e.status;
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? isActive : !isActive);
    return matchSearch && matchRole && matchStatus;
  });

  const byRole = employees.reduce<Record<string, number>>((acc, e) => {
    acc[e.role] = (acc[e.role] ?? 0) + 1;
    return acc;
  }, {});
  const active2fa      = employees.filter((e) => e.totpEnabled).length;
  const activeCount    = employees.filter((e) => e.status === 'active' || !e.status).length;
  const frontlineCount = (byRole['agent'] ?? 0) + (byRole['telecaller'] ?? 0) + (byRole['intern'] ?? 0);

  // ── Bulk operations ───────────────────────────────────────────────────────
  const filteredIds = filtered.map((e) => e.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkSetStatus = async (status: 'active' | 'inactive') => {
    const ids = [...selectedIds].filter((id) => !(status === 'inactive' && id === currentUser?.id));
    if (ids.length === 0) { toast.error('No eligible employees selected'); return; }
    setBulkPending(true);
    try {
      const result = await apiFetch<{ success: boolean; succeeded: number; failed: number }>('/api/admin/employees/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ ids, status }),
        retries: 0,
      });
      toast.success(`${result.succeeded} employee(s) ${status === 'active' ? 'activated' : 'deactivated'}`);
      if (result.failed > 0) toast.warning(`${result.failed} failed`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk operation failed');
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <>
      <Navbar title="Employee Management" showBack />
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl space-y-6 p-6">

          {/* Page header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Employee Directory</h1>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {employees.length} employees · {activeCount} active · {active2fa} with 2FA
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-employees'] })} className={ghostBtn} aria-label="Refresh">
                Refresh
              </button>
              <button onClick={() => setShowAddModal(true)} className={primaryBtn}>
                + Add Employee
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Total',      value: employees.length,  color: 'text-slate-900 dark:text-white' },
              { label: 'Active',     value: activeCount,        color: 'text-emerald-700 dark:text-emerald-300' },
              { label: 'Frontline',  value: frontlineCount,     color: 'text-blue-700 dark:text-blue-300' },
              { label: '2FA Active', value: active2fa,          color: 'text-violet-700 dark:text-violet-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                <p className={`mt-1 text-2xl font-semibold tabular-nums ${color} ${isLoading ? 'opacity-30' : ''}`}>
                  {isLoading ? '—' : value}
                </p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-56 flex-1 rounded border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:ring-blue-900/30"
              aria-label="Search employees"
            />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              aria-label="Filter by role">
              <option value="all">All Roles</option>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="team_lead">Team Lead</option>
              <option value="agent">Agent</option>
              <option value="telecaller">Telecaller</option>
              <option value="intern">Intern</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              aria-label="Filter by status">
              <option value="all">All Status</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          {/* Bulk actions bar */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-900/20">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {selectedIds.size} selected
              </span>
              <button
                onClick={() => bulkSetStatus('active')}
                disabled={bulkPending}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                ✅ Activate
              </button>
              <button
                onClick={() => bulkSetStatus('inactive')}
                disabled={bulkPending}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                ⏸️ Deactivate
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                Clear
              </button>
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loading /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {search || roleFilter !== 'all' || statusFilter !== 'all'
                  ? 'No employees match your filters'
                  : 'No employees yet'}
              </p>
              {!search && roleFilter === 'all' && statusFilter === 'all' && (
                <button onClick={() => setShowAddModal(true)} className={`mt-3 ${primaryBtn}`}>
                  Add first employee
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {filtered.map((emp) => {
                  const isActive = emp.status === 'active' || !emp.status;
                  return (
                    <div key={emp.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(emp.id)}
                            onChange={() => toggleSelectOne(emp.id)}
                            className="h-4 w-4 shrink-0 accent-indigo-600"
                          />
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                            {(emp.name ?? emp.email)?.[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900 dark:text-white">{emp.name ?? '—'}</p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{emp.email}</p>
                          </div>
                        </div>
                        <EmployeeActionMenu
                          isActive={isActive}
                          isToggling={togglingId === emp.id}
                          totpEnabled={emp.totpEnabled ?? false}
                          isSelf={emp.id === currentUser?.id}
                          onEdit={() => setEditEmployee(emp)}
                          onDelete={() => setDeleteEmployee(emp)}
                          onResetPwd={() => setResetPwdEmployee(emp)}
                          onToggleStatus={() => toggleStatusMutation.mutate({ id: emp.id, status: isActive ? 'inactive' : 'active' })}
                          on2FA={() => emp.totpEnabled ? setReset2faEmployee(emp) : setSetup2faEmployee(emp)}
                          onReport={() => setReportEmployee(emp)}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[emp.role] ?? ROLE_STYLE.telecaller}`}>
                          {ROLE_LABEL[emp.role] ?? emp.role}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800'
                            : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                        {emp.totpEnabled && (
                          <span className="rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-800">
                            2FA ✓
                          </span>
                        )}
                      </div>
                      {emp.createdAt && (
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                          Joined {formatDate(emp.createdAt, 'long')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800">
                        <th className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={toggleSelectAll}
                            className="h-3.5 w-3.5 accent-indigo-600"
                            aria-label="Select all"
                          />
                        </th>
                        {['Employee', 'Email', 'Role', 'Status', '2FA', 'Joined', 'Actions'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {filtered.map((emp) => {
                        const isActive = emp.status === 'active' || !emp.status;
                        return (
                          <tr key={emp.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selectedIds.has(emp.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}>
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(emp.id)}
                                onChange={() => toggleSelectOne(emp.id)}
                                className="h-3.5 w-3.5 accent-indigo-600"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                                  {(emp.name ?? emp.email)?.[0]?.toUpperCase()}
                                </div>
                                <span className="font-medium text-slate-900 dark:text-white">{emp.name ?? '—'}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{emp.email}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[emp.role] ?? ROLE_STYLE.telecaller}`}>
                                {ROLE_LABEL[emp.role] ?? emp.role}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${
                                isActive
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800'
                                  : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'
                              }`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                {isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {emp.totpEnabled ? (
                                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-800">On</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700">Off</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500">
                              {emp.createdAt ? formatDate(emp.createdAt, 'long') : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <EmployeeActionMenu
                                isActive={isActive}
                                isToggling={togglingId === emp.id}
                                totpEnabled={emp.totpEnabled ?? false}
                                isSelf={emp.id === currentUser?.id}
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
                  <div className="border-t border-slate-100 px-4 py-3.5 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                    Showing {filtered.length} of {employees.length} employees
                    {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add Employee Modal */}
      {showAddModal && (() => {
        const panError     = validatePAN(form.panNumber.toUpperCase());
        const aadhaarError = validateAadhaar(form.aadhaarNumber);
        const hasErrors    = !!panError || !!aadhaarError;
        const canSubmit    = !!form.name.trim() && !!form.email.trim() && !hasErrors;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Add Employee</h2>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">✕</button>
              </div>
              <div className="overflow-y-auto px-6 py-5">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Full Name *</label>
                    <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Rajesh Kumar" className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Email *</label>
                    <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="rajesh@viirtrading.com" className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Role *</label>
                    <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))} className={inputCls}>
                      <option value="telecaller">Telecaller</option>
                      <option value="agent">Agent</option>
                      <option value="intern">Intern</option>
                      <option value="team_lead">Team Lead</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Auto-generated Password</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input type={showPwd ? 'text' : 'password'} value={form.password} readOnly className={inputCls + ' pr-10 font-mono'} />
                        <button type="button" onClick={() => setShowPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600" aria-label={showPwd ? 'Hide password' : 'Show password'}>
                          {showPwd ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))} className={ghostBtn} title="Regenerate password">
                        New
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">Share with employee after creation.</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700">
                    <button type="button" onClick={() => setShowAdditional((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Additional Information <span className="font-normal normal-case text-slate-400">(optional)</span>
                      </span>
                      <ChevronDown open={showAdditional} />
                    </button>
                    {showAdditional && (
                      <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">PAN Number <span className="text-slate-400">(optional)</span></label>
                          <input value={form.panNumber} onChange={(e) => setForm((f) => ({ ...f, panNumber: e.target.value.toUpperCase() }))} maxLength={10} placeholder="ABCDE1234F" className={`${inputCls} font-mono uppercase tracking-widest`} />
                          {validatePAN(form.panNumber) && <FieldError msg={validatePAN(form.panNumber)!} />}
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Aadhaar Number <span className="text-slate-400">(optional)</span></label>
                          <input value={form.aadhaarNumber} onChange={(e) => setForm((f) => ({ ...f, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) }))} placeholder="123456789012" inputMode="numeric" className={`${inputCls} font-mono tracking-widest`} />
                          {validateAadhaar(form.aadhaarNumber) && <FieldError msg={validateAadhaar(form.aadhaarNumber)!} />}
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Home Address <span className="text-slate-400">(optional)</span></label>
                          <textarea value={form.homeAddress} onChange={(e) => setForm((f) => ({ ...f, homeAddress: e.target.value }))} rows={3} placeholder="Street, City, State, PIN" className={inputCls} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
                <button onClick={() => addMutation.mutate(form)} disabled={addMutation.isPending || !canSubmit} className={primaryBtn + ' flex-1'}>
                  {addMutation.isPending ? 'Creating…' : 'Create Employee'}
                </button>
                <button onClick={() => setShowAddModal(false)} className={ghostBtn}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {editEmployee     && <EditEmployeeModal employee={editEmployee} onClose={() => setEditEmployee(null)} />}
      {deleteEmployee   && <DeleteEmployeeDialog employee={deleteEmployee} onClose={() => setDeleteEmployee(null)} />}
      {setup2faEmployee && <Setup2FAModal employee={setup2faEmployee} onClose={() => setSetup2faEmployee(null)} />}
      {reset2faEmployee && <Reset2FADialog employee={reset2faEmployee} onClose={() => setReset2faEmployee(null)} />}
      {resetPwdEmployee && <ResetPasswordModal employee={resetPwdEmployee} onClose={() => setResetPwdEmployee(null)} />}
      {reportEmployee   && <PerformanceReportModal employee={reportEmployee} onClose={() => setReportEmployee(null)} />}
    </>
  );
}
